# DailyLoop — free-to-paid upgrade path

Latest owner direction: free-tier infrastructure where possible; paying for Google Play distribution is allowed. This is not authorization for unrelated paid tiers. No purchase or deployment is performed by this document.

## In-place upgrades

| Platform | Begin with | Later upgrade | What stays stable |
|---|---|---|---|
| Supabase | Free PostgreSQL/Auth project | Upgrade the same project/org after approval | Tenant/user IDs, data, SQL schema, API routes, auth project URLs where provider keeps them |
| Render | One Free Web Service serving backend + desktop artifacts | Change compute tier on the same service | HTTPS service address, client API contract, database records |
| Expo | Local and included Free builds | Paid build capacity only when needed/approved | EAS project, bundle IDs, Android application ID, Play app entry and signing continuity |
| GitHub | Free repo and included CI | Additional allowance/team features if needed | Source/history/workflows; no application data migration |
| Play Store | Owner-approved developer enrollment | Production testing/release tracks | Stable confirmed Android app ID and managed upload-signing ownership |

Supabase/Render tier upgrades are primarily operational/configuration changes, not a new application or a customer-table rewrite. Verify the provider's current upgrade behavior, take a tested backup and compare data/auth after the change; do not assume every future project move is automatic.

## Implementation rules that prevent lock-in

- All business rules and financial writes live in the Node API; frontend code does not directly mutate provider tables.
- Database is PostgreSQL with checked-in SQL migrations, UUID IDs and transaction constraints. Hosting pricing is not encoded in customer records.
- Restricted runtime identity is separate from migration/admin identity. New hosts receive runtime credentials only.
- API URLs, project URLs and public keys are environment configuration. Native changes to embedded URLs/keys require a new compatible build or supported update; do not promise instant endpoint changes in installed apps.
- Cookie origins and OAuth callbacks must be reviewed if a custom domain or separate frontend host is added. Keep the same-origin setup until a tested replacement is ready.
- Keep production Android IDs/signing stable across free/paid EAS changes. Never create a new Play app just because a build plan changes.
- Preserve database backups, owner-managed signing recovery and a record of project ownership independently of a single developer account.

## Upgrade checklist

1. Review measured database/traffic/build usage and cold-start/recovery pain; distinguish business owners from delivery-customer records.
2. Present the current provider quote and obtain approval for that specific spending.
3. Complete an encrypted backup and restore check; record current deployment/schema/release.
4. Upgrade the same resource if supported. Avoid copying to a new project unless there is a specific reason.
5. Verify browser/native login, membership isolation, customer counts and ledger totals when ledger features exist.
6. Verify readiness, connection pool limits, TLS and latency; only then retire the old configuration.
7. Keep rollback compatible with older mobile clients; roll forward database migrations rather than destructive resets.

Managed backups/monitoring can replace manual tasks only after restoration/alert delivery is proven. A paid plan does not itself finish M1–M6 product requirements.
