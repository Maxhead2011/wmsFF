# Physical surplus in an existing sorting source — 2026-09-07

## Scope and behavior

User journey: an administrator sorts a pallet, empties the recorded source stock, then physically finds another unit in the same box. Scanning its SKU barcode, new KIZ and explicit source must permit accounting in the target without leaving the sorting screen.

Only `PalletSortingService.move` and `StockOperationsService.recoverSortingUnit` change. The existing recovery transaction, global KIZ history checks, idempotency, client/warehouse scope, inventory locks and ADMIN/`WMS_PALLET_SORTING_ENABLED` gate remain. No migrations, bulk corrections, production stock writes, Android/web code or sold deployment changes.

Known source recovery requires a scanned active source from the locked session with unchanged client, warehouse and pallet placement. The selected SKU must have **no nonzero balance in any status** in that source. A fresh unregistered KIZ is required. Ordinary positive AVAILABLE stock follows the existing paired MOVE path. Existing/shipped KIZs and reservations are not silently converted to receipts.

The target receives one `INVENTORY_ADJUSTMENT +1` and one ProductMark. No debit is invented in the empty source or any other box. Session moves and `PALLET_SORTING_UNIT_RECOVERED` audit retain source ID/code, barcode, KIZ identity and reason `SKU_STOCK_MISSING`; the movement comment records the zero-versus-physical-one discrepancy and administrator. Known boxes are not added to `BOX_NOT_FOUND` entries. Existing TSD found-unit counter consumes the unchanged `recovered: true` field. Remaining shortages still require separate explicit confirmation.

## Files and risk

- `apps/api/src/modules/inventory/pallet-sorting.service.ts`: `move`, additive recovery reason in state; medium risk, admin sorting only.
- `apps/api/src/modules/stock/stock-operations.service.ts`: `recoverSortingUnit`; high stock-accounting risk, existing scoped recovery reused. Ordinary transfer and FBS code untouched.
- `apps/api/test/pallet-sorting-late-source.spec.ts`: regression plus explicit-source eligibility checks.
- `apps/api/test/pallet-sorting-recovery.spec.ts`: known-source balance, scope, history, replay checks.
- `apps/api/test/pallet-sorting-late-source-postgres.cjs`: unknown-barcode assertion updated to stock service validation.
- `apps/api/test/pallet-sorting-discrepancy-postgres.cjs`: synthetic real-database end-to-end service scenario.
- This evidence report.

Pre-existing uncommitted `apps/api/test/pallet-sorting-postgres.cjs` excluded; SHA256 unchanged: `93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18`.

## RED → GREEN evidence

Baseline branch `fix/sorting-late-pallet-source-20260907`, commit `e457f5d257cfa55e308b81de8e3aa2cd48012ac5`. New task branch `fix/sorting-physical-stock-discrepancy-20260907`.

Tests were written and run before business logic edits. API Vitest target `test/pallet-sorting-recovery.spec.ts test/pallet-sorting-late-source.spec.ts` initially: **13 failed / 50 passed**, including the exact `нет доступного остатка по ШК` blocker and the stock-layer existing-source rejection. No failing checkpoint commit was made because the user's stricter rule requires all tests green before commits.

Same tests after fix: **63 passed**. Additional safety assertions brought final target to **68 passed** (18 late-source, 50 recovery).

Real PostgreSQL RED: current production image `sha256:0796e13229b1cf17395c8b9e57ae76ee488ec3e1f0fdd490a4cdd43ea862953a` run only inside isolated test network against synthetic DB reproduced the same 409 after ten ordinary moves.

Real PostgreSQL GREEN: same image/test with two compiled service modules mounted read-only returned:

```json
{"result":"PASS","normalMoves":10,"recovered":2,"unrelatedQuantity":7,"ledger":22,"idempotency":"PASS","concurrent":"PASS","auditRollback":"PASS","reservation":"PASS","historicalKiz":"PASS","shortagePreview":3}
```

Additional PostgreSQL suites with the changed services:

- late-source: source9 / target1 / total10 / ledger2; retry, invalid barcode rollback, remaining preview PASS.
- unknown-source recovery: recovered3 / ledger3; rollback, concurrent retry, alternative KIZ encodings, literal LIKE escaping, completion PASS.

Isolation: stopped dedicated postgres16 container with tmpfs, internal-only Docker network, fresh `sorting_recovery_test`, schema only copied from production (no operational rows). All test scripts assert NODE_ENV, database hostname and database name before constructing Prisma. Container stopped by exit trap. Local orchestration artifact: `C:/WMSFF2207/tmp/sorting-discrepancy-test-20260907.sh` (`old`/`new`, optional `discrepancy`/`late-source`/`recovery`). No production service restart or balance change.

## Commands and final results

Bundled Node executable: `C:/Users/HonorPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`.

| Verification | Command (relative to application) | Result |
|---|---|---|
| API full suite | `node node_modules/vitest/vitest.mjs run` | 152 files, **1397 tests PASS** |
| API build | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json` | PASS |
| API lint/typecheck | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS |
| Web full suite | `node node_modules/vitest/vitest.mjs run` | 16 files, **58 tests PASS** |
| Web lint/typecheck | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS |
| Web bundle | `node node_modules/vite/bin/vite.js build` | PASS, existing missing asset/chunk-size warnings |
| Native regression tasks | Gradle `:app:testLogoffDebugUnitTest :app:testFfullhabDebugUnitTest --offline` | BUILD SUCCESSFUL; 44 tasks UP-TO-DATE, cached reports 52 tests each |
| Target native V8 coverage | `SORTING_RECOVERY_COVERAGE=true` with recovery/late-source Vitest target | recoverSortingUnit 40/41 blocks **97.56%**; recordProblemSource 4/5 **80%** |

V8 block coverage is not project-wide Istanbul line coverage. Actual physical TSD scan and browser E2E were not performed for this server-only change; production publication and the operator's pilot are still pending. No APK was rebuilt or distributed. Existing TSD recovery message is generic; detailed discrepancy reason is in server state/audit/ledger.

## PR / release boundary

Propose PR into established **our-WMS integration branch `fix/fbs-box-scan-route-consistency`** (verified base of merged PR68), remote `publish` (`Maxhead2011/wmsFF`). Do not push integration branch directly. Do not deploy sold WMS or alter its flags/configuration.

IMPORTANT: production `stock-operations.service.ts` includes a separately published calculated-overweight warning change in `validateBoxWeight`, absent from this local baseline. Future release must preserve that live function by strict baseline overlay; never replace the complete live file blindly. Existing helper `infra/scripts/sorting-recovery-overlay.cjs` can perform checked function preservation. This task changes only recovery, not weight handling.

Before any later approved publication: merged PR proof, fresh backup, baseline/overlay verification, isolated candidate full tests, existing flags unchanged, our API health check, operator pilot on current session. This commit does not claim those release steps occurred.
