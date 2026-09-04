# FBS remaining-only local search

Scope: WMSFF2207, request 592 (12 physically completed orders, one unlocated item).
The user confirmed that order 5658503591 was not found, despite WB reporting complete.
Do not mark it completed or deduct stock without an actual scan.

## Implementation

- Add admin-only POST `fbs/requests/:requestId/remaining-search`.
- Reuse the existing local/emergency WB-mutation guard without invoking the destructive
  full-emergency reset. All existing assemblies, KIZ associations and stock are preserved.
- Validate open WB-only request, shipped remaining orders and untouched pending tasks.
  Reject active marketplace work, cancelled remaining orders and started physical/return work.
- Update only request local-mode metadata/status with a Serializable transaction and CAS;
  write the audit and event in that same transaction. Repeated activation is idempotent.
- Count COMPLETED tasks independently of activation time. Full emergency restoration still
  explicitly resets statuses, so its existing reset workflow is unchanged.
- Keep the handheld's `totalOrders` meaning (remaining orders). Add `Собрано 12/13` to its
  existing title and fill `completedOrders`; no APK update or new UI parser required.
- Queue allocation skips the completed 12; source/barcode/KIZ and normal physical stock
  accounting remain mandatory for the remaining order. Existing local-mode KIZ handling
  avoids WB metadata/status mutation; sticker retrieval may still read from WB.

## TDD evidence

Source plan: user-approved remaining-only search; no external plan file.
Test: `apps/api/test/fbs-remaining-local-search.spec.ts`.
Command: `pnpm --filter @logoff/wms-api test test/fbs-remaining-local-search.spec.ts`.

- RED: list lost old completions (returned all 13 pending) and failed full archive;
  the new activation method did not exist (16 failures / 2 passes in initial run).
- GREEN: 20 tests pass, including actual queue allocation (only order 13 is assigned),
  no task reset or WB/stock/KIZ writes on activation, authorization, rollback, idempotency,
  unsafe-state rejection, active/archived list behavior and refusal to finish without scans.
- API lint and build pass.
- Full API: 659 pass / 75 pre-existing failures. Failure names identical to
  `fbs-stale-rescan-tests-20260904.json` (639 pass / 75 fail).
- No instrumented coverage percentage or real-device E2E result is claimed.

## Release boundary

Branch: `fix/fbs-remaining-local-search`.
Proposed PR base: `baseline/our-vm-production-20260827`.
Do not include pending stock-operations/tsd-storage-box-transfer edits.
Shared FBS service changed: publish to WMSFF2207 only, never to sold WMS without review.
No production activation, commit or deployment was performed during implementation.
Konstantin explicitly approved publication on 2026-09-04 after disclosure of the
75 unchanged full-suite failures. Release only the four files listed above; record
production verification in the PR after deployment.

After publishing, activate only request 592 via the new authorized method, then verify:
12/13 progress, one remaining order, unchanged completed assemblies/stock, audit event.
Do NOT call the old full emergency-assembly endpoint for this request.
