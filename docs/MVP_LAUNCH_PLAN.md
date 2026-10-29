# DailyLoop — first MVP implementation and launch plan

Prepared 29 October 2026. Revised budget: free tiers only until later explicit owner approval. Initial rollout is a limited web/Android early-access pilot; Google Play spending is approved; paid Apple distribution and paid always-on infrastructure are deferred. Status: proposed implementation roadmap, based on inspection of the current local code. No deployment, account purchase, store submission or provider contact is included in this planning task.

## Current M0 baseline — 29 October 2026

M0 is complete for implementation planning. The owner selected **tiffin delivery first, retaining milk support**, and supplied the DailyLoop Figma file. [M0 completion record](m0/README.md) governs the current scope, rules, journeys, design inventory and priorities. Earlier prototype assessment and milk-first recommendations below are historical; current implementation evidence is in IMPLEMENTATION_STATUS.md. M1 is implemented with verification gaps; M2 lifecycle is implemented with device validation outstanding and opening balances moved to M3. M3 accounting is implemented locally with migration/verification pending; M4–M6 remain required. See ACCOUNTING.md and M1_M3_STATUS.md.

## 1. Assessment and launch objective

**DailyLoop is currently a functional local prototype. It is not ready to hold real businesses’ delivery and payment records.** Preserve the working rules, original branding, and separated applications; build the missing production capabilities around them.

The first MVP should let a small delivery business owner set up their business, maintain customers and recurring plans, reliably record a daily round, correct mistakes with a history, record receipts, and issue a statement that reconciles. Their phone and desktop must show the same business records, securely, even after a restart or device change.

### Evidence from the repository

| Area | Current implementation | What prevents launch |
|---|---|---|
| Mobile | Native React Native/Expo app; customer, plan, round, payment and statement views | No authentication, native device verification, offline handling or signed installable release |
| Desktop | React/Vite app; working basic flows and browser print | Provisional UX; limited navigation and account settings; no production API configuration |
| API | Node HTTP server with local endpoints | No user/session verification or business authorization; localhost origin checks are not authentication |
| Database | One SQLite file; four tables | No users/business ownership, migration system, production recovery or managed hosting setup |
| Scheduling | Start date and weekdays; multiple independent plans | No effective-date edits, end dates, pause ranges or one-day overrides |
| Deliveries | Actual quantities, skipped/missed outcomes and duplicate plan/date protection | No corrections, actor history, safe multi-device conflict workflow or retry contract |
| Payments | Manual cash/UPI/bank receipts | A repeated request can create another receipt; no reversal, audit history or opening-balance setup |
| Statements | Recorded charges, receipts, calculated opening balance, pending-stop count | No opening balances from a previous paper ledger; no native PDF sharing or correction-aware ledger |
| Quality | Six domain/persistence tests in backend/tests/store.test.ts | No API authorization, concurrent writes, mobile runtime, recovery or full billing-cycle test coverage |
| Delivery operations | Development commands and successful earlier builds/bundles | No CI pipeline, staging/production separation, operational alerts, rollback or store configuration |

Files reviewed: backend/src/server.ts, backend/src/store.ts, backend/tests/store.test.ts, desktop/src/App.tsx, desktop/src/api.ts, mobile/App.tsx, mobile/src/api.ts, mobile/app.json, workspace manifests and development documentation. Existing passing builds and bundle exports show packaging progress; they do not prove production or native runtime readiness. The earlier dependency audit is a recorded finding, not a fresh security clearance.

## 2. Scope to freeze for version 1

### Target and rollout recommendation

The owner selected owner-operated **tiffin delivery** for the first pilot, with independent lunch/dinner plans. Retain milk support and validate its litre precision and scheduling scenarios before advertising that capability. This supersedes the original milk-first recommendation.

One owner per business for version 1; no delivery staff roles or customer login. Support INR and Asia/Kolkata explicitly. Keep Android and iOS in the mobile project. Validate both, but allow Android public release before iOS if store readiness differs; desktop can launch independently after its release gate.

### Included

- Owner verified identity via Google OAuth/Supabase, session recovery/sign-out and business setup; no paid SMTP/SMS requirement.
- Secure business isolation and synchronized phone/desktop access.
- Customer create/edit/archive, search, delivery address, optional phone and opening debit or credit.
- Multiple plans per customer: morning/evening milk or lunch/dinner tiffin, weekdays, quantity, rate, start/end dates and future-effective revisions.
- Pause/resume over a date range; single-date skip or quantity change; preview before saving.
- Daily round with actual quantity, delivered/skipped/missed status, progress and previous-day review.
- Append-only delivery corrections and receipt reversals with a required reason and actor/time history.
- Cash, UPI and bank receipt recording, partial payments, advance credit and outstanding balances. These are manual bookkeeping entries, not payment processing or bank verification.
- Reconciled statements with unresolved-stop warnings, opening/closing balances, CSV export and PDF viewing/sharing/printing.
- Mobile cached round and a bounded offline queue for delivery outcomes, with clear pending/conflict states. Financial receipts and corrections require a connection in version 1.
- Account settings, support, data export, account deletion flow, operational backup and tested restore.

### Deferred

Customer self-service, staff dispatch, route optimization, location tracking, online collections, bank integrations, automatic WhatsApp/SMS, water-container returns/deposits, prepaid meal packages, tax invoices/GST accounting, multiple currencies, extensive analytics and complex subscriptions. Do not add these to the release path without revisiting scope.

A commercial subscription checkout is not required for a free controlled pilot. Before charging for app access, decide the business model and review store payment rules for that specific model; do not bolt a payment link into the mobile app without that review.

## 3. Production architecture and project boundaries

Retain the existing application choices:

- **mobile/**: Expo React Native, native navigation, platform controls, secure session storage and local delivery queue. No HTML/WebView replacement.
- **desktop/**: React/Vite, routed screens, accessible forms, session handling and statement print/export.
- **backend/**: TypeScript Node API, validated request/response schemas, business authorization, scheduling, ledger, database migrations and operational jobs.
- **packages/contracts/** (new): shared API schemas and generated types only. Neither frontend imports database or backend service code.
- **docs/**: product rules, API contract, data model, release checklist and operational instructions.

Recommendation: use Supabase Free PostgreSQL/Auth and one Render Free Web Service serving the separately built desktop frontend and API from one HTTPS provider origin. Use local development/staging, GitHub Free and local/EAS-Free native builds. No purchased domain, Vercel Hobby commercial deployment, paid SMTP, paid monitoring, cron or store enrollment is required. HLD.md and PLATFORM_READINESS.md define the revised zero-spend baseline. Accept disclosed cold starts and limited free-tier availability for the pilot; do not promise paid-service reliability.

SQLite is suitable for a local application and is not itself proof of a demo. The PostgreSQL recommendation is for managed recovery and concurrent hosted usage. Move through explicit, tested migrations rather than replacing the file and losing records. Inventory any real local records before migration; never import QA data as customer revenue.

### Minimum data model

Users/identity references → businesses → memberships (owner only initially). Every business entity carries a business ID. Add customers, opening balance entries, plans, plan revisions, pause ranges, date overrides, delivery records/events, receipt/reversal events, ledger entries, idempotency records and audit events. Add statement export metadata and privacy/deletion request records where necessary.

Derive the active business from authenticated membership. Never authorize a request merely because it contains a customer ID or business ID. Enforce ownership on every read and write, including exports and file downloads. Where available, database row policies provide an additional boundary; API checks remain required.

Persist integer paise and thousandths of a litre. Confirm whole-meal quantities for tiffin unless fractional meals become an explicit requirement. Store timestamps in UTC and service dates as business-local dates. Index business/date/customer and enforce unique delivery occurrence and idempotency constraints in the database.

## 4. Build milestones and exit criteria

Estimates are engineering effort for one experienced developer with timely product decisions, not promised calendar dates. They include implementation and focused testing. Infrastructure access, design availability, device issues, pilot observation and store review can extend elapsed time.

| Order | Milestone | Deliverables and concrete exit criterion | Effort |
|---|---|---|---|
| M0 | Freeze product and design baseline | Completed: tiffin-first scope, billing rules, screen inventory, decision log and accessible owner-selected Figma reference. See m0/README.md. Preserve original logo. | 2–3 days |
| M1 | Secure hosted foundation | Managed identity, business setup, PostgreSQL migrations, validated API contracts, staging, CI and session handling. Two test owners cannot read or alter each other’s records through any endpoint. | 5–7 days |
| M2 | Customer and recurring-plan lifecycle | Edit/archive customers, imported opening balances, plan revisions, end dates, pauses and date overrides in both clients. Schedule preview agrees with domain tests and historical charges remain unchanged. | 5–7 days |
| M3 | Reliable delivery and accounting | Transactional delivery events, version checks, idempotent receipts, reasoned corrections/reversals and ledger-based statements. Concurrent/retried requests produce one intended result. | 6–8 days |
| M4 | Complete everyday mobile and desktop UX | Screen refactor, native dates/navigation, search/filter, cached round, offline delivery queue, conflict review, PDF/CSV and accessible error/loading/empty states. Core journeys pass on actual Android and iOS devices and desktop. | 6–9 days |
| M5 | Recovery and release hardening | Production configuration, privacy/account deletion, support, monitoring, dependency review, load checks, backup/restore rehearsal and rollback rehearsal. All release gates below pass. | 4–6 days |
| M6 | Controlled pilot and release | Web and controlled Android test-build pilot, owner onboarding, observed billing cycle and fixes. Google Play public release follows product/testing gates; Apple release requires a later funding decision. | 3–5 engineering days plus pilot/review time |

**Total planning envelope: 31–45 engineering days**, roughly 7–9 working weeks before allowing for a full billing-cycle pilot and external reviews. Re-estimate after M1. M6 release preparation can overlap M4/M5; its validation cannot be skipped. Do not announce a firm launch date before a staging build and store-account requirements are known.

### M0 — decisions and design baseline

Write the primary journey: set up business → add customer/opening balance → create plan → change a day → confirm actual delivery → record receipt → share statement. Catalogue mobile and desktop screens, including failures and recovery. Use the existing Figma file when readable; the current quota limitation blocks a claim of exact matching, but does not block backend work.

Write examples for rate changes, pauses, missing outcomes, credits and corrections. Decide which service gets the first real pilot. Create a prioritized backlog tied to the acceptance matrix, not a list of cosmetic screens.

### M1 — secure foundation

Separate HTTP routing, authentication, validation, domain services and persistence from the current compact server/store files. Replace untyped database records with explicit models. Introduce versioned migrations, test fixtures, environment validation and API documentation.

Add owner onboarding, Google OAuth verified sessions and provider-based account recovery. Use secure mobile credential storage and appropriate browser session protections; never store secrets in EXPO_PUBLIC variables. Cover token expiry, logout, business membership and denied requests. Configure HTTPS staging, exact browser origin policy, abuse controls and redacted logs.

CI must install from the lockfile, typecheck every workspace, run domain/API tests, build desktop and validate mobile bundles. Keep staging and production databases, secrets and analytics separate. Domain and authorization tests run on every relevant change.

### M2 — lifecycle and scheduling

Implement changes as effective-date revisions. A rate change tomorrow cannot recalculate yesterday’s recorded charges. Customer archiving stops future scheduling and retains statement history. Opening debit/credit is a dated ledger entry, with an explanation, rather than a hidden mutable customer field.

Define scheduling precedence in one backend function shared by round previews and confirmations: confirmed occurrence remains as recorded until corrected; otherwise an ended/archived plan is inactive; an explicit one-day override outranks a pause; a pause outranks normal weekdays; the applicable plan revision supplies quantity/rate. An override can resume a paused date but cannot silently reactivate an ended plan. Any exception requires an explicit supported action.

Show the affected dates and expected quantities before a bulk pause or revision is saved. Use clear service labels, e.g. “Morning milk” and “Dinner,” instead of ambiguous generic slots.

### M3 — delivery, receipts and statements

Write delivery confirmation and its financial entry in one transaction. Snapshot quantity, rate, unit, slot and service date so future edits do not rewrite history. Unique occurrence keys and database transactions enforce duplicate protection; return an explicit conflict when two devices change the same occurrence.

Both clients send a stable idempotency key for each intended write. Retrying a timed-out receipt returns the first result rather than adding a second payment. Reject reuse of the same key with different content. Confirmations and corrections include an expected version to prevent stale overwrites.

Use append-only correction events. A receipt reversal references the original receipt, retains who/when/why, and cannot reverse the same amount twice. A delivery correction reverses the previous charge and records the replacement; it does not erase the original event.

Calculate statement totals from ledger entries. Show opening + charges + adjustments − receipts + receipt reversals = closing balance. Show credits with the correct sign. Identify unresolved deliveries as provisional and exclude their estimated value. Revised exports carry generation time/version so a corrected statement is distinguishable from an older copy.

### M4 — complete both clients

Split the large App components into screens, focused forms, hooks and platform UI components. Keep shared data contracts aligned without mixing frontend code. Add customer/plan edit flows, review screens, settings and meaningful per-field validation. Preserve form values on save failure.

Use native date inputs and navigation in mobile; support back gestures, keyboard avoidance, safe areas, large text and screen readers. Replace long customer-chip lists with searchable selectors. Test smallest supported screens and iOS/Android keyboard differences.

For disconnected field work, cache the selected round and queue only delivery outcomes with durable operation IDs. Show “pending sync” separately from “saved.” Reconnection must reconcile stale plans and prior confirmations; financial totals use server-accepted records only. Pending operations must survive an app restart and remain scoped to the correct account. Clear or protect caches on logout.

Generate PDF/CSV from the same authorized statement data. Mobile uses native share; desktop uses download/print. Treat CSV values as data to prevent spreadsheet formula execution. Keep export links private and short-lived if stored remotely.

### M5 — operational readiness

Test backup restoration into a separate environment and compare customer counts, event counts and ledger totals. Free-pilot recovery target: no more than 24 hours of lost committed data only while encrypted daily owner-run exports actually complete. Keep a second offline copy and test restore. Four-hour recovery and always-on availability are not guaranteed by this free architecture; record actual restore time and disclose limits. A backup checkbox without a successful restore is not a release pass.

Use free provider dashboards, redacted errors, operator health checks and daily backup-age review. Add optional free alerts only after verifying no-overage settings; no paid monitoring or artificial keep-alive traffic. Exclude customer addresses, tokens and full financial payloads from routine logs. Define an incident contact and instructions for disabling risky writes during an incident.

Configure the single provider HTTPS origin, environment secrets, migrations and health checks. Rehearse rollback on staging; database migrations must remain compatible with the previous mobile release because users do not update simultaneously. Audit dependencies again, remediate reachable high/critical issues and document any assessed exceptions with an owner and follow-up date.

### M6 — pilot and distribution

Prepare confirmed unique bundle IDs, Android local signing, Expo development/preview profiles and installable test APKs. Keep iOS simulator/local-device development in scope. Google Play enrollment/publication is approved and needs Play testing/signing completion. Apple enrollment/IPA store distribution remain deferred pending separate authorization. Current JavaScript bundle exports are not store-ready apps. Test fresh installation, upgrades, expired sessions and API compatibility on real devices.

For the free pilot prepare original-brand assets, support/privacy/account deletion pages on the free provider origin, test-build instructions and distribution-requirement checks. Store descriptions, ratings, review accounts and submission become a later paid-distribution checklist; no developer membership purchase in this phase.

Run a controlled pilot with a proposed 3–5 owner-operated businesses, after separate authorization to contact/invite them. Observe one complete billing cycle, including period closing. Reconcile DailyLoop statements against their agreed source records; investigate every unexplained difference. Do not present test entries as business revenue.

Begin wider availability only after pilot gates pass. Use supported staged rollout controls, watch errors, duplicate writes and support reports, and pause rollout if data integrity fails. Keep a monitored support channel and a documented rollback path.

## 5. Release acceptance matrix

All launch blockers below must pass with recorded evidence. Existing six tests are a starting point, not this full suite.

| ID | Required evidence |
|---|---|
| AC01 | Owner can sign in through verified Google OAuth, recover identity-provider access and sign out; expired/revoked sessions fail safely on both clients. |
| AC02 | Business A cannot access B’s customers, plans, deliveries, receipts, statements or exports using guessed IDs or changed request bodies. |
| AC03 | A newly saved customer appears on the second device after refresh; setup, edits and opening debit/credit survive restart. |
| AC04 | One customer has independently scheduled morning/evening or lunch/dinner plans without duplicate stops. |
| AC05 | A future rate/quantity revision affects the intended date onward; earlier recorded charges and descriptions remain stable. |
| AC06 | Pause, resume, end date, weekdays and date override precedence match the reviewed schedule preview, including month boundaries. |
| AC07 | Actual partial quantities produce the agreed paise rounding; missed/skipped outcomes produce no charge; future confirmation is rejected. |
| AC08 | Two simultaneous confirmations and timed-out retries cannot produce duplicate delivery or ledger entries. |
| AC09 | A reasoned delivery correction retains the original and reconciles the changed charge once. |
| AC10 | Partial/advance receipts reconcile; retrying a receipt request records one payment, and reversal preserves an audit trail. |
| AC11 | Monthly statement reconciles opening, charges, adjustments, receipts, reversals and closing; unconfirmed past stops remain visibly provisional. |
| AC12 | PDF, CSV, desktop view and mobile view show the same figures; exports are private and include business/customer/period identity. |
| AC13 | Offline delivery confirmation survives restart, syncs once, and presents a conflict instead of overwriting a server-confirmed outcome. |
| AC14 | Complete onboarding-to-statement journeys pass on physical Android and iOS devices, including large text, keyboard and network interruption. |
| AC15 | Production-like backup restores successfully into a separate environment within the agreed recovery targets. |
| AC16 | Free-budget CI/local checks, provider/manual monitoring, privacy/account deletion, support, Android test signing and migration/rollback rehearsals pass. Paid store declarations are deferred to store release. |
| AC17 | Pilot owners complete a billing cycle with no unexplained balance differences, no duplicate charges/receipts and no unresolved critical defects. |

Initial performance target for testing: 500 active customers, 1,000 daily plan occurrences per business, 12 months of history and multiple simultaneous sessions. On staging, target a round load under 2 seconds at the 95th percentile and saved writes under 1 second on a stable connection. These are proposed acceptance targets, not measured capacity claims; adjust the agreed limit or optimize before advertising larger scale.

## 6. Launch dependencies and owner decisions

Resolve early, without blocking independent engineering:

| Decision/input | Needed by | Working recommendation |
|---|---|---|
| Primary pilot segment | M0 — resolved | Tiffin first; retain milk support |
| Launch geography, currency, language | M0 | India, INR, English and Asia/Kolkata initially; verify with intended owners |
| Platform order | M0/M4 | Desktop + Android first public release if needed; iOS remains in scope and is device-tested |
| Backend/identity provider, region and spending ceiling | M1 | Supabase Free + Render Free; spending ceiling ₹0; verify limits and availability |
| Figma access or approved interim baseline | M0/M4 | Preserve original identity; obtain design context before claiming exact fidelity |
| Developer account type and ownership | Before later store release | Defer paid enrollment; confirm off-store test distribution rules now |
| Support identity, policy details, domain and deletion handling | M5 | Simple public support/legal pages and one accountable operator |
| Pilot invitation and contact authorization | M6 | Existing no-contact boundary remains until explicitly changed |
| Pricing after pilot | Before paid launch | Validate value and support cost; review distribution/payment rules before implementing monetization |

## 7. External distribution constraints checked

- Expo’s release guidance distinguishes signed Android/iOS binaries from JavaScript exports. EAS Submit or manual console upload still leads into each store’s testing and review process: https://docs.expo.dev/deploy/submit-to-app-stores/
- Google currently requires qualifying new personal developer accounts to run a closed test with at least 12 testers opted in continuously for 14 days before applying for production access. A small business pilot alone may not satisfy this distribution requirement: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
- Apple requires accessible privacy-policy information, working review access/backend and, where account creation exists, an in-app account deletion flow. Implement these before submission: https://developer.apple.com/app-store/review/guidelines/ and https://developer.apple.com/support/offering-account-deletion-in-your-app/

These are planning constraints checked on 29 October 2026, not a complete legal or store-policy review. Recheck applicable console requirements immediately before release.

## 8. First implementation batch

The next coding increment should be **M0 + the beginning of M1**, not additional demo screens:

1. Freeze the MVP scope and scheduling/accounting examples in project documents.
2. Establish typed API contracts and versioned database migrations.
3. Add authenticated users, businesses and owner membership with denied-access tests.
4. Migrate customer/plan endpoints to the business-scoped model and preserve validated local records.
5. Connect mobile and desktop login/onboarding to staging with secure session handling.
6. Add CI and demonstrate: owner A creates a customer, sees it on phone/desktop, and owner B cannot access it.

That demonstration is the first meaningful production milestone. Continue to M2 only after its data-isolation checks pass. Track implementation progress against the milestone exit criteria and AC01–AC17; do not describe the full MVP as complete merely because screens render or bundles build.

## 9. Implementation design package

The proposed default providers and implementation details are now documented in [HLD.md](HLD.md), [LLD.md](LLD.md) and [PLATFORM_READINESS.md](PLATFORM_READINESS.md). Use this package for M0/M1 setup and record any provider or architecture changes before implementation. Supabase Free + one Render Free service + GitHub Free + local/EAS-Free builds is the revised baseline; cloud setup remains unverified and no paid resource has been provisioned.

## 10. Free-tier launch policy (latest owner instruction)

The initial target is a controlled pilot, not a guaranteed always-on public service. Retain all tenant security, financial-correction, idempotency and restore gates. Cloud idle/usage caps and native distribution limits are explicitly disclosed in HLD.md. Approximately 3–5 business owners is the first operating cohort; review at 70% quota or first 10 active businesses, not an automatic paid conversion. A delivery customer is not necessarily an authenticated app user.

No automatic upgrades, trials, overage charges or paid resource creation. At a free limit, reduce usage, wait for reset, run locally or seek a later owner decision. Use manual encrypted daily backups plus an offline copy; no managed-backup/cron promise. Public Google Play/App Store distribution remains later because enrollment can require fees; do not advertise it as included in a zero-spend launch.


## Latest budget and implementation clarification

The owner authorizes paying for Google Play enrollment/publication. Other infrastructure remains free-tier-first; paid-tier upgrades are designed to preserve data, identities and API contracts, and require a later explicit spending decision. Public Android store release is therefore in scope once product and Play testing gates pass, not deferred solely because of enrollment cost. No Apple membership purchase or unrelated paid service is authorized. See SUPABASE_SETUP.md, IMPLEMENTATION_STATUS.md and UPGRADE_PATH.md for the current code increment and upgrade steps.
