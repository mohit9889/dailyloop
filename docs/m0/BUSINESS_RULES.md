# DailyLoop M0 scheduling and accounting rules

Version 1 · 29 October 2026. Normative implementation baseline aligned with LLD.md and current lifecycle. M3 rules below are requirements, not currently implemented accounting.

## Service and schedule

- A customer may have independent lunch/dinner or morning/evening plans. One occurrence is a business + plan + service date. Up to 20 plans per customer in current lifecycle.
- Meals are positive whole numbers; milk supports 0.001 litre precision. Rates are positive integer paise per meal/litre; display rupees without using floating-point arithmetic to calculate charges.
- Plan start and end are inclusive. Customer archive date is the first inactive day. Archiving preserves history. Current end/archive actions cannot be undone in the UI.
- Current scheduling precedence: archive/plan lifetime → applicable dated revision → latest explicit one-day override → pause → weekday. A clear override restores pause/weekday rules. Resume override can allow a paused/off-weekday date, but cannot revive an ended/archived plan.
- Pauses include both endpoints. Early resumption leaves earlier pause history intact; another overlapping pause can still apply. Pause alone creates no delivered outcome or charge.
- Revisions and lifecycle edits affect today/future only. A recurring revision must be strictly later than the latest scheduled revision. Plan unit and initial slot identity stay fixed. A rename does not change historical labels.
- An accepted delivery keeps its original snapshot until explicitly corrected, even if schedule changes later. M3 confirmation must revalidate the current schedule and expected version. No confirmations for future dates.
- Actual delivered quantity may differ from planned quantity within supported precision. Skipped/missed outcomes have zero charge. Unresolved scheduled stops remain pending, never silently treated as delivered. One-day skips and inactive dates must be distinguishable from unresolved stops.

## Money and history

Positive charge in paise = floor((quantityMilli × ratePaise + 500) / 1000), using exact integer arithmetic. Round once per accepted occurrence; sum saved paise amounts rather than rounding a period's combined quantities. Reverse the saved amount, not a recomputed amount.

Ledger signs: opening debit, delivery charge and receipt reversal positive; opening credit, receipt and delivery reversal negative. Opening = all entries before from-date. Closing = opening + signed entries within the inclusive period. Negative closing means customer credit.

Confirm an outcome and post its financial effect in one transaction. Save quantity, rate, unit, slot, revision and service date. Required actor/time/reason history, stable operation IDs and expected versions apply to corrections/reversals. Financial writes require an internet connection; only delivery outcomes can be queued offline in v1. Offline outcomes are not server-accepted financial totals.

A receipt records manual bookkeeping, not money collection or bank verification. Accept cash/UPI/bank, partial receipts and advances. Full receipt reversal references the original and can occur once; replace a mistaken receipt by reversal plus a new receipt. Correction/reversal effective dates follow the original entry, with the actual action timestamp retained. Historical statements can therefore restate; exports identify generation time and revision. No locked accounting periods or tax invoice claim.

Opening debit/credit needs an agreed cutover date and reason. Do not import pre-cutover transactions already included in that balance. An opening correction reverses/replaces the original entry. No separate mutable balance column.

## Worked acceptance examples

All names and numbers below are illustrative, not production revenue.

| ID | Scenario | Expected result |
|---|---|---|
| R01 | Lunch 1 meal × ₹90 and dinner 2 meals × ₹100, both confirmed | Independent charges ₹90 and ₹200; total ₹290 |
| R02 | Lunch rate ₹90 through 31 October, ₹100 from 1 November | Saved 31 October delivery stays ₹90; a 1 November delivery uses ₹100 |
| R03 | Every-day lunch paused 30 October–2 November | Four dates paused, normal service resumes 3 November; dinner unchanged |
| R04 | Explicit resume on 31 October during R03 pause | 31 October schedules the applicable revision quantity; other paused dates unchanged |
| R05 | Same override after plan ended 30 October | Reject; override cannot resurrect an ended plan |
| R06 | Last delivery 31 October; customer archive 1 November | 31 October allowed; 1 November inactive; old history retained |
| R07 | Planned 2 meals, actual 1 meal at ₹90 | ₹90; actual 0.5 meal rejected; skipped/missed ₹0 |
| R08 | Milk actual 0.333 litre × ₹61.25/litre | 333 × 6125 / 1000 = 2039.625 paise → 2040 paise (₹20.40) |
| R09 | Same confirmation sent twice with same operation key | Return first result; one outcome and charge |
| R10 | Two devices submit different changes to the same accepted version | One succeeds; stale write conflicts and requires review |
| R11 | Accepted 2 × ₹100 corrected to 1 × ₹100 | Retain +₹200, append −₹200 and +₹100; net ₹100 |
| R12 | Opening debit ₹500, charges ₹900, receipt ₹1,000 | Closing ₹400 due |
| R13 | ₹900 charge, ₹1,000 receipt, no opening | Closing −₹100 (₹100 credit) |
| R14 | R12 receipt fully reversed once | Append +₹1,000; closing ₹1,400; second reversal rejected |
| R15 | Opening credit ₹200; charges ₹900; receipt ₹300 | −₹200 + ₹900 − ₹300 = ₹400 due |
| R16 | Five past scheduled stops have no accepted outcome | Provisional warning counts five; no estimated charges added |
| R17 | October correction entered in November | October statement restates with revision/time; earlier export remains identifiable |
| R18 | ₹500 opening at cutover already includes older unpaid deliveries | Do not import those older charges again |

R01–R06 map to AC04–AC06; R07–R11 to AC07–AC09; R12–R18 to AC10–AC12. Replay/conflict and device coverage also apply to AC08/AC13/AC14. Validate full billing-cycle examples against the implemented ledger before M3 sign-off.
