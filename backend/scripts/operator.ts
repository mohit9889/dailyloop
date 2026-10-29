/** Never called by the web app. Erasure requires explicit CLI confirmation and maintenance. */
import pg from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eraseApplicationData } from "../src/ops/erase.js";
import { decryptSnapshot } from "../src/ops/backup.js";
import type { Sql } from "../src/db/database.js";
const args = process.argv.slice(2),
  mode = args[0],
  root = resolve(import.meta.dirname, "../..");
const value = (flag: string) => args[args.indexOf(flag) + 1];
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: await readFile(resolve(root, "backend/supabase-ca.crt"), "utf8"),
  },
  connectionTimeoutMillis: 10000,
});
try {
  await db.connect();
  if (mode === "requests") {
    const r = await db.query(
      "SELECT r.id,r.kind,r.status,r.message,r.created_at,u.email FROM app.owner_requests r LEFT JOIN auth.users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 100",
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } else if (mode === "resolve-support") {
    const id = value("--request");
    if (!id) throw Error("Provide --request UUID.");
    const r = await db.query(
      "UPDATE app.owner_requests SET status='resolved',updated_at=now() WHERE id=$1 AND kind='support' AND status='open' RETURNING id",
      [id],
    );
    if (!r.rows.length) throw Error("Open support request not found.");
    console.log("Support request marked resolved. No message was sent.");
  } else if (mode === "erase") {
    const id = value("--request"),
      backup = value("--backup");
    if (!id || !backup || value("--confirm") !== "DELETE")
      throw Error(
        "Required: erase --request UUID --backup <verified encrypted file> --confirm DELETE",
      );
    const receipt = JSON.parse(
      await readFile(backup + ".verified.json", "utf8"),
    );
    const data = decryptSnapshot(
      await readFile(backup),
      await readFile(resolve(root, ".private/keys/backup.key")),
    );
    if (
      receipt.digest !== data.digest ||
      Date.now() - Date.parse(data.createdAt) > 86400000 ||
      Date.now() - Date.parse(receipt.verifiedAt) > 86400000
    )
      throw Error(
        "A matching backup and restore verification from the last 24 hours are required.",
      );
    const origin = process.env.APP_ORIGIN;
    if (!origin) throw Error("APP_ORIGIN is required.");
    const check = await fetch(origin + "/v1/setup");
    const status = (await check.json()) as { error?: { code?: string } };
    if (check.status !== 503 || status.error?.code !== "MAINTENANCE")
      throw Error(
        "Put the single API deployment into maintenance and drain requests before erasure.",
      );
    const req = (
      await db.query(
        "SELECT user_id FROM app.owner_requests WHERE id=$1 AND kind='deletion' AND status='open'",
        [id],
      )
    ).rows[0];
    if (!req) throw Error("Open deletion request not found.");
    if (!data.identities.some((x) => x.id === req.user_id))
      throw Error("Backup does not contain this Auth identity.");
    if (args.includes("--auth-already-deleted")) {
      if (
        (await db.query("SELECT id FROM auth.users WHERE id=$1", [req.user_id]))
          .rows.length
      )
        throw Error(
          "Auth identity still exists. Remove it in the Supabase dashboard first, or use the operator service key.",
        );
    } else {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
        url = process.env.SUPABASE_URL;
      if (!serviceKey || !url?.startsWith("https://"))
        throw Error(
          "Operator Supabase URL/service-role key required; never configure this key in a frontend.",
        );
      const removed = await fetch(url + "/auth/v1/admin/users/" + req.user_id, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
      });
      if (!removed.ok && removed.status !== 404)
        throw Error(
          "Auth removal failed; application records were not erased. Retry after checking provider status.",
        );
    }
    await db.query("BEGIN");
    try {
      await eraseApplicationData(db as Sql, String(req.user_id), id);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
    await writeJournal();
    console.log(
      "Verified requested account removed. Keep maintenance enabled until the post-removal checks and erasure journal copy are complete.",
    );
  } else if (mode === "journal") {
    await writeJournal();
    console.log("Local erasure journal updated.");
  } else
    throw Error(
      "Use requests, resolve-support --request UUID, journal, or erase with explicit confirmation.",
    );
  async function writeJournal() {
    const rows = (
      await db.query(
        "SELECT user_hash,request_id,erased_at FROM private.deletion_tombstones ORDER BY erased_at",
      )
    ).rows;
    await mkdir(resolve(root, ".private"), { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(root, ".private/erasure-journal.json"),
      JSON.stringify(rows, null, 2),
      { mode: 0o600 },
    );
  }
} finally {
  await db.end();
}
