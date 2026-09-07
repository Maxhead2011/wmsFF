# WMSFF2207: administrative cross-box KIZ reconciliation

Status: publication authorized; candidate under verification. No production stock
writes, APK installation or forced device update performed yet.

Branch: `fix/tsd-admin-cross-box-reconciliation`, based on `5173b2d`.
Proposed PR target: `fix/fbs-box-scan-route-consistency` (WMSFF2207 only).

## Incident and scope

Admin scanned barcode `2047945626535` in `FFL_LKB2107_170`, but its AVAILABLE
mark was registered in `FFL_LKB1107_393`. The latter still had five AVAILABLE
units; the former had one. The old transfer guard unconditionally demanded a
manager when the old box had any balance. Konstantin confirmed physical counts
zero and one respectively. A fresh read-only production check found no unfinished
assembly for this SKU in either box. Other SKUs in the current box are NOT part
of this correction. Counts remain unchanged in production pending application.

## Files/functions and risk

- `apps/api/src/modules/stock/tsd-admin-box-recount.ts`: `planAdminOldBoxes`;
  high stock risk, checks explicit per-old-box counts, tenant/warehouse,
  unavailable balances and active tasks, includes old state in snapshot.
- `apps/api/src/modules/stock/stock-operations.service.ts`: `runTsdKizRecount`;
  atomic old/current stock adjustment, compare-and-set KIZ reassignment,
  before-state audit and idempotent replay. High stock risk.
- `apps/api/src/modules/stock/tsd-transfer-kiz-recount.ts`: `planKizRecount`;
  allows only internally validated adopted IDs for administrators. No public
  arbitrary-ID bypass. Existing shipment/history checks retained.
- Android `MainActivity.renderStockTransferScreen`: explicit admin entry,
  only Logoff and no selected/in-flight batch. Medium navigation risk.
- Android `StorageBoxTransferActivity`: old-box count dialog, response handling,
  immutable pending-request persistence/recovery and source handoff. Medium risk.
- Android `StorageKizRecountState`, `network/TsdTransferResponse`,
  `res/values/recount_strings.xml`: explicit counts, role/flavor entry guard,
  response fields and dialog resources. Low/medium risk.
- Tests: `apps/api/test/tsd-transfer-kiz-recount.spec.ts`,
  `apps/api/test/tsd-admin-box-recount.coverage.cjs`, Android
  `StorageKizRecountStateTest.java`. Documentation: this file.

Server remains under `WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED`;
no sold-VM deployment/config/version changes. Shared source would require a
separate review if cherry-picked to the sold VM. New UI is Logoff-only.

## Workflow

1. Admin opens ordinary transfer and scans the source box.
2. Chooses «ИСПРАВИТЬ ОСТАТКИ И КИЗЫ (АДМИНИСТРАТОР)», scans the SKU barcode,
   then «СВЕРИТЬ КИЗЫ ЭТОГО ТОВАРА» and ALL physical KIZs for that SKU.
3. If marks belong to previous boxes, the dialog requires an explicit quantity
   for every old box. No default zero. Preview changes no stock.
4. Admin reviews old/current quantities and confirms. Ledger, KIZ ownership and
   audit commit together. Existing controller refreshes affected FBS selections;
   failed refresh can retry the same confirmation without repeated stock changes.

Expected tested incident result: old box 5→0, current box 1→1; scanned KIZ moves
to the current box, absent AVAILABLE old marks are removed from active box
composition with audit; historical SHIPPING marks and other SKUs remain intact.

## TDD and verification

- RED: initial six cross-box service tests failed while existing 36 passed.
- GREEN: all 50 recount service tests passed, including exact zero/one case,
  repeat confirmation, malformed counts, foreign scope, stale stock/KIZ,
  historical shipping preservation, affected routes and transactional rollback.
- Scanner-prefix regression RED 1 / GREEN 50 after handling stored `]d2`.
- Snapshot-order regression RED 1 with 4 passing native tests before stable
  old-mark ordering; covered independently from database row order.
- Full API suite: 144 files, 1,287 passing. API TypeScript build/typecheck pass.
- Web unchanged: full 54-test suite passes.
- Android: tests written before methods (expected missing-method compilation
  failure), then 48 Logoff and 48 Ffullhab unit tests pass; Logoff debug APK builds.
- Native helper tests run against compiled JavaScript with Node coverage.
  Coverage threshold 80% for lines/branches/functions; measured 100% for this
  helper, NOT a claim of 100% service/application coverage.
- Full Android lint still fails with 10 existing errors and 22 warnings.
  New dialog concatenation warnings were corrected with resource strings;
  no suppression or unrelated sync/printing fixes. Do not report lint as green.
- No physical ATOL smoke test or real PostgreSQL concurrent-write test.

## Deliberately retained protections / remaining work

This is not an unconditional ADMIN bypass. Different tenant/warehouse,
confirmed shipment and unavailable stock cannot silently become available.
An active assembly in a previous box still requires the existing task-release
workflow first; this patch does not add cross-box active-task release.
For a nonzero old count below the number of its remaining KIZs, scan the old
box's full SKU composition instead of arbitrarily choosing which KIZs to retire.

Before publication: review/apply PR to live-image staging (live has additional
FBS safeguards not all present in the host checkout), rerun runtime tests,
increment/sign the Logoff APK only and verify upgrade on an ATOL. Never deploy
the entire stale host checkout. Apply the confirmed exact SKU correction via
the audited reconciliation and verify route refresh; no blanket box zeroing.

## Authorized release preparation (2026-09-07)

- Logoff APK versionCode 158, versionName `0.1.159-admin-box-count`.
  Signed release build and release lintVital passed, 48 tests for each flavor.
- APK SHA256 `022edfc8dbaeeac7118752ff6a641a3e57a950da8f47985bf6f81a2bf332ca3b`.
  Certificate SHA256 `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`,
  unchanged from prior Logoff release. No physical-device install claimed.
- Added guarded release script, live-image overlay Dockerfile, artifact and
  full-test comparison gate. Tests reject unexpected module/web changes.
- Added exact-scope repair script using existing authenticated preview/confirm
  endpoints. It validates user, SKU, old/current ownership and counts, saves
  the exact pending request privately, uses existing route refresh, and revokes
  its temporary maintenance session. No direct balance writes.
- API 1,287, web 54 tests rerun successfully before release commit.
- Stage applied with `git apply --check` without conflicts; private database
  backup created. Live source safeguards are preserved, not replaced from Git.
- API/web baseline images respectively `29358b8ee669c901d144fc2695f388334d0623f82d72317d0cdc68929e8acf45`
  and `1981a1fef31c2fa945a04859fef82cf407b4878b61903c5239cc261ecb114af6`.
- Private backup/staging directories: `/opt/logoff-wms-backups/tsd-cross-box-20260907`
  and `/opt/logoff-wms-releases/tsd-cross-box-20260907`.
- Shared update metadata and every existing web/download file remain unchanged;
  the new APK is additive at `/downloads/logoff-tsd-admin-box-count-158.apk`.
