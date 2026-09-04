# FBS box scan / route consistency

Source: Konstantin's request to prevent recurring competing-request errors; screenshot
of request 585 scanning FFL_G_LKB0707_021 on 2026-09-04.

## Production findings (read-only)

- Current task 229494ef-b87a-4f9c-ab9a-91893ccd01f3, order 5654353030, request 585.
- Source box 92c4aa51-b916-4de8-ab9b-d07fe7a6b111 has 2 AVAILABLE units for SKU
  e26d6899-e4ad-4e7d-aacc-fb9180b2de16. Both are virtually protected by two older
  RETURN_REQUIRED tasks in request 304: orders 5527455930 and 5527368383.
- Both had prior box/barcode/KIZ scans, WB metadata REJECTED, and no corresponding
  product-mark entry or confirmed physical pick movement found. Konstantin subsequently
  confirmed the two L/46 units were physically present and free for new orders.
- The message wrongly asserts a recent competing claim. Both reservations date from
  2026-08-27; do not reset them simply because they are old or WB reports complete.
- Konstantin reported 3 physical suits in the box. A whole-box balance check matches
  that total: 2 AVAILABLE L/46 (2052400023880), 1 AVAILABLE XS/40 (2052400023910).
  This was not permission to increase balances. The two stale conflicts were resolved
  through the existing manager return path; the box balance stayed 2 × L/46 and 1 × XS/40.
- Another returned task had an actual PACKING pick and was already excluded by existing
  reservation logic. No changes to physical-pick detection or stock accounting here.

## Surgical changes

`MarketplaceConnectionsService.scanFbsTsdBox` and `formatFbsTsdAssembly` use the existing
bulk reservation classification and evaluateFbsBoxAvailability, matching the locked
claim and pallet preview. Untouched background hints no longer become protected claims
in an intermediate check. The atomic claim still rechecks and releases only permitted
untouched reservations; physical scans/return holds remain protected.

`refreshFbsTsdBoxRoute` reloads owned task state and returns a normal TSD response after
stale availability, rather than throwing FBS_ROUTE_STALE with a web-only route payload.
It offers a live alternative or explicitly says no free box was found. It does not claim
the scanned box was accepted. Ownership, sync, wrong-box and warehouse errors remain.

Existing Android success handling replaces fbsAssembly and only confirms a physical box
when scannedBoxCode matches. No APK changes or claim of device E2E testing. Existing
clients may use their normal success sound/color on a route refresh; response text and
SCAN_BOX state make clear that collection has not advanced.

## TDD evidence

- RED: first eight tests compiled/executed, 6 failed / 2 passed. Failures reproduced
  blocked background-only reservations and ConflictException instead of refreshed tasks.
- GREEN: 11 regression tests pass; combined availability, rescan and transaction-retry
  suites pass 35/35. Tests invoke real scan/format methods with mocked repositories;
  the atomic claim is stubbed here and separately covered by existing tests.
- Final API lint/build pass.
- Final full API run: 678 pass / 75 fail, identical failing names to prior 667/75.
- No coverage percentage or live end-to-end scan result is claimed.

## Boundaries

Branch: fix/fbs-box-scan-route-consistency.
Proposed PR base: baseline/our-vm-production-20260827. Shared FBS service must not be
published to sold WMS without review. Only service, new test and this document belong
to this fix. Pending stock/KIZ-transfer edits are unrelated and excluded.

The separate authorized production correction released only the two cancelled request-304
holds and preserved their scan/KIZ values in audit history; it did not mutate inventory
quantity. Known full-suite failures prevent a clean-suite claim; no RED checkpoint commit
per user's stronger rules. This code prevents misleading dialog/route handling, not all
legitimate stock shortages or simultaneous physical claims.
