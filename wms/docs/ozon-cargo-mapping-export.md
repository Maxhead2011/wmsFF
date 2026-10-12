Published PR559 / 2026-10-10: Excel mapping of WMS boxes to confirmed Ozon cargo IDs, directions and supply/order numbers. Download available after all directions succeed; exact text identifiers and scoped read-only export. Request1861 verified:27 boxes/11 directions. API3313/web417 passed,145/2 skipped; dedicated KIZ DB suites excluded. TypeScript, candidate runtime, live controller and browser download passed. Baseline `2026-10-10-ozon-cargo-export`, sourceParityVerified=false. APK227, print agent, flags, sold WMS and business records preserved. [Evidence](releases/ozon-cargo-export-20261010.json).

# Correspondence of WMS boxes and Ozon cargoes

Published from `fix/ozon-cargo-mapping-export` through PR559 on 10.10.2026.

After all destination operations return SUCCESS, the Ozon assembly panel offers
“Скачать соответствия коробов (Excel)”. The workbook includes the WMS box code,
destination, Ozon cargo ID, supply ID and order number. It remains downloadable
after reopening the assembly. No automatic browser download or remote write occurs.

GET `ozon-fbo-import/requests/:id/supply/cargo-mapping.xlsx` applies the existing
feature, client and warehouse access checks. Export joins receipt `key` to
`FboAssemblyBox.id`, checks direction/supply ownership and one-to-one coverage,
rejects pending, unknown, missing, duplicate or foreign receipts, and sorts by WMS
box code. All identifiers are Excel text cells, avoiding numeric rounding.

This does not change cargo sending, rate limiting, stock, picking, labels or TSD.
Our-WMS release only; sold WMS is outside the deployment scope.
