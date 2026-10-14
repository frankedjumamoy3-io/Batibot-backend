import "dotenv/config";

import { UserRepository } from "../auth/user-repository.js";
import { loadEnvironment, requireServiceConfiguration } from "../config/environment.js";
import { createDatabasePool } from "../database/pool.js";

const environment = loadEnvironment();
const configuration = requireServiceConfiguration(environment);

if (!environment.ADMIN_BOOTSTRAP_EMAIL) {
  throw new Error("ADMIN_BOOTSTRAP_EMAIL is required.");
}
if (!environment.ADMIN_BOOTSTRAP_PASSWORD_HASH?.startsWith("$argon2")) {
  throw new Error("ADMIN_BOOTSTRAP_PASSWORD_HASH must be a valid Argon2 hash.");
}

const pool = createDatabasePool(configuration.databaseUrl, environment.DATABASE_SSL);

try {
  const users = new UserRepository(pool);
  const admin = await users.upsertControlledAdmin({
    displayName: environment.ADMIN_BOOTSTRAP_DISPLAY_NAME,
    email: environment.ADMIN_BOOTSTRAP_EMAIL,
    passwordHash: environment.ADMIN_BOOTSTRAP_PASSWORD_HASH,
  });

  console.log(
    JSON.stringify({
      event: "admin.bootstrap_complete",
      userId: admin.id,
    })
  );
} finally {
  await pool.end();
}
