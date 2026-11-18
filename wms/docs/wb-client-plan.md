# WB client requests with stock shortage

Published 18.11.2026 through PR1024 into `feature/la_panthera`; release guard corrected through PR1025.

Excel import offers an explicit WB client-plan choice. It preserves every selected line and its requested quantity even when availability is zero. Default Excel submission still rejects shortages. Unknown SKUs, invalid quantities, parse errors and unresolved relabeling do not become valid through this choice. The mode is advertised and accepted only with the existing own-installation `WMS_FBO_EXCEL_PICK_CHECK_ENABLED` flag. Sold WMS and Ozon workflows are unchanged.

`ClientRequestsService.create` retains client/warehouse access checks and SKU ownership checks. The existing production serializable availability check and request creation run together; the new mode only permits insufficient stock. Request status remains SUBMITTED. `FBO_EXCEL_STOCK_CHECK` records formation mode, requested quantities and availability. No stock, mark, picking, packing or marketplace writes are introduced.

The request form, create DTO, API types, Excel preview capability and small eligibility helpers are affected. This restores the production create guard in stale Git source before extending it. Source/runtime parity is still false: the production availability calculation and warehouse-aware form contain additional changes. Do not deploy the compiled service or a full web build.

## Validation

- Nine API regression tests: full demand at zero stock, audit, serializable boundary, default shortage rejection, malformed inputs, installation flag and denied access. Before the change eight failed; afterwards all passed.
- Six UI eligibility tests; full web suite 650 passed / 2 skipped; web TypeScript passed.
- Full API suite: 4829 passed initially; six database suites could not connect to the stopped dedicated local PostgreSQL instance. After starting it on its configured test port, the six suites passed 51 tests with one concurrent KIZ conflict; that isolated suite then passed all five tests. No unresolved test failure remains. Dedicated database tests total 52.
- API TypeScript reports 12 errors outside this change, byte-for-byte identical to a check of the base checkout. No additional diagnostics.
- Actual captured production create handler rejects a shortage plan before patching. The exact API overlay passes full-plan/default-mode/unknown-SKU checks. The exact web component is executed with mocked hooks and HTTP dependencies: default disabled state, explicit choice, full quantities, warehouse preservation, parse-error block and disabled-installation visibility. This is an automated component/handler replay, not a physical browser or stock operation.
- Read-only live-data snapshots replayed locally preserve Ivanov 17 lines / 170 units, Eletskaya 9 / 85 and scarves 9 / 705. Existing requests 3131/3132 were already PACKED, so their remaining stock is not a historical shortage measurement. No duplicates were created for those requests.
- Separately authorized user operation: normal existing request creation produced scarves request 3160 with all 705 units and attached original workbook. Read-back verified exact composition. At preview, requested-stock coverage was 394 and shortage 311. This operation did not deploy or exercise the unpublished feature.

## Runtime preparation

`scripts/releases/wb-client-plan/prepare.py <capture> <output>` prepares API4/web2 from fresh captured files, with exact single-occurrence anchors. Capture contains current client-requests service, XLSX service, create DTO, mapped request module, index and module path metadata. It preserves warehouse selection, preview invalidation and all unrelated compiled methods. Candidate helper comes from the tested TypeScript build.

Run `node scripts/releases/wb-client-plan/runtime.test.cjs <candidate>`; optional `WB_PLAN_PROOF` points to local read-only snapshots for exact composition replay. `--baseline` against the capture reproduces the original rejection. No secrets, user workbooks or live-data snapshots belong in Git.

Captured API image: `sha256:26440c0226e5a2e439bf470010db06ce9b928e0ad5b570757667c0044fc81be8`; web: `sha256:453885f8688e1210e46eceeaaa1a2fa4218fd2b17f321146ebf60f0ad42fe037`. Both are newer than the checked-in default baseline. Publication requires a fresh full baseline, candidate hash verification, release controls/browser checks and separate user authorization. This capture is the pre-release base; the current published baseline is `2026-11-18-wb-client-plan`.

## Publication checks prepared

Fresh API/web image IDs still match the capture above. A full 785-file API baseline was verified, materialized, and checked against the exact API4 delta; all 3333 existing web files remain, with only the mapped request module and index changed. The staged images load the changed API modules. Full-app browser startup/reload and actual Excel form interaction preserve all 705 units, with POST creation intercepted. Compact controls pass all 24 cases. The real candidate DTO and service pass against current PostgreSQL availability with request/event/audit creation intercepted and the transaction always rolled back (receipt index reads require share locks). Request 3160 and the client request count remain unchanged. No production test request was created.

## Published result

PR1024 merged at `5ee9b900847af22485f3e3dbe79e98bc7020b86b`; PR1025 at `35d5541a43239de64a3a49d9dff9375f6eee58b3`. The first publication attempts automatically restored the original images because Docker reordered the environment array. PR1025 compares exact entries irrespective of order; three RED/GREEN regression tests pass locally and on the release host. Changed, added or removed values remain blocking. Final publication verified unchanged environment values and other containers.

Published API: `sha256:1b916d08b474c566105e8a0e0ac98fe3b0c0601c1d427732df7650c6181fff0f`; web: `sha256:25ccb40a4c8c4c9b84dc682df02f9525eaeee177f05289dd63f462e155433329`. All786 API and3334 web hashes match the reviewed candidate. Health is OK. Public HTTP Excel preview advertises the mode and resolves9 rows/705 units without parse errors. The actual deployed DTO/service accepts all705 units, records the explicit mode in intercepted audit data, and rejects default-mode shortage. Validation transactions are always rolled back; request3160 and request count are unchanged. Complete public-app startup/reload and form submission passed with every business API call intercepted; no live test request, duplicate3160, or stock movement was created.
