# All cargo labels for FBO Ozon

The **Распечатать все этикетки** action becomes available after every destination has confirmed cargo places. It opens the agent selector (OZON preferred), total label count and explicit confirmation. Existing per-destination controls remain available.

All destination PDFs are prepared sequentially and verified against unique cargo IDs before a single existing print-series job is submitted. A failed/incomplete destination blocks the entire submission. Ambiguous queue retries retain the existing UUID; intentional reprinting requires confirmation. Expired official URLs are refreshed. Agent media (70 x 120 mm), uniform fit and rotation remain unchanged.

## Ownership and scope

- API: `ozon-print-labels.ts`, `OzonAssemblySupplyService.printLabels`, controller and internal route count.
- Web: `ozonAllLabels.ts`, `OzonPrintAllLabels.tsx`, `OzonAssemblySupply.tsx`.
- Guard: existing `WMS_PRINT_SERIES_ENABLED`, print permission, client and warehouse scope.
- Exact runtime release scripts: `scripts/releases/ozon-print-all-20261108/`; four API and four web files, preserving all three existing Ozon panels and one shared root module. Base is PR925; source/runtime parity remains false.
- No warehouse, TSD, agent or sold-WMS changes.

## Verification

API: 4575 passed, 9 skipped; web: 612 passed, 2 skipped. Dedicated database integration suites excluded. Runtime: 8 checks with saved official PDF; browser: 8 synthetic checks including multi-destination completeness, double click and ambiguous retry UUID. Full API starts on isolated PostgreSQL. Controls: 24; startup and reload: one root and session restore each. Web typecheck passes. Full source API typecheck is blocked by previously existing nullable Yandex SKU errors and stale local Lamoda Prisma types; actual compiled runtime was verified separately.

No real full batch was printed during verification. The user previously confirmed physical FBO/FBS samples on ZavSklad and QR readability. Prepared branch: `feature/ozon-fbo-print-all-20261108`, target `feature/la_panthera`; publication is recorded separately after deployment.

Published in PR927; verified public browser/startup and unchanged deployment environment. Baseline: `2026-11-08-ozon-print-all`.
