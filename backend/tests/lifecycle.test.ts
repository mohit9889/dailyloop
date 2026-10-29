import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  todayIST,
  shiftDate,
  decimalToScaled,
  formatPaise,
  type RecurringPlan,
  type Customer,
} from "@dailyloop/contracts";
import { scheduleDay } from "../src/domain/schedule.js";
import { fixture, ownerB } from "./helpers.js";
const today = todayIST(),
  tomorrow = shiftDate(today, 1),
  later = shiftDate(today, 2);
const planInput = {
  label: "Morning milk",
  unit: "litre",
  quantityMilli: 1000,
  ratePaise: "6000",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startOn: today,
};
async function setup() {
  const f = await fixture();
  await f.request("owner-a", "POST", "/v1/businesses", {
    name: "Milk business",
    serviceType: "mixed",
  });
  await f.request("owner-b", "POST", "/v1/businesses", {
    name: "Other business",
    serviceType: "milk",
  });
  const customer = (
    await f.request("owner-a", "POST", "/v1/customers", {
      name: "Ananya",
      address: "Test address",
    })
  ).json().data as Customer;
  const created = await f.request(
    "owner-a",
    "POST",
    `/v1/customers/${customer.id}/plans`,
    planInput,
  );
  assert.equal(created.statusCode, 201, created.body);
  return { ...f, customer, plan: created.json().data as RecurringPlan };
}
test("multiple plans and dated revisions preserve the old schedule and reject stale/replayed intent", async () => {
  const f = await setup();
  try {
    const dinner = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.customer.id}/plans`,
      {
        ...planInput,
        label: "Dinner",
        unit: "meal",
        quantityMilli: 1000,
        ratePaise: "10000",
      },
    );
    assert.equal(dinner.statusCode, 201, dinner.body);
    const fractional = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.customer.id}/plans`,
      { ...planInput, label: "Lunch", unit: "meal", quantityMilli: 1500 },
    );
    assert.equal(fractional.statusCode, 422);
    const change = {
      expectedVersion: 1,
      effectiveFrom: tomorrow,
      label: "Morning milk",
      quantityMilli: 1500,
      ratePaise: "7000",
      weekdays: planInput.weekdays,
      reason: "New daily quantity",
    };
    const preview = await f.request("owner-a", "POST", "/v1/schedule/preview", {
      planId: f.plan.id,
      from: today,
      to: later,
      change: { type: "revision", input: change },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().data.after[0].ratePaise, "6000");
    assert.equal(preview.json().data.after[1].ratePaise, "7000");
    assert.equal(
      (
        await f.request(
          "owner-a",
          "GET",
          `/v1/customers/${f.customer.id}/plans`,
        )
      ).json().data.plans[0].version,
      1,
      "Preview must not mutate data",
    );
    const key = randomUUID();
    const saved = await f.request(
      "owner-a",
      "POST",
      `/v1/plans/${f.plan.id}/revisions`,
      change,
      key,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      (
        await f.request(
          "owner-a",
          "POST",
          `/v1/plans/${f.plan.id}/revisions`,
          change,
          key,
        )
      ).json(),
      saved.json(),
    );
    const actual = await f.request("owner-a", "POST", "/v1/schedule/preview", {
      planId: f.plan.id,
      from: today,
      to: later,
    });
    assert.equal(actual.json().data.after[0].quantityMilli, 1000);
    assert.equal(actual.json().data.after[1].quantityMilli, 1500);
    assert.equal(
      (
        await f.request("owner-a", "POST", `/v1/plans/${f.plan.id}/revisions`, {
          ...change,
          effectiveFrom: later,
        })
      ).statusCode,
      409,
    );
    const all = (
      await f.request("owner-a", "GET", `/v1/customers/${f.customer.id}/plans`)
    ).json().data.plans;
    assert.equal(all.length, 2);
    assert.equal(all.find((p: RecurringPlan) => p.unit === "meal").version, 1);
  } finally {
    await f.close();
  }
});
test("pauses, one-day overrides, clear and resume follow explicit precedence without erasing past pause dates", async () => {
  const f = await setup();
  try {
    const pause = await f.request(
      "owner-a",
      "POST",
      `/v1/plans/${f.plan.id}/pauses`,
      {
        expectedVersion: 1,
        fromOn: today,
        toOn: shiftDate(today, 4),
        reason: "Customer travelling",
      },
    );
    assert.equal(pause.statusCode, 200, pause.body);
    const pauseId = pause.json().data.pauses[0].id;
    let override = await f.request(
      "owner-a",
      "PUT",
      `/v1/plans/${f.plan.id}/override`,
      {
        expectedVersion: 2,
        serviceOn: tomorrow,
        action: "quantity",
        quantityMilli: 500,
        reason: "Deliver half a litre",
      },
    );
    assert.equal(override.statusCode, 200, override.body);
    let view = (
      await f.request("owner-a", "POST", "/v1/schedule/preview", {
        planId: f.plan.id,
        from: today,
        to: later,
      })
    ).json().data;
    assert.equal(view.after[0].status, "paused");
    assert.equal(view.after[1].status, "scheduled");
    assert.equal(view.after[1].quantityMilli, 500);
    override = await f.request(
      "owner-a",
      "PUT",
      `/v1/plans/${f.plan.id}/override`,
      {
        expectedVersion: 3,
        serviceOn: tomorrow,
        action: "clear",
        reason: "Use normal paused schedule",
      },
    );
    assert.equal(override.statusCode, 200, override.body);
    assert.equal(override.json().data.overrides.length, 2);
    const resume = await f.request(
      "owner-a",
      "POST",
      `/v1/plans/${f.plan.id}/pauses/${pauseId}/resume`,
      {
        expectedVersion: 4,
        resumeOn: later,
        reason: "Customer returning early",
      },
    );
    assert.equal(resume.statusCode, 200, resume.body);
    view = (
      await f.request("owner-a", "POST", "/v1/schedule/preview", {
        planId: f.plan.id,
        from: today,
        to: later,
      })
    ).json().data;
    assert.deepEqual(
      view.after.map((d: { status: string }) => d.status),
      ["paused", "paused", "scheduled"],
    );
  } finally {
    await f.close();
  }
});
test("customer edits/archive and inclusive plan end dates use versions and preserve earlier schedules", async () => {
  const f = await setup();
  try {
    const edit = await f.request(
      "owner-a",
      "PATCH",
      `/v1/customers/${f.customer.id}`,
      {
        name: "Ananya Sharma",
        phone: "",
        address: "New address",
        expectedVersion: 1,
        reason: "Address updated",
      },
    );
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal(edit.json().data.version, 2);
    const ended = await f.request(
      "owner-a",
      "POST",
      `/v1/plans/${f.plan.id}/end`,
      {
        expectedVersion: 1,
        endOn: tomorrow,
        reason: "Subscription ends tomorrow",
      },
    );
    assert.equal(ended.statusCode, 200, ended.body);
    let preview = (
      await f.request("owner-a", "POST", "/v1/schedule/preview", {
        planId: f.plan.id,
        from: today,
        to: later,
      })
    ).json().data;
    assert.deepEqual(
      preview.after.map((d: { status: string }) => d.status),
      ["scheduled", "scheduled", "ended"],
    );
    assert.equal(
      (
        await f.request("owner-a", "PUT", `/v1/plans/${f.plan.id}/override`, {
          expectedVersion: 2,
          serviceOn: later,
          action: "resume",
          reason: "Cannot resurrect ended plan",
        })
      ).statusCode,
      422,
    );
    const archive = await f.request(
      "owner-a",
      "POST",
      `/v1/customers/${f.customer.id}/archive`,
      {
        expectedVersion: 2,
        effectiveOn: tomorrow,
        reason: "Customer moved away",
      },
    );
    assert.equal(archive.statusCode, 200, archive.body);
    preview = (
      await f.request("owner-a", "POST", "/v1/schedule/preview", {
        planId: f.plan.id,
        from: today,
        to: tomorrow,
      })
    ).json().data;
    assert.equal(preview.after[0].status, "scheduled");
    assert.equal(preview.after[1].status, "archived");
    assert.equal(
      (
        await f.request("owner-a", "GET", `/v1/customers/${f.customer.id}`)
      ).json().data.archivedEffectiveOn,
      tomorrow,
    );
  } finally {
    await f.close();
  }
});
test("API and PostgreSQL policies deny cross-business plan reads, changes and customer association", async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await f.request(
          "owner-b",
          "GET",
          `/v1/customers/${f.customer.id}/plans`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request("owner-b", "POST", `/v1/plans/${f.plan.id}/pauses`, {
          expectedVersion: 1,
          fromOn: today,
          toOn: tomorrow,
          reason: "Other tenant attempt",
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request("owner-b", "POST", "/v1/schedule/preview", {
          planId: f.plan.id,
          from: today,
          to: tomorrow,
        })
      ).statusCode,
      404,
    );
    const b = (await f.request("owner-b", "GET", "/v1/me")).json().data.business
      .id;
    await f.db.transaction(async (t) => {
      await t.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
        [ownerB.id, b],
      );
      for (const table of [
        "plans",
        "plan_revisions",
        "pause_ranges",
        "date_overrides",
      ])
        assert.equal(
          (await t.query("SELECT * FROM app." + table)).rows.length,
          0,
        );
    });
    await assert.rejects(
      f.db.transaction(async (t) => {
        await t.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
          [ownerB.id, b],
        );
        await t.query(
          "INSERT INTO app.plans(business_id,customer_id,slot_key,unit,start_on) VALUES($1,$2,$3,$4,$5)",
          [b, f.customer.id, "bad-plan", "litre", today],
        );
      }),
    );
  } finally {
    await f.close();
  }
});
test("invalid history edits and large date windows are rejected; failed audit rolls the entire mutation back", async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await f.request("owner-a", "POST", "/v1/schedule/preview", {
          planId: f.plan.id,
          from: today,
          to: shiftDate(today, 62),
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await f.request("owner-a", "POST", `/v1/plans/${f.plan.id}/pauses`, {
          expectedVersion: 1,
          fromOn: shiftDate(today, -1),
          toOn: tomorrow,
          reason: "Past change blocked",
        })
      ).statusCode,
      422,
    );
    await f.pg.exec("REVOKE INSERT ON app.audit_events FROM dailyloop_runtime");
    const response = await f.request(
      "owner-a",
      "POST",
      `/v1/plans/${f.plan.id}/pauses`,
      {
        expectedVersion: 1,
        fromOn: today,
        toOn: tomorrow,
        reason: "Transaction must roll back",
      },
    );
    assert.equal(response.statusCode, 500);
    const loaded = (
      await f.request("owner-a", "GET", `/v1/customers/${f.customer.id}/plans`)
    ).json().data.plans[0];
    assert.equal(loaded.version, 1);
    assert.equal(loaded.pauses.length, 0);
  } finally {
    await f.close();
  }
});
test("additive migration preserves existing foundation customer rows", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      await readFile(
        new URL("../migrations/0001_foundation.sql", import.meta.url),
        "utf8",
      ),
    );
    const b = randomUUID(),
      c = randomUUID();
    await pg.query(
      "INSERT INTO app.businesses(id,owner_id,name,service_type) VALUES($1,$2,$3,$4)",
      [b, randomUUID(), "Existing business", "milk"],
    );
    await pg.query(
      "INSERT INTO app.customers(id,business_id,name,address) VALUES($1,$2,$3,$4)",
      [c, b, "Existing customer", "Existing address"],
    );
    await pg.exec(
      await readFile(
        new URL("../migrations/0002_plan_lifecycle.sql", import.meta.url),
        "utf8",
      ),
    );
    const row = (
      await pg.query(
        "SELECT name,archived_effective_on,version FROM app.customers WHERE id=$1",
        [c],
      )
    ).rows[0] as { name: string; archived_effective_on: null; version: number };
    assert.equal(row.name, "Existing customer");
    assert.equal(row.archived_effective_on, null);
    assert.equal(row.version, 1);
  } finally {
    await pg.close();
  }
});
test("calendar rules cross leap days/month boundaries and money/quantity parsing is exact", () => {
  const c = {
    id: randomUUID(),
    businessId: randomUUID(),
    name: "Customer",
    phone: "",
    address: "Address",
    version: 1,
    createdAt: "2026-01-01",
    archivedEffectiveOn: null,
  } satisfies Customer;
  const p = {
    id: randomUUID(),
    customerId: c.id,
    unit: "litre",
    startOn: "2028-02-28",
    endOn: null,
    version: 1,
    revisions: [
      {
        id: "r1",
        effectiveFrom: "2028-02-28",
        label: "Milk",
        quantityMilli: 1000,
        ratePaise: "6000",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        reason: "Initial plan",
      },
    ],
    pauses: [],
    overrides: [],
  } satisfies RecurringPlan;
  assert.equal(shiftDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftDate("2028-02-28", 2), "2028-03-01");
  assert.equal(scheduleDay(p, c, "2028-02-29").status, "scheduled");
  assert.equal(decimalToScaled("0.001", 1000), 1);
  assert.equal(decimalToScaled("60.10", 100), 6010);
  assert.throws(() => decimalToScaled("60.101", 100));
  assert.throws(() => decimalToScaled("1e2", 100));
  assert.equal(formatPaise("9007199254740993"), "₹9,00,71,99,25,47,409.93");
});

test("new plan screens stay gated while the live database still has only the foundation schema", async () => {
  const f = await setup();
  try {
    await f.pg.exec(
      "DROP TABLE app.ledger_entries,app.opening_balances,app.money_events,app.delivery_events,app.delivery_occurrences,app.date_overrides,app.pause_ranges,app.plan_revisions,app.plans CASCADE",
    );
    const me = await f.request("owner-a", "GET", "/v1/me");
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().data.features.planLifecycle, false);
    assert.equal(
      (await f.request("owner-a", "GET", "/v1/customers")).statusCode,
      200,
    );
    const detail = await f.request(
      "owner-a",
      "GET",
      `/v1/customers/${f.customer.id}/plans`,
    );
    assert.equal(detail.statusCode, 503);
    assert.equal(detail.json().error.code, "MIGRATION_REQUIRED");
  } finally {
    await f.close();
  }
});
