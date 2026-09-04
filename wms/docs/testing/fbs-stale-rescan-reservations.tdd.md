# Closed-request RESCAN_REQUIRED reservations

Date: 2026-09-04. Scope: WMSFF2207 only.

## User journey and cause

Request 653 has an eligible WB order and one AVAILABLE unit in FFL_LKB2504_212.
Order 5434003539 from closed request 147 retained RESCAN_REQUIRED since August 6.
Both reservation calculators excluded obsolete RESERVED/COMPLETED work, but not
RESCAN_REQUIRED. The old task consumed virtual capacity despite the closed request.

## Minimal change

`fbsTsdReservationRows` and `fbsTsdReservationRowsBySku` use the existing
closed-request / exact shipped-order check for RESCAN_REQUIRED as well as RESERVED.
No stock, marks, active physical work, or return-required task writes are added.
No architecture changes or Android changes.

## Evidence

Tests: `apps/api/test/fbs-stale-rescan-reservation.spec.ts`.
Command: `pnpm --filter @logoff/wms-api test test/fbs-stale-rescan-reservation.spec.ts`.

- RED: 9 failed / 8 passed. Both calculators retained stale capacity and the new order's source was null.
- GREEN: 17 passed. Closed requests and shipped orders release stale rescan capacity;
  active rescans, another connection's order, return-required and physically started work remain protected.
- API lint and build passed.
- Full API suite: 639 passed / 75 failed. Failure names match the pre-change
  `storage-box-new-kiz-tests-20260904.json` baseline exactly (622 passed / 75 failed).
  The checkout includes the separately pending, uncommitted storage-box KIZ fix;
  those files must not be included in this change's PR.
- No coverage percentage is claimed; coverage instrumentation and a device E2E run were not executed.

## Authorized operational repair

Only task `283180a0-bef1-4b6a-9fe9-7331ec04a1c3` changed from RESCAN_REQUIRED to RELEASED,
with an explanatory errorMessage. A Serializable transaction checked the exact old
updatedAt, request 147 DONE, the exact order shipped/complete, and no worker/barcode/KIZ.
Audit `35251381-0be9-4194-a556-a42e919f9cc9` stores the previous status/message/timestamp.
No quantities, marks, box references or historical scans were changed.

Post-repair read-only execution of production's source resolver returned zero
reservations and one AVAILABLE unit in FFL_LKB2504_212 for request 653.
The real TSD's subsequent scan has not been verified.

## Release state

Branch: `fix/fbs-stale-rescan-reservations`.
Proposed PR base: `baseline/our-vm-production-20260827`.
Konstantin explicitly approved commit and publication after disclosure of the
75 unchanged pre-existing test failures. Release verification is recorded in the PR.
The source fix affects shared FBS reservation methods and must only be published
to WMSFF2207; do not merge it into the sold deployment without separate review.
