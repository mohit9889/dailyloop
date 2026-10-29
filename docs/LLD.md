# DailyLoop — low-level design (LLD)

29 October 2026 · Specification for implementation, not implemented functionality. FREE-TIER REVISION: HLD.md and PLATFORM_READINESS.md now govern a zero-spend early-access pilot. All financial/security requirements remain; paid hosting, SMTP, domain, monitoring and store distribution are not pilot prerequisites. Business scope and milestones remain in MVP_LAUNCH_PLAN.md; architecture choices are in HLD.md. Resolve contradictions through a short decision record before coding, not by silently changing financial rules.

## 1. Repository layout

```text
mobile/
  app/                   Expo Router auth/setup/tabs/detail routes
  src/features/          round, customers, plans, receipts, statements, settings
  src/auth/              Supabase adapter, secure storage, API session registration
  src/api/               typed client, timeout/refresh/error handling
  src/db/                protected local cache and outbox migrations
  src/sync/              foreground/reconnect worker and conflict handling
  src/components/        native controls and branded tokens
  assets/brand/          original logo and icon
  eas.json               development/preview/production profiles
  tests/                 component and device flow fixtures

desktop/
  src/routes/            auth/setup/dashboard/customer/round/receipt/statement routes
  src/features/          feature-specific forms and views
  src/api/               cookie client, CSRF, typed errors, query keys
  src/components/        web components and accessible form primitives
  public/brand/          original vector assets
  tests/                 browser journeys and components

backend/
  src/app.ts             Fastify construction; no listen side effect in tests
  src/server.ts          validated configuration and server lifecycle
  src/plugins/          auth, session, tenant transaction, errors, rate limit
  src/modules/          businesses, customers, plans, rounds, deliveries,
                        receipts, statements, exports, account
  src/domain/           pure scheduling, money, correction and statement rules
  src/repositories/     database queries scoped to transaction context
  src/db/               Drizzle schema and connection pools
  migrations/           ordered SQL including constraints and RLS
  jobs/                 retention, account erasure and operational tasks
  tests/                domain, PostgreSQL integration, authorization and races

packages/contracts/     Zod schemas, API types and stable error codes; no DB imports
infra/                  one Render Free full-stack configuration and local backup scripts
.github/workflows/      PR validation, staging deploy, production promotion
```

Use npm workspaces; platform React dependencies remain independent. Format source and separate existing compressed components during the affected feature work. One schema migration system owns SQL; Supabase CLI runs local services but must not create a competing migration history.

## 2. Database conventions and entities

UUID primary keys, UTC timestamptz audit timestamps, date service/effective dates. Integer quantity_milli; whole meals are multiples of 1,000. Monetary values are PostgreSQL bigint paise. API serializes money as base-10 integer strings to avoid BigInt/JSON precision loss; client formatting utilities must be tested and must not round through floating point. Signed ledger amounts use the same representation.

Every business child has business_id and a composite foreign key to the parent (business_id, parent_id). Add unique(business_id,id) on referenced parents. Required checks and uniqueness live in SQL, not only Zod. No unbounded list endpoints; use stable cursor pagination and date windows.

| Table | Main fields | Invariants |
|---|---|---|
| profiles | user_id references auth.users, display_name, status | No password storage; disabled owners rejected |
| businesses | id, name, service_type, currency, timezone, revision, status | INR/Asia-Kolkata initially; revision increases on accepted business writes |
| memberships | business_id, user_id, role, active | Unique business/user; owner only; one primary business per owner in v1 |
| app_sessions | id, user_id, supabase_session_id, platform, token_hash, encrypted_refresh_token, expires_at, revoked_at | Opaque browser token stored hashed; mobile JWT session ID matched to active record; refresh secret only for web |
| customers | id, business_id, name, phone, address, active_from, archived_effective_on, version | Versioned edits; archiving preserves events |
| plans | id, business_id, customer_id, slot_key, start_on, end_on, version | One distinct stable slot per plan; start ≤ end when end exists |
| plan_revisions | id, business_id, plan_id, valid_from, valid_to, label, unit, quantity_milli, rate_paise, weekdays | Nonoverlapping date ranges per plan; positive quantity/rate; valid nonempty unique weekdays |
| pause_ranges | id, business_id, plan_id, from_on, to_on, reason, version | Inclusive dates; from ≤ to; no destructive history changes |
| date_overrides | id, business_id, plan_id, service_on, action, quantity_milli, version | Unique plan/date active override; action skip or resume/change; retain revisions/audit |
| delivery_occurrences | id, business_id, plan_id, service_on, current_event_id, version | Unique business/plan/date; version serializes outcome corrections |
| delivery_events | id, business_id, occurrence_id, kind, status, quantity_milli, rate_paise, unit, label, charge_paise, reverses_event_id, reason, actor_id, recorded_at | Immutable accepted events; snapshots preserve historical meaning |
| receipt_events | id, business_id, customer_id, kind, amount_paise, method, effective_on, reverses_event_id, reason, actor_id, recorded_at | Positive receipt; full reversal once only in v1; no partial reversal UI |
| ledger_entries | id, business_id, customer_id, source_type, source_event_id, effective_on, signed_amount_paise, recorded_at | Unique financial posting role per source event; immutable; no stored mutable balance |
| idempotency_records | business_id, user_id, operation_id, route, request_hash, response_code, response_json, completed_at | Unique business/user/operation; payload mismatch returns conflict |
| audit_events | id, business_id, actor_id, session_id, entity_type, entity_id, action, reason, occurred_at | Append-only business audit; redact secrets and minimize personal data |
| exports | id, business_id, customer_id, from_on, to_on, revision, object_path, expires_at | Optional retained artifact; object private and ownership checked |
| deletion_requests | id, business_id, user_id, requested_at, execute_after, status | Verified identity and explicit confirmation; documented retention/erasure workflow |
```

Indexes: tenant/customer name search; plans by tenant/customer; revisions by tenant/plan/effective date; events by occurrence; ledger by tenant/customer/effective date; receipts by tenant/customer/date; session token hash and Supabase session ID; idempotency operation key; due deletion requests. Use an exclusion constraint on plan revision date ranges or equivalent transactional locking plus constraint-backed revision boundaries.

## 3. Authorization and database access

Request pipeline: validate route → verify identity/session → load active membership → validate body → open tenant transaction → set verified transaction-local user/business context → service/repository → audit and commit → typed response.

Runtime role must not own tables or bypass RLS. Policy predicates compare business_id to verified transaction context and require active membership for current user. Membership policies are based on user_id and must not recursively query themselves. Use parameterized set_config(..., true) inside the same transaction; never keep tenant state on a pooled connection outside that transaction. Missing context denies access. All repository methods require a transaction/context argument.

Use a narrowly granted bootstrap routine to create business + owner membership atomically when no membership exists. It checks verified user identity and prevents arbitrary owner assignment. Only the API role can execute it. Migration role and account-deletion administration are separate from normal runtime credentials.

Choose the Supabase session pooler for the persistent Node API when direct network addressing is unsuitable; size pg pools against the provider’s total connection limit. Migration connection is separately configured. Verify TLS certificates. If switching to transaction pooling, verify transaction-local context and driver prepared-statement compatibility before promotion. No pooler mode is accepted solely because a basic SELECT succeeds.

## 4. API contract

Base path /v1; JSON; ISO dates. IDs are UUIDs; money strings contain integer paise; quantityMilli is an integer. Every mutation carries Idempotency-Key with a client-created UUID. Edits/corrections carry expectedVersion. Body size and list/date-range limits are explicit.

| Endpoint | Behavior |
|---|---|
| GET /auth/google/start, /auth/google/callback | Backend-managed Google OAuth PKCE/state; verified Supabase callback; rate limited; no passwords or SMTP in pilot |
| POST /auth/mobile-session | Verify Supabase bearer token/session ID and register native app session; cannot reactivate revoked ID |
| POST /auth/refresh, /auth/logout | Web refresh under session lock; revoke session and clear cookie; native logout revokes registered session too |
| GET /me | Owner profile, business/membership, supported API capabilities and session state |
| POST /businesses | Idempotent initial business setup |
| GET/PATCH /business | Settings; expectedVersion for edits |
| GET/POST /customers | Paginated search/create |
| GET/PATCH /customers/:id | Tenant-bound detail/edit |
| POST /customers/:id/archive | Effective date, preview impact and preserve ledger |
| POST /customers/:id/opening-balance | Signed initial balance with cutover date/reason; cannot double-count earlier activity |
| GET/POST /customers/:id/plans | List/create recurring plan |
| POST /plans/:id/revisions | Future-effective quantity/rate/weekday update |
| POST /plans/:id/end, /plans/:id/pauses | End or date-range pause with preview and expectedVersion |
| PUT /plans/:id/overrides/:date | Explicit single-date skip/resume/quantity change |
| POST /schedule/preview | Read-only preview of proposed changes; no writes |
| GET /rounds?date=YYYY-MM-DD | Business round, schedule revision, occurrence versions and sync capabilities |
| POST /deliveries/confirm | Plan/date, outcome, actual quantity, schedule revision, expected occurrence version |
| POST /deliveries/:id/corrections | Required reason, expectedVersion and corrected outcome/quantity |
| GET/POST /receipts | Paginated receipts; new receipt is online-only |
| POST /receipts/:id/reversal | Full reversal once; reason and expectedVersion |
| GET /customers/:id/statement?from=&to= | Reconciled lines, summary, unresolved count, generatedAt, business revision |
| GET /customers/:id/statement.pdf or .csv | Authorized streaming artifact; same snapshot and totals as view |
| POST /account/export, /account/deletion | Authenticated full export/deletion request with reauthentication where sensitive |
| GET /health/live, /health/ready | Liveness; readiness checks DB connectivity/migration compatibility without exposing secrets |

Responses: {data,meta:{requestId,...}}. Errors: {error:{code,message,fieldErrors?,retryable},requestId}. Use 400 malformed input, 401 invalid session, 403 inactive membership/forbidden action, 404 missing or cross-tenant entity, 409 version/idempotency conflict, 422 business-rule rejection, 429 abuse limit, 503 transient dependency failure. No raw SQL errors or tokens in client responses.

Confirmation example:

```json
{"planId":"<uuid>","serviceDate":"2026-10-29","outcome":"delivered","quantityMilli":750,"scheduleRevision":12,"expectedVersion":0}
```

Backend fetches rate; client cannot set it. For ratePaise "6000", chargePaise is "4500". Response includes accepted event ID, new occurrence version, new business revision and server-created ledger entry reference.

## 5. Sessions and browser protections

Web uses a random opaque cookie backed by app_sessions. Encrypt Supabase refresh secrets with a separate rotated server encryption key; serialize refresh attempts per session to avoid refresh-token races. Never use a global mutable Supabase client session across requests. Use request/session-scoped clients with automatic persistence disabled on the server.

Cookie production configuration: host-only __Host-dailyloop_session, Secure, HttpOnly, Path=/, SameSite=Lax. The desktop build and API share one Render HTTPS origin; use same-origin fetch and a host-only cookie. Protect browser mutations with a synchronizer CSRF token and Origin validation. No purchased domain or third-party cookie dependency. If hosting is split later, explicitly validate credentialed CORS and same-site behavior. Local development uses an explicitly separate cookie configuration; never weaken production flags to fix localhost behavior.

Mobile access-token claims must match an active app session. Revoked session IDs cannot be re-registered with the same still-valid JWT. Refresh maintains the same session identity; a new sign-in creates a new one. Handle key rotation and offline expiry; never sync offline writes under a different account after reauthentication.

SecureStore adapter must handle real session sizes and platform persistence differences; do not assume an arbitrarily large JSON value fits as one native secure-store item. Prototype storage with the installed SDK, use a documented encrypted storage adapter if needed, and test reinstall/logout/backup behavior. No biometric prompt is required for background refresh.

## 6. Scheduling and accounting rules

Evaluate schedule(plan, serviceDate, snapshot): recorded occurrence first → active customer/plan lifetime → applicable revision → explicit date override → pause → weekday match. Date override can resume a paused date, not resurrect an ended plan. Missing/invalid revision is an error, not zero-rate billing. Historical records use saved event snapshots.

Positive delivery charge calculation uses exact integer arithmetic: floor((quantityMilli × ratePaise + 500) / 1000). Reverse a saved charge by negating the original paise amount, not recalculating from a later rate. Bounds must be checked for input and aggregates. Reject fractional meals unless product scope explicitly changes.

Ledger sign convention: opening debit/delivery charge/receipt reversal positive; opening credit/receipt/delivery-charge reversal negative. Closing = sum of entries through toDate. Opening = sum before fromDate. Period movement = sum within inclusive dates. Do not add a separate customer balance column.

Corrections post with the original service/receipt effective date; recorded_at is the actual correction time. Historical statements therefore restate after corrections. Previously generated exports remain identifiable by business revision/generatedAt. Version 1 does not lock accounting periods or claim formal tax-invoice accounting.

Opening balance requires an agreed cutover date. Do not also import pre-cutover deliveries/payments already represented by that balance. Correct an opening entry through a reasoned reversal/replacement, never by overwriting it.

## 7. Atomic write and retry algorithm

For business writes, acquire a business-row lock first (consistent ordering); this MVP deliberately serializes writes within one small business. Then:

1. Verify active membership/session and canonical request hash including route/target.
2. Insert/reserve operation key; if the key exists, compare hash and return saved response or reject mismatch. Concurrent duplicate requests wait for the first transaction’s result.
3. Lock affected occurrence/receipt rows; validate expectedVersion and schedule revision against current state.
4. Create immutable event(s); create original/reversal/replacement ledger postings as needed; update only the materialized current pointer/version.
5. Append audit event, increment business revision, save successful idempotency response, commit once.
6. Send response after commit. A network timeout retries with the same key and body.

Any failure rolls back financial entries and idempotency reservation. Completed financial operation IDs are retained for the lifetime of the associated records; purging keys while clients may replay them can duplicate receipts. A correction is a new intended operation with its own key. Use database unique constraints as the final guard.

Full receipt reversal has unique(reverses_event_id) for reversal events; do not allow reversing the reversal via the same endpoint. Delivery correction references the previous accepted event and only succeeds against current version. Corrections are append-only, but privacy erasure is a separate authorized lifecycle that can remove a whole tenant under the declared policy.

## 8. Offline outbox

Local rows: operation_id, user_id, business_id, plan_id, service_date, payload_json, payload_hash, expected_version, schedule_revision, state, attempt_count, next_attempt_at, created_at, last_error. State machine: pending → sending → accepted, retry_wait, conflict or reauthentication_required. An interrupted sending state becomes pending on restart with the original operation key.

Encrypt/protect sensitive cached rows and keep the key in native secure storage; validate Expo SQLCipher/native plugin compatibility in a development build before committing to the adapter. A failed encryption compatibility spike blocks sensitive offline caching, not online domain work. Scope cache keys to environment/user/business. No financial receipts in offline outbox for v1.

Retry only transient network/5xx/429 failures with bounded exponential backoff and jitter; respect Retry-After. Refresh expired auth once, then pause and request sign-in. A 409 or changed plan becomes conflict, not an automatic changed-payload retry. Show original attempt and current server state; user confirmation creates a new operation/key.

Before logout, offer synchronization or explicit discard of unsent work, then purge cached personal data and keys. Never silently lose pending writes or expose the previous owner’s data to the next sign-in. On revoked access, block sync and clear sensitive cache according to policy. OS background execution is not relied on for correctness.

## 9. Reads, statements and exports

Read round/statement data in a consistent database snapshot. Statement response includes business revision and generatedAt from the same snapshot as ledger/occurrence state. Reconciliation tests cover adjustments and unresolved outcomes, not just happy-path totals. Paginate long line histories while ensuring totals cover the full requested period.

API produces PDF from escaped authorized statement data (pdf-lib is the proposed implementation); clients share/download the returned binary. This avoids shipping a headless browser in the API for MVP. CSV fields neutralize formula prefixes and use correct quoting. Apply output filename sanitization and never expose another business’s object path.

If retained, export files are private, expire under a documented retention policy and are recreated from source data where possible. Database backup and Storage backup/restoration remain separate responsibilities.

## 10. Test and rollout design

- Unit: schedule precedence, India dates/month boundaries, integer rounding, credits and reversals.
- PostgreSQL integration: real constraints/RLS under runtime role, cross-tenant IDs, migration from empty DB and upgrade from previous schema.
- Race tests: duplicate confirmations, same receipt key on two connections, conflicting payload under same key, concurrent reversals and rollback on a simulated ledger insertion failure.
- Auth: Google OAuth state/PKCE/callbacks and external pilot-account consent, key rotation, token expiry, revoked app session, cookie/CSRF protection, inactive membership and business bootstrap races. Email/password and SMTP flows are deferred.
- Client: validation/errors, preserved forms, deep links, second-device visibility, account switching and offline restart/reconnect/conflict.
- Operational: restore database plus retained files, compare counts and balances, old mobile API compatibility, delete-account lifecycle and production-config validation.

CI gates (within GitHub Free allowance, otherwise run locally): lockfile install → contracts build → typechecks → domain + PostgreSQL/API tests → desktop build → native bundle checks → browser journeys. Device build smoke tests run on release candidates; Maestro flows must run against staging on Android and iOS before release.

Pilot deployment: test with local/isolated fixtures → migrate using restricted release identity → deploy one free service containing backward-compatible API and desktop build → build Android preview locally or within EAS Free quota → smoke test cold start and safe retries. iOS local/simulator checks continue; paid store distribution and paid always-on hosting remain deferred. No destructive migration ships while N−1 mobile requires it. Monitor rollback indicators for duplicated entries, tenant isolation failure and write errors; disable affected writes if integrity is uncertain.

## 11. Free-pilot execution constraints

The single Render Free service routes /v1 and /auth before desktop static assets and SPA fallback. API 404s remain JSON. Keep frontend/backend source separate. Do not store a live SQLite database, customer uploads or backups on its ephemeral disk.

Google OAuth through Supabase is the proposed pilot sign-in method to avoid SMTP/domain costs. Native PKCE callbacks and backend web OAuth state require real external-account tests. Do not introduce paid email delivery, OTP SMS or a purchased domain as a hidden requirement. Account recovery is through the selected identity provider; later email/password support gets its own verified email setup.

Use manual local backup and deletion/retention commands with operator evidence; no Render paid cron or R2 dependency. Database RLS, safe retries, corrections and recovery rehearsal remain release blockers. Cold-start latency is excluded from the former warm performance target; show a truthful waking state, allow bounded longer read waits and retain mutation operation IDs. No fabricated uptime guarantee.

Release artifacts are web and controlled Android test builds first. Verify off-store developer/distribution rules before shipping APKs. iOS public distribution and both paid store enrollments are later gates, not zero-cost pilot acceptance. CI/native checks must stop or run locally when free allowances end, rather than purchase usage.


## Latest budget and implementation clarification

The owner authorizes paying for Google Play enrollment/publication. Other infrastructure remains free-tier-first; paid-tier upgrades are designed to preserve data, identities and API contracts, and require a later explicit spending decision. Public Android store release is therefore in scope once product and Play testing gates pass, not deferred solely because of enrollment cost. No Apple membership purchase or unrelated paid service is authorized. See SUPABASE_SETUP.md, IMPLEMENTATION_STATUS.md and UPGRADE_PATH.md for the current code increment and upgrade steps.

## M2 implementation decisions

Plan revision rows are append-only with unique effective dates; applicable ranges are derived, not maintained by updating prior rows. Only revisions after the latest stored effective date are accepted for now. Date overrides retain append-only versions; latest planVersion wins for a date. Pause early resume records resume_on, retaining earlier paused days. All mutations serialize on the business advisory lock and reject stale expectedVersion. Customer archive starts inactivity on the selected day; end_on is inclusive. See PLAN_LIFECYCLE.md for the full contract/limits. Opening balances move to M3 with the ledger rather than a parallel mutable balance table.

## M3 implementation decisions

ACCOUNTING.md describes the current API/schema rather than the proposed table names above. Monetary events cover opening/receipt/reversal; delivery corrections append a new version and reversal/replacement postings at the original service date/rate. Opening cutover stays fixed; zero opening corrections are supported. Statements take the same business transaction lock as mutations. Migration 0003 and independent PostgreSQL concurrency verification remain pending live activation; PDF/CSV and offline queue remain M4.
