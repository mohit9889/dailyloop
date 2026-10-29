# DailyLoop interface system

29 October 2026. Applies to the implemented sign-in, setup, customer register, customer detail, recurring plan, schedule and review forms. Web delivery/receipt/statement, settings and request workflows now use the same system; see docs/WEB_MVP.md.

## Reference and precedence

Owner-supplied DailyLoop Figma, original local brand assets, M0 product rules, then UI/UX Pro Max recommendations. The owner explicitly authorized a visual interpretation from the M0-reviewed Figma screens while detailed connector reads are blocked by the Starter quota. This is not a pixel-exact Figma implementation.

UI/UX Pro Max v2.15.0 is installed in the user's Codex skills. Its broad design-system queries returned unsuitable landing-page/color directions; those outputs were rejected, not persisted as requirements. Its verified Minimalism & Swiss Style result and React/React Native guidance inform clear grids, restrained surfaces, predictable feedback and usable controls. Preserve the Figma forest/lime palette rather than adopting generated purple/blue themes. React performance guidance also applied; no new UI runtime dependency was introduced.

## Semantic tokens

| Role | Value | Use |
|---|---|---|
| Primary | #174D3B | Main actions, section emphasis |
| Ink | #203D31 | Headings and primary text |
| Secondary | #5A6D62 | Supporting text |
| Canvas | #F5F7F2 | Workspace background |
| Surface | #FFFFFF | Cards, forms, headers |
| Border | #DCE5DC | Quiet separation |
| Soft | #EDF3E8 | Selected/confirmation surfaces |
| Accent | #DDF494 | Brand accents on forest |
| Danger / surface | #993F32 / #FFF1EC | Errors |
| Warning / surface | #765719 / #FBF4E2 | Consequences and exceptions |

Web tokens: desktop/src/theme.css. Native tokens: mobile/src/ui/theme.ts. Keep equivalent values across platforms without sharing frontend implementation files. Existing active styles were updated in place. Legacy desktop stylesheet remains with the inactive prototype, but is no longer imported by the active desktop entry point.

## Composition

- Web: white navigation/header, warm light canvas, clear page heading/action, forest service-guidance panel, searchable white customer register, white account summary and plan cards. Counts explicitly describe the displayed page, not a business-wide total.
- Native: safe-area header, forest customer-register introduction, readable white customer cards, native search/forms, inset account summary and recurring/schedule cards. Only supported actions are exposed.
- System fonts avoid another font/network dependency. Web helper text is at least 13px; native supporting text is 13px or larger (12px for the short uppercase hero pill). Native body copy is 14–15px where appropriate; form inputs 16px. Text scaling remains enabled.
- Native buttons/choices target at least 48 units high; web buttons at least 44px. Visible focus, retained field labels, disabled/save feedback and reduced-motion CSS remain required.
- Green conveys emphasis, not the only status signal. Keep scheduled/skipped/paused/archived text and distinguish planned service from actual revenue.
- The original monogram and custom wordmark are unchanged. The welcome panel uses the existing original icon asset, replacing a generic arrow decoration.

## Validation and limits

All workspace type checks, production build and Android/iOS exports passed. Browser QA used isolated in-memory records and verified sign-in/setup, customer save/detail, plan review and confirm/save. Screenshots identify test records. Semantic foreground/background pairs passed 4.5:1: white/forest 9.72, secondary/canvas 5.13, forest/lime 8.07, danger pair 6.12, warning pair 6.08. This checks token pairs, not a complete accessibility certification.

No physical Android/iOS or simulator visual pass: this machine has no simctl utility. Small-screen, large-text, screen-reader and native keyboard/date-picker checks remain release gates. Exact Figma fonts, spacing, all missing screens and asset equivalence need later node-level review when available. Existing original brand assets are retained meanwhile.
