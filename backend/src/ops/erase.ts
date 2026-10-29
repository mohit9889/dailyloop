import { createHash } from "node:crypto";
import type { Sql } from "../db/database.js";
/** Administrative transaction only, after an authorized request, verified backup and Auth removal. */
export async function eraseApplicationData(
  t: Sql,
  userId: string,
  requestId: string,
) {
  await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "owner-requests/" + userId,
  ]);
  const request = (
    await t.query(
      "SELECT * FROM app.owner_requests WHERE id=$1 AND user_id=$2 AND kind='deletion' AND status='open' FOR UPDATE",
      [requestId, userId],
    )
  ).rows[0];
  if (!request) throw Error("Open deletion request not found.");
  const businesses = (
    await t.query("SELECT id FROM app.businesses WHERE owner_id=$1", [userId])
  ).rows;
  for (const row of businesses) {
    const bid = String(row.id);
    await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      bid,
    ]);
    await t.query(
      "UPDATE app.delivery_occurrences SET current_event_id=NULL WHERE business_id=$1",
      [bid],
    );
    for (const table of [
      "ledger_entries",
      "opening_balances",
      "delivery_events",
      "delivery_occurrences",
      "money_events",
      "date_overrides",
      "pause_ranges",
      "plan_revisions",
      "plans",
      "customers",
      "audit_events",
      "idempotency_records",
      "owner_requests",
      "memberships",
    ])
      await t.query(`DELETE FROM app.${table} WHERE business_id=$1`, [bid]);
    await t.query("DELETE FROM app.businesses WHERE id=$1", [bid]);
  }
  await t.query("DELETE FROM app.owner_requests WHERE user_id=$1", [userId]);
  await t.query("DELETE FROM private.app_sessions WHERE user_id=$1", [userId]);
  await t.query(
    "INSERT INTO private.deletion_tombstones(user_hash,request_id) VALUES($1,$2) ON CONFLICT(user_hash) DO NOTHING",
    [createHash("sha256").update(userId).digest("hex"), requestId],
  );
}
