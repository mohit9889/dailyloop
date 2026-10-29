import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Sql } from "../db/database.js";
export const backupTables = [
  "businesses",
  "memberships",
  "customers",
  "plans",
  "plan_revisions",
  "pause_ranges",
  "date_overrides",
  "delivery_occurrences",
  "delivery_events",
  "money_events",
  "opening_balances",
  "ledger_entries",
  "audit_events",
  "idempotency_records",
  "owner_requests",
] as const;
export type Snapshot = {
  format: "dailyloop-backup-v1";
  createdAt: string;
  migrations: Record<string, string>;
  identities: { id: string; email: string | null }[];
  tables: Record<string, Record<string, unknown>[]>;
  digest: string;
};
const digest = (tables: Snapshot["tables"]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(tables)
            .sort()
            .map(([k, v]) => [k, v.map((x) => JSON.stringify(x)).sort()]),
        ),
      ),
    )
    .digest("hex");
export async function snapshot(
  t: Sql,
  migrations: Snapshot["migrations"],
  identities: Snapshot["identities"],
): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  let count = 0;
  for (const name of backupTables) {
    if (
      !(await t.query("SELECT to_regclass($1) AS found", ["app." + name]))
        .rows[0].found
    )
      continue;
    const r = await t.query(
      `SELECT row_to_json(t)::text AS json FROM app.${name} t LIMIT 200001`,
    );
    count += r.rows.length;
    if (count > 200000)
      throw Error(
        "Backup exceeds the 200,000-row interactive limit. Use an operator streaming PostgreSQL backup.",
      );
    tables[name] = r.rows.map((x) => JSON.parse(String(x.json)));
  }
  const data: Snapshot = {
    format: "dailyloop-backup-v1",
    createdAt: new Date().toISOString(),
    migrations,
    identities,
    tables,
    digest: digest(tables),
  };
  if (Buffer.byteLength(JSON.stringify(data)) > 50 * 1024 * 1024)
    throw Error("Backup exceeds 50 MB. Use a streaming PostgreSQL backup.");
  return data;
}
export function encryptSnapshot(data: Snapshot, key: Buffer) {
  if (key.length !== 32) throw Error("Backup key must be 32 bytes.");
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv),
    bytes = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([Buffer.from("DLOOPB01"), iv, c.getAuthTag(), bytes]);
}
export function decryptSnapshot(bytes: Buffer, key: Buffer): Snapshot {
  if (
    bytes.subarray(0, 8).toString() !== "DLOOPB01" ||
    bytes.length < 37 ||
    bytes.length > 51 * 1024 * 1024
  )
    throw Error("Invalid backup format/size.");
  const d = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
  d.setAuthTag(bytes.subarray(20, 36));
  const data = JSON.parse(
    Buffer.concat([d.update(bytes.subarray(36)), d.final()]).toString("utf8"),
  ) as Snapshot;
  if (
    data.format !== "dailyloop-backup-v1" ||
    digest(data.tables) !== data.digest
  )
    throw Error("Backup integrity check failed.");
  for (const name of Object.keys(data.tables))
    if (!backupTables.includes(name as (typeof backupTables)[number]))
      throw Error("Unknown backup table.");
  return data;
}
export async function restoreEmpty(t: Sql, data: Snapshot) {
  for (const name of backupTables) {
    if (
      (await t.query("SELECT to_regclass($1) AS found", ["app." + name]))
        .rows[0].found &&
      Number(
        (await t.query(`SELECT count(*)::int AS n FROM app.${name}`)).rows[0].n,
      )
    )
      throw Error("Restore requires empty application tables.");
  }
  const pointers: { id: unknown; event: unknown }[] = [];
  for (const table of backupTables) {
    const columns = new Set(
      (
        await t.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name=$1",
          [table],
        )
      ).rows.map((x) => String(x.column_name)),
    );
    let rows = [...(data.tables[table] || [])];
    if (table === "delivery_events")
      rows.sort(
        (a, b) => Number(a.occurrence_version) - Number(b.occurrence_version),
      );
    if (table === "money_events") {
      const ordered: typeof rows = [];
      const seen = new Set();
      while (rows.length) {
        const ready = rows.filter(
          (r) => !r.reverses_event_id || seen.has(r.reverses_event_id),
        );
        if (!ready.length) throw Error("Invalid money-event references.");
        for (const r of ready) {
          ordered.push(r);
          seen.add(r.id);
        }
        rows = rows.filter((r) => !seen.has(r.id));
      }
      rows = ordered;
    }
    for (const original of rows) {
      const row = { ...original };
      if (table === "delivery_occurrences") {
        pointers.push({ id: row.id, event: row.current_event_id });
        row.current_event_id = null;
      }
      const keys = Object.keys(row);
      if (keys.some((k) => !columns.has(k)))
        throw Error("Backup schema does not match the current migrations.");
      await t.query(
        `INSERT INTO app.${table}(${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
        keys.map((k) => row[k]),
      );
    }
  }
  for (const p of pointers)
    await t.query(
      "UPDATE app.delivery_occurrences SET current_event_id=$1 WHERE id=$2",
      [p.event, p.id],
    );
  await t.query("DELETE FROM private.app_sessions");
  const restored = await snapshot(t, data.migrations, data.identities);
  if (restored.digest !== data.digest)
    throw Error("Restored records do not match the backup digest.");
  return {
    verifiedAt: new Date().toISOString(),
    backupCreatedAt: data.createdAt,
    digest: data.digest,
    rows: Object.fromEntries(
      Object.entries(data.tables).map(([k, v]) => [k, v.length]),
    ),
  };
}
