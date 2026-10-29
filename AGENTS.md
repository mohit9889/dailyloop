# Dailyloop project instructions

- Use `/Users/mohit/Work/dailyloop` as the project root.
- Keep mobile frontend code in `mobile/`.
- Keep desktop frontend code in `desktop/`.
- Keep backend services, APIs, and database code in `backend/`.
- Keep application-specific dependencies, configuration, and tests with the corresponding application.
- Do not mix backend implementation or secrets into frontend applications.
- Use or install relevant skills when needed for the task.

- Mobile means a native React Native + Expo app for Android and iOS, not a mobile web frontend.
- Desktop uses React + Vite; backend uses Node.js + PostgreSQL (Supabase); SQLite is legacy prototype storage.
- Use Node.js 24 or later and keep database/runtime files out of source control.
- Treat current UI as provisional until Figma design context and original assets are accessible.

- Preserve the original DailyLoop loop monogram and custom vector wordmark in desktop/public/brand and mobile/assets/brand. Do not substitute a generic icon or text logo.

## Budget constraint

- Use free tiers and free/open-source tooling only until the user explicitly approves spending later. No paid trials, automatic upgrades, usage overages or purchased domains. Google Play enrollment/publication is the explicit paid exception; Apple enrollment is not authorized.
- Initial hosted baseline: Supabase Free + one Render Free service serving separately built desktop and API artifacts. Do not use Vercel Hobby for the commercial pilot.
- Use local/EAS-Free native builds within allowances; prepare Google Play distribution when release gates pass; defer paid Apple distribution. No paid SMTP, monitoring, R2 or cron prerequisite.
- Preserve security/accounting gates. Disclose free-tier cold starts/quotas; use manual encrypted backups with restore checks. HLD.md and PLATFORM_READINESS.md supersede the older provider wishlist.

- Latest budget exception: the user authorizes paying for Google Play enrollment/release; infrastructure remains free-tier-first. Do not enroll or purchase automatically. Design free-to-paid upgrades to preserve data and APIs.

- Read docs/IMPLEMENTATION_STATUS.md before continuing. The new server uses Fastify/PostgreSQL; legacy SQLite/demo UI is not the production API. Apply the installed Supabase Postgres skill before changing database schema/RLS.
