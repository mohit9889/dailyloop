import pg from "pg";
// Service dates are calendar strings, never host-timezone Date objects.
pg.types.setTypeParser(1082, (value) => value);
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load Supabase's root CA once at import time for verified TLS.
let supabaseCa: string | undefined;
try {
  const caPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase-ca.crt",
  );
  supabaseCa = readFileSync(caPath, "utf8");
} catch {
  // No CA file — sslmode in connection string still encrypts; verify-full will
  // rely on the system trust store.
}
export type Sql = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export interface Database {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): Database {
  // Require verified TLS for every non-local database connection.
  // TLS is enforced programmatically via the Supabase root CA loaded above.
  // Do NOT put sslmode=verify-full in the URL — pg v8 conflicts with explicit
  // ssl options when the URL contains sslmode.
  const parsed = new URL(url);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!isLocal && !supabaseCa) {
    throw new Error(
      "Remote DATABASE_URL requires backend/supabase-ca.crt for verified TLS. " +
        "Download it from your Supabase dashboard (Database → SSL Configuration).",
    );
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    ...(supabaseCa
      ? { ssl: { rejectUnauthorized: true, ca: supabaseCa } }
      : {}),
  });
  return {
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await fn(c as Sql);
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
export async function userContext(
  tx: Sql,
  userId: string,
  businessId?: string,
) {
  await tx.query(
    "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
    [userId, businessId || ""],
  );
}
