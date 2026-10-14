import { newDb } from "pg-mem";

import { runMigrations } from "../src/database/migrate.js";
import type { DatabasePool } from "../src/database/pool.js";

export async function createMigratedTestPool(): Promise<DatabasePool> {
  const memoryDatabase = newDb();
  const adapter = memoryDatabase.adapters.createPg();
  const pool = new adapter.Pool() as unknown as DatabasePool;
  await runMigrations(pool);
  return pool;
}
