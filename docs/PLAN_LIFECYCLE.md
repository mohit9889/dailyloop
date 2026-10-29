# Recurring-plan lifecycle increment

29 October 2026. Local implementation of the M2 recurring-plan portion. This is not the delivery/financial ledger milestone or a completed launch-ready MVP.

## Included

- Customer detail/edit and effective-date archiving with required reason and expected version.
- Up to 20 distinct named delivery slots per customer; milk quantities to 0.001 litre, whole meals, and integer-paise rates.
- Recurring weekdays, dated quantity/rate/name revisions, an inclusive last-delivery date, date-range pauses and early resumption.
- Single-date skip, different quantity, resume on a paused/off-day, and clear-to-normal schedule. One-day intent history is append-only.
- Backend-authoritative week previews and before/after review prior to saving in desktop and native mobile screens.
- Native date-picker controls; original DailyLoop branding retained.
- Per-business RLS and composite tenant foreign keys; idempotent mutations, version conflicts, business write serialization and atomic audit records.

## Rules made explicit

Creation and changes affect today/future only. A new recurring revision must follow the latest revision's effective date; it cannot overwrite an existing revision or insert an earlier change ahead of a later scheduled revision in this MVP increment. Revision end dates are derived from the next effective date, rather than mutating the old row. Its immutable effective-date uniqueness plus serialized writes gives one applicable revision per date.

Customer archive date is the first inactive day. Plan end date is the last active day. These lifetime limits outrank date overrides, which outrank pauses, which outrank weekdays. Clearing an override restores the normal pause/weekday result. Resuming one pause preserves earlier paused dates; another overlapping pause can still apply. Ending/archiving is currently not reversible in the UI and is explicitly disclosed before confirmation.

Plan unit stays fixed. Each plan has a stable normalized creation-slot identity; duplicate initial slot names are rejected. Renaming a dated revision does not rewrite earlier revision labels. Client decimal inputs are converted to integer thousandths/paise without floating-point multiplication. Monetary API fields are strings.

This increment produces planned schedules only. It does not confirm actual deliveries, create revenue, migrate legacy SQLite records or recalculate existing financial entries. Opening balances will be added with the audited ledger/receipt increment (M3) to avoid introducing a separate mutable balance model. This is a deliberate sequencing change from the initial M2 table in the launch roadmap.

## Rollout status

The additive migration is backend/migrations/0002_plan_lifecycle.sql. It adds a nullable archive date to customers and audit details, then new plans/revisions/pause/override tables, indexes, RLS and narrowly scoped grants. Existing customer records are retained. Migration 0001 remains unchanged.

Migration 0002 was applied to the configured Supabase project after the owner explicitly approved it. Restricted-role database readiness and all four plan tables with RLS enabled were verified. The local API was restarted. Existing customer records were retained during migration. Subsequently, on explicit owner request, five labelled [TEST] customers and seven meal plans were added under the existing owner for testing; these are not real customer revenue.

The API advertises features.planLifecycle. New clients hide plan entry points when absent/false; new plan endpoints return MIGRATION_REQUIRED if the schema is not available. Existing login/customer creation continue to work against the foundation schema. After approved migration application, restart the API and refresh clients; no account/data reset is required.

## Validation

Automated checks include the previous authentication/tenancy/idempotency suite and new cases for multiple slots, effective revisions, preview without mutation, retries, stale versions, whole-meal quantities, pause/override/clear/resume precedence, inclusive end/archive behavior, cross-business plan access, foreign keys, failed-audit rollback, additive migration preserving existing rows, leap dates and exact decimal conversion. A rollout-gate test verifies the customer register remains available while plans are gated without the new schema.

Desktop browser QA used a synthetic identity and in-memory database: customer setup, plan creation with review, future change from 1 litre/₹60 to 1.5 litre/₹70, date-range pause and opening the one-day-change form. Browser control then lost its tab; the final one-day save was verified through API tests rather than claimed as a browser pass. The saved screenshot is test data, not a live customer or charge.

Physical Android/iOS picker/sign-in/device behavior remains pending. Adding the native date-picker requires a new development/preview binary; restarting Metro alone cannot add a native module to an already-installed custom development client.

## Migration procedure

Run the existing versioned migration runner from project root, using the private configured environment:

    npm run db:migrate -w @dailyloop/backend

For future environments, verify the migration record, restricted-role queries and readiness, then restart the API. Do not alter migration 0001, change serving role to administrator, or insert test customers into live data to demonstrate the feature.
