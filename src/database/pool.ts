import pg from "pg";

const { Pool } = pg;

export type DatabasePool = pg.Pool;

export function createDatabasePool(databaseUrl: string, useSsl: boolean): DatabasePool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });

  pool.on("error", () => {
    console.error(JSON.stringify({ event: "database.idle_client_error" }));
  });

  return pool;
}

export async function checkDatabase(pool: DatabasePool) {
  await pool.query("SELECT 1 AS healthy");
}
