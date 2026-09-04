# Online FBS remaining-search progress

Source: Konstantin reported that online request 592 still required all goods after PR39.
Scope: WMSFF2207 only. No database mutations, task resets, stock changes, WB calls or APK edits.

## Cause and fix

`ClientRequestsService.list` and `TsdAssemblyService.loadFbsAssemblyFacts` independently
discarded COMPLETED tasks predating fbsEmergencyAssemblyAt. PR39 fixed the handheld
list but missed these online views. Both read paths now honor the current task status.
Full emergency reset still sets tasks to WAITING_STOCK and therefore remains incomplete.
Cancelled links and RETURN_REQUIRED handling are unchanged.

## Evidence

- Production read-only replay before fix: 11 COMPLETED, 1 IN_PROGRESS, 1 RETURN_REQUIRED;
  online details returned 0 completed and 12 remaining linked orders.
- Order 5657354981 became RETURN_REQUIRED at 2026-09-04T17:13:12.503Z following WB
  buyer cancellation. Order 5658503591 was in progress for Administrator at
  2026-09-04T17:15:41.209Z. Do not restore either status or claim the old 12/13 snapshot.
- RED: `pnpm --filter @logoff/wms-api test test/fbs-online-remaining-progress.spec.ts`
  ran the first seven tests: 4 failed / 3 passed; local-mode output lost all completions.
- GREEN: eight new tests pass, including the subsequently added cancellation case.
- Combined new tests and PR39 tests: 28 pass.
- API lint and build pass.
- Full API: 667 passed / 75 failed, identical failing names to previous 659/75 run.
  Existing client-requests/tsd-assembly test failures remain; do not claim a clean suite.
- `git diff --check` passes. No instrumentation coverage percentage or browser/device
  E2E result is claimed. Tests execute real service read methods with mocked repositories.

## Guarantees

- Online list counts 12 of 13 completed before activation (92%), without marking all done.
- Details retain saved box/barcode/KIZ facts, leaving exactly one item uncollected.
- No-local-mode behavior remains the same.
- Fully complete local request reaches 100% and has no uncollected rows.
- Explicit full reset still requires all 13 items, even if a historical timestamp remains.
- Legacy COMPLETED tasks without completion dates still count consistently with PR39.
- RETURN_REQUIRED remains a manager decision, not a new collection task.

## Release boundary

Branch: fix/fbs-online-remaining-progress.
Proposed PR base: baseline/our-vm-production-20260827.
Only the two read-service files, new test and this evidence file belong to the fix.
Shared API read paths could affect sold WMS if imported there: keep this release isolated.
Pending stock-operations and tsd-storage-box-transfer edits are excluded.
Implementation was left uncommitted pending publication approval. Konstantin confirmed
publication on 2026-09-04 after disclosure of the unchanged 75 failures. User requirements
took precedence over RED checkpoint commits. Record deployment verification in the PR;
no stock repair or task mutation is needed.
