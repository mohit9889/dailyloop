import { createHash, randomUUID } from "node:crypto";
import {
  todayIST,
  shiftDate,
  type Customer,
  type Business,
  type Page,
  type PlanCreate,
  type PlanRevisionInput,
  type PauseInput,
  type ResumeInput,
  type OverrideInput,
  type EndPlanInput,
  type ArchiveCustomerInput,
  type EditCustomerInput,
  type RecurringPlan,
  type SchedulePreviewInput,
  type SchedulePreview,
  type NewPlanPreviewInput,
} from "@dailyloop/contracts";
import { Repository, customer, type Identity } from "./repository.js";
import type { Sql } from "./database.js";
import { ApiError } from "../errors.js";
import { scheduleDay } from "../domain/schedule.js";
const fail = (message: string): never => {
  throw new ApiError(422, "SCHEDULE_RULE", message);
};
const conflict = (): never => {
  throw new ApiError(
    409,
    "VERSION_CONFLICT",
    "This record changed. Refresh it before saving again.",
  );
};
const calendar = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
export class LifecycleRepository extends Repository {
  async lock(tx: Sql, businessId: string) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      businessId,
    ]);
  }
  async customerRow(tx: Sql, businessId: string, id: string) {
    const r = await tx.query(
      "SELECT * FROM app.customers WHERE business_id=$1 AND id=$2",
      [businessId, id],
    );
    if (!r.rows[0]) throw new ApiError(404, "NOT_FOUND", "Customer not found.");
    return customer(r.rows[0]);
  }
  async planRow(
    tx: Sql,
    businessId: string,
    id: string,
  ): Promise<RecurringPlan> {
    const r = await tx.query(
      "SELECT * FROM app.plans WHERE business_id=$1 AND id=$2",
      [businessId, id],
    );
    if (!r.rows[0]) throw new ApiError(404, "NOT_FOUND", "Plan not found.");
    const p = r.rows[0];
    const revisions = await tx.query(
      "SELECT * FROM app.plan_revisions WHERE business_id=$1 AND plan_id=$2 ORDER BY effective_from",
      [businessId, id],
    );
    const pauses = await tx.query(
      "SELECT * FROM app.pause_ranges WHERE business_id=$1 AND plan_id=$2 ORDER BY from_on,id",
      [businessId, id],
    );
    const overrides = await tx.query(
      "SELECT * FROM app.date_overrides WHERE business_id=$1 AND plan_id=$2 ORDER BY service_on,plan_version",
      [businessId, id],
    );
    return {
      id: String(p.id),
      customerId: String(p.customer_id),
      unit: p.unit as "litre" | "meal",
      startOn: calendar(p.start_on),
      endOn: p.end_on ? calendar(p.end_on) : null,
      version: Number(p.version),
      revisions: revisions.rows.map((v) => ({
        id: String(v.id),
        effectiveFrom: calendar(v.effective_from),
        label: String(v.label),
        quantityMilli: Number(v.quantity_milli),
        ratePaise: String(v.rate_paise),
        weekdays: v.weekdays as number[],
        reason: String(v.reason),
      })),
      pauses: pauses.rows.map((v) => ({
        id: String(v.id),
        fromOn: calendar(v.from_on),
        toOn: calendar(v.to_on),
        resumeOn: v.resume_on ? calendar(v.resume_on) : null,
        reason: String(v.reason),
      })),
      overrides: overrides.rows.map((v) => ({
        id: String(v.id),
        serviceOn: calendar(v.service_on),
        action: v.action as "skip" | "resume" | "quantity" | "clear",
        quantityMilli:
          v.quantity_milli === null ? null : Number(v.quantity_milli),
        planVersion: Number(v.plan_version),
        reason: String(v.reason),
      })),
    };
  }
  async mutate<T>(
    user: Identity,
    key: string,
    route: string,
    input: unknown,
    fn: (
      tx: Sql,
      b: Business,
    ) => Promise<{
      value: T;
      entityId: string;
      action: string;
      details: unknown;
    }>,
  ): Promise<T> {
    return this.tenant(user, async (tx, b) => {
      await this.lock(tx, b.id);
      const hash = createHash("sha256")
        .update(JSON.stringify({ route, input }))
        .digest("hex");
      const previous = await tx.query(
        "SELECT * FROM app.idempotency_records WHERE business_id=$1 AND user_id=$2 AND operation_id=$3",
        [b.id, user.id, key],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This operation ID was already used with different details.",
          );
        return previous.rows[0].response_json as T;
      }
      const result = await fn(tx, b);
      await tx.query(
        "INSERT INTO app.audit_events(business_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
        [
          b.id,
          user.id,
          result.action,
          result.entityId,
          JSON.stringify(result.details),
        ],
      );
      await tx.query("SELECT private.bump_revision($1)", [b.id]);
      await tx.query(
        "INSERT INTO app.idempotency_records(business_id,user_id,operation_id,request_hash,response_json) VALUES($1,$2,$3,$4,$5)",
        [b.id, user.id, key, hash, JSON.stringify(result.value)],
      );
      return result.value;
    });
  }
  future(date: string) {
    if (date < todayIST())
      fail(
        "Choose today or a future date. Earlier schedules cannot be changed.",
      );
    if (date > shiftDate(todayIST(), 3660))
      fail("Choose a date within the next 10 years.");
  }
  active(customer: Customer, date: string) {
    if (customer.archivedEffectiveOn && date >= customer.archivedEffectiveOn)
      fail("This customer is archived on that date.");
  }
  quantity(planUnit: string, value: number) {
    if (planUnit === "meal" && value % 1000)
      fail("Meal quantities must be whole numbers.");
  }
  change(
    plan: RecurringPlan,
    c: Customer,
    change: NonNullable<SchedulePreviewInput["change"]>,
  ): RecurringPlan {
    const next = structuredClone(plan),
      v = change.input;
    if (v.expectedVersion !== plan.version) conflict();
    const within = (day: string) => {
      this.future(day);
      this.active(c, day);
      if (day < plan.startOn)
        fail("Choose a date on or after the plan starts.");
      if (plan.endOn && day > plan.endOn)
        fail("This plan has ended on that date.");
    };
    if (change.type === "revision") {
      const x = change.input;
      within(x.effectiveFrom);
      this.quantity(plan.unit, x.quantityMilli);
      if (plan.revisions.length >= 1000)
        fail("Plan history limit reached. Create a new plan.");
      const latest = plan.revisions[plan.revisions.length - 1];
      if (x.effectiveFrom <= latest.effectiveFrom)
        fail(
          "Choose a date after the latest plan revision (" +
            latest.effectiveFrom +
            ").",
        );
      next.revisions.push({
        id: randomUUID(),
        effectiveFrom: x.effectiveFrom,
        label: x.label,
        quantityMilli: x.quantityMilli,
        ratePaise: x.ratePaise,
        weekdays: x.weekdays,
        reason: x.reason,
      });
    }
    if (change.type === "pause") {
      const x = change.input;
      within(x.fromOn);
      within(x.toOn);
      if (Date.parse(x.toOn) - Date.parse(x.fromOn) > 366 * 86400000)
        fail("A pause may cover up to one year.");
      if (plan.pauses.length >= 1000)
        fail("Pause history limit reached. Create a new plan.");
      next.pauses.push({
        id: randomUUID(),
        fromOn: x.fromOn,
        toOn: x.toOn,
        resumeOn: null,
        reason: x.reason,
      });
    }
    if (change.type === "resume") {
      const x = change.input;
      within(x.resumeOn);
      const pause = next.pauses.find((p) => p.id === change.pauseId);
      if (!pause) throw new ApiError(404, "NOT_FOUND", "Pause not found.");
      if (pause.resumeOn) fail("This pause has already been resumed.");
      if (x.resumeOn < pause.fromOn || x.resumeOn > pause.toOn)
        fail("Resume date must fall inside the selected pause.");
      pause.resumeOn = x.resumeOn;
    }
    if (change.type === "override") {
      const x = change.input;
      within(x.serviceOn);
      if (x.quantityMilli !== undefined)
        this.quantity(plan.unit, x.quantityMilli);
      if (plan.overrides.length >= 5000)
        fail("Override history limit reached. Create a new plan.");
      next.overrides.push({
        id: randomUUID(),
        serviceOn: x.serviceOn,
        action: x.action,
        quantityMilli: x.quantityMilli ?? null,
        planVersion: plan.version + 1,
        reason: x.reason,
      });
    }
    if (change.type === "end") {
      const x = change.input;
      this.future(x.endOn);
      if (x.endOn < plan.startOn)
        fail("Last delivery date must be on or after the plan starts.");
      if (plan.endOn) fail("This plan already has an end date.");
      next.endOn = x.endOn;
    }
    next.version++;
    return next;
  }
  async updateCustomer(
    user: Identity,
    id: string,
    input: EditCustomerInput,
    key: string,
  ) {
    return this.mutate(
      user,
      key,
      "PATCH /customers/" + id,
      input,
      async (t, b) => {
        const before = await this.customerRow(t, b.id, id);
        if (before.version !== input.expectedVersion) conflict();
        const r = await t.query(
          "UPDATE app.customers SET name=$3,phone=$4,address=$5,version=version+1 WHERE business_id=$1 AND id=$2 RETURNING *",
          [b.id, id, input.name, input.phone, input.address],
        );
        const after = customer(r.rows[0]);
        return {
          value: after,
          entityId: id,
          action: "customer.updated",
          details: { before, after, reason: input.reason },
        };
      },
    );
  }
  async archiveCustomer(
    user: Identity,
    id: string,
    input: ArchiveCustomerInput,
    key: string,
  ) {
    return this.mutate(
      user,
      key,
      "POST /customers/" + id + "/archive",
      input,
      async (t, b) => {
        const before = await this.customerRow(t, b.id, id);
        if (before.version !== input.expectedVersion) conflict();
        if (before.archivedEffectiveOn)
          fail("This customer already has an archive date.");
        this.future(input.effectiveOn);
        const r = await t.query(
          "UPDATE app.customers SET archived_effective_on=$3,version=version+1 WHERE business_id=$1 AND id=$2 RETURNING *",
          [b.id, id, input.effectiveOn],
        );
        const after = customer(r.rows[0]);
        return {
          value: after,
          entityId: id,
          action: "customer.archived",
          details: { before, after, reason: input.reason },
        };
      },
    );
  }
  async plans(user: Identity, id: string) {
    return this.tenant(user, async (t, b) => {
      await this.lock(t, b.id);
      const c = await this.customerRow(t, b.id, id);
      const rows = await t.query(
        "SELECT id FROM app.plans WHERE business_id=$1 AND customer_id=$2 ORDER BY created_at,id",
        [b.id, id],
      );
      const plans: RecurringPlan[] = [];
      for (const row of rows.rows)
        plans.push(await this.planRow(t, b.id, String(row.id)));
      return { customer: c, plans, today: todayIST() };
    });
  }
  async createPlan(user: Identity, id: string, input: PlanCreate, key: string) {
    return this.mutate(
      user,
      key,
      "POST /customers/" + id + "/plans",
      input,
      async (t, b) => {
        const c = await this.customerRow(t, b.id, id);
        this.future(input.startOn);
        this.active(c, input.startOn);
        this.quantity(input.unit, input.quantityMilli);
        const count = await t.query(
          "SELECT count(*)::int AS count FROM app.plans WHERE business_id=$1 AND customer_id=$2",
          [b.id, id],
        );
        if (Number(count.rows[0].count) >= 20)
          fail("This customer already has 20 plans.");
        let planId: string;
        try {
          const row = await t.query(
            "INSERT INTO app.plans(business_id,customer_id,slot_key,unit,start_on) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [
              b.id,
              id,
              input.label.normalize("NFKC").toLowerCase(),
              input.unit,
              input.startOn,
            ],
          );
          planId = String(row.rows[0].id);
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new ApiError(
              409,
              "PLAN_EXISTS",
              "A plan with this name already exists for this customer. Use a distinct slot name.",
            );
          throw e;
        }
        await t.query(
          "INSERT INTO app.plan_revisions(business_id,plan_id,effective_from,label,quantity_milli,rate_paise,weekdays,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            b.id,
            planId,
            input.startOn,
            input.label,
            input.quantityMilli,
            input.ratePaise,
            input.weekdays,
            "Initial plan",
          ],
        );
        const plan = await this.planRow(t, b.id, planId);
        return {
          value: plan,
          entityId: planId,
          action: "plan.created",
          details: { after: plan },
        };
      },
    );
  }
  async saveChange(
    user: Identity,
    id: string,
    change: NonNullable<SchedulePreviewInput["change"]>,
    key: string,
  ) {
    return this.mutate(
      user,
      key,
      "POST /plans/" + id + "/" + change.type,
      change,
      async (t, b) => {
        const before = await this.planRow(t, b.id, id),
          c = await this.customerRow(t, b.id, before.customerId),
          next = this.change(before, c, change);
        if (change.type === "revision") {
          const r = next.revisions[next.revisions.length - 1];
          await t.query(
            "INSERT INTO app.plan_revisions(id,business_id,plan_id,effective_from,label,quantity_milli,rate_paise,weekdays,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              r.id,
              b.id,
              id,
              r.effectiveFrom,
              r.label,
              r.quantityMilli,
              r.ratePaise,
              r.weekdays,
              r.reason,
            ],
          );
        }
        if (change.type === "pause") {
          const p = next.pauses[next.pauses.length - 1];
          await t.query(
            "INSERT INTO app.pause_ranges(id,business_id,plan_id,from_on,to_on,reason) VALUES($1,$2,$3,$4,$5,$6)",
            [p.id, b.id, id, p.fromOn, p.toOn, p.reason],
          );
        }
        if (change.type === "resume")
          await t.query(
            "UPDATE app.pause_ranges SET resume_on=$4 WHERE business_id=$1 AND plan_id=$2 AND id=$3",
            [b.id, id, change.pauseId, change.input.resumeOn],
          );
        if (change.type === "override") {
          const o = next.overrides[next.overrides.length - 1];
          await t.query(
            "INSERT INTO app.date_overrides(id,business_id,plan_id,service_on,action,quantity_milli,plan_version,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              o.id,
              b.id,
              id,
              o.serviceOn,
              o.action,
              o.quantityMilli,
              o.planVersion,
              o.reason,
            ],
          );
        }
        await t.query(
          "UPDATE app.plans SET version=$3,end_on=$4 WHERE business_id=$1 AND id=$2",
          [b.id, id, next.version, next.endOn],
        );
        return {
          value: next,
          entityId: id,
          action: "plan." + change.type,
          details: {
            reason: change.input.reason,
            beforeVersion: before.version,
            after: next,
          },
        };
      },
    );
  }
  async preview(
    user: Identity,
    input: SchedulePreviewInput,
  ): Promise<SchedulePreview> {
    return this.tenant(user, async (t, b) => {
      await this.lock(t, b.id);
      const span = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
      if (span > 61) fail("Preview up to 62 days at a time.");
      const plan = await this.planRow(t, b.id, input.planId),
        c = await this.customerRow(t, b.id, plan.customerId),
        next = input.change ? this.change(plan, c, input.change) : plan;
      const dates = Array.from({ length: span + 1 }, (_, i) =>
        shiftDate(input.from, i),
      );
      const revision = await t.query(
        "SELECT revision FROM app.businesses WHERE id=$1",
        [b.id],
      );
      return {
        planId: plan.id,
        planVersion: plan.version,
        businessRevision: Number(revision.rows[0].revision),
        before: dates.map((d) => scheduleDay(plan, c, d)),
        after: dates.map((d) => scheduleDay(next, c, d)),
      };
    });
  }
  async previewNew(
    user: Identity,
    input: NewPlanPreviewInput,
  ): Promise<SchedulePreview> {
    return this.tenant(user, async (t, b) => {
      await this.lock(t, b.id);
      const c = await this.customerRow(t, b.id, input.customerId);
      this.future(input.plan.startOn);
      this.active(c, input.plan.startOn);
      const span = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
      if (span > 61) fail("Preview up to 62 days at a time.");
      const p: RecurringPlan = {
        id: "preview",
        customerId: c.id,
        unit: input.plan.unit,
        startOn: input.plan.startOn,
        endOn: null,
        version: 0,
        revisions: [
          {
            id: "preview",
            effectiveFrom: input.plan.startOn,
            label: input.plan.label,
            quantityMilli: input.plan.quantityMilli,
            ratePaise: input.plan.ratePaise,
            weekdays: input.plan.weekdays,
            reason: "Initial plan",
          },
        ],
        pauses: [],
        overrides: [],
      };
      const days = Array.from({ length: span + 1 }, (_, i) =>
        scheduleDay(p, c, shiftDate(input.from, i)),
      );
      return {
        planId: "preview",
        planVersion: 0,
        businessRevision: b.revision,
        before: [],
        after: days,
      };
    });
  }
}
