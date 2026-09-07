# Permanent storage boxes and source KIZ lifecycle — WMSFF2207

## Approved behavior

Konstantin confirmed: an empty storage box remains active until explicitly deleted.
A transferred KIZ leaves the source box and remains active at its destination.
A shipped KIZ retains shipment history, not active source placement.
Existing cancellation/return/replacement restrictions are not relaxed by this change.

## Isolation and delivery

- Branch: `fix/permanent-storage-box-lifecycle`, created from `feature/pallet-box-contents-hover` at `ea5908b`.
- Proposed PR target: `fix/fbs-box-scan-route-consistency` (our current release branch).
- Flag: `WMS_PERMANENT_STORAGE_BOXES_ENABLED=true`, only for WMSFF2207.
- Default is false. Keep false in sold WMS / FFULHAB. No schema migration, APK or web runtime changes.
- Storage identification uses `warehouse.boxCodePolicy.storageBoxPrefix` and `storageBoxAliases`, including FFL_LKBBOX only when configured.
- A missing/unavailable policy fails the transaction instead of allowing accidental archival.
- Production has NOT been changed by this task. No bulk correction of previously archived boxes or historical stock.
- Release ref has advanced to PR53/54 in parallel; integrate and repeat affected tests before deployment. Do not overwrite those changes.

## Changed production files / impact

All paths below are relative to `wms/`.

- `apps/api/src/common/boxes/box-code-policy.service.ts`: shared flag and permanent-storage predicate.
- `apps/api/src/modules/stock/stock-operations.service.ts`: `executeTsdTransfer`, `executeTsdTransferBatch`, `transferWholeBox`; retain empty permanent source and return accurate archive flags. Mark movement stays atomic and idempotent.
- `apps/api/src/modules/inventory/sku-sorting.service.ts`: `move`; no permanent-source archival after sorting.
- `apps/api/src/modules/warehouse/warehouse-box-integrity.service.ts`: `decideRow`; apply stock decision without removing reusable location.
- `apps/api/src/modules/administration/administration-unpalleted-writeoff.service.ts`: `preview`, `applyOneBox`; exclude permanent storage from mass writeoff/archive, including stale selections.
- `apps/api/src/common/boxes/archived-empty-box-pallet-detach.service.ts`: `evaluateInDatabase`; no automatic permanent-box detach, including old archived records.
- `apps/api/src/scripts/reconcile-archived-empty-pallet-boxes.ts`: `main`; inject the configured policy in CLI as in Nest.
- `apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts`: `moveExistingFbsKizToOpenedBox`, `reserveCompletedWildberriesStock`; preserve permanent source, remove physical KIZ placement on WB pick. Task/movement source remains intact for returns.
- `apps/api/src/common/shipment-history/shipped-kiz-history.ts`: `captureShippedKizHistory`; clear source placement on current shipment only. Do not mutate live marks during DONE-history refresh or using archived assembly attempts. Guard SKU, original source/null PACKING location, status and mark update timestamp; later receipts/moves/rebindings are not seized.
- `.env.example`: opt-in configuration documentation.

## TDD evidence

Tests preceded production edits. RED: 5 failures in transfer/sorting/detach/pick; 7 failures in whole-box/shipment tests; 2 failures in administrative cleanup/integrity. Failures demonstrated actual archive/update calls, not missing dependencies or syntax errors.

No RED checkpoint commit was made: the user's green-tests-before-commit rule takes priority. No refactoring stage.

| Guarantee | Tests (`apps/api/test/`) | Result |
| --- | --- | --- |
| Permanent last-unit source survives, same KIZ goes to target once, batch retry is idempotent | `tsd-storage-box-transfer.spec.ts` | PASS |
| Whole-box transfer retains reusable source and ordinary archival behavior | `stock-whole-box-transfer.spec.ts` | PASS |
| SKU sorting retains storage but moves KIZ | `sku-sorting-move.spec.ts` | PASS |
| Zero-count decision preserves permanent placement, ordinary writeoff unchanged | `warehouse-audit-history-scope.spec.ts` | PASS |
| Mass archive preview/apply exclude permanent boxes | `administration-unpalleted-writeoff.service.spec.ts` | PASS |
| Reconciliation cannot detach permanent storage | `archived-empty-box-pallet-detach.service.spec.ts`, `reconcile-archived-empty-pallet-boxes.spec.ts` | PASS |
| Configured prefixes/aliases only; flag-off isolation; settings failure fails closed | `box-code-policy.service.spec.ts` | PASS |
| Both FBS relocation branches retain permanent source and move exact KIZ | `fbs-permanent-box-lifecycle.spec.ts` | PASS |
| WB pick clears source KIZ placement; undo restores it; task source unchanged | `fbs-stock-reservation-mark.spec.ts` | PASS |
| Shipment preserves history and clears source; no seizure of moved/rebound/recovered/blocked KIZ; DONE refresh is history-only | `shipped-kiz-source-lifecycle.spec.ts` | PASS |

Commands actually run (direct tools avoid modifying the shared node_modules junction):

- API: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1` — **131 files / 1021 tests PASS** (140.27 s).
- One preview test was added after that full run; rerun `test/administration-unpalleted-writeoff.service.spec.ts` — **27 tests PASS**. Combined current test count covered: 1022; not a second full-suite run.
- API lint: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — PASS.
- API build: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json` — PASS.
- Web: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1` — **12 files / 45 tests PASS**.
- Web lint: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — PASS.
- Web build: `node node_modules/vite/bin/vite.js build` — PASS; existing warnings about font/image runtime URLs and chunks above 500 kB.
- `git diff --check` — PASS.

Coverage percentage is not measured: `@vitest/coverage-v8` is absent; shared dependencies were not modified. No claim of 80% coverage. Tests use mocked transactions/predicates; no PostgreSQL concurrency or physical TSD E2E test was performed in this task. Those remain deployment acceptance checks.

## Deployment / rollback checklist

1. Integrate latest our-WMS release, resolve no conflicts without user direction; rerun affected/full suites.
2. Publish through PR only, verify installed runtime and box-prefix policy, enable flag only on our WMS.
3. Verify last-unit transfer from a disposable box and a permanent box, empty permanent pallet placement, exact KIZ at target, WB pick/undo/shipment, immutable old shipment history after return.
4. Do not mass-reactivate old archived boxes or recompute quantities as part of deployment.
5. Disabling the flag restores old code behavior for future operations; it does not undo already committed stock movements or source-KIZ detachments. Use a forward fix for data inconsistencies, not blind rollback of stock.
