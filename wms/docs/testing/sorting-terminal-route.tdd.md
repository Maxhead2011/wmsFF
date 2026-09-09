# Sorting: terminal WB order route retry (2026-09-09)

## Scope and observed state

User confirmed barcode 2048538899800, KIZ serial 8wiT2B)POFdD and target FFL_LKBS0709_08 for cancelled WB order 5497088111.
Read-only WB status checks returned cancel/canceled. During investigation a concurrent PR85 release restored this item through an administrator scan at 18:12:22 Moscow time. Its mark was AVAILABLE in that target. This change does not receive it again or rewrite shipment history.

A separate pending sorting route for request 536 failed with the FBS-only error. Its exact pending task had no physical scan, while its WMS order link recorded supplier status complete. The request had no ACTIVE/confirm links and was incorrectly rejected as non-FBS by repairFbsRequestSelection.

## Implementation and isolation

- marketplace-connections.service.ts: repairFbsRequestSelection only; exact sorting task subset can finish as a no-op when all tasks are unpicked WB tasks with matching terminal complete/cancel links.
- pallet-sorting-terminal-route.spec.ts: permission, client, warehouse, identity, status and no-write guards; integration of the marketplace and sorting services with mocked persistence.
- Ordinary whole-request repair remains unchanged. Existing ADMIN and WMS_PALLET_SORTING_ENABLED gates apply. No Android or sold-VM configuration changes.
- No stock, task, mark or WB mutation was performed by this fix. A future successful route retry clears only its pending queue entry; a newer queue revision is preserved.

## TDD evidence

Runner detected from package scripts: Vitest, pnpm monorepo. Used installed Node/Vitest binaries locally.

RED at 18:23:13: new terminal-route test file, 2 failed / 13 passed. Both intended success cases failed with the old FBS-only error before production-code changes.

GREEN at 18:24:19: terminal-route plus existing route tests, 19 passed. Added two service-chain checks afterward; terminal-route file alone passed all 17 at 18:29:53.

Commands (from the respective package directory):

```text
node node_modules/vitest/vitest.mjs run test/pallet-sorting-terminal-route.spec.ts test/pallet-sorting-route.spec.ts --maxWorkers=1 --minWorkers=1
node node_modules/vitest/vitest.mjs run test/pallet-sorting-terminal-route.spec.ts --maxWorkers=1 --minWorkers=1
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

Full API run: 165 files, 1665 tests passed (included the original 15-test version; both subsequently added tests passed in the 17-test targeted run). Full web run: 19 files, 70 tests passed. API and web typechecks passed. API build passed. git diff --check passed.

No browser/device E2E or coverage percentage was measured for this patch. Service-chain tests mock persistence; they are not PostgreSQL concurrency tests. RED checkpoint was not committed because repository instructions require green tests before every commit. RED evidence is preserved here. No unrelated refactor.

## Delivery

Branch: fix/sorting-cancelled-wb-return, based on PR85 merge 7a6c42dcdeca5bbdc8a06977e6a2a6a425f209d2.
Proposed PR base: fix/sorting-recorded-source-20260908. Publication requires user confirmation. No new APK is required for this API-only change.
