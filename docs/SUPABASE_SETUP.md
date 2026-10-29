# DailyLoop — Supabase setup for the first implementation milestone

29 October 2026. Use your existing **Free** project. This guide does not deploy resources or expose any credentials. The user has authorized paying for Google Play publication; backend/database/hosting remain free-tier-first.

## What is implemented in this increment

A new Fastify backend, shared Zod contracts, versioned SQL migration, restricted PostgreSQL role, tenant RLS, web/native session registration/revocation, encrypted web refresh-token storage, Google PKCE integration, business setup and retry-safe customer creation. Desktop/native entry flows connect to this API.

Plans, delivery events, corrections, ledger and offline queue remain later milestones. Their earlier local prototype source is retained as LegacyApp/store code and is not exposed by the new server. This avoids presenting unauthenticated prototype routes as the secure MVP. Do not overwrite the old SQLite file or assume it has been imported.

## 1. Configure the local backend privately

Copy backend/.env.example to backend/.env. Use the dashboard’s project URL and **publishable** key for SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. Do not use a service/secret key in either frontend.

Set MIGRATION_DATABASE_URL privately to the project's migration/admin connection. Use the dashboard’s appropriate direct/session-pooler address and verified TLS; URL-encode reserved password characters. Do not copy a real URL into chat, docs or source control. Supabase settings, regions and exact connection details must come from your project dashboard.

Generate SESSION_ENCRYPTION_KEY locally with the command shown in the example. It is an application secret, not a Supabase signing secret. Keep it stable across restarts. Rotating it currently requires signing web users in again; do not claim seamless key rotation is implemented yet.

Keep APP_ORIGIN=http://127.0.0.1:5173 during laptop web development. Values ending with a slash should be entered without that slash. Hosted APP_ORIGIN must be the exact HTTPS Render origin. Use HOST=0.0.0.0 only for hosted/trusted device-network development.

## 2. Apply versioned schema and create a restricted serving login

From project root:

```sh
npm ci
npm run build -w @dailyloop/contracts
npm run db:migrate -w @dailyloop/backend
```

The migration creates private/application schemas, RLS policies, membership bootstrap, session functions and the NOLOGIN dailyloop_runtime role. It records checksums so an already-applied SQL file cannot be silently edited. It does not reset the existing database or import legacy records. Do not add app/private to Supabase Data API exposed schemas; clients access business records only through this API.

Temporarily add DATABASE_RUNTIME_PASSWORD to backend/.env with a random password of at least 24 characters, then run:

```sh
npm run db:create-runtime -w @dailyloop/backend
```

This creates the dailyloop_api LOGIN role inheriting only the restricted application permissions. It refuses to overwrite an existing login. If the Supabase project does not permit the role creation/grants through the chosen migration identity, resolve permissions in the project dashboard rather than serving as postgres/service role. No cloud role setup has been verified yet.

Set DATABASE_URL privately to that restricted login, using your dashboard's network/pooler format. A session-pooler username for a custom role may include the project ref; verify it against Supabase documentation and your project. Use verified TLS (e.g. sslmode=verify-full with the appropriate trusted CA). Never disable certificate verification. Remove the temporary runtime-password variable once configured.

The running service must not receive MIGRATION_DATABASE_URL or DATABASE_RUNTIME_PASSWORD on Render. Those belong only to the explicit release/setup process. The backend readiness gate rejects superuser/BYPASSRLS or table-owner serving identities; access tests additionally verify RLS behavior.

## 3. Google OAuth in Supabase

In your Google OAuth project, create the appropriate web OAuth client and configure the consent audience. Use only basic identity scopes. Enable Google in Supabase Auth and enter the OAuth client ID/secret **in the provider dashboard**, not in client source.

Register the exact Supabase callback URL shown in its dashboard with Google. Add these application redirect URLs to the Supabase allowlist as applicable:

- http://127.0.0.1:5173/auth/google/callback for local desktop development.
- https://YOUR-RENDER-SUBDOMAIN.onrender.com/auth/google/callback for the hosted web app.
- dailyloop-preview://auth/callback for actual preview native builds.
- dailyloop://auth/callback for the eventual production Android app.

Verify the actual URI emitted by the installed Expo build; it must match the allowlist. Expo Go uses different linking behavior and is not the proof for a signed development/preview build. App identifiers in the committed config are proposals until their availability/ownership is confirmed before Play submission.

If Google consent is in Testing, add the intended pilot identities and check its restrictions. No Gmail/Drive permissions or billable Google Cloud service is needed for basic login. Branding/verification requirements may still require account configuration; do not bypass consent restrictions.

Use modern asymmetric Supabase JWT signing keys (ES256 or RS256) and its JWKS endpoint. The current verifier deliberately rejects unsigned/incorrectly signed tokens and does not support the older shared-secret HS256 mode. Confirm the active signing configuration before trying the live app.

## 4. Run and verify the web flow

```sh
npm run dev
```

Open http://127.0.0.1:5173. Before configuration, sign-in is unavailable and business API routes fail closed. With configuration and a ready database, Continue with Google should create a server-side encrypted session and HttpOnly browser cookie.

Sign in as owner A, create a business and customer. Sign in as owner B in a separate browser profile and verify there is no access to A’s data, including direct customer URLs/API IDs. Check logout/re-login and token refresh. The automated suite exercises these boundaries locally, but it is not a replacement for live provider verification.

## 5. Native configuration

Copy mobile/.env.example to mobile/.env. Set the public Supabase URL/publishable key and API address. Android emulator: http://10.0.2.2:4000; iOS simulator: http://127.0.0.1:4000. A physical device uses your laptop's trusted LAN address while developing; hosted builds use the Render HTTPS address.

Use a native development/preview build for custom OAuth callbacks. mobile/app.config.ts separates preview and production app IDs/schemes. EAS account/project linking, store signing, actual device auth and storage behavior remain configuration/release checks. Secure session storage chunks longer values into native encrypted entries; restart/logout/reinstall behavior still needs physical-device verification. No offline customer cache is enabled in this increment.

## 6. Free Render hosting

infra/render.yaml declares one **Free** Node Web Service, not an automatic deployment. Build from repository root with npm ci && npm run build; start npm run start -w @dailyloop/backend. It serves desktop/dist and /v1 from the same HTTPS origin. Complete migrations separately with the release identity before starting the API. Configure only runtime secrets and set APP_ORIGIN to that service URL.

/health/ready returns 503 until configuration/database/role checks pass. It is intentionally not a fake “healthy” response. Render Free cold starts and restarts remain possible. Supabase is the data store; local service files are not durable. Do not purchase a paid instance or trial during setup.

## 7. Remaining evidence before M1 is complete

- Live Supabase migration, restricted role and pooler/TLS connectivity.
- Live Google consent/callback and actual web token refresh behavior.
- Second-device visibility and two real-owner isolation checks.
- Native Android/iOS sign-in and secure storage on devices.
- Two independent PostgreSQL connection race tests; embedded test transactions currently serialize.
- Audit/remediation of current dependency advisories before release.

No Play enrollment, domain purchase or remote deployment was performed as part of this coding increment. Paid Google Play distribution is allowed by the latest user direction; other services remain free-tier-first and upgrade only after an explicit spending decision.
