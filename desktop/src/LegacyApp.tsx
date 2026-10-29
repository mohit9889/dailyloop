import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardList,
  FileText,
  Plus,
  Search,
  Users,
  Wallet,
  X,
  Truck,
  RefreshCw,
} from "lucide-react";
import {
  api,
  money,
  today,
  type Workspace,
  type Round,
  type Statement,
} from "./api";
type Tab = "round" | "customers" | "payments" | "statements";
type Modal =
  | { type: "customer" }
  | { type: "plan"; customerId?: string }
  | { type: "payment"; customerId?: string }
  | { type: "delivery"; row: Round }
  | null;
const nav = [
  { id: "round" as const, label: "Delivery round", Icon: ClipboardList },
  { id: "customers" as const, label: "Customers", Icon: Users },
  { id: "payments" as const, label: "Payments", Icon: Wallet },
  { id: "statements" as const, label: "Statements", Icon: FileText },
];
export default function App() {
  const [tab, setTab] = useState<Tab>("round"),
    [day, setDay] = useState(today),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState<Modal>(null),
    [saving, setSaving] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [customerId, setCustomerId] = useState(""),
    [from, setFrom] = useState(today().slice(0, 8) + "01"),
    [to, setTo] = useState(today),
    [statement, setStatement] = useState<Statement | null>(null),
    [statementLoading, setStatementLoading] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Workspace>("workspace?date=" + day, undefined, controller.signal)
      .then(setWorkspace)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [day, revision]);
  useEffect(() => {
    setStatement(null);
    if (tab !== "statements" || !customerId) return;
    const controller = new AbortController();
    setStatementLoading(true);
    setError("");
    api<Statement>(
      "statement?" + new URLSearchParams({ customerId, from, to }),
      undefined,
      controller.signal,
    )
      .then(setStatement)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatementLoading(false);
      });
    return () => controller.abort();
  }, [tab, customerId, from, to, revision]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) setModal(null);
      if (e.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not(:disabled),[role="dialog"] input,[role="dialog"] select',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal, saving]);
  async function save(path: string, body: unknown) {
    setSaving(true);
    setError("");
    try {
      await api(path, body);
      setModal(null);
      setNotice("Saved to your local workspace.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function open(next: Modal) {
    setError("");
    setModal(next);
  }
  function changeTab(next: Tab) {
    setTab(next);
    setSearch("");
    setNotice("");
    setError("");
  }
  const completed = workspace?.round.filter((r) => r.delivery).length || 0,
    delivered =
      workspace?.round.filter((r) => r.delivery?.status === "delivered")
        .length || 0,
    total = workspace?.round.length || 0,
    charges =
      workspace?.round.reduce(
        (sum, r) => sum + (r.delivery?.chargePaise || 0),
        0,
      ) || 0;
  const rows =
    workspace?.round.filter(
      (r) =>
        (r.customer.name + " " + r.customer.address + " " + r.label)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "pending" ? !r.delivery : r.delivery?.status === filter)),
    ) || [];
  const customers =
    workspace?.customers.filter((c) =>
      (c.name + " " + c.phone + " " + c.address)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !modal) return;
    const f = new FormData(event.currentTarget),
      data = Object.fromEntries(f.entries());
    if (modal.type === "customer") await save("customers", data);
    if (modal.type === "plan")
      await save("plans", {
        ...data,
        quantity: Number(data.quantity),
        rate: Number(data.rate),
        weekdays: f.getAll("weekday").map(Number),
      });
    if (modal.type === "payment")
      await save("payments", { ...data, amount: Number(data.amount) });
    if (modal.type === "delivery")
      await save("deliveries", {
        planId: modal.row.id,
        date: day,
        status: data.status,
        quantity: Number(data.quantity),
      });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changeTab("round");
          }}
        >
          <img
            className="brand-logo"
            src="/brand/dailyloop-logo.svg"
            width="200"
            height="50"
            alt="DailyLoop"
          />
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => changeTab(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "round" && total > completed ? (
                <b>{total - completed}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> Local development
          <p>Records stay on this computer.</p>
        </div>
        <div className="profile">
          <span>DL</span>
          <div>
            My delivery business<small>Owner workspace</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            {nav.find((n) => n.id === tab)?.label}
          </span>
          <div>
            <span className="local-badge">
              <span className="status-dot" />
              Local database
            </span>
            <span className="avatar">DL</span>
          </div>
        </header>
        <main>
          <div className="development-note">
            Development build · provisional interface; Figma matching is pending
            design access.
          </div>
          <div className="page-heading">
            <div>
              <span className="eyebrow">A LITTLE ORDER. A BETTER DAY.</span>
              <h1>
                {tab === "round"
                  ? "Your day, delivered."
                  : tab === "customers"
                    ? "Good service starts here."
                    : tab === "payments"
                      ? "Keep every payment clear."
                      : "Every rupee, explained."}
              </h1>
              <p>
                {tab === "round"
                  ? "A clear view of your recurring deliveries. One stop at a time."
                  : tab === "customers"
                    ? "Your customers and their recurring delivery plans."
                    : tab === "payments"
                      ? "Record receipts and keep customer accounts up to date."
                      : "Delivered quantities, recorded payments, and a balance you can trace."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                open({ type: tab === "payments" ? "payment" : "customer" })
              }
            >
              <Plus size={17} />
              {tab === "payments" ? "Record payment" : "Add customer"}
            </button>
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          ) : null}
          {notice ? (
            <div role="status" className="success">
              {notice}
            </div>
          ) : null}
          {!workspace && loading ? (
            <div className="empty">Connecting to your local workspace…</div>
          ) : !workspace ? (
            <div className="empty">
              <h2>Couldn’t connect to DailyLoop</h2>
              <p>Start the backend and try again.</p>
              <button onClick={() => setRevision((v) => v + 1)}>
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          ) : (
            <>
              {tab === "round" ? (
                <>
                  <section className="stats" aria-label="Round summary">
                    <article>
                      <span>
                        Scheduled stops
                        <Truck size={18} />
                      </span>
                      <strong>
                        {total}
                        <small>deliveries</small>
                      </strong>
                      <p>Across all recurring plans</p>
                    </article>
                    <article>
                      <span>
                        Delivered
                        <Check size={18} />
                      </span>
                      <strong>
                        {delivered}
                        <small>of {total} stops</small>
                      </strong>
                      <div className="progress">
                        <i
                          style={{
                            width: total
                              ? `${(completed / total) * 100}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </article>
                    <article>
                      <span>
                        Still to confirm
                        <ClipboardList size={18} />
                      </span>
                      <strong>
                        {total - completed}
                        <small>stops</small>
                      </strong>
                      <p>Skipped and missed stops have no charge</p>
                    </article>
                    <article>
                      <span>
                        Recorded charges
                        <Wallet size={18} />
                      </span>
                      <strong>{money(charges)}</strong>
                      <p>Based on actual delivered quantities</p>
                    </article>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Delivery round <span className="count">{total}</span>
                        </h2>
                        <p>Confirm what actually reached each customer.</p>
                      </div>
                      <label className="date-control">
                        Delivery date
                        <input
                          aria-label="Delivery date"
                          type="date"
                          value={day}
                          onChange={(e) =>
                            e.target.value && setDay(e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className="tools">
                      <div className="filters">
                        {[
                          "all",
                          "pending",
                          "delivered",
                          "skipped",
                          "missed",
                        ].map((f) => (
                          <button
                            key={f}
                            className={filter === f ? "selected" : ""}
                            onClick={() => setFilter(f)}
                          >
                            {f === "all"
                              ? "All deliveries"
                              : f === "pending"
                                ? "To confirm"
                                : f}
                          </button>
                        ))}
                      </div>
                      <label className="search">
                        <Search size={17} />
                        <input
                          aria-label="Search delivery round"
                          placeholder="Search customer or plan…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    {loading ? (
                      <div className="empty">Loading round…</div>
                    ) : rows.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Customer</th>
                              <th>Delivery plan</th>
                              <th>Quantity / rate</th>
                              <th>Status</th>
                              <th className="right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <div className="customer-cell">
                                    <span className="initial">
                                      {r.customer.name.slice(0, 1)}
                                    </span>
                                    <div>
                                      <strong>{r.customer.name}</strong>
                                      <small>{r.customer.address}</small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <strong>{r.label}</strong>
                                  <small>
                                    {r.unit === "litre"
                                      ? "Milk delivery"
                                      : "Tiffin delivery"}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {(r.delivery
                                      ? r.delivery.quantityMilli
                                      : r.quantityMilli) / 1000}{" "}
                                    {r.unit}
                                  </strong>
                                  <small>
                                    {money(r.ratePaise)} / {r.unit}
                                  </small>
                                </td>
                                <td>
                                  <span
                                    className={
                                      "badge " +
                                      (r.delivery?.status || "pending")
                                    }
                                  >
                                    {r.delivery?.status || "To confirm"}
                                  </span>
                                </td>
                                <td className="right">
                                  {r.delivery ? (
                                    <span className="recorded">
                                      <Check size={15} />
                                      {money(r.delivery.chargePaise)}
                                    </span>
                                  ) : (
                                    <button
                                      disabled={
                                        day > workspace.today || loading
                                      }
                                      className="confirm"
                                      onClick={() =>
                                        open({ type: "delivery", row: r })
                                      }
                                    >
                                      Confirm <ArrowUpRight size={15} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty">
                        <ClipboardList size={32} />
                        <h3>
                          {total
                            ? "No matching deliveries"
                            : "A fresh start for your delivery round"}
                        </h3>
                        <p>
                          {total
                            ? "Try a different search or status."
                            : "Add a customer and a recurring plan to see scheduled deliveries here."}
                        </p>
                        {!total ? (
                          <button
                            className="primary"
                            onClick={() =>
                              open({
                                type: workspace.customers.length
                                  ? "plan"
                                  : "customer",
                              })
                            }
                          >
                            <Plus size={16} />
                            {workspace.customers.length
                              ? "Create a delivery plan"
                              : "Add your first customer"}
                          </button>
                        ) : null}
                      </div>
                    )}
                    <div className="panel-footer">
                      <span>
                        <span className="status-dot" />
                        Saved records are kept in your local database
                      </span>
                      <span>Actual deliveries. Clear accounts.</span>
                    </div>
                  </section>
                </>
              ) : null}
              {tab === "customers" ? (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Customer register{" "}
                        <span className="count">
                          {workspace.customers.length}
                        </span>
                      </h2>
                      <p>One customer. As many delivery plans as they need.</p>
                    </div>
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search customers"
                        placeholder="Search name, phone or address…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="customer-grid">
                    {customers.map((c) => (
                      <article className="customer-card" key={c.id}>
                        <div className="customer-cell">
                          <span className="initial">{c.name[0]}</span>
                          <div>
                            <h3>{c.name}</h3>
                            <p>{c.address}</p>
                            <small>{c.phone || "No phone added"}</small>
                          </div>
                        </div>
                        <div className="plan-list">
                          {workspace.plans
                            .filter((p) => p.customerId === c.id)
                            .map((p) => (
                              <div key={p.id}>
                                <strong>{p.label}</strong>
                                <small>
                                  {p.quantityMilli / 1000} {p.unit} ·{" "}
                                  {money(p.ratePaise)} / {p.unit}
                                  <br />
                                  {p.weekdays.length === 7
                                    ? "Every day"
                                    : p.weekdays
                                        .map(
                                          (d) =>
                                            [
                                              "Sun",
                                              "Mon",
                                              "Tue",
                                              "Wed",
                                              "Thu",
                                              "Fri",
                                              "Sat",
                                            ][d],
                                        )
                                        .join(", ")}{" "}
                                  · from {p.start}
                                </small>
                              </div>
                            ))}
                        </div>
                        <div className="card-actions">
                          <button
                            onClick={() =>
                              open({ type: "plan", customerId: c.id })
                            }
                          >
                            <Plus size={15} />
                            Add plan
                          </button>
                          <button
                            onClick={() => {
                              setCustomerId(c.id);
                              changeTab("statements");
                            }}
                          >
                            Statement
                            <ChevronRight size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!customers.length ? (
                    <div className="empty">
                      <Users size={32} />
                      <h3>
                        {search
                          ? "No matching customers"
                          : "Your next great relationship starts here"}
                      </h3>
                      <p>
                        Add your first customer, then their milk or tiffin
                        delivery plans.
                      </p>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {tab === "payments" ? (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recorded receipts</h2>
                      <p>
                        Owner-entered records; these do not verify bank
                        transactions.
                      </p>
                    </div>
                  </div>
                  {workspace.payments.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Date</th>
                            <th>Method</th>
                            <th>Note</th>
                            <th className="right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workspace.payments.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <strong>
                                  {
                                    workspace.customers.find(
                                      (c) => c.id === p.customerId,
                                    )?.name
                                  }
                                </strong>
                              </td>
                              <td>{p.date}</td>
                              <td>{p.method.toUpperCase()}</td>
                              <td>{p.note || "—"}</td>
                              <td className="right">
                                <strong>{money(p.amountPaise)}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      <Wallet size={32} />
                      <h3>No payments recorded yet</h3>
                      <p>Record a payment when a customer pays you.</p>
                    </div>
                  )}
                </section>
              ) : null}
              {tab === "statements" ? (
                <>
                  <section className="statement-controls">
                    <label>
                      Customer
                      <select
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                      >
                        <option value="">Choose a customer</option>
                        {workspace.customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From
                      <input
                        type="date"
                        value={from}
                        onChange={(e) =>
                          e.target.value && setFrom(e.target.value)
                        }
                      />
                    </label>
                    <label>
                      To
                      <input
                        type="date"
                        value={to}
                        onChange={(e) =>
                          e.target.value && setTo(e.target.value)
                        }
                      />
                    </label>
                    <button
                      disabled={!statement || statementLoading}
                      onClick={() => window.print()}
                    >
                      <FileText size={16} />
                      Print / save PDF
                    </button>
                  </section>
                  {statementLoading ? (
                    <div className="empty">Preparing statement…</div>
                  ) : statement ? (
                    <>
                      <div
                        className={
                          "statement-status " +
                          (statement.pending ? "warning" : "success")
                        }
                      >
                        {statement.pending
                          ? `Provisional · ${statement.pending} scheduled deliveries remain unconfirmed and are excluded from charges.`
                          : "All scheduled deliveries in this period are resolved."}
                      </div>
                      <div className="statement-layout">
                        <section className="panel invoice">
                          <span className="eyebrow">
                            DAILYLOOP · CUSTOMER STATEMENT
                          </span>
                          <h2>{statement.customer.name}</h2>
                          <p>{statement.customer.address}</p>
                          <p>
                            {from} — {to}
                          </p>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Entry</th>
                                  <th className="right">Charge</th>
                                  <th className="right">Payment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {statement.rows.map((r) => (
                                  <tr key={r.id}>
                                    <td>{r.date}</td>
                                    <td>{r.description}</td>
                                    <td className="right">
                                      {r.chargePaise
                                        ? money(r.chargePaise)
                                        : "—"}
                                    </td>
                                    <td className="right">
                                      {r.paymentPaise
                                        ? money(r.paymentPaise)
                                        : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {!statement.rows.length ? (
                            <p>No recorded activity in this period.</p>
                          ) : null}
                          <p className="fine-print">
                            Only confirmed deliveries create charges. Payments
                            are manual receipt records.
                          </p>
                        </section>
                        <aside className="panel balance">
                          <h3>Account summary</h3>
                          <p>
                            Opening balance{" "}
                            <strong>{money(statement.openingPaise)}</strong>
                          </p>
                          <p>
                            Delivery charges{" "}
                            <strong>{money(statement.chargesPaise)}</strong>
                          </p>
                          <p>
                            Payments{" "}
                            <strong>−{money(statement.paymentsPaise)}</strong>
                          </p>
                          <div className="balance-total">
                            <span>
                              {statement.closingPaise < 0
                                ? "Customer credit"
                                : "Balance due"}
                            </span>
                            <strong>
                              {money(Math.abs(statement.closingPaise))}
                            </strong>
                          </div>
                          <button
                            className="primary"
                            onClick={() =>
                              open({ type: "payment", customerId })
                            }
                          >
                            <Plus size={16} />
                            Record payment
                          </button>
                        </aside>
                      </div>
                    </>
                  ) : (
                    <div className="panel empty">
                      <FileText size={32} />
                      <h3>Choose a customer to get started</h3>
                      <p>View a reconciled account for any date range.</p>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
          <footer className="page-footer">
            DailyLoop <span>Less admin. More happy customers.</span>
          </footer>
        </main>
      </div>
      {modal ? (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">LET’S KEEP THINGS IN SYNC</span>
                <h2 id="modal-title">
                  {modal.type === "customer"
                    ? "Add a customer"
                    : modal.type === "plan"
                      ? "Create a recurring plan"
                      : modal.type === "payment"
                        ? "Record a payment"
                        : "Confirm actual delivery"}
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                disabled={saving}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {error ? (
              <div className="error" role="alert">
                {error}
              </div>
            ) : null}
            <form onSubmit={submit}>
              {modal.type === "customer" ? (
                <>
                  <label>
                    Customer name
                    <input
                      autoFocus
                      name="name"
                      required
                      maxLength={120}
                      placeholder="e.g. Ananya Sharma"
                    />
                  </label>
                  <label>
                    Phone number <small>(optional)</small>
                    <input
                      name="phone"
                      type="tel"
                      maxLength={20}
                      placeholder="Customer’s contact number"
                    />
                  </label>
                  <label>
                    Delivery address
                    <input
                      name="address"
                      required
                      maxLength={300}
                      placeholder="Building, flat and area"
                    />
                  </label>
                </>
              ) : null}
              {modal.type === "plan" || modal.type === "payment" ? (
                <label>
                  Customer
                  <select
                    autoFocus
                    name="customerId"
                    required
                    defaultValue={modal.customerId || ""}
                  >
                    <option value="" disabled>
                      Choose a customer
                    </option>
                    {workspace?.customers.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {modal.type === "plan" ? (
                <>
                  <label>
                    Plan name
                    <input
                      name="label"
                      required
                      maxLength={120}
                      placeholder="e.g. Morning milk or Dinner"
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Quantity
                      <input
                        name="quantity"
                        type="number"
                        min="0.001"
                        step="0.001"
                        max="100000"
                        required
                        defaultValue="1"
                      />
                    </label>
                    <label>
                      Unit
                      <select name="unit">
                        <option value="litre">Litre · milk</option>
                        <option value="meal">Meal · tiffin</option>
                      </select>
                    </label>
                  </div>
                  <div className="form-grid">
                    <label>
                      Rate per unit (₹)
                      <input
                        name="rate"
                        type="number"
                        min="0.01"
                        step="0.01"
                        max="100000"
                        required
                        placeholder="60"
                      />
                    </label>
                    <label>
                      Starts on
                      <input
                        name="start"
                        type="date"
                        required
                        defaultValue={day}
                      />
                    </label>
                  </div>
                  <fieldset>
                    <legend>Delivery days</legend>
                    <div className="weekdays">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (d, i) => (
                          <label key={d}>
                            <input
                              name="weekday"
                              type="checkbox"
                              value={i}
                              defaultChecked
                            />
                            {d}
                          </label>
                        ),
                      )}
                    </div>
                  </fieldset>
                  <p className="fine-print">
                    Each slot is a separate plan. Rates are captured when a
                    delivery is confirmed.
                  </p>
                </>
              ) : null}
              {modal.type === "payment" ? (
                <>
                  <div className="form-grid">
                    <label>
                      Amount received (₹)
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="100000"
                        required
                      />
                    </label>
                    <label>
                      Received on
                      <input
                        name="date"
                        type="date"
                        required
                        max={today()}
                        defaultValue={today()}
                      />
                    </label>
                  </div>
                  <label>
                    Payment method
                    <select name="method">
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="bank">Bank transfer</option>
                    </select>
                  </label>
                  <label>
                    Note <small>(optional)</small>
                    <input
                      name="note"
                      maxLength={300}
                      placeholder="Reference or receipt note"
                    />
                  </label>
                  <p className="fine-print">
                    This records a receipt. It does not initiate a charge or
                    verify a bank transfer.
                  </p>
                </>
              ) : null}
              {modal.type === "delivery" ? (
                <>
                  <div className="delivery-summary">
                    <strong>{modal.row.customer.name}</strong>
                    <p>
                      {modal.row.label} · {day}
                    </p>
                    <small>
                      Scheduled: {modal.row.quantityMilli / 1000}{" "}
                      {modal.row.unit} · {money(modal.row.ratePaise)} /{" "}
                      {modal.row.unit}
                    </small>
                  </div>
                  <label>
                    Outcome
                    <select autoFocus name="status">
                      <option value="delivered">Delivered</option>
                      <option value="skipped">
                        Skipped by customer · no charge
                      </option>
                      <option value="missed">
                        Missed delivery · no charge
                      </option>
                    </select>
                  </label>
                  <label>
                    Actual quantity delivered ({modal.row.unit})
                    <input
                      name="quantity"
                      type="number"
                      min="0.001"
                      step="0.001"
                      max="100000"
                      required
                      defaultValue={modal.row.quantityMilli / 1000}
                    />
                  </label>
                  <p className="fine-print">
                    Only the actual quantity is billed. Quantity is ignored for
                    skipped or missed deliveries. Saved entries cannot yet be
                    corrected in this development build.
                  </p>
                </>
              ) : null}
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    saving ||
                    ((modal.type === "payment" || modal.type === "plan") &&
                      !workspace?.customers.length)
                  }
                >
                  {saving
                    ? "Saving…"
                    : modal.type === "delivery"
                      ? "Confirm delivery"
                      : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
