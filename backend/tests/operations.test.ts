import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { todayIST } from "@dailyloop/contracts";
import { fixture, ownerA, ownerB } from "./helpers.js";
import {
  snapshot,
  encryptSnapshot,
  decryptSnapshot,
  restoreEmpty,
} from "../src/ops/backup.js";
import { eraseApplicationData } from "../src/ops/erase.js";
import type { Sql } from "../src/db/database.js";
function sqlFor(db: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}): Sql {
  return {
    async query(sql, params = []) {
      const r = await db.query(sql, params);
      return { rows: r.rows as Record<string, unknown>[] };
    },
  } as Sql;
}
test("encrypted snapshot authenticates bytes and restores exact application history while clearing sessions", async () => {
  const f = await fixture(),
    other = new PGlite();
  try {
    await f.request("owner-a", "POST", "/v1/businesses", {
      name: "Backup fixture",
      serviceType: "tiffin",
    });
    const c = (
      await f.request("owner-a", "POST", "/v1/customers", {
        name: "Backup customer",
        address: "Private fixture address",
      })
    ).json().data;
    await f.request("owner-a", "POST", "/v1/receipts", {
      customerId: c.id,
      effectiveOn: todayIST(),
      amountPaise: "5000",
      method: "cash",
      reason: "Restore this receipt once",
    });
    const data = await snapshot(sqlFor(f.pg), {}, [
      { id: ownerA.id, email: ownerA.email },
    ]);
    const key = randomBytes(32),
      bytes = encryptSnapshot(data, key);
    assert.ok(!bytes.includes(Buffer.from("Private fixture address")));
    const modified = Buffer.from(bytes);
    modified[modified.length - 1] ^= 1;
    assert.throws(() => decryptSnapshot(modified, key));
    assert.throws(() => decryptSnapshot(bytes, randomBytes(32)));
    const decoded = decryptSnapshot(bytes, key);
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await other.exec(
        await readFile(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    const receipt = await other.transaction((tx) =>
      restoreEmpty(sqlFor(tx), decoded),
    );
    assert.equal(receipt.digest, data.digest);
    assert.equal(
      (
        await sqlFor(other).query(
          "SELECT count(*)::int AS n FROM private.app_sessions",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await sqlFor(other).query(
          "SELECT sum(signed_amount_paise)::text AS amount FROM app.ledger_entries",
        )
      ).rows[0].amount,
      "-5000",
    );
    await assert.rejects(
      () => restoreEmpty(sqlFor(other), decoded),
      /empty application tables/,
    );
  } finally {
    await f.close();
    await other.close();
  }
});
test("operator erasure removes only the requested owner, including sessions, leaving a non-contact tombstone", async () => {
  const f = await fixture();
  try {
    for (const token of ["owner-a", "owner-b"])
      await f.request(token, "POST", "/v1/businesses", {
        name: token + " test",
        serviceType: "tiffin",
      });
    const c = (
      await f.request("owner-a", "POST", "/v1/customers", {
        name: "Erasure fixture",
        address: "Delete this fixture",
      })
    ).json().data;
    await f.request("owner-a", "POST", "/v1/receipts", {
      customerId: c.id,
      effectiveOn: todayIST(),
      amountPaise: "5000",
      method: "cash",
      reason: "Must be erased with account",
    });
    const r = (
      await f.request("owner-a", "POST", "/v1/account/requests", {
        kind: "deletion",
        message: "Erase test owner A only",
        confirmation: "DELETE MY ACCOUNT",
      })
    ).json().data;
    await f.pg.transaction((t) =>
      eraseApplicationData(sqlFor(t), ownerA.id, r.id),
    );
    assert.equal(
      (await sqlFor(f.pg).query("SELECT count(*)::int AS n FROM app.customers"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await sqlFor(f.pg).query(
          "SELECT count(*)::int AS n FROM app.ledger_entries",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await sqlFor(f.pg).query(
          "SELECT count(*)::int AS n FROM app.businesses WHERE owner_id=$1",
          [ownerB.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await sqlFor(f.pg).query(
          "SELECT count(*)::int AS n FROM private.app_sessions WHERE user_id=$1",
          [ownerA.id],
        )
      ).rows[0].n,
      0,
    );
    const tombstone = (
      await sqlFor(f.pg).query("SELECT * FROM private.deletion_tombstones")
    ).rows[0];
    assert.equal(String(tombstone.user_hash).length, 64);
    assert.ok(!JSON.stringify(tombstone).includes(ownerA.id));
    assert.equal((await f.request("owner-a", "GET", "/v1/me")).statusCode, 401);
  } finally {
    await f.close();
  }
});
