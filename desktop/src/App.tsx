import { WorkspaceSettings, LegalLinks } from "./features/Workspace";
import { DailyRound } from "./features/Accounting";
import CustomerDetail from "./features/CustomerDetail";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Utensils,
  Leaf,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  Id,
  BusinessInput,
  CustomerInput,
  type Customer,
  type CustomerPage,
  type Me,
  type Setup,
} from "@dailyloop/contracts";
import {
  request,
  RequestError,
  setCsrf,
  setOwnerScope,
  pendingSave,
} from "./client";
import "./foundation.css";
const brand = (
  <img
    src="/brand/dailyloop-logo.svg"
    width="200"
    height="50"
    alt="DailyLoop"
    className="brand-logo"
  />
);
function readable(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export default function App() {
  const [setup, setSetup] = useState<Setup | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]),
    [search, setSearch] = useState(""),
    [listLoading, setListLoading] = useState(false),
    [listError, setListError] = useState(""),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | undefined>(),
    [showCustomer, setShowCustomer] = useState(false);
  const [settingsOpen, setSettingsOpenState] = useState(
    () => new URLSearchParams(location.search).get("view") === "settings",
  );
  const [roundOpen, setRoundOpenState] = useState(
    () => new URLSearchParams(location.search).get("view") === "round",
  );
  const [selectedCustomer, setSelectedCustomerState] = useState<string | null>(
    () => {
      const id = new URLSearchParams(location.search).get("customer");
      return Id.safeParse(id).success ? id : null;
    },
  );
  function route(
    view: "customers" | "round" | "settings",
    customer?: string | null,
  ) {
    const url = new URL(location.href);
    url.searchParams.delete("auth");
    url.searchParams.delete("customer");
    url.searchParams.delete("view");
    if (customer) url.searchParams.set("customer", customer);
    else if (view !== "customers") url.searchParams.set("view", view);
    if (url.href !== location.href) history.pushState(null, "", url);
  }
  function setSettingsOpen(value: boolean) {
    setSettingsOpenState(value);
    setRoundOpenState(false);
    setSelectedCustomerState(null);
    route(value ? "settings" : "customers");
  }
  function setRoundOpen(value: boolean) {
    setRoundOpenState(value);
    setSettingsOpenState(false);
    setSelectedCustomerState(null);
    route(value ? "round" : "customers");
  }
  function setSelectedCustomer(value: string | null) {
    setSelectedCustomerState(value);
    setRoundOpenState(false);
    setSettingsOpenState(false);
    route("customers", value);
  }
  useEffect(() => {
    const apply = () => {
      const q = new URLSearchParams(location.search),
        id = q.get("customer");
      setSelectedCustomerState(Id.safeParse(id).success ? id : null);
      setRoundOpenState(q.get("view") === "round");
      setSettingsOpenState(q.get("view") === "settings");
    };
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);
  const operation = useRef<{ body: string; key: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    (async () => {
      const status = await request<Setup>("/v1/setup", {
        signal: controller.signal,
      });
      setSetup(status);
      if (!status.configured) {
        setMe(null);
        return;
      }
      try {
        const user = await request<Me>("/v1/me", { signal: controller.signal });
        setMe(user);
        setOwnerScope(user.user.id);
        setCsrf(user.csrfToken || "");
      } catch (e) {
        if (e instanceof RequestError && e.status === 401) {
          setMe(null);
          setCsrf("");
          setOwnerScope("");
          return;
        }
        throw e;
      }
    })()
      .catch((e) => {
        if (e.name !== "AbortError") setError(readable(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!me?.business) return;
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    const timeout = setTimeout(() => {
      const query = new URLSearchParams({
        search,
        limit: "25",
        ...(cursor ? { after: cursor } : {}),
      });
      request<CustomerPage>("/v1/customers?" + query, {
        signal: controller.signal,
      })
        .then((page) => {
          setCustomers(page.items);
          setNextCursor(page.nextCursor);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setListError(readable(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setListLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [me?.business?.id, search, cursor, revision]);
  useEffect(() => {
    if (showCustomer) {
      dialog.current?.showModal();
      dialog.current?.querySelector("input")?.focus();
    } else dialog.current?.close();
  }, [showCustomer]);
  function keyFor(body: unknown) {
    const encoded = JSON.stringify(body);
    if (operation.current?.body !== encoded)
      operation.current = { body: encoded, key: crypto.randomUUID() };
    return operation.current.key;
  }
  async function createBusiness(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const f = new FormData(event.currentTarget);
    const parsed = BusinessInput.safeParse({
      name: f.get("name"),
      serviceType: f.get("serviceType"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request("/v1/businesses", {
        body: parsed.data,
        operationId: keyFor(parsed.data),
      });
      operation.current = null;
      setRevision((v) => v + 1);
    } catch (e) {
      setError(readable(e));
    } finally {
      setSaving(false);
    }
  }
  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const f = new FormData(event.currentTarget);
    const parsed = CustomerInput.safeParse({
      name: f.get("name"),
      phone: f.get("phone"),
      address: f.get("address"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request("/v1/customers", {
        body: parsed.data,
        operationId: keyFor(parsed.data),
      });
      operation.current = null;
      setShowCustomer(false);
      setNotice("Customer saved to your business.");
      setCursor(undefined);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(readable(e));
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    if (pendingSave()) {
      setError("Resolve the pending financial save before signing out.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request("/auth/logout", { body: {} });
      setMe(null);
      setOwnerScope("");
      setSettingsOpen(false);
      setRoundOpen(false);
      setSelectedCustomer(null);
      setCsrf("");
      setCustomers([]);
      setNotice("");
    } catch (e) {
      setError(readable(e));
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    window.addEventListener("dailyloop-records-changed", refresh);
    return () =>
      window.removeEventListener("dailyloop-records-changed", refresh);
  }, []);
  const authFailed =
    new URLSearchParams(window.location.search).get("auth") === "failed";
  if (loading)
    return (
      <div className="entry-loading">
        <div>
          {brand}
          <p role="status">Opening your workspace…</p>
        </div>
      </div>
    );
  if (!me)
    return (
      <div className="entry-page">
        <section className="entry-story">
          <div>{brand}</div>
          <div className="entry-story-copy">
            <span className="entry-kicker">
              YOUR BUSINESS, A LITTLE LIGHTER.
            </span>
            <h1>
              More deliveries.
              <br />
              Less loose ends.
            </h1>
            <p>
              Give every customer, delivery and payment a place. Build a daily
              rhythm that works for you.
            </p>
            <div className="story-benefits">
              <span>
                <Check size={17} aria-hidden="true" />
                Your records, together
              </span>
              <span>
                <Check size={17} aria-hidden="true" />
                Made for everyday delivery
              </span>
              <span>
                <Check size={17} aria-hidden="true" />
                Your business stays yours
              </span>
            </div>
          </div>
          <LegalLinks />
          <p className="story-footer">A clear record. A better day.</p>
        </section>
        <main className="entry-main">
          <div className="entry-card">
            <span className="entry-kicker">WELCOME TO DAILYLOOP</span>
            <h2>
              A fresh start for
              <br />
              your daily business.
            </h2>
            <p>
              Sign in to set up your workspace and start adding your customers.
            </p>
            {error || authFailed ? (
              <div className="entry-error" role="alert">
                {error || "Sign-in could not be completed. Please try again."}
              </div>
            ) : null}
            {setup?.configured ? (
              <a className="google-login" href="/auth/google/start">
                <span className="google-mark" aria-hidden="true">
                  G
                </span>
                Continue with Google
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            ) : (
              <div className="connection-card">
                <span className="connection-icon">
                  <ShieldCheck size={22} aria-hidden="true" />
                </span>
                <h3>Your workspace is being prepared</h3>
                <p>
                  Secure sign-in will be available once the project connection
                  is complete.
                </p>
                <button onClick={() => setRevision((v) => v + 1)}>
                  Check connection
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="entry-privacy">
              <ShieldCheck size={17} aria-hidden="true" />
              <p>
                A private workspace for your business.
                <br />
                Your customer records are kept separate.
              </p>
            </div>
          </div>
          <p className="entry-bottom">Every delivery counts.</p>
        </main>
      </div>
    );
  if (settingsOpen)
    return (
      <WorkspaceSettings
        me={me}
        onBack={() => setSettingsOpen(false)}
        onSaved={(b) => setMe((v) => (v ? { ...v, business: b } : v))}
        onSignOut={() => void logout()}
      />
    );
  if (!me.business)
    return (
      <div className="onboarding-shell">
        <header>
          {brand}
          <time dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date())}
          </time>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button onClick={logout} disabled={saving}>
            Sign out
          </button>
        </header>
        <main className="onboarding-card">
          <span className="entry-kicker">LET’S MAKE IT YOURS</span>
          <h1>
            A home for your
            <br />
            delivery business.
          </h1>
          <p>Start with your business name. You can add your customers next.</p>
          {error ? (
            <div className="entry-error" role="alert">
              {error}
            </div>
          ) : null}
          <form onSubmit={createBusiness}>
            <label htmlFor="business-name">Business name</label>
            <input
              id="business-name"
              name="name"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g. Green Valley Milk…"
              autoFocus
            />
            <label htmlFor="service-type">What do you deliver?</label>
            <select id="service-type" name="serviceType">
              <option value="milk">Milk</option>
              <option value="tiffin">Tiffin meals</option>
              <option value="mixed">Milk and tiffin</option>
            </select>
            <button className="primary" disabled={saving}>
              {saving ? "Creating your workspace…" : "Create my workspace"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>
          <span className="onboarding-note">India · INR · Asia/Kolkata</span>
        </main>
      </div>
    );
  if (roundOpen && me.features?.accounting)
    return (
      <DailyRound
        onBack={() => {
          setRoundOpen(false);
          setRevision((v) => v + 1);
        }}
      />
    );
  if (selectedCustomer)
    return (
      <CustomerDetail
        customerId={selectedCustomer}
        accountingEnabled={me.features?.accounting}
        serviceType={me.business.serviceType}
        onBack={() => {
          setSelectedCustomer(null);
          setRevision((v) => v + 1);
        }}
      />
    );
  return (
    <div className="owner-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="owner-sidebar">
        {brand}
        <p className="sidebar-caption">YOUR WORKSPACE</p>
        <nav aria-label="Main navigation">
          <a href="/" aria-current="page">
            <Users size={19} aria-hidden="true" />
            Customers
          </a>
          {me.features?.accounting ? (
            <button onClick={() => setRoundOpen(true)}>Daily round</button>
          ) : null}
          <button onClick={() => setSettingsOpen(true)}>
            Settings and support
          </button>
        </nav>
        <div className="owner-sidebar-bottom">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            Your private workspace<small>Connected to your business</small>
          </span>
        </div>
      </aside>
      <div className="owner-content">
        <header className="owner-topbar">
          <span>
            {me.business.name}
            <ChevronDown size={14} aria-hidden="true" />
          </span>
          <time dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date())}
          </time>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button onClick={logout} disabled={saving}>
            Sign out
          </button>
        </header>
        <main id="main-content" className="owner-main">
          <span className="entry-kicker">YOUR DAILYLOOP WORKSPACE</span>
          <div className="owner-heading">
            <div>
              <h1>Your customer register.</h1>
              <p>Good service starts with knowing every customer.</p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setError("");
                setShowCustomer(true);
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Add customer
            </button>
          </div>
          {notice ? (
            <div className="entry-success" role="status">
              {notice}
            </div>
          ) : null}
          {error && !showCustomer ? (
            <div className="entry-error" role="alert">
              {error}
            </div>
          ) : null}
          <section
            className="register-context"
            aria-label="Recurring service guidance"
          >
            <div>
              <h2>A little planning. A smoother day.</h2>
              <p>
                Keep lunch, dinner and every regular delivery in rhythm. Open a
                customer to manage plans, pause dates or review their schedule.
              </p>
            </div>
            <span className="context-symbol">
              <Utensils size={25} aria-hidden="true" />
            </span>
          </section>
          <section className="owner-panel" aria-labelledby="register-title">
            <div className="register-toolbar">
              <div className="register-title-group">
                <h2 id="register-title">Your customers</h2>
                <p>
                  {listLoading
                    ? "Updating register…"
                    : `${customers.length} shown${nextCursor ? " · more on the next page" : ""}`}{" "}
                  · Search or open a customer
                </p>
              </div>
              <label className="register-search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search customers</span>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCursor(undefined);
                  }}
                  placeholder="Search name or phone…"
                  autoComplete="off"
                />
              </label>
            </div>
            {listLoading ? (
              <div className="register-empty" role="status">
                Loading your customers…
              </div>
            ) : listError ? (
              <div className="register-empty">
                <p role="alert">{listError}</p>
                <button onClick={() => setRevision((v) => v + 1)}>
                  Try again
                </button>
              </div>
            ) : customers.length ? (
              <div className="register-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Delivery address</th>
                      <th scope="col">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className="customer-avatar" aria-hidden="true">
                            {c.name[0]}
                          </span>
                          <button
                            className="customer-open"
                            disabled={!me.features?.planLifecycle}
                            onClick={() => setSelectedCustomer(c.id)}
                          >
                            {c.name}
                            <ChevronDown size={13} aria-hidden="true" />
                          </button>
                          {c.archivedEffectiveOn ? (
                            <span className="customer-archive-label">
                              Archived from {c.archivedEffectiveOn}
                            </span>
                          ) : null}
                        </td>
                        <td>{c.address}</td>
                        <td>{c.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="register-empty">
                <span className="empty-illustration">
                  <Users size={33} aria-hidden="true" />
                  <Leaf size={16} aria-hidden="true" />
                </span>
                <h3>
                  {search
                    ? "No customers found"
                    : "Your first customer starts the loop."}
                </h3>
                <p>
                  {search
                    ? "Try another name or phone number."
                    : "Add a name and delivery address to get your register started."}
                </p>
                {!search ? (
                  <button
                    onClick={() => {
                      setError("");
                      setShowCustomer(true);
                    }}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Add your first customer
                  </button>
                ) : null}
              </div>
            )}
            <footer className="register-footer">
              <span>
                <span className="status-dot" />
                Saved to your business workspace
              </span>
              <div>
                {cursor ? (
                  <button onClick={() => setCursor(undefined)}>
                    First page
                  </button>
                ) : null}
                {nextCursor ? (
                  <button onClick={() => setCursor(nextCursor)}>
                    Next page
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </footer>
          </section>
          <footer className="owner-footer">
            DailyLoop<span>A little order. A better day.</span>
            <LegalLinks />
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="customer-dialog"
        onCancel={(e) => {
          if (saving) e.preventDefault();
          else setShowCustomer(false);
        }}
        onClose={() => setShowCustomer(false)}
        aria-labelledby="customer-dialog-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="entry-kicker">A NEW FACE ON YOUR ROUND</span>
            <h2 id="customer-dialog-title">Add a customer</h2>
          </div>
          <button
            aria-label="Close dialog"
            disabled={saving}
            onClick={() => setShowCustomer(false)}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {error ? (
          <p className="entry-error" role="alert">
            {error}
          </p>
        ) : null}
        <form onSubmit={createCustomer}>
          <label htmlFor="customer-name">Customer name</label>
          <input
            id="customer-name"
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            autoFocus
            placeholder="e.g. Ananya Sharma…"
          />
          <label htmlFor="customer-address">Delivery address</label>
          <input
            id="customer-address"
            name="address"
            required
            maxLength={300}
            autoComplete="street-address"
            placeholder="Building, flat and area…"
          />
          <label htmlFor="customer-phone">
            Phone <span>(optional)</span>
          </label>
          <input
            id="customer-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="Customer’s contact number…"
          />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowCustomer(false)}
            >
              Cancel
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save customer"}
              <Check size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
