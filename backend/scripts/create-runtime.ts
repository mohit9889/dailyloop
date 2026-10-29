import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.MIGRATION_DATABASE_URL,
  password = process.env.DATABASE_RUNTIME_PASSWORD;
if (!url || !password || password.length < 24)
  throw new Error(
    "Set MIGRATION_DATABASE_URL and a random DATABASE_RUNTIME_PASSWORD of at least 24 characters in backend/.env.",
  );
const caPath = new URL("../supabase-ca.crt", import.meta.url);
let sslOptions: pg.ClientConfig["ssl"] | undefined;
try {
  const ca = await readFile(caPath, "utf8");
  sslOptions = { rejectUnauthorized: true, ca };
} catch {
  // No local CA file — fall back to driver defaults.
}
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  ...(sslOptions ? { ssl: sslOptions } : {}),
});
await client.connect();
try {
  const exists = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname='dailyloop_api'",
  );
  if (exists.rows.length)
    throw new Error(
      "dailyloop_api already exists. Rotate credentials deliberately; this command does not overwrite them.",
    );
  // PostgreSQL DDL does not accept a parameter for PASSWORD. Quote the secret as a literal;
  // never print this SQL or the credential. All identifiers are fixed application constants.
  await client.query("SET standard_conforming_strings=on");
  const quoted = "'" + password.replaceAll("'", "''") + "'";
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE ROLE dailyloop_api LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD " +
        quoted,
    );
    await client.query("GRANT dailyloop_runtime TO dailyloop_api");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  console.log(
    "Restricted dailyloop_api login created. Configure DATABASE_URL privately.",
  );
} finally {
  await client.end();
}
