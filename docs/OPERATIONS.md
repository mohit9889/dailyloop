# DailyLoop free-pilot operator runbook

29 October 2026. Operator commands use the local backend environment. Never put migration credentials, service-role keys, backup keys or encrypted backups in a frontend, GitHub or the serving deployment. No paid cron, email or monitoring is required.

## Daily checks

Check API /health/live and /health/ready, Render/Supabase dashboards and free quotas. Confirm the last successful encrypted backup/restore verification is under 24 hours old. Review open requests and failed saves; no email notification is automatically sent. Maintain a monitored support contact before inviting external owners. Free cold starts/pausing mean no always-on SLA is promised.

From the project root:

    npm run backup:create -w @dailyloop/backend
    npm run backup:verify -w @dailyloop/backend -- <encrypted-backup-path>

Create reads a consistent read-only database snapshot using local migration credentials, encrypts with AES-256-GCM and writes an owner-only file under .private/backups. The generated 32-byte key is separate under .private/keys/backup.key; it is not printed. Verification authenticates/decrypts it, applies only trusted checksum-matching migrations in an isolated in-memory database, restores every application row, compares a canonical digest and clears app sessions. It never restores into Supabase.

Copy encrypted backup and key to separate owner-controlled offline locations and check readability. Keep a second encrypted copy. The interactive backup cap is 200,000 rows/50 MB; at a cap, arrange a streaming PostgreSQL backup rather than silently skipping records. Rotate obsolete copies within 30 days, retaining the agreed recovery window and completed erasure journal. Recovery point <=24 hours is a target only while daily backups actually complete; no guaranteed restore time is claimed.

## Support and deletion requests

    npm run operator -w @dailyloop/backend -- requests
    npm run operator -w @dailyloop/backend -- resolve-support --request <uuid>

The request list contains private owner messages: view only in an operator-controlled terminal and do not forward logs. Resolve only after actually handling the request. The command does not contact anyone. Use separate explicit authorization before sending messages to people.

Deletion requests require recent sign-in and typed confirmation in the app. Saving one does not erase an account. The operator verifies ownership and scope, checks for cancellation, offers the owner's export and fulfils the request manually. Working target: review daily and fulfil verified requests within 30 days; do not advertise automatic deletion or an unstaffed mailbox.

Before irreversible removal:

1. Create and verify a fresh encrypted backup (under 24 hours old); preserve key/copy custody.
2. Set MAINTENANCE_MODE=1 on the single serving deployment and restart/drain it. /v1/setup must respond 503 with code MAINTENANCE. Health endpoints remain available; public policy/contact information remains readable.
3. Verify the open request reference. Remove the exact Google/Supabase identity with the local operator service-role key, or manually through Supabase's Auth dashboard. Do not remove another owner's identity or use a guessed ID.
4. Execute the guarded operator command, only after review:

       npm run operator -w @dailyloop/backend -- erase --request <uuid> --backup <verified-encrypted-backup> --confirm DELETE

   The key option is local SUPABASE_SERVICE_ROLE_KEY; never place it in Render's runtime. If Auth was already removed in the dashboard, add --auth-already-deleted; the command verifies its absence before proceeding.
5. The command removes only that owner's tenant and sessions, retains a non-contact identity hash/request reference in the operator-only journal and writes .private/erasure-journal.json. Copy this journal separately from old backups. Verify other owners remain intact. Keep maintenance on if any step fails; retry/reconcile the operation, never silently label a half-completed removal successful.
6. Remove obsolete backup copies per policy; preserved copies may contain pre-erasure data until rotation. Resume serving only after verification. New Google sign-in may create a new empty account; it must not restore the old tenant.

No actual erasure is authorized by this runbook alone. Its test uses synthetic accounts in an isolated database. A human must confirm each real irreversible action.

## Restore and incident recovery

Put the service in maintenance and stop new onboarding. Verify backup authentication/checksums/digest in isolation first. Preserve current incident evidence and take a fresh encrypted snapshot before considering rollback. Never overwrite the live project just to test a backup.

Prepare an empty isolated PostgreSQL/Supabase target, apply the matching versioned migrations and restore via reviewed operator tooling. The included restoreEmpty function rejects non-empty tables, restores FK/correction order, verifies the digest and removes sessions. The shipped CLI only runs this function in isolation; a live restore remains an explicit reviewed operator action.

Compare customer/plan/event counts and ledger balances. Check the backup's Auth ID/email mapping against the provider project: restoring app tables does not by itself restore Google/Supabase identities. Reapply ALL completed erasures from the separately maintained current journal before access is reopened. Do not rely only on the older backup's journal, and do not remap ownership by an unverified email. Check two owners' access and force a new login after restoring. Record actual recovery time and missing data window before reopening.

## Rollback

Keep the previous Git commit/deploy available. Migrations are additive; prefer deploying the previous application artifact over dropping schema/history. Never edit an applied migration checksum. Do not reverse ledger corrections with SQL updates; use the audited app workflows. If the prior app cannot safely serve the migrated schema, keep maintenance enabled and fix forward. Test rollback on an isolated environment first; no hosted rollback rehearsal has yet been performed.
