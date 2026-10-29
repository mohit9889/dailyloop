# M3 delivery and accounting increment

29 October 2026. Implemented locally in API, desktop and native mobile. Not yet applied to the live Supabase project; not a completed M1/M2/M3 release sign-off.

## Included

- Paginated business daily round, selected service date, planned/saved status and customer details.
- Actual delivered/skipped/missed outcomes, exact integer-paise charges, whole meals and 0.001 litre precision. Future confirmations and unscheduled charging rejected.
- Immutable delivery snapshots (label, unit, rate, revision, actual quantity, actor/time/reason) and increasing occurrence versions. Corrections replace actual quantity/outcome using the original saved rate, with reversal/replacement postings. Price changes never rewrite accepted charges.
- Opening debit/credit and zero opening, fixed cutover date, versioned reversal/replacement corrections. Pre-cutover receipts/deliveries are rejected to prevent double counting; cutover cannot be moved after creation or placed after an existing earlier transaction.
- Manual cash/UPI/bank receipts, partial receipts, advance credit, repeat-safe saves, full reversal once, retained history. Does not collect money or verify bank transactions.
- Period statements with full-period totals independent of entry pagination: opening + charges + adjustments − receipts + receipt reversals = closing. Signed opening corrections are adjustments. Negative closing is customer credit.
- Past unresolved scheduled deliveries are counted and excluded from revenue. Today/future pending stops are not included in the “past unresolved” count. Dates before the cutover are excluded from unresolved counts.
- Before-save reviews, reasons, retry-stable operation IDs, expected versions, stale-schedule rejection and explicit refresh in both clients. Native financial writes require a live request; no offline financial queue is introduced.

## Schema and transaction boundaries

Migration: backend/migrations/0003_accounting.sql. Adds delivery_occurrences, delivery_events, money_events, opening_balances and ledger_entries, plus supporting tenant/customer uniqueness on plans/revisions. Existing migrations stay checksum-identical. No existing customers/plans are deleted, reset or automatically charged.

Every new table has business RLS, tenant composite foreign keys and narrow runtime privileges. History/postings have SELECT/INSERT, no UPDATE/DELETE. Occurrence and opening pointers have column-limited updates. Unique business/plan/date, occurrence/event version, previous-event and reversal constraints provide additional duplicate protection.

Reuse the existing per-business transaction advisory lock for all accounting mutations. In one transaction: authorize business, lock, verify operation hash and expected state, append events/postings, update current pointer/version, append audit, bump business revision, save replay response. Audit failure rolls everything back. Same operation ID/body returns the original response; a changed payload or stale version conflicts.

Statement/round reads take the same transaction lock and refresh business revision after acquiring it. Financial lines and totals therefore represent the same accepted state. Amounts remain decimal integer strings in JSON; rounding uses BigInt once per occurrence. Reversals negate the saved charge/amount.

Bounds: quantity at most 100,000 units, rate at most ₹100,000 per unit, individual financial amount at most 1,000,000,000,000 paise. Financial dates from 2000 through today; statement/receipt windows at most 366 inclusive days. Round pages scan 100 plans; ledger/receipt/history pages are bounded with cursors. Round history is batch-loaded; a page can contain no eligible stops but still have more plan pages. Aggregate totals use database sums and integer strings.

## API

All endpoints use the existing verified session/membership boundary; browser writes require CSRF + Origin and mutations require UUID Idempotency-Key.

- GET /v1/rounds?date=&after=
- POST /v1/deliveries/confirm
- POST /v1/deliveries/:id/corrections
- GET /v1/deliveries/:id/history?after=
- POST /v1/receipts
- POST /v1/receipts/:id/reversal
- POST /v1/customers/:id/opening-balance
- GET /v1/customers/:id/receipts?from=&to=&after=&limit=
- GET /v1/customers/:id/statement?from=&to=&after=&limit=

/v1/me advertises features.accounting only when the ledger schema exists. Clients hide accounting controls in unmigrated environments; endpoints return MIGRATION_REQUIRED. Customer/plan flows keep working. PDF/CSV and native sharing remain M4, not implied by statement viewing.

## Verification evidence

- 30 regular tests pass: 10 new accounting tests, 14 foundation/auth/lifecycle tests, six retained legacy SQLite regressions. Legacy tests do not count as production ledger coverage.
- New tests cover exact rounding, zero-charge outcomes, statement arithmetic, advance credit, full receipt reversal once, opening correction to zero, retries/payload mismatch, stale writes, tenant denial, SQL history permissions/composite keys, audit rollback, paused/override service, whole-meal/date/cutover rules, all-page totals, migration gating and a synthetic historical month-to-date reconciliation. A real pilot billing cycle remains M6.
- All workspace typechecks, production build and Android/iOS JavaScript/Hermes exports pass.
- Isolated browser test verified lunch confirmation/review/save at ₹90, receipt/review/save at ₹50 resulting in ₹40 due, then full receipt reversal restoring ₹90 due with both events retained. Uses in-memory synthetic data only.
- Real PostgreSQL independent-connection suite is provided in backend/tests/postgres.integration.ts. It upgrades a pre-existing customer/plan from 0002 to 0003, tests runtime RLS and races for customer/delivery/receipt retries, conflicting corrections and double reversals. Here it failed before starting PostgreSQL because the execution environment denies shmget/shared memory. It is NOT recorded as passed. CI configuration now invokes it, but no hosted CI run has occurred.

## Finish M1/M2 validation before live accounting activation

From the laptop's own terminal, outside this execution environment:

    cd /Users/mohit/Work/dailyloop
    npm run test:postgres -w @dailyloop/backend

The command creates a disposable loopback-only PostgreSQL process with random credentials under the temporary folder, applies migrations there, then stops/removes that fixture. It does not load .env, touch Supabase or create OS users. Node dependencies include the open-source test-only embedded-postgres runtime. A shared-memory failure inside Codex is an environment limitation, not a concurrency pass. Record the actual terminal result before signing off multi-connection integrity.

Also verify Google login/logout/expiry and M2 pause/override/date-picker behavior on physical Android/iOS, plus two real identities on independent devices against the configured project. These checks remain open; simulator/device behavior cannot be inferred from bundle export.

## Live rollout — pending

Read-only Supabase preflight confirms migrations 0001/0002 match their applied checksums and 0003 is pending. No live financial records are added by this increment. After the independent-connection test and owner authorization for migration 0003, use the existing migration runner, verify runtime grants/RLS/readiness, restart API, then refresh clients. No additional paid service is required. Preserve restricted serving credentials and verified TLS.

A migration alone enables features.accounting, so do not apply it as an incidental deployment before the verification/authorization step. Do not manually insert test financial postings into live data as a demonstration. Store/public pilot, backups/restore, privacy and M4 offline/export gates remain separate.
