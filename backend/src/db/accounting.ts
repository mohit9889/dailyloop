import { randomUUID } from "node:crypto";
import {
  todayIST,
  shiftDate,
  type Business,
  type Customer,
  type RecurringPlan,
  type ConfirmDelivery,
  type CorrectDelivery,
  type ReceiptInput,
  type OpeningInput,
  type Period,
  type DeliveryRecord,
  type MoneyEvent,
  type Statement,
  type Round,
  type LedgerLine,
} from "@dailyloop/contracts";
import { LifecycleRepository } from "./lifecycle.js";
import { customer, type Identity } from "./repository.js";
import type { Sql } from "./database.js";
import { ApiError } from "../errors.js";
import { scheduleDay } from "../domain/schedule.js";
const day = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const stamp = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const rule = (message: string): never => {
  throw new ApiError(422, "ACCOUNTING_RULE", message);
};
const stale = (): never => {
  throw new ApiError(
    409,
    "VERSION_CONFLICT",
    "The record or schedule changed. Refresh and review again.",
  );
};
export const charge = (quantity: number, rate: string) =>
  ((BigInt(quantity) * BigInt(rate) + 500n) / 1000n).toString();
type Row = Record<string, unknown>;
function delivery(r: Row): DeliveryRecord {
  return {
    id: String(r.occurrence_id),
    planId: String(r.plan_id),
    customerId: String(r.customer_id),
    customerName: String(r.customer_name || ""),
    serviceOn: day(r.service_on),
    version: Number(r.version),
    eventId: String(r.id),
    status: r.status as DeliveryRecord["status"],
    quantityMilli: Number(r.quantity_milli),
    ratePaise: String(r.rate_paise),
    chargePaise: String(r.charge_paise),
    unit: r.unit as DeliveryRecord["unit"],
    label: String(r.label),
    reason: String(r.reason),
    actorId: String(r.actor_id),
    recordedAt: stamp(r.recorded_at),
  };
}
function money(r: Row): MoneyEvent {
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    kind: r.kind as MoneyEvent["kind"],
    amountPaise: String(r.amount_paise),
    method: r.method ? String(r.method) : null,
    effectiveOn: day(r.effective_on),
    reversesEventId: r.reverses_event_id ? String(r.reverses_event_id) : null,
    reason: String(r.reason),
    actorId: String(r.actor_id),
    recordedAt: stamp(r.recorded_at),
    reversed: Boolean(r.reversed),
  };
}
export class AccountingRepository extends LifecycleRepository {
  async available() {
    return this.db.transaction(async (t) =>
      Boolean(
        (
          await t.query(
            "SELECT to_regclass('app.ledger_entries') IS NOT NULL AS available",
          )
        ).rows[0].available,
      ),
    );
  }
  async revision(t: Sql, id: string) {
    return Number(
      (await t.query("SELECT revision FROM app.businesses WHERE id=$1", [id]))
        .rows[0].revision,
    );
  }
  async cutover(t: Sql, bid: string, cid: string) {
    return (
      await t.query(
        "SELECT o.*,m.amount_paise FROM app.opening_balances o JOIN app.money_events m ON m.id=o.current_event_id WHERE o.business_id=$1 AND o.customer_id=$2",
        [bid, cid],
      )
    ).rows[0];
  }
  async checkCutover(t: Sql, bid: string, cid: string, date: string) {
    const opening = await this.cutover(t, bid, cid);
    if (opening && date < day(opening.cutover_on))
      rule(
        "This date is before the opening-balance cutover. Earlier activity is already represented by that balance.",
      );
  }
  async read<T>(user: Identity, fn: (t: Sql, b: Business) => Promise<T>) {
    return this.tenant(user, async (t, b) => {
      await this.lock(t, b.id);
      b.revision = await this.revision(t, b.id);
      return fn(t, b);
    });
  }
  async records(t: Sql, bid: string, where: string, params: unknown[]) {
    return (
      await t.query(
        `SELECT e.*,o.plan_id,o.service_on,o.version,c.name AS customer_name FROM app.delivery_occurrences o JOIN app.delivery_events e ON e.id=o.current_event_id JOIN app.customers c ON c.id=o.customer_id WHERE o.business_id=$1 AND ${where}`,
        [bid, ...params],
      )
    ).rows.map(delivery);
  }
  // Batch schedule history reads avoid one database round trip per plan in a round.
  async allPlans(
    t: Sql,
    bid: string,
    cid?: string,
    after?: string,
    limit = 1000,
  ) {
    const rows = (
      await t.query(
        "SELECT id FROM app.plans WHERE business_id=$1 AND ($2::uuid IS NULL OR customer_id=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
        [bid, cid || null, after || null, limit + 1],
      )
    ).rows;
    const ids = rows.slice(0, limit).map((r) => String(r.id));
    if (!ids.length) return { plans: [] as RecurringPlan[], nextCursor: null };
    const p = (
      await t.query(
        "SELECT * FROM app.plans WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
        [bid, ids],
      )
    ).rows;
    const rs = (
      await t.query(
        "SELECT * FROM app.plan_revisions WHERE business_id=$1 AND plan_id=ANY($2::uuid[]) ORDER BY effective_from",
        [bid, ids],
      )
    ).rows;
    const ps = (
      await t.query(
        "SELECT * FROM app.pause_ranges WHERE business_id=$1 AND plan_id=ANY($2::uuid[]) ORDER BY from_on,id",
        [bid, ids],
      )
    ).rows;
    const os = (
      await t.query(
        "SELECT * FROM app.date_overrides WHERE business_id=$1 AND plan_id=ANY($2::uuid[]) ORDER BY service_on,plan_version",
        [bid, ids],
      )
    ).rows;
    const plans: RecurringPlan[] = p.map((v) => ({
      id: String(v.id),
      customerId: String(v.customer_id),
      unit: v.unit as "meal" | "litre",
      startOn: day(v.start_on),
      endOn: v.end_on ? day(v.end_on) : null,
      version: Number(v.version),
      revisions: rs
        .filter((x) => x.plan_id === v.id)
        .map((x) => ({
          id: String(x.id),
          effectiveFrom: day(x.effective_from),
          label: String(x.label),
          quantityMilli: Number(x.quantity_milli),
          ratePaise: String(x.rate_paise),
          weekdays: x.weekdays as number[],
          reason: String(x.reason),
        })),
      pauses: ps
        .filter((x) => x.plan_id === v.id)
        .map((x) => ({
          id: String(x.id),
          fromOn: day(x.from_on),
          toOn: day(x.to_on),
          resumeOn: x.resume_on ? day(x.resume_on) : null,
          reason: String(x.reason),
        })),
      overrides: os
        .filter((x) => x.plan_id === v.id)
        .map((x) => ({
          id: String(x.id),
          serviceOn: day(x.service_on),
          action: x.action as "skip" | "resume" | "quantity" | "clear",
          quantityMilli:
            x.quantity_milli === null ? null : Number(x.quantity_milli),
          planVersion: Number(x.plan_version),
          reason: String(x.reason),
        })),
    }));
    return {
      plans,
      nextCursor: rows.length > limit ? ids[ids.length - 1] : null,
    };
  }
  async round(user: Identity, date: string, after?: string): Promise<Round> {
    return this.read(user, async (t, b) => {
      const { plans, nextCursor } = await this.allPlans(
        t,
        b.id,
        undefined,
        after,
        100,
      );
      const cr = await t.query(
        "SELECT * FROM app.customers WHERE business_id=$1 AND id=ANY($2::uuid[])",
        [b.id, [...new Set(plans.map((p) => p.customerId))]],
      );
      const customers = new Map(
        cr.rows.map((r) => {
          const c = customer(r);
          return [c.id, c];
        }),
      );
      const records = await this.records(
        t,
        b.id,
        "o.service_on=$2 AND o.plan_id=ANY($3::uuid[])",
        [date, plans.map((p) => p.id)],
      );
      const map = new Map(records.map((r) => [r.planId, r]));
      return {
        date,
        businessRevision: b.revision,
        nextCursor,
        stops: plans
          .map((p) => {
            const c = customers.get(p.customerId)!;
            return {
              planId: p.id,
              customerId: c.id,
              customerName: c.name,
              address: c.address,
              schedule: scheduleDay(p, c, date),
              record: map.get(p.id) || null,
            };
          })
          .filter(
            (s) =>
              s.record ||
              ["scheduled", "skipped", "paused"].includes(s.schedule.status),
          ),
      };
    });
  }
  async posting(
    t: Sql,
    bid: string,
    cid: string,
    date: string,
    amount: string,
    role: string,
    source: string,
    isDelivery: boolean,
    description: string,
  ) {
    await t.query(
      `INSERT INTO app.ledger_entries(business_id,customer_id,effective_on,signed_amount_paise,posting_role,${isDelivery ? "delivery_event_id" : "money_event_id"},description) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [bid, cid, date, amount, role, source, description],
    );
  }
  async confirm(user: Identity, input: ConfirmDelivery, key: string) {
    return this.mutate(user, key, "delivery.confirm", input, async (t, b) => {
      if (input.scheduleRevision !== (await this.revision(t, b.id))) stale();
      const p = await this.planRow(t, b.id, input.planId),
        c = await this.customerRow(t, b.id, p.customerId),
        s = scheduleDay(p, c, input.serviceOn);
      if (s.status !== "scheduled")
        rule(
          "This plan is not scheduled on that date. Use an explicit schedule change first.",
        );
      await this.checkCutover(t, b.id, c.id, input.serviceOn);
      this.quantity(p.unit, input.quantityMilli);
      if (
        (
          await t.query(
            "SELECT id FROM app.delivery_occurrences WHERE business_id=$1 AND plan_id=$2 AND service_on=$3",
            [b.id, p.id, input.serviceOn],
          )
        ).rows.length
      )
        stale();
      const id = randomUUID();
      await t.query(
        "INSERT INTO app.delivery_occurrences(id,business_id,customer_id,plan_id,service_on) VALUES($1,$2,$3,$4,$5)",
        [id, b.id, c.id, p.id, input.serviceOn],
      );
      const result = await this.saveDelivery(
        t,
        b.id,
        user.id,
        id,
        c.id,
        input.serviceOn,
        p.id,
        c.name,
        p.unit,
        s.label,
        s.revisionId!,
        s.ratePaise,
        input,
        0,
        null,
      );
      return {
        value: result,
        entityId: id,
        action: "delivery.confirmed",
        details: { after: result },
      };
    });
  }
  async saveDelivery(
    t: Sql,
    bid: string,
    actor: string,
    id: string,
    cid: string,
    date: string,
    planId: string,
    name: string,
    unit: "meal" | "litre",
    label: string,
    revision: string,
    rate: string,
    input: {
      status: DeliveryRecord["status"];
      quantityMilli: number;
      reason: string;
    },
    version: number,
    previous: DeliveryRecord | null,
  ) {
    const eid = randomUUID(),
      amount = charge(input.quantityMilli, rate);
    this.quantity(unit, input.quantityMilli);
    const e = (
      await t.query(
        "INSERT INTO app.delivery_events(id,business_id,customer_id,occurrence_id,previous_event_id,status,quantity_milli,rate_paise,charge_paise,unit,label,revision_id,reason,actor_id,occurrence_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
        [
          eid,
          bid,
          cid,
          id,
          previous?.eventId || null,
          input.status,
          input.quantityMilli,
          rate,
          amount,
          unit,
          label,
          revision,
          input.reason,
          actor,
          version + 1,
        ],
      )
    ).rows[0];
    if (previous)
      await this.posting(
        t,
        bid,
        cid,
        date,
        (-BigInt(previous.chargePaise)).toString(),
        "charge_reversal",
        eid,
        true,
        `Reverse ${label}: ${input.reason}`,
      );
    await this.posting(
      t,
      bid,
      cid,
      date,
      amount,
      "charge",
      eid,
      true,
      `${label} · ${input.status} · ${input.quantityMilli / 1000} ${unit}`,
    );
    await t.query(
      "UPDATE app.delivery_occurrences SET current_event_id=$1,version=version+1 WHERE business_id=$2 AND id=$3",
      [eid, bid, id],
    );
    return delivery({
      ...e,
      plan_id: planId,
      service_on: date,
      version: version + 1,
      customer_name: name,
    });
  }
  async correct(
    user: Identity,
    id: string,
    input: CorrectDelivery,
    key: string,
  ) {
    return this.mutate(
      user,
      key,
      "delivery.correct/" + id,
      input,
      async (t, b) => {
        const old = (await this.records(t, b.id, "o.id=$2", [id]))[0];
        if (!old) throw new ApiError(404, "NOT_FOUND", "Delivery not found.");
        if (old.version !== input.expectedVersion) stale();
        const r = (
          await t.query(
            "SELECT revision_id FROM app.delivery_events WHERE business_id=$1 AND id=$2",
            [b.id, old.eventId],
          )
        ).rows[0];
        const result = await this.saveDelivery(
          t,
          b.id,
          user.id,
          id,
          old.customerId,
          old.serviceOn,
          old.planId,
          old.customerName,
          old.unit,
          old.label,
          String(r.revision_id),
          old.ratePaise,
          input,
          old.version,
          old,
        );
        return {
          value: result,
          entityId: id,
          action: "delivery.corrected",
          details: { before: old, after: result },
        };
      },
    );
  }
  async history(user: Identity, id: string, after?: string) {
    return this.read(user, async (t, b) => {
      const old = (await this.records(t, b.id, "o.id=$2", [id]))[0];
      if (!old) throw new ApiError(404, "NOT_FOUND", "Delivery not found.");
      const r = await t.query(
        "SELECT e.*,o.plan_id,o.service_on,e.occurrence_version AS version FROM app.delivery_events e JOIN app.delivery_occurrences o ON o.id=e.occurrence_id WHERE e.business_id=$1 AND e.occurrence_id=$2 AND ($3::uuid IS NULL OR e.occurrence_version>(SELECT occurrence_version FROM app.delivery_events WHERE business_id=$1 AND occurrence_id=$2 AND id=$3)) ORDER BY e.occurrence_version LIMIT 51",
        [b.id, id, after || null],
      );
      return {
        items: r.rows.slice(0, 50).map(delivery),
        nextCursor: r.rows.length > 50 ? String(r.rows[49].id) : null,
      };
    });
  }
  async addMoney(
    t: Sql,
    bid: string,
    cid: string,
    actor: string,
    kind: "receipt" | "opening" | "reversal",
    amount: string,
    date: string,
    reason: string,
    method: string | null = null,
    reverses: string | null = null,
  ) {
    const e = (
      await t.query(
        "INSERT INTO app.money_events(business_id,customer_id,actor_id,kind,amount_paise,effective_on,reason,method,reverses_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [bid, cid, actor, kind, amount, date, reason, method, reverses],
      )
    ).rows[0];
    const signed = kind === "receipt" ? -BigInt(amount) : BigInt(amount);
    const target =
      kind === "reversal"
        ? (
            await t.query(
              "SELECT kind FROM app.money_events WHERE business_id=$1 AND id=$2",
              [bid, reverses],
            )
          ).rows[0]
        : null;
    await this.posting(
      t,
      bid,
      cid,
      date,
      signed.toString(),
      kind === "reversal"
        ? target?.kind === "opening"
          ? "opening_reversal"
          : "money_reversal"
        : kind,
      String(e.id),
      false,
      `${kind === "receipt" ? "Receipt · " + method : kind === "opening" ? "Opening balance" : "Reversal"} · ${reason}`,
    );
    return money(e);
  }
  async receipt(user: Identity, input: ReceiptInput, key: string) {
    return this.mutate(user, key, "receipt.create", input, async (t, b) => {
      await this.customerRow(t, b.id, input.customerId);
      await this.checkCutover(t, b.id, input.customerId, input.effectiveOn);
      const result = await this.addMoney(
        t,
        b.id,
        input.customerId,
        user.id,
        "receipt",
        input.amountPaise,
        input.effectiveOn,
        input.reason,
        input.method,
      );
      return {
        value: result,
        entityId: result.id,
        action: "receipt.created",
        details: { after: result },
      };
    });
  }
  async reverse(user: Identity, id: string, reason: string, key: string) {
    return this.mutate(
      user,
      key,
      "receipt.reverse/" + id,
      { reason },
      async (t, b) => {
        const r = (
          await t.query(
            "SELECT m.*,EXISTS(SELECT 1 FROM app.money_events x WHERE x.reverses_event_id=m.id) AS reversed FROM app.money_events m WHERE m.business_id=$1 AND m.id=$2 AND m.kind='receipt'",
            [b.id, id],
          )
        ).rows[0];
        if (!r) throw new ApiError(404, "NOT_FOUND", "Receipt not found.");
        if (r.reversed) stale();
        const result = await this.addMoney(
          t,
          b.id,
          String(r.customer_id),
          user.id,
          "reversal",
          String(r.amount_paise),
          day(r.effective_on),
          reason,
          null,
          id,
        );
        return {
          value: result,
          entityId: result.id,
          action: "receipt.reversed",
          details: { reverses: id, after: result },
        };
      },
    );
  }
  async opening(user: Identity, cid: string, input: OpeningInput, key: string) {
    return this.mutate(user, key, "opening/" + cid, input, async (t, b) => {
      await this.customerRow(t, b.id, cid);
      const old = await this.cutover(t, b.id, cid);
      if ((old ? Number(old.version) : 0) !== input.expectedVersion) stale();
      if (old && day(old.cutover_on) !== input.cutoverOn)
        rule(
          "The cutover date is fixed. Correct the opening amount without moving the cutover.",
        );
      if (
        !old &&
        (
          await t.query(
            "SELECT id FROM app.ledger_entries WHERE business_id=$1 AND customer_id=$2 AND effective_on<$3 LIMIT 1",
            [b.id, cid, input.cutoverOn],
          )
        ).rows.length
      )
        rule(
          "Earlier entries already exist. Choose a cutover no later than your first recorded transaction.",
        );
      if (old)
        await this.addMoney(
          t,
          b.id,
          cid,
          user.id,
          "reversal",
          (-BigInt(String(old.amount_paise))).toString(),
          input.cutoverOn,
          input.reason,
          null,
          String(old.current_event_id),
        );
      const result = await this.addMoney(
        t,
        b.id,
        cid,
        user.id,
        "opening",
        input.amountPaise,
        input.cutoverOn,
        input.reason,
      );
      if (old)
        await t.query(
          "UPDATE app.opening_balances SET current_event_id=$1,version=version+1 WHERE business_id=$2 AND customer_id=$3",
          [result.id, b.id, cid],
        );
      else
        await t.query(
          "INSERT INTO app.opening_balances(business_id,customer_id,cutover_on,current_event_id,version) VALUES($1,$2,$3,$4,1)",
          [b.id, cid, input.cutoverOn, result.id],
        );
      return {
        value: { ...result, version: input.expectedVersion + 1 },
        entityId: result.id,
        action: "opening.saved",
        details: { after: result },
      };
    });
  }
  async receipts(user: Identity, cid: string, period: Period) {
    return this.read(user, async (t, b) => {
      await this.customerRow(t, b.id, cid);
      const r = await t.query(
        "SELECT m.*,EXISTS(SELECT 1 FROM app.money_events x WHERE x.reverses_event_id=m.id) AS reversed FROM app.money_events m WHERE business_id=$1 AND customer_id=$2 AND effective_on BETWEEN $3 AND $4 AND kind IN ('receipt','reversal') AND ($5::uuid IS NULL OR id>$5) ORDER BY id LIMIT $6",
        [
          b.id,
          cid,
          period.from,
          period.to,
          period.after || null,
          period.limit + 1,
        ],
      );
      return {
        items: r.rows.slice(0, period.limit).map(money),
        nextCursor:
          r.rows.length > period.limit
            ? String(r.rows[period.limit - 1].id)
            : null,
      };
    });
  }
  async statement(
    user: Identity,
    cid: string,
    period: Period,
  ): Promise<Statement> {
    return this.read(user, (t, b) => this.statementIn(t, b, cid, period));
  }
  async exportStatement(
    user: Identity,
    cid: string,
    period: Period,
    expectedRevision: number,
  ): Promise<Statement> {
    return this.read(user, async (t, b) => {
      await this.customerRow(t, b.id, cid);
      if (b.revision !== expectedRevision)
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "The account changed. Refresh the statement before exporting.",
        );
      return this.statementIn(t, b, cid, { ...period, after: undefined }, true);
    });
  }
  private async statementIn(
    t: Sql,
    b: Business,
    cid: string,
    period: Period,
    all = false,
  ): Promise<Statement> {
    const c = await this.customerRow(t, b.id, cid),
      opening = await this.cutover(t, b.id, cid);
    const totals = (
      await t.query(
        "SELECT coalesce(sum(signed_amount_paise) FILTER(WHERE effective_on<$3),0)::text AS opening,coalesce(sum(signed_amount_paise),0)::text AS closing,coalesce(sum(signed_amount_paise) FILTER(WHERE effective_on>=$3 AND posting_role='charge'),0)::text AS charges,coalesce(sum(signed_amount_paise) FILTER(WHERE effective_on>=$3 AND posting_role IN ('opening','charge_reversal','opening_reversal')),0)::text AS adjustments,coalesce(-sum(signed_amount_paise) FILTER(WHERE effective_on>=$3 AND posting_role='receipt'),0)::text AS receipts,coalesce(sum(signed_amount_paise) FILTER(WHERE effective_on>=$3 AND posting_role='money_reversal'),0)::text AS reversals FROM app.ledger_entries WHERE business_id=$1 AND customer_id=$2 AND effective_on<=$4",
        [b.id, cid, period.from, period.to],
      )
    ).rows[0];
    if (
      period.after &&
      !(
        await t.query(
          "SELECT id FROM app.ledger_entries WHERE business_id=$1 AND customer_id=$2 AND id=$3 AND effective_on BETWEEN $4 AND $5",
          [b.id, cid, period.after, period.from, period.to],
        )
      ).rows.length
    )
      throw new ApiError(404, "NOT_FOUND", "Statement page not found.");
    const r = await t.query(
      "SELECT * FROM app.ledger_entries WHERE business_id=$1 AND customer_id=$2 AND effective_on BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR (effective_on,recorded_at,id)>(SELECT effective_on,recorded_at,id FROM app.ledger_entries WHERE business_id=$1 AND id=$5)) ORDER BY effective_on,recorded_at,id LIMIT $6",
      [
        b.id,
        cid,
        period.from,
        period.to,
        period.after || null,
        (all ? 10000 : period.limit) + 1,
      ],
    );
    const { plans } = await this.allPlans(t, b.id, cid);
    const records = await this.records(
      t,
      b.id,
      "o.customer_id=$2 AND o.service_on BETWEEN $3 AND $4",
      [cid, period.from, period.to],
    );
    const accepted = new Set(records.map((v) => v.planId + "/" + v.serviceOn));
    let unresolved = 0;
    for (
      let date = period.from;
      date <= period.to && date < todayIST();
      date = shiftDate(date, 1)
    ) {
      if (opening && date < day(opening.cutover_on)) continue;
      for (const p of plans)
        if (
          scheduleDay(p, c, date).status === "scheduled" &&
          !accepted.has(p.id + "/" + date)
        )
          unresolved++;
    }
    if (all && r.rows.length > 10000)
      rule("Export up to 10,000 entries at once. Choose a shorter period.");
    const lines: LedgerLine[] = r.rows
      .slice(0, all ? 10000 : period.limit)
      .map((v) => ({
        id: String(v.id),
        date: day(v.effective_on),
        amountPaise: String(v.signed_amount_paise),
        role: String(v.posting_role),
        description: String(v.description),
        recordedAt: stamp(v.recorded_at),
        sourceId: String(v.delivery_event_id || v.money_event_id),
      }));
    return {
      customer: c,
      businessName: b.name,
      from: period.from,
      to: period.to,
      openingPaise: String(totals.opening),
      chargesPaise: String(totals.charges),
      adjustmentsPaise: String(totals.adjustments),
      receiptsPaise: String(totals.receipts),
      reversalsPaise: String(totals.reversals),
      closingPaise: String(totals.closing),
      unresolved,
      businessRevision: b.revision,
      generatedAt: new Date().toISOString(),
      lines,
      nextCursor:
        !all && r.rows.length > period.limit
          ? lines[lines.length - 1].id
          : null,
      openingBalance: opening
        ? {
            version: Number(opening.version),
            cutoverOn: day(opening.cutover_on),
            amountPaise: String(opening.amount_paise),
          }
        : null,
    };
  }
}
