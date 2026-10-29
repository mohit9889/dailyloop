import { CustomerAccount } from "./Accounting";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Pause,
  Plus,
  X,
} from "lucide-react";
import {
  PlanCreate,
  PlanRevisionInput,
  PauseInput,
  ResumeInput,
  OverrideInput,
  EndPlanInput,
  EditCustomerInput,
  ArchiveCustomerInput,
  todayIST,
  shiftDate,
  decimalToScaled,
  formatPaise,
  type CustomerPlans,
  type Customer,
  type RecurringPlan,
  type SchedulePreview,
  type SchedulePreviewInput,
} from "@dailyloop/contracts";
import { request } from "../client";
import "./plans.css";
type Kind =
  | "create"
  | "revision"
  | "pause"
  | "override"
  | "end"
  | "resume"
  | "edit"
  | "archive";
type Editor = { kind: Kind; plan?: RecurringPlan; pauseId?: string };
const titles: Record<Kind, string> = {
  create: "Create a delivery plan",
  revision: "Change a recurring plan",
  pause: "Pause deliveries",
  override: "Change one delivery date",
  end: "End this plan",
  resume: "Resume a paused plan",
  edit: "Edit customer details",
  archive: "Archive this customer",
};
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";
const decimal = (paise: string) => {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
};
export default function CustomerDetail({
  customerId,
  accountingEnabled,
  onBack,
  serviceType,
}: {
  customerId: string;
  accountingEnabled?: boolean;
  onBack: () => void;
  serviceType: string;
}) {
  const [data, setData] = useState<CustomerPlans | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<Editor | null>(null),
    [planId, setPlanId] = useState(""),
    [from, setFrom] = useState(todayIST),
    [preview, setPreview] = useState<SchedulePreview | null>(null),
    [previewError, setPreviewError] = useState(""),
    [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    request<CustomerPlans>(`/v1/customers/${customerId}/plans`, {
      signal: c.signal,
    })
      .then((v) => {
        setData(v);
        setError("");
        setPlanId((old) =>
          v.plans.some((p) => p.id === old) ? old : v.plans[0]?.id || "",
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(message(e));
      });
    return () => c.abort();
  }, [customerId, revision]);
  useEffect(() => {
    setPreview(null);
    setPreviewError("");
    if (!planId) return;
    const c = new AbortController();
    setPreviewLoading(true);
    request<SchedulePreview>("/v1/schedule/preview", {
      body: { planId, from, to: shiftDate(from, 6) },
      signal: c.signal,
    })
      .then(setPreview)
      .catch((e) => {
        if (e.name !== "AbortError") setPreviewError(message(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setPreviewLoading(false);
      });
    return () => c.abort();
  }, [planId, from, revision]);
  function open(next: Editor) {
    setNotice("");
    setEditor(next);
  }
  return (
    <div className="detail-shell">
      <header className="detail-top">
        <img
          src="/brand/dailyloop-logo.svg"
          width="200"
          height="50"
          alt="DailyLoop"
        />
        <button onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Customers
        </button>
      </header>
      <main className="detail-main">
        <button className="back-text" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to customer register
        </button>
        {error ? (
          <div className="entry-error" role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>Try again</button>
          </div>
        ) : null}
        {!data ? (
          <p role="status">Loading customer details…</p>
        ) : (
          <>
            <div className="detail-heading">
              <div>
                <span className="entry-kicker">
                  A FAMILIAR FACE ON YOUR ROUND
                </span>
                <h1>{data.customer.name}</h1>
                <p>{data.customer.address}</p>
                {data.customer.phone ? <p>{data.customer.phone}</p> : null}
                {data.customer.archivedEffectiveOn ? (
                  <span className="plan-badge">
                    Archived from {data.customer.archivedEffectiveOn}
                  </span>
                ) : null}
              </div>
              <div className="detail-actions">
                {accountingEnabled ? (
                  <a className="account-jump" href="#account-title">
                    Account and statements
                  </a>
                ) : null}
                <button onClick={() => open({ kind: "edit" })}>
                  Edit details
                </button>
                {!data.customer.archivedEffectiveOn ? (
                  <button onClick={() => open({ kind: "archive" })}>
                    Archive customer
                  </button>
                ) : null}
              </div>
            </div>
            {notice ? (
              <div className="entry-success" role="status">
                {notice}
              </div>
            ) : null}
            <section className="plans-section" aria-labelledby="plans-title">
              <div className="plans-heading">
                <div>
                  <h2 id="plans-title">
                    Recurring delivery plans <span>{data.plans.length}</span>
                  </h2>
                  <p>
                    Each morning, evening, lunch or dinner slot has its own
                    plan.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={Boolean(
                    data.customer.archivedEffectiveOn &&
                    data.customer.archivedEffectiveOn <= data.today,
                  )}
                  onClick={() => open({ kind: "create" })}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add plan
                </button>
              </div>
              {!data.plans.length ? (
                <div className="plans-empty">
                  <CalendarDays size={30} aria-hidden="true" />
                  <h3>Start with their first delivery.</h3>
                  <p>
                    Create a recurring plan with a quantity, rate and delivery
                    days.
                  </p>
                </div>
              ) : (
                <div className="plan-grid">
                  {data.plans.map((plan) => {
                    const current =
                        [...plan.revisions]
                          .reverse()
                          .find((r) => r.effectiveFrom <= data.today) ||
                        plan.revisions[0],
                      upcoming = plan.revisions.filter(
                        (r) => r.effectiveFrom > data.today,
                      ),
                      ended = Boolean(plan.endOn && plan.endOn < data.today),
                      archived = Boolean(
                        data.customer.archivedEffectiveOn &&
                        data.customer.archivedEffectiveOn <= data.today,
                      );
                    return (
                      <article className="plan-card" key={plan.id}>
                        <div className="plan-card-top">
                          <span className="plan-icon">
                            <CalendarDays size={19} aria-hidden="true" />
                          </span>
                          <span className="plan-badge">
                            {ended
                              ? "Ended"
                              : plan.startOn > data.today
                                ? "Starts " + plan.startOn
                                : archived
                                  ? "Customer archived"
                                  : "Recurring"}
                          </span>
                        </div>
                        <h3>{current.label}</h3>
                        <p className="plan-quantity">
                          {current.quantityMilli / 1000} {plan.unit}
                          {current.quantityMilli / 1000 === 1 ? "" : "s"}{" "}
                          <span>
                            · {formatPaise(current.ratePaise)} / {plan.unit}
                          </span>
                        </p>
                        <p>
                          {current.weekdays.length === 7
                            ? "Every day"
                            : current.weekdays
                                .map((d) => weekdays[d])
                                .join(" · ")}
                        </p>
                        <p className="plan-dates">
                          Starts {plan.startOn}
                          {plan.endOn ? " · Last delivery " + plan.endOn : ""}
                        </p>
                        {upcoming.length ? (
                          <div className="plan-next">
                            Next change: {upcoming[0].effectiveFrom} ·{" "}
                            {upcoming[0].quantityMilli / 1000} {plan.unit} at{" "}
                            {formatPaise(upcoming[0].ratePaise)}
                          </div>
                        ) : null}
                        <div className="plan-controls">
                          <button
                            onClick={() => {
                              setPlanId(plan.id);
                              document
                                .getElementById("schedule-title")
                                ?.scrollIntoView({ behavior: "auto" });
                            }}
                          >
                            View schedule
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                          {!ended && !archived ? (
                            <>
                              <button
                                onClick={() => open({ kind: "revision", plan })}
                              >
                                Change plan
                              </button>
                              <button
                                onClick={() => open({ kind: "pause", plan })}
                              >
                                <Pause size={13} aria-hidden="true" />
                                Pause
                              </button>
                              <button
                                onClick={() => open({ kind: "override", plan })}
                              >
                                One-day change
                              </button>
                              {!plan.endOn ? (
                                <button
                                  onClick={() => open({ kind: "end", plan })}
                                >
                                  End plan
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                        {plan.pauses.length ? (
                          <details>
                            <summary>
                              Pauses and resumptions ({plan.pauses.length})
                            </summary>
                            {plan.pauses.map((p) => (
                              <div className="pause-row" key={p.id}>
                                <p>
                                  {p.fromOn} — {p.toOn}
                                  <small>
                                    {p.reason}
                                    {p.resumeOn
                                      ? " · Resumed " + p.resumeOn
                                      : ""}
                                  </small>
                                </p>
                                {!p.resumeOn &&
                                p.toOn >= data.today &&
                                !ended &&
                                !archived ? (
                                  <button
                                    onClick={() =>
                                      open({
                                        kind: "resume",
                                        plan,
                                        pauseId: p.id,
                                      })
                                    }
                                  >
                                    Resume
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </details>
                        ) : null}
                        <details>
                          <summary>
                            Plan revision history ({plan.revisions.length})
                          </summary>
                          {plan.revisions.map((r) => (
                            <p className="revision-row" key={r.id}>
                              <strong>
                                From {r.effectiveFrom} · {r.label}
                              </strong>
                              <span>
                                {r.quantityMilli / 1000} {plan.unit} ·{" "}
                                {formatPaise(r.ratePaise)} ·{" "}
                                {r.weekdays.map((d) => weekdays[d]).join(", ")}
                              </span>
                              <small>{r.reason}</small>
                            </p>
                          ))}
                        </details>
                        {plan.overrides.length ? (
                          <details>
                            <summary>
                              One-day change history ({plan.overrides.length})
                            </summary>
                            {plan.overrides.map((o) => (
                              <p className="revision-row" key={o.id}>
                                <strong>
                                  {o.serviceOn} ·{" "}
                                  {o.action === "clear"
                                    ? "Normal schedule restored"
                                    : o.action === "quantity"
                                      ? `${o.quantityMilli! / 1000} ${plan.unit}`
                                      : o.action}
                                </strong>
                                <small>{o.reason}</small>
                              </p>
                            ))}
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            {data.plans.length ? (
              <section
                className="schedule-section"
                aria-labelledby="schedule-title"
              >
                <div className="plans-heading">
                  <div>
                    <span className="entry-kicker">SEE THE WEEK AHEAD</span>
                    <h2 id="schedule-title">Planned deliveries</h2>
                    <p>
                      This is the schedule. Actual deliveries and charges are
                      recorded separately.
                    </p>
                  </div>
                  <div className="schedule-filters">
                    <label>
                      Plan
                      <select
                        value={planId}
                        onChange={(e) => setPlanId(e.target.value)}
                      >
                        {data.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.revisions.at(-1)?.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Week starting
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => {
                          if (e.target.value) setFrom(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                </div>
                {previewLoading ? (
                  <p role="status">Loading schedule…</p>
                ) : previewError ? (
                  <div className="entry-error" role="alert">
                    {previewError}
                  </div>
                ) : preview ? (
                  <ScheduleTable preview={preview} />
                ) : null}
              </section>
            ) : null}
            {editor ? (
              <LifecycleEditor
                key={
                  editor.kind +
                  "-" +
                  (editor.plan?.id || data.customer.id) +
                  "-" +
                  (editor.pauseId || "")
                }
                editor={editor}
                customer={data.customer}
                serviceType={serviceType}
                planCount={data.plans.length}
                onClose={() => setEditor(null)}
                onSaved={() => {
                  setEditor(null);
                  setNotice("Saved. Your delivery schedule is up to date.");
                  setRevision((v) => v + 1);
                }}
              />
            ) : null}
          </>
        )}

        {data && accountingEnabled ? (
          <CustomerAccount customerId={customerId} />
        ) : null}
        <footer className="owner-footer">
          DailyLoop<span>Every delivery counts.</span>
        </footer>
      </main>
    </div>
  );
}
function ScheduleTable({
  preview,
  comparison = false,
}: {
  preview: SchedulePreview;
  comparison?: boolean;
}) {
  return (
    <div className="schedule-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {comparison ? <th scope="col">Before</th> : null}
            <th scope="col">{comparison ? "After" : "Status"}</th>
            <th scope="col">Planned quantity</th>
            <th scope="col">Rate / unit</th>
          </tr>
        </thead>
        <tbody>
          {preview.after.map((day, i) => (
            <tr key={day.date}>
              <td>
                {day.date}
                <small>
                  {new Date(day.date + "T00:00:00Z").toLocaleDateString(
                    "en-IN",
                    { weekday: "short", timeZone: "UTC" },
                  )}
                </small>
              </td>
              {comparison ? (
                <td>
                  {preview.before[i]?.status.replaceAll("_", " ") || "—"}
                  {preview.before[i]?.status === "scheduled"
                    ? ` · ${preview.before[i].quantityMilli / 1000} ${day.unit} · ${formatPaise(preview.before[i].ratePaise)}`
                    : ""}
                </td>
              ) : null}
              <td>
                <span className={"schedule-status " + day.status}>
                  {day.status.replaceAll("_", " ")}
                </span>
              </td>
              <td>
                {day.status === "scheduled"
                  ? `${day.quantityMilli / 1000} ${day.unit}`
                  : "—"}
              </td>
              <td>
                {day.ratePaise !== "0" ? formatPaise(day.ratePaise) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function LifecycleEditor({
  editor,
  customer,
  serviceType,
  planCount,
  onClose,
  onSaved,
}: {
  editor: Editor;
  customer: Customer;
  serviceType: string;
  planCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    operation = useRef<{ body: string; key: string } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<{
      path: string;
      body: unknown;
      method: "POST" | "PATCH" | "PUT";
      preview?: SchedulePreview;
    } | null>(null);
  const [overrideAction, setOverrideAction] = useState("skip");
  const { kind, plan } = editor,
    latest = plan?.revisions.at(-1),
    today = todayIST(),
    pause = plan?.pauses.find((p) => p.id === editor.pauseId);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => dialog.current?.close();
  }, []);
  function key(body: unknown) {
    const text = JSON.stringify(body);
    if (operation.current?.body !== text)
      operation.current = { body: text, key: crypto.randomUUID() };
    return operation.current.key;
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const f = new FormData(e.currentTarget),
      value = (k: string) => String(f.get(k) || "");
    setBusy(true);
    try {
      let path = "",
        body: unknown,
        method: "POST" | "PATCH" | "PUT" = "POST",
        change: SchedulePreviewInput["change"];
      const date =
        kind === "revision"
          ? "effectiveFrom"
          : kind === "pause"
            ? "fromOn"
            : kind === "resume"
              ? "resumeOn"
              : kind === "end"
                ? "endOn"
                : "serviceOn";
      if (kind === "edit") {
        path = `/v1/customers/${customer.id}`;
        method = "PATCH";
        body = EditCustomerInput.parse({
          name: value("name"),
          address: value("address"),
          phone: value("phone"),
          expectedVersion: customer.version,
          reason: value("reason"),
        });
      } else if (kind === "archive") {
        path = `/v1/customers/${customer.id}/archive`;
        body = ArchiveCustomerInput.parse({
          expectedVersion: customer.version,
          effectiveOn: value("effectiveOn"),
          reason: value("reason"),
        });
      } else if (kind === "create" || kind === "revision") {
        const common = {
          label: value("label"),
          quantityMilli: decimalToScaled(value("quantity"), 1000),
          ratePaise: String(decimalToScaled(value("rate"), 100)),
          weekdays: f.getAll("weekday").map(Number),
        };
        if (kind === "create") {
          path = `/v1/customers/${customer.id}/plans`;
          body = PlanCreate.parse({
            ...common,
            unit: value("unit"),
            startOn: value("startOn"),
          });
        } else {
          path = `/v1/plans/${plan!.id}/revisions`;
          const input = PlanRevisionInput.parse({
            ...common,
            expectedVersion: plan!.version,
            effectiveFrom: value("effectiveFrom"),
            reason: value("reason"),
          });
          body = input;
          change = { type: "revision", input };
        }
      } else if (kind === "pause") {
        path = `/v1/plans/${plan!.id}/pauses`;
        const input = PauseInput.parse({
          expectedVersion: plan!.version,
          fromOn: value("fromOn"),
          toOn: value("toOn"),
          reason: value("reason"),
        });
        body = input;
        change = { type: "pause", input };
      } else if (kind === "resume") {
        path = `/v1/plans/${plan!.id}/pauses/${editor.pauseId}/resume`;
        const input = ResumeInput.parse({
          expectedVersion: plan!.version,
          resumeOn: value("resumeOn"),
          reason: value("reason"),
        });
        body = input;
        change = { type: "resume", pauseId: editor.pauseId!, input };
      } else if (kind === "override") {
        path = `/v1/plans/${plan!.id}/override`;
        method = "PUT";
        const input = OverrideInput.parse({
          expectedVersion: plan!.version,
          serviceOn: value("serviceOn"),
          action: overrideAction,
          ...(overrideAction === "quantity"
            ? { quantityMilli: decimalToScaled(value("quantity"), 1000) }
            : {}),
          reason: value("reason"),
        });
        body = input;
        change = { type: "override", input };
      } else {
        path = `/v1/plans/${plan!.id}/end`;
        const input = EndPlanInput.parse({
          expectedVersion: plan!.version,
          endOn: value("endOn"),
          reason: value("reason"),
        });
        body = input;
        change = { type: "end", input };
      }
      let preview: SchedulePreview | undefined;
      if (kind === "create") {
        const p = body as PlanCreate;
        preview = await request<SchedulePreview>("/v1/schedule/preview-new", {
          body: {
            customerId: customer.id,
            plan: p,
            from: p.startOn,
            to: shiftDate(p.startOn, 6),
          },
        });
      } else if (change) {
        let from = value(date);
        if (kind === "revision" || kind === "resume")
          from = from > today ? shiftDate(from, -1) : today;
        let to = shiftDate(from, 6);
        if (kind === "pause" && value("toOn") < to) to = value("toOn");
        if (kind === "override") to = from;
        preview = await request<SchedulePreview>("/v1/schedule/preview", {
          body: { planId: plan!.id, from, to, change },
        });
      }
      setReview({ path, body, method, preview });
    } catch (e) {
      setError(
        e instanceof Error && "issues" in e
          ? String((e as { issues: { message: string }[] }).issues[0]?.message)
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(review.path, {
        body: review.body,
        method: review.method,
        operationId: key({ path: review.path, body: review.body }),
      });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (review)
      dialog.current?.querySelector<HTMLElement>("#review-title")?.focus();
  }, [review]);
  const revisionDate =
    latest && shiftDate(latest.effectiveFrom, 1) > shiftDate(today, 1)
      ? shiftDate(latest.effectiveFrom, 1)
      : shiftDate(today, 1);
  return (
    <dialog
      ref={dialog}
      className="lifecycle-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="lifecycle-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="entry-kicker">{customer.name}</span>
          <h2 id="lifecycle-title">{titles[kind]}</h2>
        </div>
        <button disabled={busy} onClick={onClose} aria-label="Close dialog">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <div role="alert" className="entry-error">
          {error}
        </div>
      ) : null}
      <form onSubmit={submit}>
        <fieldset disabled={busy || Boolean(review)}>
          {kind === "edit" ? (
            <>
              <label htmlFor="edit-name">Customer name</label>
              <input
                id="edit-name"
                name="name"
                defaultValue={customer.name}
                required
                maxLength={120}
                autoComplete="name"
              />
              <label htmlFor="edit-address">Delivery address</label>
              <input
                id="edit-address"
                name="address"
                defaultValue={customer.address}
                required
                maxLength={300}
                autoComplete="street-address"
              />
              <label htmlFor="edit-phone">Phone (optional)</label>
              <input
                id="edit-phone"
                name="phone"
                defaultValue={customer.phone}
                type="tel"
                maxLength={20}
                autoComplete="tel"
              />
            </>
          ) : null}
          {kind === "create" || kind === "revision" ? (
            <>
              <label htmlFor="plan-label">Plan name / delivery slot</label>
              <input
                id="plan-label"
                name="label"
                defaultValue={latest?.label || ""}
                required
                maxLength={120}
                placeholder="e.g. Morning milk or Dinner…"
              />
              <div className="lifecycle-fields">
                <div>
                  <label htmlFor="plan-quantity">Quantity</label>
                  <input
                    id="plan-quantity"
                    name="quantity"
                    type="number"
                    min="0.001"
                    max="100000"
                    step="0.001"
                    required
                    defaultValue={latest ? latest.quantityMilli / 1000 : 1}
                  />
                </div>
                <div>
                  {kind === "create" ? (
                    <>
                      <label htmlFor="plan-unit">Unit</label>
                      <select
                        id="plan-unit"
                        name="unit"
                        defaultValue={
                          serviceType === "tiffin" ? "meal" : "litre"
                        }
                      >
                        <option value="litre">Litre (milk)</option>
                        <option value="meal">Meal (whole numbers)</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <label htmlFor="plan-unit-fixed">Unit</label>
                      <input id="plan-unit-fixed" value={plan!.unit} readOnly />
                    </>
                  )}
                </div>
              </div>
              <label htmlFor="plan-rate">Rate per unit (₹)</label>
              <input
                id="plan-rate"
                name="rate"
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                required
                defaultValue={latest ? decimal(latest.ratePaise) : ""}
              />
              <fieldset className="weekday-field">
                <legend>Delivery days</legend>
                <div className="weekday-options">
                  {weekdays.map((day, i) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        name="weekday"
                        value={i}
                        defaultChecked={
                          latest ? latest.weekdays.includes(i) : true
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="plan-effective">
                {kind === "create"
                  ? "Starts on"
                  : "New quantity / rate applies from"}
              </label>
              <input
                id="plan-effective"
                name={kind === "create" ? "startOn" : "effectiveFrom"}
                type="date"
                min={kind === "create" ? today : revisionDate}
                required
                defaultValue={kind === "create" ? today : revisionDate}
              />
              {kind === "revision" ? (
                <p className="form-note">
                  Earlier plan revisions are retained. The next change must
                  follow the latest revision ({latest!.effectiveFrom}).
                </p>
              ) : null}
            </>
          ) : null}
          {kind === "pause" ? (
            <div className="lifecycle-fields">
              <div>
                <label htmlFor="pause-from">Pause from</label>
                <input
                  id="pause-from"
                  type="date"
                  name="fromOn"
                  required
                  min={today}
                  defaultValue={plan!.startOn > today ? plan!.startOn : today}
                />
              </div>
              <div>
                <label htmlFor="pause-to">Through (inclusive)</label>
                <input
                  id="pause-to"
                  type="date"
                  name="toOn"
                  required
                  min={today}
                  defaultValue={shiftDate(
                    plan!.startOn > today ? plan!.startOn : today,
                    6,
                  )}
                />
              </div>
            </div>
          ) : null}
          {kind === "resume" ? (
            <>
              <p className="form-note">
                Selected pause: {pause?.fromOn} — {pause?.toOn}. Earlier paused
                dates remain unchanged. Another overlapping pause may still
                apply.
              </p>
              <label htmlFor="resume-on">Resume on</label>
              <input
                id="resume-on"
                type="date"
                name="resumeOn"
                required
                min={today > pause!.fromOn ? today : pause!.fromOn}
                max={pause!.toOn}
                defaultValue={today > pause!.fromOn ? today : pause!.fromOn}
              />
            </>
          ) : null}
          {kind === "override" ? (
            <>
              <label htmlFor="override-day">Delivery date</label>
              <input
                id="override-day"
                type="date"
                name="serviceOn"
                required
                min={today}
                defaultValue={plan!.startOn > today ? plan!.startOn : today}
              />
              <label htmlFor="override-action">Change for this date only</label>
              <select
                id="override-action"
                value={overrideAction}
                onChange={(e) => setOverrideAction(e.target.value)}
              >
                <option value="skip">Skip delivery</option>
                <option value="quantity">Deliver a different quantity</option>
                <option value="resume">Deliver even if paused / off-day</option>
                <option value="clear">Use the normal schedule again</option>
              </select>
              {overrideAction === "quantity" ? (
                <>
                  <label htmlFor="override-quantity">
                    Quantity ({plan!.unit})
                  </label>
                  <input
                    id="override-quantity"
                    name="quantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    max="100000"
                    required
                    defaultValue={latest!.quantityMilli / 1000}
                  />
                </>
              ) : null}
              <p className="form-note">
                A one-day change can override a pause or weekday. It cannot
                restart an ended plan or archived customer.
              </p>
            </>
          ) : null}
          {kind === "end" ? (
            <>
              <label htmlFor="end-on">Last delivery date (inclusive)</label>
              <input
                id="end-on"
                type="date"
                name="endOn"
                required
                min={plan!.startOn > today ? plan!.startOn : today}
                defaultValue={plan!.startOn > today ? plan!.startOn : today}
              />
              <p className="form-note">
                The plan stays scheduled through this date and stops afterward.
                Its history is retained.
              </p>
            </>
          ) : null}
          {kind === "archive" ? (
            <>
              <label htmlFor="archive-on">Archive from</label>
              <input
                id="archive-on"
                type="date"
                name="effectiveOn"
                required
                min={today}
                defaultValue={today}
              />
              <p className="archive-warning">
                This stops all {planCount} recurring plan
                {planCount === 1 ? "" : "s"} from the selected date. Earlier
                history is retained. Archiving cannot currently be undone.
              </p>
            </>
          ) : null}
          {kind !== "create" ? (
            <>
              <label htmlFor="change-reason">Reason for this change</label>
              <input
                id="change-reason"
                name="reason"
                minLength={3}
                maxLength={300}
                required
                placeholder="A short explanation for your records…"
              />
            </>
          ) : null}
        </fieldset>
        {review ? (
          <section className="review-section" aria-labelledby="review-title">
            <h3 id="review-title" tabIndex={-1}>
              Review before saving
            </h3>
            {review.preview ? (
              <>
                <p>
                  Showing {review.preview.after.length} day
                  {review.preview.after.length === 1 ? "" : "s"} for review. The
                  full date range entered above will be saved.
                </p>
                <ScheduleTable
                  preview={review.preview}
                  comparison={Boolean(review.preview.before.length)}
                />
              </>
            ) : (
              <p>
                {kind === "archive"
                  ? `Archive ${customer.name} from ${(review.body as ArchiveCustomerInput).effectiveOn}. All recurring deliveries stop from that date.`
                  : `Update the saved contact details for ${customer.name}.`}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Edit details
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={confirm}
              >
                {busy ? "Saving…" : "Confirm and save"}
                <Check size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : (
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Preparing preview…" : "Review changes"}
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
