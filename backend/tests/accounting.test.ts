import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { todayIST, shiftDate } from "@dailyloop/contracts";
import { fixture, ownerA, ownerB } from "./helpers.js";
import { AccountingRepository, charge } from "../src/db/accounting.js";
const today = todayIST();
async function setup() {
  const f = await fixture();
  await f.request("owner-a", "POST", "/v1/businesses", {
    name: "Tiffin test",
    serviceType: "tiffin",
  });
  await f.request("owner-b", "POST", "/v1/businesses", {
    name: "Other business",
    serviceType: "milk",
  });
  const c = (
    await f.request("owner-a", "POST", "/v1/customers", {
      name: "Test customer",
      address: "Test address",
    })
  ).json().data;
  const p = (
    await f.request("owner-a", "POST", `/v1/customers/${c.id}/plans`, {
      label: "Lunch",
      unit: "meal",
      quantityMilli: 2000,
      ratePaise: "10000",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startOn: today,
    })
  ).json().data;
  return { ...f, c, p, ledger: new AccountingRepository(f.db) };
}
async function round(f: Awaited<ReturnType<typeof setup>>) {
  return (await f.request("owner-a", "GET", "/v1/rounds?date=" + today)).json()
    .data;
}
async function statement(f: Awaited<ReturnType<typeof setup>>, extra = "") {
  const r = await f.request(
    "owner-a",
    "GET",
    `/v1/customers/${f.c.id}/statement?from=${today}&to=${today}${extra}`,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json().data;
}
async function confirm(
  f: Awaited<ReturnType<typeof setup>>,
  key = randomUUID(),
) {
  const r = await round(f);
  return f.request(
    "owner-a",
    "POST",
    "/v1/deliveries/confirm",
    {
      planId: f.p.id,
      serviceOn: today,
      scheduleRevision: r.businessRevision,
      expectedVersion: 0,
      status: "delivered",
      quantityMilli: 2000,
      reason: "Actual lunch confirmed",
    },
    key,
  );
}
test("ledger reconciles opening, delivery, partial/advance receipt and full reversal; snapshots and corrections retain history", async () => {
  const f = await setup();
  try {
    const opening = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.c.id}/opening-balance`,
      {
        expectedVersion: 0,
        cutoverOn: today,
        amountPaise: "50000",
        reason: "Paper ledger cutover",
      },
    );
    assert.equal(opening.statusCode, 200, opening.body);
    const d = await confirm(f);
    assert.equal(d.statusCode, 201, d.body);
    const record = d.json().data;
    assert.equal(record.chargePaise, "20000");
    const correction = await f.request(
      "owner-a",
      "POST",
      `/v1/deliveries/${record.id}/corrections`,
      {
        expectedVersion: 1,
        status: "delivered",
        quantityMilli: 1000,
        reason: "Only one meal delivered",
      },
    );
    assert.equal(correction.statusCode, 200, correction.body);
    assert.equal(correction.json().data.chargePaise, "10000");
    const receipt = await f.request("owner-a", "POST", "/v1/receipts", {
      customerId: f.c.id,
      effectiveOn: today,
      amountPaise: "100000",
      method: "upi",
      reason: "Manual receipt entered",
    });
    assert.equal(receipt.statusCode, 201, receipt.body);
    let s = await statement(f);
    assert.equal(s.closingPaise, "-40000");
    assert.equal(s.chargesPaise, "30000");
    assert.equal(s.adjustmentsPaise, "30000");
    assert.equal(s.receiptsPaise, "100000");
    const id = receipt.json().data.id;
    const rev = await f.request(
      "owner-a",
      "POST",
      `/v1/receipts/${id}/reversal`,
      { expectedVersion: 1, reason: "Wrong receipt recorded" },
    );
    assert.equal(rev.statusCode, 200, rev.body);
    s = await statement(f);
    assert.equal(s.closingPaise, "60000");
    assert.equal(s.reversalsPaise, "100000");
    assert.equal(
      (
        await f.request("owner-a", "POST", `/v1/receipts/${id}/reversal`, {
          expectedVersion: 1,
          reason: "Duplicate reversal blocked",
        })
      ).statusCode,
      409,
    );
    const history = (
      await f.request("owner-a", "GET", `/v1/deliveries/${record.id}/history`)
    ).json().data.items;
    assert.equal(history.length, 2);
    assert.deepEqual(
      history.map((x: { chargePaise: string }) => x.chargePaise).sort(),
      ["10000", "20000"],
    );
    await f.request("owner-a", "POST", `/v1/plans/${f.p.id}/revisions`, {
      expectedVersion: 1,
      effectiveFrom: shiftDate(today, 1),
      label: "New lunch",
      quantityMilli: 1000,
      ratePaise: "12000",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      reason: "Future price revision",
    });
    assert.equal((await round(f)).stops[0].record.ratePaise, "10000");
    assert.equal((await statement(f)).closingPaise, "60000");
    const correctedOpening = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.c.id}/opening-balance`,
      {
        expectedVersion: 1,
        cutoverOn: today,
        amountPaise: "-20000",
        reason: "Opening was an advance credit",
      },
    );
    assert.equal(correctedOpening.statusCode, 200, correctedOpening.body);
    assert.equal((await statement(f)).closingPaise, "-10000");
  } finally {
    await f.close();
  }
});
test("operation retries post once; changed payload, stale schedule and stale correction conflict", async () => {
  const f = await setup();
  try {
    const r = await round(f);
    const body = {
      planId: f.p.id,
      serviceOn: today,
      scheduleRevision: r.businessRevision,
      expectedVersion: 0,
      status: "delivered",
      quantityMilli: 1000,
      reason: "Confirmed actual meal",
    };
    const key = randomUUID();
    const responses = await Promise.all([
      f.request("owner-a", "POST", "/v1/deliveries/confirm", body, key),
      f.request("owner-a", "POST", "/v1/deliveries/confirm", body, key),
    ]);
    assert.equal(responses[0].statusCode, 201, responses[0].body);
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal((await statement(f)).closingPaise, "10000");
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          "/v1/deliveries/confirm",
          { ...body, quantityMilli: 2000 },
          key,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await f.request("owner-a", "POST", "/v1/deliveries/confirm", body))
        .statusCode,
      409,
    );
    const id = responses[0].json().data.id;
    const b = {
      expectedVersion: 1,
      status: "missed",
      quantityMilli: 0,
      reason: "No delivery actually arrived",
    };
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/deliveries/${id}/corrections`,
          b,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/deliveries/${id}/corrections`,
          b,
        )
      ).statusCode,
      409,
    );
    assert.equal((await statement(f)).closingPaise, "0");
    const pay = {
      customerId: f.c.id,
      effectiveOn: today,
      amountPaise: "7000",
      method: "cash",
      reason: "Partial cash receipt",
    };
    const k = randomUUID();
    const a = await f.request("owner-a", "POST", "/v1/receipts", pay, k);
    const z = await f.request("owner-a", "POST", "/v1/receipts", pay, k);
    assert.deepEqual(a.json(), z.json());
    assert.equal((await statement(f)).closingPaise, "-7000");
  } finally {
    await f.close();
  }
});
test("accounting API, composite foreign keys and RLS isolate tenants and prohibit history edits", async () => {
  const f = await setup();
  try {
    const d = (await confirm(f)).json().data;
    for (const url of [
      `/v1/customers/${f.c.id}/statement?from=${today}&to=${today}`,
      `/v1/customers/${f.c.id}/receipts?from=${today}&to=${today}`,
      `/v1/deliveries/${d.id}/history`,
    ])
      assert.equal((await f.request("owner-b", "GET", url)).statusCode, 404);
    assert.equal(
      (
        await f.request(
          "owner-b",
          "POST",
          `/v1/deliveries/${d.id}/corrections`,
          {
            expectedVersion: 1,
            status: "missed",
            quantityMilli: 0,
            reason: "Cross tenant attack",
          },
        )
      ).statusCode,
      404,
    );
    const hidden = await f.repo.tenant(ownerB, (t) =>
      t.query("SELECT * FROM app.ledger_entries"),
    );
    assert.equal(hidden.rows.length, 0);
    await assert.rejects(
      () =>
        f.repo.tenant(ownerA, (t) =>
          t.query("UPDATE app.ledger_entries SET signed_amount_paise=1"),
        ),
      /permission denied/i,
    );
    await assert.rejects(
      () =>
        f.repo.tenant(ownerA, (t) =>
          t.query("DELETE FROM app.delivery_events"),
        ),
      /permission denied/i,
    );
    const bc = (
      await f.request("owner-b", "POST", "/v1/customers", {
        name: "Other",
        address: "Other address",
      })
    ).json().data;
    await assert.rejects(
      () =>
        f.repo.tenant(ownerA, (t, b) =>
          t.query(
            "INSERT INTO app.delivery_occurrences(business_id,customer_id,plan_id,service_on) VALUES($1,$2,$3,$4)",
            [b.id, bc.id, f.p.id, shiftDate(today, -1)],
          ),
        ),
      /foreign key/i,
    );
  } finally {
    await f.close();
  }
});
test("financial validation rejects fractional meals, invalid outcomes, future dates and moving cutovers", async () => {
  const f = await setup();
  try {
    const r = await round(f);
    const body = {
      planId: f.p.id,
      serviceOn: today,
      scheduleRevision: r.businessRevision,
      expectedVersion: 0,
      status: "delivered",
      quantityMilli: 500,
      reason: "Half meal is unsupported",
    };
    assert.equal(
      (await f.request("owner-a", "POST", "/v1/deliveries/confirm", body))
        .statusCode,
      422,
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/deliveries/confirm", {
          ...body,
          status: "skipped",
          quantityMilli: 1000,
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/deliveries/confirm", {
          ...body,
          serviceOn: shiftDate(today, 1),
          quantityMilli: 1000,
        })
      ).statusCode,
      422,
    );
    const input = {
      expectedVersion: 0,
      cutoverOn: today,
      amountPaise: "5000",
      reason: "Initial paper ledger opening",
    };
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/customers/${f.c.id}/opening-balance`,
          input,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/customers/${f.c.id}/opening-balance`,
          { ...input, expectedVersion: 1, cutoverOn: shiftDate(today, -1) },
        )
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/receipts", {
          customerId: f.c.id,
          effectiveOn: shiftDate(today, -1),
          amountPaise: "100",
          method: "cash",
          reason: "Pre-cutover double counting",
        })
      ).statusCode,
      422,
    );
  } finally {
    await f.close();
  }
});
test("statement totals cover all pages; accounting failure rolls back every financial posting", async () => {
  const f = await setup();
  try {
    await confirm(f);
    for (let i = 0; i < 3; i++)
      await f.request("owner-a", "POST", "/v1/receipts", {
        customerId: f.c.id,
        effectiveOn: today,
        amountPaise: "1000",
        method: "cash",
        reason: "Partial payment " + i,
      });
    const first = await statement(f, "&limit=1");
    assert.equal(first.lines.length, 1);
    assert.ok(first.nextCursor);
    assert.equal(first.closingPaise, "17000");
    const second = await statement(f, "&limit=1&after=" + first.nextCursor);
    assert.equal(second.closingPaise, "17000");
    assert.notEqual(first.lines[0].id, second.lines[0].id);
    await f.pg.exec(
      "CREATE FUNCTION private.reject_money_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='receipt.created' THEN RAISE EXCEPTION 'audit rejected'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_money_audit BEFORE INSERT ON app.audit_events FOR EACH ROW EXECUTE FUNCTION private.reject_money_audit();",
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/receipts", {
          customerId: f.c.id,
          effectiveOn: today,
          amountPaise: "9900",
          method: "cash",
          reason: "Must roll back on audit error",
        })
      ).statusCode,
      500,
    );
    assert.equal((await statement(f)).closingPaise, "17000");
  } finally {
    await f.close();
  }
});
test("integer milk rounding and zero-charge outcomes are exact", () => {
  assert.equal(charge(333, "6125"), "2040");
  assert.equal(charge(0, "10000"), "0");
  assert.equal(charge(100000000, "10000000"), "1000000000000");
});

test("opening correction to zero keeps cutover and reverses the saved opening exactly", async () => {
  const f = await setup();
  try {
    const body = {
      cutoverOn: today,
      amountPaise: "50000",
      expectedVersion: 0,
      reason: "Initial outstanding paper balance",
    };
    assert.equal(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/customers/${f.c.id}/opening-balance`,
          body,
        )
      ).statusCode,
      200,
    );
    const r = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.c.id}/opening-balance`,
      {
        ...body,
        amountPaise: "0",
        expectedVersion: 1,
        reason: "Paper balance was actually settled",
      },
    );
    assert.equal(r.statusCode, 200, r.body);
    const s = await statement(f);
    assert.equal(s.closingPaise, "0");
    assert.equal(s.openingBalance.version, 2);
    assert.equal(s.lines.length, 3);
  } finally {
    await f.close();
  }
});
test("full period reconciles historical outcomes and unresolved warnings without estimating revenue", async () => {
  const f = await setup();
  try {
    const start = today.slice(0, 7) + "-01";
    await f.pg.query("UPDATE app.plans SET start_on=$1 WHERE id=$2", [
      start,
      f.p.id,
    ]);
    await f.pg.query(
      "UPDATE app.plan_revisions SET effective_from=$1 WHERE plan_id=$2",
      [start, f.p.id],
    );
    const url = `/v1/customers/${f.c.id}/statement?from=${start}&to=${today}`;
    let s = (await f.request("owner-a", "GET", url)).json().data;
    const elapsed = (Date.parse(today) - Date.parse(start)) / 86400000;
    assert.equal(s.unresolved, elapsed);
    assert.equal(s.closingPaise, "0");
    let total = 0n;
    for (let date = start; date <= today; date = shiftDate(date, 1)) {
      const r = (
        await f.request("owner-a", "GET", "/v1/rounds?date=" + date)
      ).json().data;
      const missed = date === start;
      const response = await f.request(
        "owner-a",
        "POST",
        "/v1/deliveries/confirm",
        {
          planId: f.p.id,
          serviceOn: date,
          scheduleRevision: r.businessRevision,
          expectedVersion: 0,
          status: missed ? "missed" : "delivered",
          quantityMilli: missed ? 0 : 1000,
          reason: missed
            ? "Missed on first service day"
            : "One actual meal confirmed",
        },
      );
      assert.equal(response.statusCode, 201, response.body);
      if (!missed) total += 10000n;
    }
    const pay = await f.request("owner-a", "POST", "/v1/receipts", {
      customerId: f.c.id,
      effectiveOn: today,
      amountPaise: (total + 5000n).toString(),
      method: "bank",
      reason: "Manual month settlement and advance",
    });
    assert.equal(pay.statusCode, 201, pay.body);
    s = (await f.request("owner-a", "GET", url)).json().data;
    assert.equal(s.unresolved, 0);
    assert.equal(s.chargesPaise, total.toString());
    assert.equal(s.closingPaise, "-5000");
  } finally {
    await f.close();
  }
});
test("pause/one-day skip cannot be charged without schedule override; skipped confirmation has zero charge", async () => {
  const f = await setup();
  try {
    const r = await f.request("owner-a", "POST", `/v1/plans/${f.p.id}/pauses`, {
      expectedVersion: 1,
      fromOn: today,
      toOn: today,
      reason: "Customer away today",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await confirm(f)).statusCode, 422);
    const override = await f.request(
      "owner-a",
      "PUT",
      `/v1/plans/${f.p.id}/override`,
      {
        expectedVersion: 2,
        serviceOn: today,
        action: "resume",
        reason: "Customer requests one delivery",
      },
    );
    assert.equal(override.statusCode, 200, override.body);
    const roundData = await round(f);
    const d = await f.request("owner-a", "POST", "/v1/deliveries/confirm", {
      planId: f.p.id,
      serviceOn: today,
      scheduleRevision: roundData.businessRevision,
      expectedVersion: 0,
      status: "skipped",
      quantityMilli: 0,
      reason: "Customer declined at door",
    });
    assert.equal(d.statusCode, 201, d.body);
    assert.equal((await statement(f)).closingPaise, "0");
  } finally {
    await f.close();
  }
});
test("new accounting endpoints are gated on an unmigrated database without breaking customer/plans", async () => {
  const f = await setup();
  try {
    await f.pg.exec(
      "DROP TABLE app.ledger_entries,app.opening_balances,app.money_events,app.delivery_events,app.delivery_occurrences CASCADE",
    );
    const me = (await f.request("owner-a", "GET", "/v1/me")).json().data;
    assert.equal(me.features.accounting, false);
    assert.equal(me.features.planLifecycle, true);
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/rounds?date=" + today))
        .statusCode,
      503,
    );
    assert.equal(
      (await f.request("owner-a", "GET", `/v1/customers/${f.c.id}/plans`))
        .statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});
