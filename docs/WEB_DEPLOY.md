# DailyLoop web deployment — free-tier baseline

29 October 2026. Prepared for https://github.com/mohit9889/dailyloop.git. Not proof of a hosted deployment. Do not publish secrets or private backups.

## Git and validation

The project separates desktop/, mobile/, backend/ and packages/contracts/. Git ignores .env, .private, local databases, signing keys, node_modules and build output. The Supabase root CA certificate is public trust material and is included for verified runtime TLS; a private client key must never be committed.

Run regular tests, workspace type checks, the production build and the real PostgreSQL test in the laptop terminal. The owner already reported the M3 independent-connection suite passing. CI repeats it on a standard runner within the GitHub Free allowance. Stop or run locally when allowances are reached; no paid runner/build upgrade is automatic.

Review the initial commit before the authorized first push to main. The repository was previously empty; never use a force push if remote history appears. Public/private visibility is an owner choice—do not change it incidentally.

## Live schema

Create/verify a fresh encrypted backup. Obtain explicit authorization for 0003_accounting.sql and 0004_web_workspace.sql, then run the existing versioned migration runner with the local migration identity. Never configure MIGRATION_DATABASE_URL in the serving deployment. Verify checksums, RLS, narrow runtime grants, retained customers/plans and /health/ready; new accounting/settings are gated until the schema exists. Existing web sessions need a fresh sign-in for account export/deletion requests after the recent-auth migration.

## Render Free setup

Use one Free Node Web Service from the provided GitHub repo/main. Review infra/render.yaml or enter its commands manually. The scoped install/build was tested from a clean temporary checkout and does not install Expo's native tooling. No purchased domain or second always-running host is needed.

- Build: npm ci --include=dev --workspace @dailyloop/backend --workspace @dailyloop/desktop --workspace @dailyloop/contracts --include-workspace-root && npm run build
- Start: npm run start -w @dailyloop/backend
- Health: /health/ready
- Node 24, NODE_ENV=production, HOST=0.0.0.0; Render supplies PORT.
- APP_ORIGIN: exact HTTPS URL shown by Render, without trailing slash. Do not guess an available hostname.
- DATABASE_URL: restricted serving identity, verified TLS using the included CA; never the migration/database owner.
- SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SESSION_ENCRYPTION_KEY: private deployment configuration. Generate the 32-byte key locally; never paste secrets in chat or commit them.
- SUPPORT_EMAIL: replace support@dailyloop.example with a monitored address before external onboarding. MAINTENANCE_MODE normally 0.

Configure Supabase Auth's actual hosted site URL and exact /auth/google/callback redirect; retain explicitly allowed localhost redirects for development. Google's provider callback stays the configured Supabase Auth endpoint. Test the real consent/callback flow at the hosted origin; a working local login does not prove it.

Serve desktop and API from the same provider origin. Do not move DB data or backups onto Render's ephemeral filesystem. Use local operator backups and separate offline custody. Free service sleep/cold-start/quota limits are accepted pilot constraints, not a production uptime guarantee. Avoid artificial keep-alive traffic.

## Hosted acceptance

Verify fresh Google login/logout, expired sessions, customer/plan changes across two owners/browsers, delivery correction, receipt retry/reversal, statement PDF/CSV/full export, support/deletion request history and denied cross-tenant IDs. Use labelled test records; do not invent revenue in an external owner's tenant. Check small desktop/tablet widths, keyboard navigation, browser refresh/back and blocked/slow network states. Confirm no secrets in responses, logs, source maps or Git.

The public web is ready to invite pilots only after real contact/operator identity, hosted verification, offline backup custody, provider Auth restore mapping and recovery/rollback rehearsal are recorded. Observe a complete billing cycle before wider release. Native/offline and Play release gates remain separate.
