/** Disposable, loopback-only real PostgreSQL. Never reads project .env or cloud data. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { AccountingRepository } from "../src/db/accounting.js";
import type { Database, Sql } from "../src/db/database.js";
import { todayIST } from "@dailyloop/contracts";
test("real PostgreSQL: additive upgrade, restricted RLS, independent connections, repeated writes and stale corrections", async () => {
  const reserve = createServer();
  await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((r) => reserve.close(() => r()));
  const directory = await mkdtemp(join(tmpdir(), "dailyloop-pg-"));
  const password = randomBytes(24).toString("hex");
  const cluster = new EmbeddedPostgres({
    databaseDir: join(directory, "db"),
    port,
    user: "test_admin",
    password,
    persistent: true,
    createPostgresUser: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  let pool: pg.Pool | undefined;
  let admin: pg.Client | undefined;
  try {
    await cluster.initialise();
    await cluster.start();
    admin = cluster.getPgClient();
    await admin.connect();
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((x) => x.endsWith(".sql") && x < "0003")
      .sort())
      await admin.query(await readFile(new URL(name, migrations), "utf8"));
    await admin.query(
      `CREATE ROLE test_runtime LOGIN PASSWORD '${password}' INHERIT; GRANT dailyloop_runtime TO test_runtime;`,
    );
    pool = new pg.Pool({
      host: "127.0.0.1",
      port,
      user: "test_runtime",
      password,
      database: "postgres",
      max: 6,
    });
    const db: Database = {
      async transaction(fn) {
        const c = await pool!.connect();
        try {
          await c.query("BEGIN");
          const r = await fn(c as Sql);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      async close() {
        await pool!.end();
      },
    };
    const repo = new AccountingRepository(db),
      a = { id: randomUUID(), email: null, providerSessionId: randomUUID() },
      b = { id: randomUUID(), email: null, providerSessionId: randomUUID() };
    await repo.createBusiness(a, {
      name: "Real PG test A",
      serviceType: "tiffin",
    });
    await repo.createBusiness(b, {
      name: "Real PG test B",
      serviceType: "milk",
    });
    const key = randomUUID(),
      customer = {
        name: "Concurrency fixture",
        address: "Test only",
        phone: "",
      };
    const cs = await Promise.all(
      Array.from({ length: 4 }, () => repo.createCustomer(a, customer, key)),
    );
    assert.equal(new Set(cs.map((c) => c.id)).size, 1);
    const c = cs[0];
    const p = await repo.createPlan(
      a,
      c.id,
      {
        label: "Lunch",
        unit: "meal",
        quantityMilli: 2000,
        ratePaise: "10000",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startOn: todayIST(),
      },
      randomUUID(),
    );
    await admin.query(
      await readFile(new URL("0003_accounting.sql", migrations), "utf8"),
    );
    assert.equal((await repo.getCustomer(a, c.id)).id, c.id);
    const r = await repo.round(a, todayIST());
    const input = {
      planId: p.id,
      serviceOn: todayIST(),
      scheduleRevision: r.businessRevision,
      expectedVersion: 0 as const,
      status: "delivered" as const,
      quantityMilli: 2000,
      reason: "Concurrency fixture outcome",
    };
    const op = randomUUID();
    const ds = await Promise.all(
      Array.from({ length: 4 }, () => repo.confirm(a, input, op)),
    );
    assert.equal(new Set(ds.map((d) => d.eventId)).size, 1);
    assert.equal(ds[0].chargePaise, "20000");
    const changes = await Promise.allSettled([
      repo.correct(
        a,
        ds[0].id,
        {
          expectedVersion: 1,
          status: "delivered",
          quantityMilli: 1000,
          reason: "Concurrent correction A",
        },
        randomUUID(),
      ),
      repo.correct(
        a,
        ds[0].id,
        {
          expectedVersion: 1,
          status: "missed",
          quantityMilli: 0,
          reason: "Concurrent correction B",
        },
        randomUUID(),
      ),
    ]);
    assert.equal(changes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(changes.filter((x) => x.status === "rejected").length, 1);
    const receipt = {
      customerId: c.id,
      effectiveOn: todayIST(),
      amountPaise: "5000",
      method: "cash" as const,
      reason: "Concurrent cash receipt",
    };
    const rk = randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => repo.receipt(a, receipt, rk)),
    );
    assert.equal(new Set(rs.map((x) => x.id)).size, 1);
    const reversed = await Promise.allSettled([
      repo.reverse(a, rs[0].id, "Reverse once A", randomUUID()),
      repo.reverse(a, rs[0].id, "Reverse once B", randomUUID()),
    ]);
    assert.equal(reversed.filter((x) => x.status === "fulfilled").length, 1);
    const s = await repo.statement(a, c.id, {
      from: todayIST(),
      to: todayIST(),
      limit: 50,
    });
    assert.equal(s.receiptsPaise, "5000");
    assert.equal(s.reversalsPaise, "5000");
    assert.ok(["0", "10000"].includes(s.closingPaise));
    assert.equal(
      (await repo.tenant(b, (t) => t.query("SELECT * FROM app.ledger_entries")))
        .rows.length,
      0,
    );
    assert.equal(
      (await db.transaction((t) => t.query("SELECT * FROM app.ledger_entries")))
        .rows.length,
      0,
    );
    const role = await pool.query(
      "SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user",
    );
    assert.equal(role.rows[0].rolbypassrls, false);
    assert.equal(role.rows[0].rolsuper, false);
    await assert.rejects(
      () =>
        repo.tenant(a, (t) =>
          t.query("UPDATE app.delivery_events SET quantity_milli=1000"),
        ),
      /permission denied/,
    );
    console.log(
      "Independent-connection customer/delivery/receipt retries, correction/reversal races and RLS: PASS",
    );
  } finally {
    await pool?.end();
    await admin?.end();
    await cluster.stop().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
