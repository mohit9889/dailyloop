import { useEffect, useRef, useState } from "react";
import {
  BusinessEditInput,
  OwnerRequestInput,
  type Me,
  type Business,
  type OwnerRequest,
} from "@dailyloop/contracts";
import {
  request,
  download,
  setCsrf,
  setOwnerScope,
  pendingSave,
  type PendingSave,
  RequestError,
} from "../client";
import "./workspace.css";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";
type PublicInfo = {
  supportEmail: string;
  supportPlaceholder: boolean;
  privacyVersion: string;
};
export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Policies and support">
      <a href="/privacy">Privacy</a>
      <a href="/support">Support</a>
      <a href="/account-deletion">Delete account</a>
    </nav>
  );
}
function Requests({ me }: { me: Me }) {
  const [items, setItems] = useState<OwnerRequest[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [kind, setKind] = useState<"support" | "deletion">("support"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draft, setDraft] = useState<ReturnType<
      typeof OwnerRequestInput.parse
    > | null>(null);
  const key = useRef("");
  async function load(after?: string) {
    setLoading(true);
    try {
      const r = await request<{
        items: OwnerRequest[];
        nextCursor: string | null;
      }>("/v1/account/requests" + (after ? "?after=" + after : ""));
      setItems((old) => (after ? [...old, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [me.user.id]);
  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const data = OwnerRequestInput.parse({
        kind,
        message: String(f.get("message")),
        ...(kind === "deletion"
          ? { confirmation: String(f.get("confirmation")) }
          : {}),
      });
      key.current = crypto.randomUUID();
      setDraft(data);
      setError("");
      setNotice("");
    } catch (e) {
      setError(message(e));
    }
  }
  async function send() {
    if (!draft || loading) return;
    setLoading(true);
    setError("");
    try {
      const r = await request<OwnerRequest>("/v1/account/requests", {
        body: draft,
        operationId: key.current,
      });
      setDraft(null);
      setNotice(
        `Request saved. Reference ${r.id}.${r.kind === "deletion" ? " Your account has not been deleted." : ""}`,
      );
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function cancel(id: string) {
    setLoading(true);
    try {
      await request(`/v1/account/requests/${id}/cancel`, {
        body: {},
        operationId: crypto.randomUUID(),
      });
      await load();
      setNotice("Request cancelled.");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="finance-card" aria-labelledby="request-title">
      <h2 id="request-title">Support and account deletion</h2>
      <p>
        Requests are saved for manual review by the DailyLoop operator. Saving a
        request does not send an email or immediately erase your account. Check
        its status here.
      </p>
      <form onSubmit={review}>
        <fieldset disabled={loading || Boolean(draft)}>
          <label htmlFor="request-kind">Request type</label>
          <select
            id="request-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="support">Support</option>
            <option value="deletion">
              Delete my account and business data
            </option>
          </select>
          {kind === "deletion" ? (
            <div className="archive-warning">
              <p>
                Download your records first. Sign out and sign in again before
                requesting deletion; the sign-in must be within the last 10
                minutes. The request covers your business records and login
                identity. It can be cancelled while open. Final removal is
                permanent and performed by the operator after verifying the
                request.
              </p>
              <label htmlFor="delete-confirm">Type DELETE MY ACCOUNT</label>
              <input
                id="delete-confirm"
                name="confirmation"
                autoComplete="off"
                required
              />
            </div>
          ) : null}
          <label htmlFor="request-message">Details</label>
          <textarea
            id="request-message"
            name="message"
            required
            minLength={3}
            maxLength={2000}
            rows={4}
          />
          <p>
            Do not include passwords, tokens, card details or bank credentials.
          </p>
          <button>Review request</button>
        </fieldset>
      </form>
      {draft ? (
        <div className="finance-review">
          <h3 tabIndex={-1} ref={(n) => n?.focus()}>
            Review your request
          </h3>
          <strong>
            {draft.kind === "deletion"
              ? "Account deletion request"
              : "Support request"}
          </strong>
          <p>{draft.message}</p>
          <div className="finance-actions">
            <button disabled={loading} onClick={() => setDraft(null)}>
              Edit
            </button>
            <button
              className="primary"
              disabled={loading}
              onClick={() => void send()}
            >
              {loading ? "Saving…" : "Save request"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="entry-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="entry-success" role="status">
          {notice}
        </p>
      ) : null}
      <h3>Your requests</h3>
      {!items.length ? (
        <p>No saved requests.</p>
      ) : (
        items.map((r) => (
          <article className="request-item" key={r.id}>
            <strong>
              {r.kind === "deletion" ? "Account deletion" : "Support"} ·{" "}
              {r.status}
            </strong>
            <p>{r.message}</p>
            <small>
              {r.createdAt} · Reference {r.id}
            </small>
            {r.status === "open" ? (
              <button disabled={loading} onClick={() => void cancel(r.id)}>
                Cancel this request
              </button>
            ) : null}
          </article>
        ))
      )}
      {cursor ? (
        <button disabled={loading} onClick={() => void load(cursor)}>
          More requests
        </button>
      ) : null}
    </section>
  );
}
export function WorkspaceSettings({
  me,
  onBack,
  onSaved,
  onSignOut,
}: {
  me: Me;
  onBack: () => void;
  onSaved: (b: Business) => void;
  onSignOut: () => void;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [review, setReview] = useState<ReturnType<
      typeof BusinessEditInput.parse
    > | null>(null),
    [info, setInfo] = useState<PublicInfo | null>(null);
  const key = useRef("");
  useEffect(() => {
    request<PublicInfo>("/v1/public")
      .then(setInfo)
      .catch(() => {});
  }, []);
  function prepare(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!me.business) return;
    try {
      const f = new FormData(e.currentTarget);
      setReview(
        BusinessEditInput.parse({
          name: f.get("name"),
          serviceType: f.get("serviceType"),
          expectedRevision: me.business.revision,
        }),
      );
      key.current = crypto.randomUUID();
      setError("");
      setNotice("");
    } catch (e) {
      setError(message(e));
    }
  }
  async function save() {
    if (!review || saving) return;
    setSaving(true);
    try {
      const b = await request<Business>("/v1/business", {
        method: "PATCH",
        body: review,
        operationId: key.current,
      });
      onSaved(b);
      setReview(null);
      setNotice(
        "Business details saved. Existing plans and records are unchanged.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function exportData() {
    setSaving(true);
    setError("");
    try {
      await download("/v1/account/export", "dailyloop-account.json", {
        body: {},
        operationId: crypto.randomUUID(),
      });
      setNotice("Account export downloaded. Keep this file private.");
    } catch (e) {
      setError(message(e));
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
        <button disabled={saving} onClick={onBack}>
          Back to workspace
        </button>
      </header>
      <main className="detail-main workspace-main">
        <span className="entry-kicker">YOUR BUSINESS, YOUR RECORDS</span>
        <h1>Settings and support</h1>
        <p>{me.user.email} · India · INR · Asia/Kolkata</p>
        {!me.features?.workspace ? (
          <p className="archive-warning">
            Settings are awaiting the web workspace migration. Your customers
            and plans remain available.
          </p>
        ) : (
          <>
            {me.business ? (
              <section className="finance-card">
                <h2>Business details</h2>
                <form key={me.business.revision} onSubmit={prepare}>
                  <fieldset disabled={saving || Boolean(review)}>
                    <label htmlFor="settings-name">Business name</label>
                    <input
                      id="settings-name"
                      name="name"
                      autoComplete="organization"
                      required
                      minLength={2}
                      maxLength={120}
                      defaultValue={me.business.name}
                    />
                    <label htmlFor="settings-service">Service type</label>
                    <select
                      id="settings-service"
                      name="serviceType"
                      defaultValue={me.business.serviceType}
                    >
                      <option value="tiffin">Tiffin</option>
                      <option value="milk">Milk</option>
                      <option value="mixed">Both</option>
                    </select>
                    <p>
                      This changes the defaults for new plans. It does not
                      convert existing meal or litre plans.
                    </p>
                    <button>Review changes</button>
                  </fieldset>
                </form>
                {review ? (
                  <div className="finance-review">
                    <h3>Review business details</h3>
                    <p>
                      {review.name} · {review.serviceType}
                    </p>
                    <button disabled={saving} onClick={() => setReview(null)}>
                      Edit
                    </button>
                    <button
                      className="primary"
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      Confirm and save
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {error ? (
              <p role="alert" className="entry-error">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="entry-success">
                {notice}
              </p>
            ) : null}
            {me.business ? (
              <section className="finance-card">
                <h2>Download your business records</h2>
                <p>
                  The JSON export contains customer contact details, plans,
                  delivery history, financial entries and audit records. Store
                  it privately. It excludes authentication tokens and session
                  secrets.
                </p>
                <p>
                  For protection, sign out and sign in again, then download
                  within 10 minutes.
                </p>
                <div className="finance-actions">
                  <button disabled={saving} onClick={() => void exportData()}>
                    {saving ? "Preparing…" : "Download account JSON"}
                  </button>
                  <button disabled={saving} onClick={onSignOut}>
                    Sign out to verify again
                  </button>
                </div>
              </section>
            ) : null}
            <Requests me={me} />
          </>
        )}
        <section className="finance-card">
          <h2>Pilot service</h2>
          <p>
            DailyLoop uses free-tier hosting. After inactivity, the server may
            take time to start. Keep this page open while a save is pending;
            retry the same operation after a connection failure.
          </p>
          <p>
            {info?.supportPlaceholder
              ? `${info.supportEmail} is a placeholder, not a monitored mailbox. Use the in-app request form during testing.`
              : info?.supportEmail || "Loading support information…"}
          </p>
          <LegalLinks />
        </section>
      </main>
    </div>
  );
}
export function PublicPage({ path }: { path: string }) {
  const [info, setInfo] = useState<PublicInfo | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request<PublicInfo>("/v1/public")
      .then(setInfo)
      .catch((e) => setError(message(e)));
    if (path !== "/privacy")
      request<Me>("/v1/me")
        .then((v) => {
          setMe(v);
          setCsrf(v.csrfToken || "");
          setOwnerScope(v.user.id);
        })
        .catch((e) => {
          if (!(e instanceof RequestError && e.status === 401))
            setError(message(e));
        });
    document.title =
      (path === "/privacy"
        ? "Privacy"
        : path === "/support"
          ? "Support"
          : "Account deletion") + " · DailyLoop";
  }, [path]);
  return (
    <div className="detail-shell">
      <header className="detail-top">
        <img
          src="/brand/dailyloop-logo.svg"
          width="200"
          height="50"
          alt="DailyLoop"
        />
        <a href="/">Open DailyLoop</a>
      </header>
      <main className="detail-main workspace-main">
        <LegalLinks />
        {path === "/privacy" ? (
          <>
            <h1>Privacy notice</h1>
            <p>Version 29 October 2026 · Early-access service</p>
            <h2>What we store</h2>
            <p>
              Your Google account identifier and email, business details,
              customer names and delivery contact information, recurring plans,
              delivery outcomes, manual receipts, account requests and change
              history. DailyLoop does not collect card details or verify bank
              payments.
            </p>
            <h2>Why and where</h2>
            <p>
              We use these records to provide sign-in, delivery scheduling,
              bookkeeping, statements, support and account management. Google
              handles sign-in; Supabase provides identity and database services;
              the hosted deployment uses Render. These providers process data to
              operate their services. DailyLoop requests basic Google identity
              scopes, not Gmail or Drive access.
            </p>
            <h2>Your controls</h2>
            <p>
              Use Settings to export business data or submit a deletion request.
              You can correct records using the app’s history-preserving
              workflows. Avoid putting unnecessary personal information in
              notes. Account deletion is reviewed manually; a saved request is
              not immediate erasure. Active records are retained while your
              account is in use.
            </p>
            <h2>Deletion and backups</h2>
            <p>
              After a verified removal, working records and login access are
              removed. Encrypted recovery copies may retain earlier data until
              their rotation, targeted within 30 days. The operator must check
              requests and backups; the free pilot does not offer automatic
              deletion or guaranteed availability. A restored backup must
              reapply completed deletions before access is reopened.
            </p>
            <h2>Contact</h2>
            <p>
              {info?.supportPlaceholder
                ? "A monitored contact address has not been published yet. The displayed test address must be replaced before public launch. Use the signed-in support form during testing."
                : info?.supportEmail || "Loading contact…"}
            </p>
            <p>
              No claim of legal certification or tax-accounting compliance is
              made.
            </p>
          </>
        ) : (
          <>
            <h1>{path === "/support" ? "Support" : "Account deletion"}</h1>
            <p>
              {path === "/support"
                ? "Tell us which workflow needs help. Do not share passwords or secret keys."
                : "Request removal of your business records and DailyLoop login. Export your records first. The operator verifies and fulfils requests manually; cancellation is available while a request is open."}
            </p>
            {info?.supportPlaceholder ? (
              <p className="archive-warning">
                {info.supportEmail} is a non-routable test placeholder. It does
                not receive email.
              </p>
            ) : info ? (
              <p>
                Contact{" "}
                <a href={"mailto:" + info.supportEmail}>{info.supportEmail}</a>
              </p>
            ) : null}
            {me?.features?.workspace ? (
              <Requests me={me} />
            ) : (
              <p>
                <a href="/auth/google/start">Sign in with Google</a>, then
                return to this page to submit and track your request. For
                deletion, sign-in must be within the last 10 minutes.
              </p>
            )}
          </>
        )}
        {error ? (
          <p role="alert" className="entry-error">
            {error}
          </p>
        ) : null}
        <a href="/">Back to DailyLoop</a>
      </main>
    </div>
  );
}

export function PendingSaveNotice() {
  const [pending, setPending] = useState<PendingSave | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const read = () => setPending(pendingSave());
    read();
    window.addEventListener("dailyloop-pending", read);
    return () => window.removeEventListener("dailyloop-pending", read);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  async function retry() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await request(pending.path, {
        body: pending.body,
        operationId: pending.operationId,
      });
      setError("");
      window.dispatchEvent(new Event("dailyloop-records-changed"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return pending ? (
    <aside className="pending-save-banner" role="status">
      <strong>Save awaiting confirmation</strong>
      <p>
        Keep this tab open. Retry uses the same operation reference, so an
        already accepted entry is not recorded twice. Other financial saves are
        blocked until this is resolved.
      </p>
      <button disabled={busy} onClick={() => void retry()}>
        {busy ? "Checking…" : "Retry pending save"}
      </button>
      <small>
        {pending.createdAt} · Reference {pending.operationId}
      </small>
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  ) : null;
}
