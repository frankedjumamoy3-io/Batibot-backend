import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { verify as verifyPassword } from "argon2";
import { jwtVerify, SignJWT } from "jose";

import type { Environment } from "../config/environment.js";
import type { DatabasePool } from "../database/pool.js";
import { ApiError } from "../http/api-error.js";
import type { AppUser, AuthSession, PublicAppUser } from "./types.js";
import type { UserRepository } from "./user-repository.js";

interface RefreshTokenRow {
  expires_at: Date;
  family_id: string;
  id: string;
  replaced_by_token_id: string | null;
  revoked_at: Date | null;
  user_id: string;
}

interface AuthConfiguration {
  accessTokenSecret: string;
  accessTokenTtlMinutes: number;
  audience: string;
  issuer: string;
  refreshTokenSecret: string;
  refreshTokenTtlDays: number;
}

function invalidCredentials() {
  return new ApiError(401, "AUTH_INVALID_CREDENTIALS", "The email or password is incorrect.");
}

function invalidToken() {
  return new ApiError(401, "AUTH_INVALID_TOKEN", "The session is invalid or has expired.");
}

function toPublicUser(user: AppUser): PublicAppUser {
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    role: user.role,
    status: user.status,
    updatedAt: user.updatedAt,
  };
}

export class AuthService {
  private readonly accessTokenKey: Uint8Array;
  private readonly configuration: AuthConfiguration;

  constructor(
    private readonly pool: DatabasePool,
    private readonly users: UserRepository,
    environment: Environment
  ) {
    if (!environment.JWT_ACCESS_SECRET || environment.JWT_ACCESS_SECRET.length < 32) {
      throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters.");
    }
    if (!environment.JWT_REFRESH_SECRET || environment.JWT_REFRESH_SECRET.length < 32) {
      throw new Error("JWT_REFRESH_SECRET must contain at least 32 characters.");
    }

    this.configuration = {
      accessTokenSecret: environment.JWT_ACCESS_SECRET,
      accessTokenTtlMinutes: environment.ACCESS_TOKEN_TTL_MINUTES,
      audience: environment.JWT_AUDIENCE,
      issuer: environment.JWT_ISSUER,
      refreshTokenSecret: environment.JWT_REFRESH_SECRET,
      refreshTokenTtlDays: environment.REFRESH_TOKEN_TTL_DAYS,
    };
    this.accessTokenKey = new TextEncoder().encode(this.configuration.accessTokenSecret);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const user = await this.users.findActiveByEmail(email.trim().toLowerCase());
    if (!user) {
      throw invalidCredentials();
    }

    let validPassword: boolean;
    try {
      validPassword = await verifyPassword(user.passwordHash, password);
    } catch {
      validPassword = false;
    }

    if (!validPassword) {
      throw invalidCredentials();
    }

    return this.createSession(user, randomUUID());
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<RefreshTokenRow>(
        `SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_token_id
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );
      const storedToken = tokenResult.rows[0];

      if (!storedToken) {
        await client.query("ROLLBACK");
        throw invalidToken();
      }

      if (storedToken.revoked_at) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
           WHERE family_id = $1`,
          [storedToken.family_id]
        );
        await client.query("COMMIT");
        throw invalidToken();
      }

      if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1",
          [storedToken.id]
        );
        await client.query("COMMIT");
        throw invalidToken();
      }

      const user = await this.users.findActiveById(storedToken.user_id);
      if (!user) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
           WHERE family_id = $1`,
          [storedToken.family_id]
        );
        await client.query("COMMIT");
        throw invalidToken();
      }

      const nextRefreshToken = this.generateRefreshToken();
      const nextTokenId = randomUUID();
      const nextExpiration = this.getRefreshExpiration();
      await client.query(
        `INSERT INTO refresh_tokens (
           id, user_id, family_id, token_hash, expires_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          nextTokenId,
          user.id,
          storedToken.family_id,
          this.hashRefreshToken(nextRefreshToken),
          nextExpiration,
        ]
      );
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = CURRENT_TIMESTAMP,
             last_used_at = CURRENT_TIMESTAMP,
             replaced_by_token_id = $2
         WHERE id = $1`,
        [storedToken.id, nextTokenId]
      );
      await client.query("COMMIT");

      return {
        ...(await this.createAccessSession(user)),
        refreshToken: nextRefreshToken,
        refreshTokenExpiresAt: nextExpiration.toISOString(),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The transaction may already be committed for a security revocation.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           last_used_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  async authenticateAccessToken(accessToken: string): Promise<PublicAppUser> {
    try {
      const result = await jwtVerify(accessToken, this.accessTokenKey, {
        algorithms: ["HS256"],
        audience: this.configuration.audience,
        issuer: this.configuration.issuer,
      });
      if (!result.payload.sub) {
        throw invalidToken();
      }

      const user = await this.users.findActiveById(result.payload.sub);
      if (!user) {
        throw invalidToken();
      }

      return toPublicUser(user);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw invalidToken();
    }
  }

  private async createSession(user: AppUser, familyId: string): Promise<AuthSession> {
    const refreshToken = this.generateRefreshToken();
    const refreshTokenExpiresAt = this.getRefreshExpiration();
    await this.pool.query(
      `INSERT INTO refresh_tokens (
         id, user_id, family_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        user.id,
        familyId,
        this.hashRefreshToken(refreshToken),
        refreshTokenExpiresAt,
      ]
    );

    return {
      ...(await this.createAccessSession(user)),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  private async createAccessSession(user: AppUser) {
    const expiresInSeconds = this.configuration.accessTokenTtlMinutes * 60;
    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(this.configuration.issuer)
      .setAudience(this.configuration.audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(this.accessTokenKey);

    return {
      accessToken,
      accessTokenExpiresInSeconds: expiresInSeconds,
      tokenType: "Bearer" as const,
      user: toPublicUser(user),
    };
  }

  private generateRefreshToken() {
    return randomBytes(48).toString("base64url");
  }

  private hashRefreshToken(refreshToken: string) {
    return createHmac("sha256", this.configuration.refreshTokenSecret)
      .update(refreshToken)
      .digest("hex");
  }

  private getRefreshExpiration() {
    return new Date(Date.now() + this.configuration.refreshTokenTtlDays * 24 * 60 * 60 * 1_000);
  }
}
