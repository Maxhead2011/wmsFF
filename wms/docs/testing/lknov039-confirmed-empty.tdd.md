# FFL_LKNOV1607_039: approved empty-box reconciliation

Date: 2026-09-06. Scope: WMSFF2207 only. Explicit user confirmation: the source box is physically empty; remove 2 AVAILABLE units and 4 stale PACKING units, preserving history and the destination FFL_LKBBOX_012. Do not archive the source.

## Changes and risk

- `apps/api/src/scripts/repair-lknov039-confirmed-empty.ts`: guarded, manually invoked repair; high data risk mitigated by exact IDs/quantities, snapshot digest, Serializable transaction, row locks, compare-and-set writes, before snapshot and postconditions.
- `apps/api/test/repair-lknov039-confirmed-empty.spec.ts`: 16 focused regression tests; no application runtime changes.
- This evidence file: documentation only.

No sold-VM module, route, service, migration, UI, or automatic deployment changed. This script must not be used for other boxes. Parent PR #56 is a separate, still-unpublished change.

## Diagnosis

The PACKING quantity is not four active assembly tasks. Five stale PACKING units originated from closed requests 303/334, were consolidated from FFL_LKB0106_081 into this box, and later request 523 consumed one box-linked PACKING unit, leaving four. The inspected requests are DONE in WMS; this is not evidence of marketplace delivery to a customer.

The last observed physical transfer to FFL_LKBBOX_012 was one unit of barcode 2047946106760 at 2026-09-06 14:16:25 UTC. Its destination balance and mark are protected against changes by the repair.

## Guarantees and tests

User journey: reconcile a confirmed-empty source without inventing shipments, modifying the destination or erasing history.

| Guarantee | Validation | Result |
| --- | --- | --- |
| Only the approved three balance rows can change | Exact snapshot and scope tests | PASS |
| Changed quantities, active work or reopened requests abort | Negative validation tests | PASS |
| Three INVENTORY_ADJUSTMENT movements, not SHIP | Transaction-operation tests | PASS |
| Missing AVAILABLE mark is detached and BLOCKED, not deleted/shipped | Mark compare-and-set test | PASS |
| Concurrent balance/mark changes and audit failures abort | Failure tests | PASS |
| Replay and partial correction cannot clear a refilled box | Idempotency tests | PASS |
| Changed destination invalidates preflight digest | Digest test | PASS |
| Destination, tasks, history and source placement remain unchanged | Real transaction postconditions with forced rollback | PASS |

## Executed validation

Commands run from `apps/api`, using installed runners without modifying shared dependencies:

```text
node node_modules/vitest/vitest.mjs run test/repair-lknov039-confirmed-empty.spec.ts --maxWorkers=1 --minWorkers=1
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

- RED: executable initial skeleton, 14 tests executed; 3 failed because implementation was missing, 11 passed. A preceding missing-module error is not counted as RED evidence.
- GREEN: 14/14, subsequently 16/16 with replay/digest tests added.
- Full API suite: 138 files, 1153/1153 tests passed.
- API lint/type check and build passed.
- No RED commit: user requires all tests green before every commit. This report preserves the RED/GREEN evidence.
- Coverage percentage not measured: coverage provider unavailable; dependencies deliberately not installed into shared node_modules. No browser flow changed; browser E2E not run for this operational script.

## Production preflight and rollback proof

Readonly snapshot: AVAILABLE 2, PACKING 4, no active picking task or counting inventory. Digest:

`e607166d1a01bac85cb4c4f93ae0604a6f231085ba4851ed34c2502adc2e9ee6`

Before any committed correction, a private backup was copied outside the API container to `/opt/logoff-wms-backups/lknov039-empty-20260906/preview.json` (0600). Backup-file SHA256:

`2f3dfed6c9c00357450343f077e8704b01c6f90ec7c607b8def39650dfc51ecd`

`--mode=rollback-test` executed all changes and postconditions, then deliberately rolled back: `ROLLBACK_TEST_PASSED`. Subsequent readonly preview returned the identical snapshot digest and original 2+4 units. No application restart or deployment was performed.

Apply remains an explicit separate invocation with this digest and a new private before-snapshot path. Verify APPLIED, repeat for ALREADY_APPLIED, and independently inspect source balances and protected destination afterwards. Never restore an old snapshot blindly after new warehouse operations.
