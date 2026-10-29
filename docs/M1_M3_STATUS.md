# M1–M3 implementation and validation status

29 October 2026.

| Milestone | Implemented | Remaining exit evidence |
|---|---|---|
| M1 secure foundation | Supabase Google identity, business isolation, restricted verified-TLS role, customer API, session/CSRF checks, migrations, CI definition | Physical native callbacks, two real identities/second-device isolation, expiry/refresh scenarios, successful independent-connection PostgreSQL test; hosted deployment/CI evidence |
| M2 lifecycle | Both clients: edit/archive, independent slots, dated revisions, pauses/resume/overrides/end, backend schedule review | Physical date-picker/layout and multi-device review; opening balances now implemented with M3 but live rollout pending |
| M3 delivery/accounting | Both clients + API: actual outcomes, append-only corrections, opening/cutover history, receipts/reversals, paginated reconciled statements | Migration 0003 not applied live; PostgreSQL concurrency run blocked here by shared-memory restriction; physical/device checks and real pilot evidence remain |

Latest regular tests: **30 passed**. Workspace type checks, production build, Android/iOS exports passed. Browser QA used isolated test data and verified charge/receipt/reversal reconciliation. The separate real-Postgres test did not run successfully; no concurrency sign-off is claimed. See ACCOUNTING.md for the exact local command and rollout sequence.

Next steps: run the provided PostgreSQL test in the laptop terminal; validate physical device and second-identity flows; authorize/apply 0003 after reviewing evidence. Continue M4 offline delivery/conflicts/PDF/CSV and M5 recovery/privacy/release hardening afterward. Existing customer/plan test data is preserved; no live billing records or paid services were created.

## Latest activation update — 29 October 2026

The preceding table records pre-activation gaps. Owner-reported real PostgreSQL test: PASS. Regular suite: 39 passed; workspace types/build passed. Owner-approved live migrations 0003/0004 and initial GitHub push are complete. Runtime readiness, accounting/workspace availability, new-table RLS and preservation of five customers/seven plans were verified. Local services restarted. Public hosting, two-live-identity, physical-device and pilot evidence remain open. Web PDF/CSV, requests and encrypted backup/isolated restore are implemented; see WEB_MVP.md.
