import { useEffect, useRef, useState } from "react";
import {
  ConfirmDelivery,
  CorrectDelivery,
  ReceiptInput,
  OpeningInput,
  ReversalInput,
  todayIST,
  shiftDate,
  decimalToScaled,
  formatPaise,
  type Round,
  type RoundStop,
  type Statement,
  type MoneyEvent,
  type DeliveryRecord,
} from "@dailyloop/contracts";
import { request, download } from "../client";
import "./accounting.css";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";
const rupees = (v: string) => {
  const n = BigInt(v);
  const a = n < 0n ? -n : n;
  return `${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
};
type Draft = { path: string; body: unknown; title: string; summary: string };
function Review({
  draft,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: Draft;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className="finance-review" aria-label="Review transaction">
      <h3 tabIndex={-1} ref={(n) => n?.focus()}>
        Review before saving
      </h3>
      <strong>{draft.title}</strong>
      <p>{draft.summary}</p>
      <p>
        Confirm the customer, date and amount. This records bookkeeping; it does
        not collect or verify money.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="finance-actions">
        <button disabled={saving} onClick={onCancel}>
          Edit details
        </button>
        <button className="primary" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Confirm and save"}
        </button>
      </div>
    </section>
  );
}
export function DailyRound({ onBack }: { onBack: () => void }) {
  const [date, setDate] = useState(todayIST()),
    [page, setPage] = useState<Round | null>(null),
    [after, setAfter] = useState<string | undefined>(),
    [tick, setTick] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<RoundStop | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [saving, setSaving] = useState(false),
    [history, setHistory] = useState<DeliveryRecord[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const key = useRef("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setPage(null);
    setError("");
    request<Round>(
      "/v1/rounds?" +
        new URLSearchParams({ date, ...(after ? { after } : {}) }),
      { signal: c.signal },
    )
      .then(setPage)
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [date, after, tick]);
  async function loadHistory(stop: RoundStop, cursor?: string) {
    if (!stop.record) return;
    try {
      const r = await request<{
        items: DeliveryRecord[];
        nextCursor: string | null;
      }>(
        `/v1/deliveries/${stop.record.id}/history${cursor ? "?after=" + cursor : ""}`,
      );
      setHistory((old) => (cursor ? [...old, ...r.items] : r.items));
      setHistoryCursor(r.nextCursor);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || !page) return;
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        status = String(f.get("status")) as "delivered" | "skipped" | "missed",
        quantityMilli =
          status === "delivered"
            ? decimalToScaled(String(f.get("quantity")), 1000)
            : 0;
      if (
        (selected.record?.unit || selected.schedule.unit) === "meal" &&
        quantityMilli % 1000
      )
        throw new Error("Meals must be whole numbers.");
      const values = { status, quantityMilli, reason: String(f.get("reason")) };
      const body = selected.record
        ? CorrectDelivery.parse({
            ...values,
            expectedVersion: selected.record.version,
          })
        : ConfirmDelivery.parse({
            ...values,
            planId: selected.planId,
            serviceOn: date,
            scheduleRevision: page.businessRevision,
            expectedVersion: 0,
          });
      const rate = selected.record?.ratePaise || selected.schedule.ratePaise;
      const amount = (
        (BigInt(quantityMilli) * BigInt(rate) + 500n) /
        1000n
      ).toString();
      key.current = crypto.randomUUID();
      setDraft({
        path: selected.record
          ? `/v1/deliveries/${selected.record.id}/corrections`
          : "/v1/deliveries/confirm",
        body,
        title: selected.record ? "Correct delivery" : "Confirm actual delivery",
        summary: `${selected.customerName} · ${selected.record?.label || selected.schedule.label} · ${date} · ${status} · ${quantityMilli / 1000} ${selected.record?.unit || selected.schedule.unit} · ${formatPaise(amount)}${selected.record ? " (replaces " + formatPaise(selected.record.chargePaise) + ")" : ""}`,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    try {
      await request(draft.path, { body: draft.body, operationId: key.current });
      setDraft(null);
      setSelected(null);
      setHistory([]);
      setTick((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
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
        <button onClick={onBack}>Customers</button>
      </header>
      <main className="detail-main">
        <div className="plans-heading">
          <div>
            <span className="entry-kicker">EVERY DELIVERY COUNTS</span>
            <h1>Your daily round</h1>
            <p>
              Record what actually arrived. Planned quantities are not charges.
            </p>
          </div>
          <label>
            Service date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setAfter(undefined);
                setSelected(null);
                setDraft(null);
              }}
            />
          </label>
        </div>
        {error && !selected ? (
          <p role="alert" className="entry-error">
            {error}
          </p>
        ) : null}
        <button
          onClick={() => {
            setSelected(null);
            setDraft(null);
            setTick((v) => v + 1);
          }}
          disabled={saving}
        >
          Refresh round
        </button>
        {loading ? <p role="status">Loading round…</p> : null}
        <section className="round-grid">
          {page?.stops.map((s) => (
            <article className="plan-card" key={s.planId}>
              <span className="plan-badge">
                {s.record
                  ? s.record.status
                  : s.schedule.status === "scheduled"
                    ? "Not recorded"
                    : s.schedule.status}
              </span>
              <h2>{s.customerName}</h2>
              <p>{s.address}</p>
              <h3>{s.record?.label || s.schedule.label}</h3>
              <p>
                {s.record ? "Actual" : "Planned"}:{" "}
                {(s.record?.quantityMilli ?? s.schedule.quantityMilli) / 1000}{" "}
                {s.record?.unit || s.schedule.unit} ·{" "}
                {formatPaise(s.record?.ratePaise || s.schedule.ratePaise)} /
                unit
              </p>
              {s.record ? (
                <strong>
                  Recorded charge {formatPaise(s.record.chargePaise)}
                </strong>
              ) : null}
              <div className="finance-actions">
                <button
                  disabled={
                    date > todayIST() ||
                    (!s.record && s.schedule.status !== "scheduled")
                  }
                  onClick={() => {
                    setSelected(s);
                    setDraft(null);
                    setError("");
                    setHistory([]);
                    setHistoryCursor(null);
                    if (s.record) void loadHistory(s);
                  }}
                >
                  {s.record ? "Correct / view history" : "Record delivery"}
                </button>
              </div>
            </article>
          ))}
        </section>
        {page && !page.stops.length && !loading ? (
          <p>No service on this page for this date.</p>
        ) : null}
        <div className="finance-actions">
          {after ? (
            <button onClick={() => setAfter(undefined)}>First page</button>
          ) : null}
          {page?.nextCursor ? (
            <button
              onClick={() => {
                setAfter(page.nextCursor!);
                setSelected(null);
                setDraft(null);
              }}
            >
              Next plans
            </button>
          ) : null}
        </div>
        {selected ? (
          <section className="finance-card">
            <h2>
              {selected.customerName} ·{" "}
              {selected.record?.label || selected.schedule.label}
            </h2>
            <p>
              {date} ·{" "}
              {selected.record
                ? "Correcting saved outcome. Original price stays fixed."
                : "Confirm the actual quantity received."}
            </p>
            <form
              key={selected.planId + ":" + (selected.record?.version || 0)}
              onSubmit={review}
            >
              <fieldset disabled={Boolean(draft) || saving}>
                <label>
                  Outcome
                  <select
                    name="status"
                    defaultValue={selected.record?.status || "delivered"}
                  >
                    <option value="delivered">Delivered</option>
                    <option value="skipped">Skipped — no charge</option>
                    <option value="missed">Missed — no charge</option>
                  </select>
                </label>
                <label>
                  Actual quantity ({selected.schedule.unit})
                  <input
                    name="quantity"
                    type="number"
                    step={selected.schedule.unit === "meal" ? "1" : "0.001"}
                    min="0"
                    defaultValue={
                      (selected.record?.quantityMilli ??
                        selected.schedule.quantityMilli) / 1000
                    }
                  />
                </label>
                <p>
                  Skipped/missed always save zero quantity and zero charge.
                  Meals must be whole numbers.
                </p>
                <label>
                  Reason
                  <input name="reason" required minLength={3} maxLength={300} />
                </label>
                <button type="submit">Review outcome</button>
              </fieldset>
            </form>
            {error ? (
              <p role="alert" className="entry-error">
                {error}
              </p>
            ) : null}
            {draft ? (
              <Review
                draft={draft}
                saving={saving}
                error=""
                onCancel={() => setDraft(null)}
                onSave={() => void save()}
              />
            ) : null}
            <button
              disabled={saving}
              onClick={() => {
                setSelected(null);
                setDraft(null);
              }}
            >
              Close
            </button>
            {history.length ? (
              <details open>
                <summary>Saved event history</summary>
                {history.map((h) => (
                  <p key={h.eventId}>
                    {h.recordedAt} · {h.status} · {h.quantityMilli / 1000}{" "}
                    {h.unit} · {formatPaise(h.chargePaise)}
                    <br />
                    {h.reason} · Actor {h.actorId}
                  </p>
                ))}
                {historyCursor ? (
                  <button
                    onClick={() => void loadHistory(selected, historyCursor)}
                  >
                    More history
                  </button>
                ) : null}
              </details>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
export function CustomerAccount({ customerId }: { customerId: string }) {
  const [from, setFrom] = useState(todayIST().slice(0, 7) + "-01"),
    [to, setTo] = useState(todayIST()),
    [statement, setStatement] = useState<Statement | null>(null),
    [receipts, setReceipts] = useState<MoneyEvent[]>([]),
    [receiptCursor, setReceiptCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [saving, setSaving] = useState(false),
    [kind, setKind] = useState<"receipt" | "opening" | null>(null);
  const operation = useRef("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setStatement(null);
    setReceipts([]);
    setDraft(null);
    setError("");
    const q = new URLSearchParams({ from, to });
    Promise.all([
      request<Statement>(`/v1/customers/${customerId}/statement?` + q, {
        signal: c.signal,
      }),
      request<{ items: MoneyEvent[]; nextCursor: string | null }>(
        `/v1/customers/${customerId}/receipts?` + q,
        { signal: c.signal },
      ),
    ])
      .then(([s, r]) => {
        setStatement(s);
        setReceipts(r.items);
        setReceiptCursor(r.nextCursor);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [customerId, from, to, tick]);
  async function exportFile(format: "csv" | "pdf") {
    if (!statement) return;
    setSaving(true);
    setError("");
    try {
      await download(
        `/v1/customers/${customerId}/statement.${format}?` +
          new URLSearchParams({
            from,
            to,
            revision: String(statement.businessRevision),
          }),
        `dailyloop-statement-${from}-${to}.${format}`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  async function moreLines() {
    if (!statement?.nextCursor) return;
    try {
      const s = await request<Statement>(
        `/v1/customers/${customerId}/statement?` +
          new URLSearchParams({ from, to, after: statement.nextCursor }),
      );
      if (s.businessRevision !== statement.businessRevision) {
        setTick((v) => v + 1);
        throw Error("Statement changed. Refreshed from the first page.");
      }
      setStatement({ ...s, lines: [...statement.lines, ...s.lines] });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function moreReceipts() {
    if (!receiptCursor) return;
    try {
      const r = await request<{
        items: MoneyEvent[];
        nextCursor: string | null;
      }>(
        `/v1/customers/${customerId}/receipts?` +
          new URLSearchParams({ from, to, after: receiptCursor }),
      );
      setReceipts((v) => [...v, ...r.items]);
      setReceiptCursor(r.nextCursor);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function propose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!statement) return;
    try {
      const f = new FormData(e.currentTarget),
        reason = String(f.get("reason")),
        amount = String(decimalToScaled(String(f.get("amount")), 100));
      let body: unknown, path: string, title: string;
      if (kind === "receipt") {
        body = ReceiptInput.parse({
          customerId,
          effectiveOn: String(f.get("date")),
          amountPaise: amount,
          method: String(f.get("method")),
          reason,
        });
        path = "/v1/receipts";
        title = "Record receipt";
      } else {
        body = OpeningInput.parse({
          expectedVersion: statement.openingBalance?.version || 0,
          cutoverOn:
            statement.openingBalance?.cutoverOn || String(f.get("date")),
          amountPaise: f.get("direction") === "credit" ? "-" + amount : amount,
          reason,
        });
        path = `/v1/customers/${customerId}/opening-balance`;
        title = "Save opening balance";
      }
      operation.current = crypto.randomUUID();
      setError("");
      setDraft({
        path,
        body,
        title,
        summary: `${statement.customer.name} · ${String((body as { effectiveOn?: string; cutoverOn?: string }).effectiveOn || (body as { cutoverOn?: string }).cutoverOn)} · ${formatPaise((body as { amountPaise: string }).amountPaise)} · ${reason}`,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  function reverse(e: React.FormEvent<HTMLFormElement>, receipt: MoneyEvent) {
    e.preventDefault();
    try {
      const reason = String(new FormData(e.currentTarget).get("reason"));
      const body = ReversalInput.parse({ expectedVersion: 1, reason });
      operation.current = crypto.randomUUID();
      setDraft({
        path: `/v1/receipts/${receipt.id}/reversal`,
        body,
        title: "Reverse full receipt",
        summary: `${statement?.customer.name} · ${receipt.effectiveOn} · ${formatPaise(receipt.amountPaise)} · ${reason}`,
      });
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await request(draft.path, {
        body: draft.body,
        operationId: operation.current,
      });
      setDraft(null);
      setKind(null);
      setTick((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="finance-section" aria-labelledby="account-title">
      <div className="plans-heading">
        <div>
          <span className="entry-kicker">EVERY RUPEE, CLEAR</span>
          <h2 id="account-title">Customer account</h2>
          {statement ? (
            <p>
              {statement.customer.name} · {statement.businessName}
            </p>
          ) : null}
          <p>
            Receipts are manual bookkeeping. They do not collect or verify
            payments.
          </p>
        </div>
        <button disabled={saving} onClick={() => setTick((v) => v + 1)}>
          Refresh account
        </button>
      </div>
      <div className="finance-filters">
        <label>
          From
          <input
            type="date"
            value={from}
            max={to}
            disabled={saving}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            min={from}
            max={todayIST()}
            disabled={saving}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {loading ? <p role="status">Loading account…</p> : null}
      {error ? (
        <p role="alert" className="entry-error">
          {error}
        </p>
      ) : null}
      {statement ? (
        <>
          <div className="finance-totals">
            <article>
              <span>Opening before period</span>
              <strong>{formatPaise(statement.openingPaise)}</strong>
            </article>
            <article>
              <span>Charges / adjustments</span>
              <strong>
                {formatPaise(
                  (
                    BigInt(statement.chargesPaise) +
                    BigInt(statement.adjustmentsPaise)
                  ).toString(),
                )}
              </strong>
            </article>
            <article>
              <span>Receipts / reversals</span>
              <strong>
                {formatPaise(
                  (
                    BigInt(statement.receiptsPaise) -
                    BigInt(statement.reversalsPaise)
                  ).toString(),
                )}
              </strong>
            </article>
            <article className="finance-balance">
              <span>
                {BigInt(statement.closingPaise) < 0n
                  ? "Customer credit"
                  : "Balance due"}
              </span>
              <strong>{formatPaise(statement.closingPaise)}</strong>
            </article>
          </div>
          <p>
            {statement.unresolved
              ? `Provisional: ${statement.unresolved} past scheduled deliveries are unresolved. Their estimated value is excluded.`
              : "No unresolved past deliveries in this period."}
          </p>
          <p className="finance-meta">
            Revision {statement.businessRevision} · Generated{" "}
            {statement.generatedAt}
          </p>
          <div className="finance-actions">
            <button
              disabled={saving}
              onClick={() => {
                setKind("receipt");
                setDraft(null);
              }}
            >
              Record receipt
            </button>
            <button
              disabled={saving}
              onClick={() => {
                setKind("opening");
                setDraft(null);
              }}
            >
              {statement.openingBalance
                ? "Correct opening balance"
                : "Set opening balance"}
            </button>
          </div>
          {kind ? (
            <div className="finance-card">
              <h3>
                {kind === "receipt"
                  ? "Record receipt"
                  : "Opening balance / cutover"}
              </h3>
              <form key={kind + statement.businessRevision} onSubmit={propose}>
                <fieldset disabled={Boolean(draft) || saving}>
                  <label>
                    Amount (₹)
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      min={kind === "opening" ? "0" : "0.01"}
                      required
                      defaultValue={
                        kind === "opening" && statement.openingBalance
                          ? rupees(statement.openingBalance.amountPaise)
                          : ""
                      }
                    />
                  </label>
                  {kind === "receipt" ? (
                    <label>
                      Method
                      <select name="method">
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="bank">Bank</option>
                      </select>
                    </label>
                  ) : (
                    <>
                      <label>
                        Opening type
                        <select
                          name="direction"
                          defaultValue={
                            statement.openingBalance &&
                            BigInt(statement.openingBalance.amountPaise) < 0n
                              ? "credit"
                              : "debit"
                          }
                        >
                          <option value="debit">Customer owes you</option>
                          <option value="credit">
                            Customer has advance credit
                          </option>
                        </select>
                      </label>
                      <p>
                        Choose the cutover before entering earlier activity.
                        Dates before it cannot be charged again. The cutover
                        date stays fixed after creation.
                      </p>
                    </>
                  )}
                  <label>
                    {kind === "receipt" ? "Receipt date" : "Cutover date"}
                    <input
                      name="date"
                      type="date"
                      required
                      max={todayIST()}
                      disabled={
                        kind === "opening" && Boolean(statement.openingBalance)
                      }
                      defaultValue={
                        kind === "opening" && statement.openingBalance
                          ? statement.openingBalance.cutoverOn
                          : todayIST()
                      }
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </label>
                  <button>Review transaction</button>
                </fieldset>
              </form>
              <button
                disabled={saving}
                onClick={() => {
                  setKind(null);
                  setDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {draft ? (
            <Review
              draft={draft}
              saving={saving}
              error={error}
              onCancel={() => setDraft(null)}
              onSave={() => void save()}
            />
          ) : null}
          <div className="register-table finance-lines">
            <table>
              <caption>
                Statement entries · signed amounts add to the balance
              </caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.date}</td>
                    <td>
                      {l.description}
                      <small>{l.recordedAt}</small>
                    </td>
                    <td>{formatPaise(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!statement.lines.length ? <p>No entries in this period.</p> : null}
            {statement.nextCursor ? (
              <button onClick={() => void moreLines()}>More entries</button>
            ) : null}
          </div>
          <div className="finance-actions">
            <button disabled={saving} onClick={() => void exportFile("pdf")}>
              Download PDF
            </button>
            <button disabled={saving} onClick={() => void exportFile("csv")}>
              Export CSV
            </button>
          </div>
          <p className="finance-meta">
            Downloads include all entries in this period. Open the PDF to view
            or print it. If records change, refresh before exporting.
          </p>
          <h3>Receipt history</h3>
          {receipts.map((r) => (
            <article className="finance-card" key={r.id}>
              <strong>
                {r.kind} · {r.effectiveOn} · {formatPaise(r.amountPaise)}
                {r.reversed ? " · Reversed" : ""}
              </strong>
              <p>
                {r.method} · {r.reason}
              </p>
              <p className="finance-meta">
                {r.recordedAt} · Actor {r.actorId}
              </p>
              {r.kind === "receipt" && !r.reversed ? (
                <details>
                  <summary>Reverse this receipt</summary>
                  <form onSubmit={(e) => reverse(e, r)}>
                    <fieldset disabled={saving || Boolean(draft)}>
                      <label>
                        Reversal reason
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={300}
                        />
                      </label>
                      <button>Review full reversal</button>
                    </fieldset>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
          {receiptCursor ? (
            <button onClick={() => void moreReceipts()}>More receipts</button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
