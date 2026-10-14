import "dotenv/config";

import { loadEnvironment, requireServiceConfiguration } from "../config/environment.js";
import { runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";

const environment = loadEnvironment();
const configuration = requireServiceConfiguration(environment);
const pool = createDatabasePool(configuration.databaseUrl, environment.DATABASE_SSL);

try {
  const result = await runMigrations(pool);
  console.log(
    JSON.stringify({
      alreadyApplied: result.alreadyApplied,
      applied: result.applied,
      event: "database.migrations_complete",
    })
  );
} finally {
  await pool.end();
}
