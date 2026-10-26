import { randomUUID } from "node:crypto";

import type { DatabasePool } from "../database/pool.js";
import type { AppRole, AppUser, AppUserStatus } from "./types.js";

interface AppUserRow {
  grade_level: string | null;
  created_at: Date;
  display_name: string;
  email: string;
  id: string;
  password_hash: string;
  role: AppRole;
  status: AppUserStatus;
  updated_at: Date;
}

function mapUser(row: AppUserRow): AppUser {
  return {
    gradeLevel: row.grade_level,
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly pool: DatabasePool) {}

  async createLearner(input: { email: string; passwordHash: string; displayName: string; gradeLevel: string }): Promise<AppUser> {
    const result = await this.pool.query<AppUserRow>(
      `INSERT INTO app_users (id, email, password_hash, display_name, grade_level, role)
       VALUES ($1, LOWER($2), $3, $4, $5, 'learner') RETURNING *`,
      [randomUUID(), input.email, input.passwordHash, input.displayName, input.gradeLevel]
    );
    return mapUser(result.rows[0]!);
  }

  async findActiveByEmail(email: string): Promise<AppUser | null> {
    const result = await this.pool.query<AppUserRow>(
      `SELECT id, email, password_hash, display_name, grade_level, role, status, created_at, updated_at
       FROM app_users
       WHERE LOWER(email) = LOWER($1) AND status = 'active'
       LIMIT 1`,
      [email]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findActiveById(id: string): Promise<AppUser | null> {
    const result = await this.pool.query<AppUserRow>(
      `SELECT id, email, password_hash, display_name, grade_level, role, status, created_at, updated_at
       FROM app_users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [id]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async upsertControlledAdmin(input: {
    displayName: string;
    email: string;
    passwordHash: string;
  }): Promise<AppUser> {
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [input.email]
    );
    const id = existing.rows[0]?.id ?? randomUUID();
    const result = await this.pool.query<AppUserRow>(
      `INSERT INTO app_users (
         id, email, password_hash, display_name, role, status, created_at, updated_at
       ) VALUES ($1, LOWER($2), $3, $4, 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = 'admin',
         status = 'active',
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, email, password_hash, display_name, role, status, created_at, updated_at`,
      [id, input.email, input.passwordHash, input.displayName]
    );

    return mapUser(result.rows[0]!);
  }
}
