import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DatabasePool } from "./pool.js";

interface AppliedMigrationRow {
  checksum: string;
  filename: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(
  pool: DatabasePool,
  migrationsDirectory = resolve(process.cwd(), "migrations")
): Promise<MigrationResult> {
  const migrationTable = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
  );
  if (migrationTable.rowCount === 0) {
    await pool.query(`
    CREATE TABLE schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  }

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort((left, right) => left.localeCompare(right));
  const appliedResult = await pool.query<AppliedMigrationRow>(
    "SELECT filename, checksum FROM schema_migrations ORDER BY filename"
  );
  const appliedByFilename = new Map(
    appliedResult.rows.map((migration) => [migration.filename, migration.checksum])
  );
  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  for (const filename of files) {
    const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existingChecksum = appliedByFilename.get(filename);

    if (existingChecksum) {
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${filename}`);
      }

      result.alreadyApplied.push(filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [filename, checksum]
      );
      await client.query("COMMIT");
      result.applied.push(filename);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return result;
}
