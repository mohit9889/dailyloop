import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "Set MIGRATION_DATABASE_URL in backend/.env. Never use migration credentials to serve requests.",
  );
const caPath = new URL("../supabase-ca.crt", import.meta.url);
let sslOptions: pg.ClientConfig["ssl"] | undefined;
try {
  const ca = await readFile(caPath, "utf8");
  sslOptions = { rejectUnauthorized: true, ca };
} catch {
  // No local CA file — fall back to driver defaults (still encrypted via connection string sslmode).
}
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  ...(sslOptions ? { ssl: sslOptions } : {}),
});
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(742181001)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.dailyloop_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const source = await readFile(new URL(name, directory), "utf8"),
      checksum = createHash("sha256").update(source).digest("hex");
    const old = await client.query(
      "SELECT checksum FROM public.dailyloop_migrations WHERE name=$1",
      [name],
    );
    if (old.rows[0]) {
      if (old.rows[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query(
        "INSERT INTO public.dailyloop_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log("Applied", name);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(742181001)");
  await client.end();
}
