# Existing sorting destination top-up — 2026-09-09

## Scope and evidence

Journey supplied by Konstantin: scan an already filled destination in a new
sorting session and add units without clearing/re-receiving its current stock.
Only WMSFF2207. No Android changes, migrations or production data writes.

Read-only production check: FFL_LKBS0709_12 is active, on PALET_SORT_03,
with 3 AVAILABLE units. Its prior sorting is COMPLETED. The current FORMING
session starts from PALET_SORT_02 and does not include this box as a source.
Root cause: openTarget allowed a non-empty box only when found in the current
session's targets; otherwise it required an empty box.

## Change

`PalletSortingService.openTarget` permits an existing destination, preserves its
stock/marks, and initializes the displayed quantity from the locked stock sum.
Negative balance rows remain blocked (not silently netted against positive rows).
Client, warehouse, placement, source/target separation, competing session,
inventory and non-FBS request checks are unchanged. Opening writes session/audit
state and, if absent, placement; it does not create receipt/movement records.

## RED / GREEN

Command from apps/api:
`node node_modules/vitest/vitest.mjs run test/pallet-sorting-reopen.spec.ts --maxWorkers=2 --minWorkers=1`

- RED before service edit: 3 failed, 17 passed. Exact failure:
  `Для формирования нужен пустой целевой короб.`
- GREEN after service edit: 20 passed.
- Guarantees: existing destinations with 0/3/13 units; no replacement Box;
  repeated close/reopen retains count and one target; unsafe ownership,
  warehouse, placement, source, archive, concurrent target/session, inventory
  and negative balance cases remain rejected.

Full local API suite:
`node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/reports/sorting-nonempty-target/api-tests.json`
Result: 1561 passed, 0 failed.

Lint/build equivalents from package.json:
`node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
and `node ../../node_modules/typescript/bin/tsc -p tsconfig.json`: both exit 0.
The pnpm wrapper attempted dependency synchronization and aborted without TTY;
existing installed TypeScript was run directly instead. Dependencies unchanged.

## Gaps and handoff

Coverage command with `--coverage` could not run because @vitest/coverage-v8 is
not installed. No percentage is claimed. Physical TSD/E2E and real SQL top-up
were not run for this patch. No production publication in this task yet.
Checkpoint RED commit deliberately omitted: user requires green tests before
any commit. RED/GREEN proof is preserved above. No unrelated refactoring.

Proposed PR: fix/sorting-existing-target-topup -> fix/sorting-recorded-source-20260908.
Before publication, apply the minimal service diff to the verified live API
base so unrelated production fixes are preserved. Sold environment excluded.
