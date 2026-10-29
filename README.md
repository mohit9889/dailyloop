# DailyLoop

Owner workspace for recurring milk and per-delivery tiffin businesses. This repository is moving from the original local prototype to the first secure MVP.

## Project structure

- `mobile/`: native React Native + Expo Android/iOS application.
- `desktop/`: React + Vite browser frontend.
- `backend/`: Fastify/Node API, PostgreSQL migrations, authentication and tenant services.
- `packages/contracts/`: shared validation and API contracts; no database implementation in frontends.
- `docs/`: HLD, LLD, launch roadmap, setup and upgrade instructions.
- `infra/`: single-service Render Free deployment blueprint.

Original DailyLoop branding is preserved in both frontend asset folders.

## Run

Requires Node.js 24+. From the project root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The backend is at http://127.0.0.1:4000. Without secure project configuration, the app shows a connection-pending screen and business endpoints stay unavailable. This is intentional; there is no automatic unauthenticated fallback.

Follow [Supabase setup](docs/SUPABASE_SETUP.md), copy the supplied backend/mobile `.env.example` files into private `.env` files, configure your Free project and apply migrations. Do not paste secrets into chat or commit them. The API serving connection must use the restricted role, not the migration owner.

Native development:

```sh
npm run mobile
```

Custom Google OAuth callbacks require a development/preview native build; Expo Go alone does not validate them. Android/iOS simulator addresses and hosted setup are in the guide. Physical-device auth/storage checks remain required.

## Validation

```sh
npm run build -w @dailyloop/contracts
npm run typecheck
npm test
npm run build
npm run mobile:bundle
```

Backend tests exercise signed JWT verification, PostgreSQL RLS using an embedded PostgreSQL engine, session revocation, CSRF, business/customer isolation and idempotent customer creation. The six earlier SQLite billing tests remain as legacy domain regressions. Native export produces JavaScript/Hermes bundles, not installable store releases.

The new server exposes `/health/live`, `/health/ready`, `/v1/setup`, authentication and business/customer endpoints. Old `/api` prototype routes are not served. The local SQLite database has not been modified or imported. Legacy UI/store source remains available for subsequent feature migration; it is not a second production path.

## Current milestone

Secure foundation and customer register are implemented locally. Live Supabase/Google configuration, native device validation and independent-connection race tests remain before M1 sign-off. Recurring plans, audited delivery corrections, ledger-based statements and offline delivery sync are later MVP milestones. See [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Budget and deployment

Supabase Free + one Render Free service serve both separately built frontend and API. Paid Google Play enrollment/publication is allowed by the owner; other services remain free-tier-first with no automatic paid upgrade or overage. React Native iOS work continues; paid Apple distribution requires a later decision.

Render cold starts and free-tier quotas are real pilot constraints. Manual encrypted backups/restore checks remain required before real records. No paid plan change is needed to use the schema/API design. See [upgrade path](docs/UPGRADE_PATH.md).

## Project documentation

- [MVP launch roadmap](docs/MVP_LAUNCH_PLAN.md)
- [High-level design](docs/HLD.md)
- [Low-level design](docs/LLD.md)
- [Platform readiness](docs/PLATFORM_READINESS.md)
- [Supabase setup](docs/SUPABASE_SETUP.md)

## Recurring plans

The next lifecycle increment is implemented locally in desktop/mobile/API. Read [PLAN_LIFECYCLE.md](docs/PLAN_LIFECYCLE.md) for features and rollout. Live database migration 0002 was applied after owner approval; restricted-role readiness and plan-table RLS were verified. New plan entry points are gated automatically in environments without the migration. Native date-picker changes require a new development build.

## Product baseline

[M0 is complete](docs/m0/README.md): tiffin-first pilot with milk support retained, owner-selected Figma reference, original branding, screen/state inventory and scheduling/accounting examples. This defines the implementation baseline; launch gates remain open.

## Delivery and accounting

M3 is implemented locally: daily round, actual quantities, reasoned corrections, opening balances/cutover, manual receipts/reversals and reconciled account statements in web/native. See [accounting and rollout](docs/ACCOUNTING.md) and [M1–M3 status](docs/M1_M3_STATUS.md). Migration 0003 is pending live activation; new features are hidden until it exists. The independent-connection PostgreSQL check is `npm run test:postgres -w @dailyloop/backend`; run outside the restricted execution environment, which blocks shared memory.

## Web MVP

Online web journeys, statement PDF/CSV, settings, private account export, support/deletion requests and guarded operator backup/erasure tooling are implemented. Start with [WEB_MVP.md](docs/WEB_MVP.md), [deployment](docs/WEB_DEPLOY.md) and [operator runbook](docs/OPERATIONS.md). Live schema activation and public deployment remain reviewed steps. The placeholder support address is deliberately non-routable and must be replaced before external onboarding.
