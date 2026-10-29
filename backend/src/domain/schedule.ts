import type {
  Customer,
  RecurringPlan,
  ScheduleDay,
} from "@dailyloop/contracts";
export function scheduleDay(
  plan: RecurringPlan,
  customer: Customer,
  date: string,
): ScheduleDay {
  const revision = [...plan.revisions]
    .filter((r) => r.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const base = {
    date,
    label: revision?.label || plan.revisions[0]?.label || "Delivery plan",
    unit: plan.unit,
    quantityMilli: 0,
    ratePaise: revision?.ratePaise || "0",
    revisionId: revision?.id || null,
  };
  if (customer.archivedEffectiveOn && date >= customer.archivedEffectiveOn)
    return { ...base, status: "archived", source: "lifetime" };
  if (date < plan.startOn)
    return { ...base, status: "not_started", source: "lifetime" };
  if (plan.endOn && date > plan.endOn)
    return { ...base, status: "ended", source: "lifetime" };
  if (!revision)
    throw new Error("A plan revision is missing for this service date.");
  const override = [...plan.overrides]
    .filter((o) => o.serviceOn === date)
    .sort((a, b) => b.planVersion - a.planVersion)[0];
  if (override && override.action !== "clear") {
    if (override.action === "skip")
      return { ...base, status: "skipped", source: "override" };
    return {
      ...base,
      status: "scheduled",
      source: "override",
      quantityMilli:
        override.action === "quantity"
          ? override.quantityMilli!
          : revision.quantityMilli,
    };
  }
  if (
    plan.pauses.some(
      (p) =>
        p.fromOn <= date &&
        date <= p.toOn &&
        (!p.resumeOn || date < p.resumeOn),
    )
  )
    return { ...base, status: "paused", source: "pause" };
  if (!revision.weekdays.includes(new Date(date + "T00:00:00Z").getUTCDay()))
    return { ...base, status: "not_scheduled", source: "weekday" };
  return {
    ...base,
    status: "scheduled",
    source: "weekday",
    quantityMilli: revision.quantityMilli,
  };
}
