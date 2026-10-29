# DailyLoop M0 design baseline and screen inventory

Version 1 · 29 October 2026. Owner-selected reference: [DailyLoop — MVP Product Design](https://www.figma.com/design/hwtqUOxcOo675jCfAPWj2g/DailyLoop-MVP-Product-Design).

## Evidence and limits

Figma connector metadata was blocked by the Starter-plan call limit. Read-only browser review succeeded without a paid upgrade: three pages, their top-level layer inventories, foundations overview, mobile delivery/change/payment screens and desktop register/statement composition were inspected. No Figma layers were edited. No full token export, precise font/spacing extraction, asset equivalence certification or code-to-design visual pass is claimed. Future design implementation must obtain node-level context when available and compare rendered screens.

Observed pages: Foundations (0:1), Mobile experience (3:2), Desktop experience (3:3). Mobile overview frame selected as 8:108. Only observed IDs are recorded; other frame IDs must be retrieved rather than guessed.

Foundations include DailyLoop/Button, Field, Status, Chip and Design overview. Visual direction: light backgrounds, forest-green primary areas/actions, lime accents, restrained borders/cards and status badges. Existing source logo colors include forest #174D3B, lime #DDF494 and white. These are verified local asset values, not a complete Figma variable export.

Original desktop assets in desktop/public/brand and mobile assets in mobile/assets/brand remain the brand source. Preserve the loop monogram and custom vector wordmark; no generic icon/text-logo substitution. Verify Figma asset equivalence before replacing any existing original asset.

## Screen inventory

“Observed” means a named Figma layer exists, not that all interactions, states or code are implemented. Both clients must cover the same business capability using platform-appropriate layouts.

| ID | Capability / journey | Observed mobile layer(s) | Observed desktop layer / requirement | Delivery milestone |
|---|---|---|---|---|
| S01 | Sign-in/session J01 | welcome | Sign-in screen needed | M1 |
| S02 | Business setup J01 | setup, empty | Setup/empty state needed | M1 |
| S03 | Daily overview/round J03 | overview | desktopOverview | M3/M4 |
| S04 | Customer register/search J01 | customers | desktopCustomers | M1/M2 |
| S05 | New/edit/archive customer J01 | newCustomer; edit/archive variants needed | Form and detail variants needed | M2 |
| S06 | Recurring plan/new slot J01/J02 | plan; milk variant | Plan/detail/review forms needed | M2 |
| S07 | Customer account/history J04/J05/J06 | account | Account/detail needed | M3 |
| S08 | Change plan/pause/review J02 | changes, change | Same review and affected dates needed | M2 |
| S09 | Actual delivery confirmation J03 | deliveryConfirm | Round and confirmation needed | M3 |
| S10 | Delivery correction J04 | Dedicated reason/reversal review needed | Dedicated correction review needed | M3 |
| S11 | Receipt J05 | payment | Receipt review/form needed | M3 |
| S12 | Receipt reversal J05 | reverse | Reversal/history needed | M3 |
| S13 | Statement/PDF/CSV J06 | statement | desktopStatement | M3/M4 |
| S14 | Settings/export/support/deletion J07 | settings; deletion/support details needed | Settings and privacy flows needed | M5 |
| S15 | Restore/connectivity J07 | restore | Operator restore procedure; user reconnect state needed | M4/M5 |
| S16 | Loading/error/success/validation | loading, saveError, success, validation | Equivalent states for all routes needed | All |
| S17 | Offline queue/conflict J03 | Dedicated queue/pending/conflict views needed | Stale-data/connection conflict states needed | M4 |

Mobile page has 21 named screen/state frames excluding its section title: welcome, setup, empty, overview, customers, newCustomer, plan, account, changes, change, deliveryConfirm, payment, statement, reverse, settings, restore, saveError, success, milk, validation, loading. Desktop has three named screens excluding its section title: desktopOverview, desktopCustomers, desktopStatement.

## Navigation and interaction requirements

Mobile target navigation: Overview/round, Customers, Statements, Settings; customer detail links to plans, delivery history and receipts. Native stack/back handling, native dates, keyboard avoidance and safe areas are required. Desktop uses persistent navigation and searchable lists/tables, with customer detail and focused review dialogs. These describe target behavior, not current routing implementation.

For each workflow specify initial loading, ready, empty, field error, saving, success, connection failure/retry, expired session and stale-version conflict. Keep entered values on failure. Planned, pending sync, saved, skipped and missed must use explicit labels. A pending operation never appears saved. Destructive/accounting actions disclose consequences and require an explicit review/reason. Offline financial entries are blocked with a useful explanation.

Use readable body text, visible keyboard focus, associated field labels, focus management and announced errors/status updates. Aim for 44px touch controls, support text enlargement, avoid relying on color alone, and verify contrast before sign-off. Respect reduced motion, preserve usable layouts for long customer names/addresses and format dates unambiguously. These are requirements, not a certification of the current screens. Review reference: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

## Reconciliations and implementation backlog

| Priority | Finding | Resolution / acceptance |
|---|---|---|
| P0 | Mobile delivery copy says partial quantity supported; meals are whole-only in contracts | Tiffin copy says whole meals; milk permits 0.001 litre. Confirm quantities and exact charge before save |
| P0 | Design sample money and planned summaries can be mistaken for actual revenue | Bind confirmed ledger amounts only; label planned quantities and provisional statements clearly |
| P0 | Desktop has only three top-level screens | Add/derive S01/S02/S05–S12/S14–S17 using established visual language; do not skip functional states |
| P0 | Offline/stale-version review is not represented by a dedicated named frame | Define pending/sync/conflict actions before queue implementation; never overwrite server data |
| P1 | Corrections, archive/end, opening balance and deletion need detailed variants | Apply BUSINESS_RULES.md, preserve history and show consequences; add missing states during respective milestone |
| P1 | Current compact UI includes small helper text and inconsistent sizing | Verify text scaling, contrast and tap targets on physical devices; complete focused accessibility review in M4 |
| P1 | Full Figma token/font/asset values unavailable through connector | Reconcile node-level context at implementation; preserve current original assets; no paid upgrade dependency |

## M0 design exit

The supplied Figma file is accessible and recorded as the reference; screen coverage and gaps are mapped. This satisfies M0's design-baseline selection and inventory. Pixel matching, missing-screen design work, exhaustive accessibility review and implementation acceptance remain M2–M5 tasks. No replacement interim visual baseline is silently approved.

## Implementation follow-up

On 29 October 2026 the owner explicitly authorized proceeding from the reviewed Figma direction and UI/UX Pro Max while detailed connector access is quota-blocked. The existing implemented screens were refreshed under that exception; see ../UI_REFRESH.md. Pixel-exact matching and physical native visual validation remain outstanding.
