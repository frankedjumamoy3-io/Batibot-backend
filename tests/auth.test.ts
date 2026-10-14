import { hash as hashPassword } from "argon2";
import { SignJWT } from "jose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import type { DatabasePool } from "../src/database/pool.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

const ADMIN_EMAIL = "admin@example.test";
const ADMIN_PASSWORD = "Controlled-Test-Password-123!";

describe("controlled administrator authentication", () => {
  let pool: DatabasePool;
  let users: UserRepository;
  let authService: AuthService;

  beforeEach(async () => {
    pool = await createMigratedTestPool();
    users = new UserRepository(pool);
    authService = new AuthService(pool, users, testEnvironment);
    await users.upsertControlledAdmin({
      displayName: "Test Administrator",
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD, {
        memoryCost: 4_096,
        timeCost: 2,
      }),
    });
  });

  afterEach(async () => {
    await pool?.end();
  });

  it("signs in a controlled admin and returns the current account", async () => {
    const app = createApp(testEnvironment, { authService });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    expect(login.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: "Bearer",
      user: {
        displayName: "Test Administrator",
        email: ADMIN_EMAIL,
        role: "admin",
      },
    });
    expect(login.body.data.user.passwordHash).toBeUndefined();

    const currentUser = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .expect(200);

    expect(currentUser.body.data.user).toMatchObject({
      email: ADMIN_EMAIL,
      role: "admin",
    });
  });

  it("uses a generic response for invalid credentials", async () => {
    const app = createApp(testEnvironment, { authService });
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" })
      .expect(401);

    expect(response.body.error).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "The email or password is incorrect.",
    });
  });

  it("rotates refresh tokens and rejects reuse of the old token family", async () => {
    const app = createApp(testEnvironment, { authService });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const originalRefreshToken = login.body.data.refreshToken as string;
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalRefreshToken })
      .expect(200);

    expect(refreshed.body.data.refreshToken).not.toBe(originalRefreshToken);

    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalRefreshToken })
      .expect(401);
    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: refreshed.body.data.refreshToken })
      .expect(401);
  });

  it("revokes a refresh token during logout", async () => {
    const app = createApp(testEnvironment, { authService });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);
  });

  it("rejects expired refresh tokens", async () => {
    const app = createApp(testEnvironment, { authService });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    await pool.query(
      "UPDATE refresh_tokens SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'"
    );

    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);
  });

  it("rejects expired access tokens", async () => {
    const app = createApp(testEnvironment, { authService });
    const expiredToken = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("00000000-0000-0000-0000-000000000001")
      .setIssuer(testEnvironment.JWT_ISSUER)
      .setAudience(testEnvironment.JWT_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 60)
      .sign(new TextEncoder().encode(testEnvironment.JWT_ACCESS_SECRET!));

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);
    expect(response.body.error.code).toBe("AUTH_INVALID_TOKEN");
  });

  it("enforces authentication and administrator roles", async () => {
    const app = createApp(testEnvironment, { authService });
    await request(app).get("/api/v1/admin/status").expect(401);

    await users.upsertControlledAdmin({
      displayName: "Controlled Tester",
      email: "tester@example.test",
      passwordHash: await hashPassword(ADMIN_PASSWORD, {
        memoryCost: 4_096,
        timeCost: 2,
      }),
    });
    await pool.query("UPDATE app_users SET role = 'tester' WHERE email = $1", [
      "tester@example.test",
    ]);
    const testerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "tester@example.test", password: ADMIN_PASSWORD })
      .expect(200);

    const denied = await request(app)
      .get("/api/v1/admin/status")
      .set("Authorization", `Bearer ${testerLogin.body.data.accessToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });
});
