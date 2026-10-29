/** Operator-only encrypted backup and isolated restore verification. Never starts a restore against the live database. */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import {
  snapshot,
  encryptSnapshot,
  decryptSnapshot,
  restoreEmpty,
} from "../src/ops/backup.js";
import type { Sql } from "../src/db/database.js";
const mode = process.argv[2],
  root = resolve(import.meta.dirname, "../.."),
  privateDir = resolve(root, ".private"),
  keyPath = resolve(privateDir, "keys/backup.key");
await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
const migrations: Record<string, string> = {};
const folder = resolve(root, "backend/migrations");
for (const name of (await readdir(folder))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  migrations[name] = createHash("sha256")
    .update(await readFile(resolve(folder, name)))
    .digest("hex");
if (mode === "create") {
  let key: Buffer;
  try {
    key = await readFile(keyPath);
  } catch {
    key = randomBytes(32);
    await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw Error("MIGRATION_DATABASE_URL is required for an operator backup.");
  const ca = await readFile(resolve(root, "backend/supabase-ca.crt"), "utf8");
  const client = new pg.Client({
    connectionString: url,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const applied = await client.query(
      "SELECT name,checksum FROM public.dailyloop_migrations",
    );
    const appliedMap = Object.fromEntries(
      applied.rows.map((r) => [r.name, r.checksum]),
    );
    for (const [name, checksum] of Object.entries(appliedMap))
      if (migrations[name] !== checksum)
        throw Error("Applied migration checksum mismatch.");
    const ids = (await client.query("SELECT id,email FROM auth.users"))
      .rows as { id: string; email: string | null }[];
    const data = await snapshot(client as Sql, appliedMap, ids);
    await client.query("COMMIT");
    const directory = resolve(privateDir, "backups");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, `dailyloop-${Date.now()}.enc`);
    await writeFile(path, encryptSnapshot(data, key), {
      flag: "wx",
      mode: 0o600,
    });
    console.log("Encrypted backup saved: " + path);
    console.log("Key is separate: " + keyPath);
    console.log(
      "Copy the key and encrypted backup to separate owner-controlled offline locations.",
    );
  } finally {
    await client.end();
  }
} else if (mode === "verify") {
  const path = process.argv[3];
  if (!path) throw Error("Provide the encrypted backup path.");
  if ((await stat(path)).size > 51 * 1024 * 1024)
    throw Error("Backup exceeds verification size limit.");
  const data = decryptSnapshot(await readFile(path), await readFile(keyPath));
  for (const [name, h] of Object.entries(data.migrations))
    if (migrations[name] !== h)
      throw Error("Backup migration checksum mismatch.");
  const db = new PGlite();
  try {
    for (const name of Object.keys(data.migrations).sort())
      await db.exec(await readFile(resolve(folder, name), "utf8"));
    const receipt = await db.transaction(async (tx) =>
      restoreEmpty(
        {
          async query(sql, params = []) {
            const r = await tx.query(sql, params);
            return { rows: r.rows as Record<string, unknown>[] };
          },
        } as Sql,
        data,
      ),
    );
    const out = path + ".verified.json";
    await writeFile(out, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log("Restore verification PASS: " + out);
    console.log(
      "All application rows matched; sessions were cleared. Cloud Auth identity mapping remains an operator check.",
    );
  } finally {
    await db.close();
  }
} else throw Error("Use create, or verify <encrypted-backup-path>.");
