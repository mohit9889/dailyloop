import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
export class DomainError extends Error {
  status = 400;
}
export const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function fail(message: string): never {
  throw new DomainError(message);
}
function text(value: unknown, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function date(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("Use a valid date.");
  return value;
}
function fixed(value: unknown, scale: number, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100000 ||
    Math.abs(value * scale - Math.round(value * scale)) > 0.000001
  )
    fail(
      `${label} must be positive with at most ${Math.log10(scale)} decimal places (maximum 100,000).`,
    );
  return Math.round(value * scale);
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,customerId TEXT NOT NULL REFERENCES customers(id),label TEXT NOT NULL,unit TEXT NOT NULL,quantityMilli INTEGER NOT NULL,ratePaise INTEGER NOT NULL,start TEXT NOT NULL,weekdays TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,planId TEXT NOT NULL REFERENCES plans(id),date TEXT NOT NULL,status TEXT NOT NULL,quantityMilli INTEGER NOT NULL,chargePaise INTEGER NOT NULL,createdAt TEXT NOT NULL,UNIQUE(planId,date));
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,customerId TEXT NOT NULL REFERENCES customers(id),date TEXT NOT NULL,amountPaise INTEGER NOT NULL,method TEXT NOT NULL,note TEXT NOT NULL,createdAt TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  all(sql: string, ...params: (string | number)[]) {
    return this.db.prepare(sql).all(...params) as Record<string, any>[];
  }
  one(sql: string, ...params: (string | number)[]) {
    return this.db.prepare(sql).get(...params) as
      Record<string, any> | undefined;
  }
  snapshot(day: string) {
    date(day);
    const customers = this.all("SELECT * FROM customers ORDER BY name");
    const plans = this.all("SELECT * FROM plans ORDER BY rowid").map(
      (p): Record<string, any> => ({ ...p, weekdays: JSON.parse(p.weekdays) }),
    );
    const deliveries = this.all("SELECT * FROM deliveries WHERE date=?", day);
    const payments = this.all(
      "SELECT * FROM payments ORDER BY date DESC,rowid DESC",
    );
    const round = plans
      .filter(
        (p) =>
          p.start <= day &&
          p.weekdays.includes(new Date(day + "T00:00:00Z").getUTCDay()),
      )
      .map((p) => ({
        ...p,
        customer: customers.find((c) => c.id === p.customerId),
        delivery: deliveries.find((d) => d.planId === p.id) || null,
      }));
    return { customers, plans, round, payments, today: todayIST(), date: day };
  }
  addCustomer(input: Record<string, unknown>) {
    const row = {
      id: randomUUID(),
      name: text(input.name, "Name"),
      phone: typeof input.phone === "string" ? input.phone.trim() : "",
      address: text(input.address, "Address", 300),
    };
    if (row.phone && !/^[+\d ()-]{7,20}$/.test(row.phone))
      fail("Use a valid phone number.");
    this.db
      .prepare("INSERT INTO customers VALUES(?,?,?,?)")
      .run(row.id, row.name, row.phone, row.address);
    return row;
  }
  addPlan(input: Record<string, unknown>) {
    const customerId = text(input.customerId, "Customer");
    if (!this.one("SELECT id FROM customers WHERE id=?", customerId))
      fail("Customer not found.");
    const label = text(input.label, "Plan name");
    const unit = text(input.unit, "Unit", 20);
    if (!["litre", "meal"].includes(unit)) fail("Choose litre or meal.");
    const quantityMilli = fixed(input.quantity, 1000, "Quantity");
    const ratePaise = fixed(input.rate, 100, "Rate");
    const start = date(input.start);
    const weekdays = input.weekdays;
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      weekdays.some((x) => !Number.isInteger(x) || x < 0 || x > 6) ||
      new Set(weekdays).size !== weekdays.length
    )
      fail("Choose unique delivery weekdays.");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO plans VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        customerId,
        label,
        unit,
        quantityMilli,
        ratePaise,
        start,
        JSON.stringify(weekdays),
      );
    return { id };
  }
  recordDelivery(input: Record<string, unknown>) {
    const planId = text(input.planId, "Plan");
    const day = date(input.date);
    if (day > todayIST()) fail("Future deliveries cannot be confirmed.");
    const plan = this.one("SELECT * FROM plans WHERE id=?", planId);
    if (!plan) fail("Plan not found.");
    if (
      day < plan.start ||
      !JSON.parse(plan.weekdays).includes(
        new Date(day + "T00:00:00Z").getUTCDay(),
      )
    )
      fail("This plan is not scheduled on that date.");
    if (!["delivered", "missed", "skipped"].includes(String(input.status)))
      fail("Choose a valid delivery status.");
    const quantityMilli =
      input.status === "delivered"
        ? fixed(input.quantity, 1000, "Actual quantity")
        : 0;
    const chargePaise = Math.round((quantityMilli * plan.ratePaise) / 1000);
    if (
      this.one(
        "SELECT id FROM deliveries WHERE planId=? AND date=?",
        planId,
        day,
      )
    )
      fail("This delivery has already been recorded.");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO deliveries VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        planId,
        day,
        String(input.status),
        quantityMilli,
        chargePaise,
        new Date().toISOString(),
      );
    return { id, chargePaise };
  }
  addPayment(input: Record<string, unknown>) {
    const customerId = text(input.customerId, "Customer");
    if (!this.one("SELECT id FROM customers WHERE id=?", customerId))
      fail("Customer not found.");
    const day = date(input.date);
    if (day > todayIST()) fail("Payments cannot be future dated.");
    const amountPaise = fixed(input.amount, 100, "Amount");
    const method = text(input.method, "Method");
    if (!["cash", "upi", "bank"].includes(method))
      fail("Choose a valid payment method.");
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note.length > 300) fail("Note must be at most 300 characters.");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        customerId,
        day,
        amountPaise,
        method,
        note,
        new Date().toISOString(),
      );
    return { id };
  }
  statement(customerId: string, from: string, to: string) {
    date(from);
    date(to);
    if (from > to) fail("Start date must be before end date.");
    const customer = this.one("SELECT * FROM customers WHERE id=?", customerId);
    if (!customer) fail("Customer not found.");
    const deliveries = this.all(
      "SELECT d.*,p.label,p.unit FROM deliveries d JOIN plans p ON p.id=d.planId WHERE p.customerId=? AND d.date<=? ORDER BY d.date,d.rowid",
      customerId,
      to,
    );
    const payments = this.all(
      "SELECT * FROM payments WHERE customerId=? AND date<=? ORDER BY date,rowid",
      customerId,
      to,
    );
    const openingPaise =
      deliveries
        .filter((d) => d.date < from)
        .reduce((sum, d) => sum + d.chargePaise, 0) -
      payments
        .filter((p) => p.date < from)
        .reduce((sum, p) => sum + p.amountPaise, 0);
    const rows = [
      ...deliveries
        .filter((d) => d.date >= from)
        .map((d) => ({
          id: d.id,
          date: d.date,
          description: `${d.label} · ${d.status} · ${d.quantityMilli / 1000} ${d.unit}`,
          chargePaise: d.chargePaise,
          paymentPaise: 0,
        })),
      ...payments
        .filter((p) => p.date >= from)
        .map((p) => ({
          id: p.id,
          date: p.date,
          description: `Payment · ${p.method}${p.note ? " · " + p.note : ""}`,
          chargePaise: 0,
          paymentPaise: p.amountPaise,
        })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let pending = 0;
    const plans = this.all(
      "SELECT * FROM plans WHERE customerId=?",
      customerId,
    );
    const until = to < todayIST() ? to : todayIST();
    const days = (Date.parse(until) - Date.parse(from)) / 86400000;
    if (days > 3660) fail("Statements support periods up to 10 years.");
    for (let i = 0; i <= days; i++) {
      const day = new Date(Date.parse(from) + i * 86400000)
        .toISOString()
        .slice(0, 10);
      for (const p of plans)
        if (
          p.start <= day &&
          JSON.parse(p.weekdays).includes(new Date(day).getUTCDay()) &&
          !deliveries.some((d) => d.planId === p.id && d.date === day)
        )
          pending++;
    }
    const chargesPaise = rows.reduce((s, r) => s + r.chargePaise, 0),
      paymentsPaise = rows.reduce((s, r) => s + r.paymentPaise, 0);
    return {
      customer,
      from,
      to,
      rows,
      openingPaise,
      chargesPaise,
      paymentsPaise,
      closingPaise: openingPaise + chargesPaise - paymentsPaise,
      pending,
    };
  }
}
