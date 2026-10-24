import { describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import { createMigratedTestPool } from "./database-test-utils.js";

describe("PostgreSQL migrations", () => {
  it("creates the controlled testing schema from a clean database", async () => {
    const pool = await createMigratedTestPool();

    try {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
         ORDER BY table_name`
      );

      expect(result.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          "admin_activity_logs",
          "app_users",
          "asset_metadata",
          "curated_quizzes",
          "quiz_attempts",
          "quiz_questions",
          "refresh_tokens",
          "schema_migrations",
        ])
      );
    } finally {
      await pool.end();
    }
  });

  it("is idempotent and verifies applied migration checksums", async () => {
    const pool = await createMigratedTestPool();

    try {
      const result = await runMigrations(pool);
      expect(result.applied).toEqual([]);
      expect(result.alreadyApplied).toEqual(["001_initial_schema.sql", "002_quiz_content.sql", "003_content_drafts.sql"]);
    } finally {
      await pool.end();
    }
  });
});
