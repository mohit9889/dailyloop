# DailyLoop M0 product baseline

Version 1 · 29 October 2026 · Product definition, not a claim of release readiness.

## Decisions and authority

The owner selected **tiffin delivery first, retaining milk support**, and supplied the Figma file as the design reference on 29 October 2026. The former milk-first roadmap recommendation is superseded. The existing original loop monogram and vector wordmark remain mandatory. Figma is a design reference; its sample records, copy and financial figures do not authorize changing business rules or importing data.

| ID | Decision | Basis/status |
|---|---|---|
| D01 | First pilot: owner-operated tiffin delivery, lunch/dinner slots; milk remains supported | Explicit owner choice |
| D02 | One owner per business; no staff/customer accounts in v1 | Existing MVP scope retained |
| D03 | India, INR, English interface, Asia/Kolkata service dates; UTC audit timestamps | Existing HLD/LLD baseline retained |
| D04 | Native React Native/Expo Android and iOS, separate React desktop and Node backend | Explicit owner instruction |
| D05 | Desktop and Android pilot first; iOS development/device validation retained; paid Apple distribution deferred | Existing budget/platform decision |
| D06 | Supabase Free + one Render Free service; free/open-source tooling; no automatic paid upgrades | Explicit owner budget; Google Play fee is the exception |
| D07 | Supplied Figma is the visual reference, with documented functional gaps | Explicit owner choice; browser review completed |
| D08 | Exact integer paise and thousandths; whole meals; fractional litres | Existing LLD/contracts retained |
| D09 | Opening balances implemented with M3 ledger, not a mutable customer balance | Recorded M2 sequencing decision |
| D10 | Controlled pilot target 3–5 owners, one reconciled billing cycle before wider launch | Existing roadmap target; no invitation/contact authorization implied |

## Product promise and boundary

An owner can maintain recurring meals, change future service, confirm what was actually delivered, record manual receipts and share a statement that explains the balance. Phone and desktop access the same protected business records. A planned meal is not a delivered meal or earned revenue.

Included: Google sign-in/logout; business setup; customer create/edit/archive/search and opening debit/credit; independent lunch/dinner plans; weekdays/start/end dates; future quantity/rate revisions; pauses/resume/date overrides with preview; daily actual delivery outcomes; append-only corrections; cash/UPI/bank receipts and full reversals; advances/partial payments; reconciled statements, PDF/CSV; offline delivery queue with conflict review; support/export/deletion and recovery workflows.

Deferred: staff dispatch, customer app, routing/GPS, online payment collection or verification, prepaid meal packages, automatic messaging, tax invoices/GST, containers/deposits, subscription checkout, multiple currencies and complex analytics. Milk support means per-litre recurring plans using the same ledger and lifecycle, not a second product.

## Primary journeys

| Journey | Steps | Required successful result | Failure/recovery |
|---|---|---|---|
| J01 Onboard | Google sign-in → business setup → customer → opening balance/cutover → lunch and/or dinner plan → preview/save | Same records on second device | Preserve inputs; expired login returns to authentication; no duplicate setup |
| J02 Plan service | Customer → selected slot → future revision or pause/date override → before/after review → save | Only selected slot/dates change; past charges stay fixed | Version conflict requires refresh and a new review; retry same operation key |
| J03 Daily round | Date/slot filter → scheduled stop → actual whole meals/status → charge review → confirm | One accepted outcome and exact charge; skipped/missed charge zero | Offline delivery shows pending; sync once or show conflict; future confirmation rejected |
| J04 Correct | Accepted outcome → replacement quantity/status → required reason → review → confirm | Original retained, original charge reversed once, replacement posted | Stale version cannot overwrite another device |
| J05 Receive money | Customer → amount/date/method → review → record receipt | Partial payment or advance reconciles; retry creates one receipt | Online only; timeout retains operation ID; correction uses reasoned reversal/new receipt |
| J06 Statement | Customer + inclusive dates → totals/history + unresolved warning → PDF/CSV/share | Opening + charges + adjustments − receipts + reversals = closing | Export matches same revision/totals; unresolved stops are not estimated revenue |
| J07 Account/recovery | Settings → export/support/delete request/logout; operator backup/restore | Clear consequences, private records, tested restore | Pending delivery work is reconciled or explicitly discarded before logout |

## Success and release evidence

A pilot owner completes J01–J07 on desktop and physical devices; two owners remain isolated; retries/concurrent writes do not duplicate charges/receipts; restored data reconciles; a full billing cycle has no unexplained balance difference. AC01–AC17 in MVP_LAUNCH_PLAN.md remain the release acceptance matrix. M0 completion defines these requirements; it does not pass their implementation tests.

## Change control

Changes to quantity precision, scheduling precedence, financial signs, correction dates, scope or paid infrastructure require a dated decision entry before implementation. Future work links its acceptance evidence to journey IDs and AC IDs. Missing design states are backlog work, not permission to weaken financial/security rules.
