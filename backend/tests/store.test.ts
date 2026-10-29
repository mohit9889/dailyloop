import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, date, todayIST } from "../src/store.ts";
function setup() {
  const store = new Store(":memory:");
  const c = store.addCustomer({
    name: "Ananya Sharma",
    address: "A-204, Sector 46",
  });
  const p = store.addPlan({
    customerId: c.id,
    label: "Morning milk",
    unit: "litre",
    quantity: 1,
    rate: 60,
    start: "2026-01-01",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  return { store, c, p };
}
test("partial quantities are billed once and duplicate delivery is rejected", () => {
  const { store, c, p } = setup();
  try {
    store.recordDelivery({
      planId: p.id,
      date: "2026-01-01",
      status: "delivered",
      quantity: 0.75,
    });
    assert.equal(
      store.statement(c.id, "2026-01-01", "2026-01-01").closingPaise,
      4500,
    );
    assert.throws(
      () =>
        store.recordDelivery({
          planId: p.id,
          date: "2026-01-01",
          status: "delivered",
          quantity: 1,
        }),
      /already/,
    );
  } finally {
    store.close();
  }
});
test("multiple plans stay independent and statement subtracts payment", () => {
  const { store, c, p } = setup();
  try {
    const evening = store.addPlan({
      customerId: c.id,
      label: "Evening milk",
      unit: "litre",
      quantity: 0.5,
      rate: 60,
      start: "2026-01-01",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    store.recordDelivery({
      planId: p.id,
      date: "2026-01-01",
      status: "delivered",
      quantity: 1,
    });
    store.recordDelivery({
      planId: evening.id,
      date: "2026-01-01",
      status: "delivered",
      quantity: 0.5,
    });
    store.addPayment({
      customerId: c.id,
      date: "2026-01-01",
      amount: 50,
      method: "cash",
    });
    const statement = store.statement(c.id, "2026-01-01", "2026-01-01");
    assert.equal(statement.closingPaise, 4000);
    assert.equal(statement.pending, 0);
    assert.equal(store.snapshot("2026-01-01").round.length, 2);
  } finally {
    store.close();
  }
});
test("missed and skipped deliveries have zero charge", () => {
  const { store, c, p } = setup();
  try {
    for (const [day, status] of [
      ["2026-01-01", "skipped"],
      ["2026-01-02", "missed"],
    ])
      store.recordDelivery({ planId: p.id, date: day, status, quantity: 5 });
    assert.equal(
      store.statement(c.id, "2026-01-01", "2026-01-02").chargesPaise,
      0,
    );
  } finally {
    store.close();
  }
});
test("pending stops make a statement provisional and opening balance carries forward", () => {
  const { store, c, p } = setup();
  try {
    store.recordDelivery({
      planId: p.id,
      date: "2026-01-01",
      status: "delivered",
      quantity: 1,
    });
    const s = store.statement(c.id, "2026-01-02", "2026-01-03");
    assert.equal(s.openingPaise, 6000);
    assert.equal(s.pending, 2);
    assert.equal(s.closingPaise, 6000);
  } finally {
    store.close();
  }
});
test("invalid dates, future confirmations, unscheduled days and excess precision rejected", () => {
  const { store, c, p } = setup();
  try {
    assert.throws(() => date("2026-02-30"));
    assert.throws(
      () =>
        store.recordDelivery({
          planId: p.id,
          date: "2099-01-01",
          status: "delivered",
          quantity: 1,
        }),
      /Future/,
    );
    assert.throws(
      () =>
        store.recordDelivery({
          planId: p.id,
          date: "2026-01-01",
          status: "delivered",
          quantity: 0.0001,
        }),
      /decimal/,
    );
    assert.throws(() =>
      store.addPayment({
        customerId: c.id,
        date: todayIST(),
        amount: -1,
        method: "cash",
      }),
    );
    const monday = store.addPlan({
      customerId: c.id,
      label: "Monday",
      unit: "meal",
      quantity: 1,
      rate: 100,
      start: "2026-01-01",
      weekdays: [1],
    });
    assert.throws(
      () =>
        store.recordDelivery({
          planId: monday.id,
          date: "2026-01-01",
          status: "delivered",
          quantity: 1,
        }),
      /not scheduled/,
    );
  } finally {
    store.close();
  }
});
test("saved records survive reopening the SQLite file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dailyloop-test-"));
  const path = join(dir, "test.sqlite");
  let store = new Store(path);
  try {
    store.addCustomer({ name: "Persistent customer", address: "Test address" });
    store.close();
    store = new Store(path);
    assert.equal(
      store.snapshot(todayIST()).customers[0].name,
      "Persistent customer",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
