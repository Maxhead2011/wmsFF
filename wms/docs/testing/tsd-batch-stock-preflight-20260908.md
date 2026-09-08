# TSD batch preflight and FFL_LKB2107_22 correction — 2026-09-08

## Scope
User: Константин. Only our WMS. Branch `fix/tsd-batch-stock-preflight-20260908`.
Created from the working branch and fast-forwarded to its already merged upstream `9c803b9`.
Proposed PR base: `fix/sorting-recorded-source-20260908` (same base as PR78).
No PR/deployment performed in this task.

Files/functions:
- `apps/api/src/modules/stock/stock-operations.service.ts`, `executeTsdTransferBatch`: medium regression risk, shared API method. Complete-batch read validation before target creation or any ledger write; existing transfer/revalidation, permissions, idempotency and transaction behavior retained.
- `apps/api/test/tsd-transfer-batch-preflight.spec.ts`: isolated handler regression tests.
- `infra/scripts/repair-ffl-lkb2107-22-double-pick.cjs`, `validateEvidence/evidence/run`: high data-domain risk, exact incident only, read-only snapshot, Serializable correction, inventory/box locks, rollback assertions and fixed idempotency key.
- matching `.test.cjs`: guard tests.
- this report.

WARNING for any sold-WMS merge: batch handler is shared source. Sold environment and Android/web were not deployed or changed here; do not promote this branch there automatically.

## Incident evidence
TSD operation `793a4807-136c-4755-b192-19a44364cbd5`, 2026-09-08 17:49:58 MSK:
source FFL_LKB2107_22, target FFL_LKBS0709_07, seven distinct KIZ scans, AVAILABLE stock six.
All seven marks still belonged to the source, AVAILABLE; checked order/shipment/print/circulation histories had no matches.
Batch ledger contained zero committed rows. The seventh iteration failed; whole transaction rolled back.
MainActivity clears scan lists only on success, not on this error.

Request 576 / order 5653603723 had one completed unit from this box.
PICK `330eb3fc-f0e1-48b9-ae31-96d98aa66d87` on Sep3 removed one AVAILABLE unit.
Manual-close PICK `31120d9e-df14-4b52-8415-43950f67ad1f` on Sep4 removed another from the same source/request.
This historical double deduction is corrected by one compensating movement, not by editing old records or receiving seven new units.

## Applied data correction
Fresh full PostgreSQL dump, pg_restore listing and SHA256 verified:
`/opt/logoff-wms-backups/repair-ffl-lkb2107-22-20260908/` (scope snapshot before.json).
Applied inventory adjustment +1:
`2c68bf6c-1c1c-4f8a-b435-63ba695d6c2f`.
Committed read-only verification: AVAILABLE balance 7, AVAILABLE ledger sum 7, 7 marks, one audit record.
Marks, original deductions and box placement unchanged; no actual transfer performed.
Explicit replay returned ALREADY_APPLIED with the same movement ID; no repeated increment.
This changes only the verified historical data, not WMS receipt/FBS closing rules.

## TDD evidence
- Batch RED: 4/7 failed: wrong empty-box message for 7 vs6, lack of per-SKU whole-batch check, writes before duplicate/bad later scan.
- Batch GREEN: same 7/7 pass, plus related stock suites 186/186.
- Repair guard RED: newly referenced missing validator module.
- Repair guard GREEN: 15/15; rejects changed stock, mismatched ledger, other client/warehouse, missing/duplicate marks, histories, already moved units, additional orders and wrong deductions.
- Full API: 1534/1534 in 157 files, `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1`.
- Web: 61/61 in 17 files, same runner.
- API lint/typecheck: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`, PASS.
- API build: `node ../../node_modules/typescript/bin/tsc -p tsconfig.json`, PASS.
- Repair guards: `node --test infra/scripts/repair-ffl-lkb2107-22-double-pick.test.cjs`, PASS.
- `git diff --check` PASS.
Coverage percentage not measured. No physical-device replay or isolated PostgreSQL batch test for the new preflight.
The new message is returned at batch submission; separate per-item scans do not carry the entire pending list, and no Android behavior was changed.
User green-before-commit rule overrides a RED-stage commit; RED evidence preserved here.

Unrelated dirty `apps/api/test/pallet-sorting-postgres.cjs` preserved/excluded, SHA256:
`93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18`.

```ts
// FIX: validate the complete batch against one source snapshot before creating a target or writing stock.
const requestedBySku = new Map<string, { quantity: number; available: number; name: string }>();
// TEST: execute the real batch handler; stock writes are observable and must not start on invalid batches.
```
