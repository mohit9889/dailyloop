# DailyLoop — free-tier platform readiness

29 October 2026. Owner budget policy: **₹0 service spend until later explicit approval.** No paid trials, automatic upgrades, usage-based overages or domain purchases. Google Play enrollment/publication is the approved spending exception; Apple membership is not. This revises the earlier platform wishlist. No account/service setup has been completed by this planning update.

## 1. Accounts required for the free pilot

| Account/tool | Plan/use | Setup proof |
|---|---|---|
| GitHub | Free private repository; included Actions usage | User owns repo; spend disabled; PR checks work within allowance |
| Supabase | Free PostgreSQL/Auth; optional free Storage | One pilot project; account free-project capacity checked; restricted DB role and RLS tests pass |
| Render | One Free Web Service | Serves separate API and desktop build from same onrender.com HTTPS origin; cold-start behavior tested |
| Google account/Cloud OAuth console | Basic Google OAuth client used by Supabase | Correct callbacks, audience/test users and basic identity scopes; no billable compute/services enabled |
| Expo | Free account and included EAS builds when available | Android preview profile; quota checked; local builds available as fallback |
| Local developer tools | Node/npm/Git, Docker + Supabase CLI, Android Studio, Xcode | Local tests and simulator/emulator builds work; use existing laptop |
| Figma | Existing Free access within available limits | Original assets remain local; no upgrade required to continue backend work |

Not required now: Vercel, Resend, paid SMTP, paid domain, Cloudflare R2, Render Cron, Sentry subscription, external paid uptime service, Supabase Pro, Apple Developer Program. Google Play enrollment is authorized when needed for Android release. They cannot become hidden pilot prerequisites.

## 2. Configuration

Backend public values: APP_ENV, PORT, HOST, PUBLIC_APP_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JWT_ISSUER and SUPABASE_JWT_AUDIENCE. Backend secrets: restricted DATABASE_URL, session encryption key/key ID and isolated migration credentials. Administrative Supabase secret only for narrow account jobs if needed. Never expose privileged keys in either frontend.

Google OAuth client secret belongs in Supabase provider configuration. Backend web OAuth PKCE verifier/state is short-lived and server-controlled; exact callback URLs are registered. Use normal login consent, not access to unrelated Google data.

Browser API paths are relative (/v1, /auth) on the same Render origin; no cross-site cookie dependency or purchased domain. Development proxy remains local-only. Native public variables are EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY and EXPO_PUBLIC_APP_ENV. Public values are readable in the app binary.

GitHub/Expo access tokens, signing keys and backup decryption secrets are never pasted in chat or committed. Store only required secrets in supported secure settings. Do not add a payment method just to bypass a free-tier restriction.

## 3. Hosting configuration to implement

One repository-root build installs from lockfile, builds contracts/backend/desktop, then starts node backend/dist/server.js. Fastify serves /v1 and /auth first, desktop/dist assets next and frontend route fallback last. Unknown API routes return JSON 404, not index.html. Listen on the host PORT and 0.0.0.0; readiness verifies DB access. Persist everything important in Supabase, not Render files.

Render’s Free service sleeps after inactivity and has shared monthly quotas. Use a cold-start UI and bounded safe retries; no artificial pings to keep it running. Test readiness at deployment and during deliberate operator checks instead of using an uptime tool as a sleep bypass.

Local staging is the default. A second isolated Supabase Free project is allowed only within available quota. A second hosted API is optional and consumes shared Render free hours; do not provision paid staging. Production/pilot data never becomes test fixtures.

## 4. Setup gates

| Gate | Requirement | If blocked |
|---|---|---|
| G0 | Node/Git and local auth/database tools verified | Continue domain/contracts work while resolving local setup |
| G1 | Auth, memberships, restricted DB role and cross-tenant tests pass | No public exposure of existing unauthenticated API |
| G2 | Google OAuth works for real pilot identities on same-origin web and actual native callbacks | Pause external onboarding; do not disable auth verification |
| G3 | Free Render build serves web/API over HTTPS and safely handles cold starts | Local test-only work; no automatic paid upgrade |
| G4 | Android test build installs; iOS simulator/local development tested | Keep iOS source; defer paid external distribution |
| G5 | Encrypted daily backup + separate offline copy, restore rehearsal, audit and correction tests | No real-record pilot until data-safety checks pass |
| G6 | Cohort accepts pilot limits, policy/support/deletion process works, distribution requirements checked | Keep controlled testing; no Apple store enrollment without authorization |

## 5. Recovery without paid services

Owner-run daily export and backup-age review, encrypted before storage on the laptop plus another owner-controlled offline device/location. Do not use GitHub artifacts as a permanent customer database backup. Verify restore to an isolated local/test instance, including identity relationships and invalidating old sessions. If a retained file bucket is used, test object-byte restoration too.

Manual operation is an explicit responsibility, not an automatic free managed backup. If a day’s export fails, resolve it promptly and suspend onboarding if recovery targets cannot be met. Account erasure/retention jobs have manual commands/runbooks and an operator schedule; no paid cron.

## 6. Quotas and spending controls

Read the live owner dashboards before provisioning; free allowances/eligibility can change. Keep all paid spending disabled where supported. If a service cannot provide a free no-overage configuration, stop before activating it and choose a compliant alternative.

Track weekly: Supabase DB size/egress/storage/auth MAU; project pause status; Render hours/bandwidth/build minutes/service egress; EAS build balance; GitHub runner/artifact/cache use. Configure free alerts where available; otherwise record a weekly manual check. Remove obsolete test data and artifacts through documented retention, never erase real audit/ledger history to disguise quota exhaustion.

Review at 70% quota, first 10 active businesses, repeated disruptive cold starts or backup burden. These are prompts to review, not permission to pay. Upgrade only after an explicit owner decision with current pricing and migration implications.

## 7. Free distribution boundary

Web uses the provider subdomain with HTTPS. Android starts with locally built or EAS-Free test APKs under a controlled testing workflow; check current off-store verification/distribution rules before external installation. Google Play Console enrollment has a fee; the owner approves that cost. Prepare Play testing/production access and signing when the MVP reaches release readiness. iOS simulator and personal local-device development can use free tools subject to Apple provisioning/capability limits; free local signing is not general customer distribution. TestFlight/App Store publication is deferred until the owner authorizes membership fees or an existing eligible membership is confirmed.

Do not promise simultaneous zero-cost public Android/iOS store launch. Expo free cloud-build allowance does not cover store memberships/signing eligibility. If mobile distribution becomes a blocker, web pilot access remains the zero-cost path while native development continues.

## 8. Inputs needed now

Preferred GitHub identity/repo, available Supabase Free capacity, Render/Expo identities and a Google OAuth project owner. No paid domain, credit card or store account is required for this initial architecture. Existing domain/developer memberships may be used if already available and no new charge is introduced.

## 9. References

Supabase Free limits: https://supabase.com/pricing
Render Free limitations: https://render.com/docs/free
Vercel Hobby commercial restriction: https://vercel.com/docs/plans/hobby
Google OAuth setup: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
EAS allowance: https://expo.dev/pricing
GitHub billing controls: https://docs.github.com/en/billing/concepts/product-billing/github-actions
Apple free/paid account capabilities: https://developer.apple.com/help/account/basics/about-your-developer-account
Google Play enrollment: https://support.google.com/googleplay/android-developer/answer/6112435


## Latest budget and implementation clarification

The owner authorizes paying for Google Play enrollment/publication. Other infrastructure remains free-tier-first; paid-tier upgrades are designed to preserve data, identities and API contracts, and require a later explicit spending decision. Public Android store release is therefore in scope once product and Play testing gates pass, not deferred solely because of enrollment cost. No Apple membership purchase or unrelated paid service is authorized. See SUPABASE_SETUP.md, IMPLEMENTATION_STATUS.md and UPGRADE_PATH.md for the current code increment and upgrade steps.
