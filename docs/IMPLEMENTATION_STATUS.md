# DailyLoop implementation status

29 October 2026. M0 planning baseline complete; M1 foundation and M2 lifecycle implemented with verification gaps. M3 accounting is now implemented locally with rollout/verification pending; M4–M6 remain. This is not a completed MVP or launch readiness claim.

See [M0 completion record](m0/README.md) for the owner-selected tiffin-first scope, Figma reference, journeys, rules and design backlog.

## Implemented

- Shared Zod API schemas in packages/contracts.
- Fastify app factory separate from server startup; structured validation/errors, body/rate limits, security headers and readiness checks.
- Versioned PostgreSQL foundation migration and checksum-verified migration runner.
- Restricted serving role; tenant membership, SQL RLS policies and tenant/customer audit records.
- Google OAuth PKCE integration, verified asymmetric JWTs, encrypted web refresh secrets, HttpOnly session cookies, CSRF and server-side application session revocation.
- Native session registration and chunked native secure-session storage; preview vs production app configuration.
- Owner business setup; paginated customer search/detail/create; repeat-safe customer creation with operation keys, request hashes and audit transaction.
- New desktop/native sign-in, setup and customer-register interfaces retaining the original logo.
- Single Render Free service blueprint, repository CI configuration and EAS build profiles.
- Exact private setup instructions and free-to-paid upgrade plan. Google Play spending exception recorded; no store enrollment performed.
- Supabase’s official PostgreSQL skill installed at .agents/skills/supabase-postgres-best-practices and applied alongside existing React/UI review skills.

## Evidence and limits

Automated suite: signed JWT validation (signature/issuer/audience/expiry/session), RLS/API isolation for two owners including guessed IDs, retry protection, setup/validation behavior, revoked native sessions, web CSRF/logout, encryption tampering and the six existing legacy billing scenarios. Embedded PostgreSQL is used because no Docker/PostgreSQL command was available in the workspace. It validates SQL/RLS but serializes transactions; it is not proof of production multi-connection races or Supabase role/pooler setup.

Desktop browser QA uses an explicitly guarded local test fixture, synthetic identity and in-memory test database. Verified sign-in callback flow, business setup, customer form, save and page reload. This tests application wiring, not Google's real consent/callback service. Saved QA screenshot is labelled with test business/customer data.

Latest verification: 30 regular tests passed (10 new accounting, 14 foundation/lifecycle/auth and six legacy SQLite regressions); all four workspace typechecks passed; compiled backend and desktop builds passed; Android and iOS JavaScript/Hermes bundle exports passed. Physical-device login/storage, live key rotation, live refresh-token race behavior and release signing are still required. No signed AAB/IPA or cloud deployment is claimed.

## Next required work

1. Close M1 live verification: physical native Google callbacks, two-owner/second-device isolation, expired sessions and independent-connection concurrency. Supabase configuration, verified runtime TLS/readiness and migrations 0001/0002 are already complete; the owner verified local browser Google login/logout.
2. Validate M2 lifecycle/date-picker behavior on physical devices; rebuild native development binaries for the date-picker module.
3. Complete M3 rollout: implementation is local; run the real PostgreSQL independent-connection test outside this execution environment (shared memory is blocked here), obtain owner authorization for migration 0003, verify it live and restart the API. See ACCOUNTING.md.
4. Complete M4 offline delivery sync/conflicts, missing design states, PDF/CSV and device journeys.
5. Complete M5 backup/restore, privacy/deletion/support, dependency review and rollback; deploy/validate the selected free hosting baseline.
6. Run M6 signed Android pilot, observe a complete billing cycle, then satisfy Google Play release gates. No paid Apple distribution is authorized.
7. Inventory old SQLite records only if a real-data import is requested; no automatic prototype import. The owner explicitly authorized five [TEST] customers and seven meal plans in their existing Supabase business for testing, with future quantity/pause/skip scenarios. These are not real customer financial records.

## Dependency audit

The two newly introduced backend advisories were resolved by updating @fastify/static and drizzle-orm to patched versions. The last recorded whole-repository audit reported 8 findings (3 high, 5 low), traced to Expo tooling/transitive zod/deepmerge. Application contract validation uses a separately resolved patched Zod version. Do not force-downgrade Expo to clear the report; assess compatible upstream fixes before release.

## Recurring-plan lifecycle increment

Local customer editing/archiving, multiple recurring plans, immutable effective-date revisions, pauses/resumption, single-date overrides, end dates, schedule previews and desktop/native interfaces are implemented. See PLAN_LIFECYCLE.md for rules, evidence and rollout. Live migration 0002 was applied after explicit owner approval. Restricted-role readiness and RLS on all four plan tables were verified, and the local API restarted. Plan entry points remain gated automatically in environments without the schema. Opening balances are sequenced with M3 ledger work. User-reported local Google login/logout is verified; native/device and two-live-owner checks remain separate.

## Interface refresh

Existing desktop and native screens now follow the owner-authorized M0 Figma direction with UI/UX Pro Max guidance, consolidated semantic colors, clearer customer/plan cards, readable text and larger controls. See UI_REFRESH.md. Workspace typechecks, production build and Android/iOS exports passed; isolated customer/plan review/save browser QA passed. Exact Figma matching and physical-device checks remain open. This adds no delivery or accounting capability.

## Delivery and accounting increment

M3 API and desktop/native screens are implemented and isolated-tested. See ACCOUNTING.md and M1_M3_STATUS.md. Migration 0003 remains unapplied to Supabase; feature gating preserves customer/plan functionality. The separate real PostgreSQL concurrency check failed to start due to denied shared-memory access here and is not counted among the 30 passing regular tests. No physical-device pass, cloud deployment, hosted CI pass, financial production readiness or MVP completion is claimed.

## Web completion increment

Web online-MVP features now include PDF/CSV, full private JSON export, settings, support/deletion requests, recent-sign-in protection, refresh-safe navigation and pending financial-operation recovery within a tab. 39 regular tests, workspace types, production/clean scoped web builds pass; selected web production dependency audit has zero findings. The owner reported the real PostgreSQL concurrency suite passing from their own terminal. Encrypted pre-migration live snapshot and isolated restore digest were verified. See WEB_MVP.md, OPERATIONS.md and WEB_DEPLOY.md.

Migration 0003/0004 application and initial GitHub push remain owner-approval steps. Public hosting is not yet deployed; real support contact (currently a reserved placeholder), hosted/two-live-owner verification, operator/offline key custody and pilot-cycle evidence remain publication gates. No live account was erased. Native Expo audit findings and physical/offline native work remain separate.
