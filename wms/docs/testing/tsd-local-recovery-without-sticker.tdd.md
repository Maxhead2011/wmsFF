# TSD local recovery without WB sticker — TDD evidence

## Source and user journey

The journey was derived from production incident evidence on 2026-08-30.

As an FBS picker completing a local-only `FBS ДОВОЗ` request, I can finish the
WMS task after scanning the product and KIZ even when WB no longer returns a
sticker for the already `complete/shipped` order. A normal WB order must remain
blocked without a real sticker.

## Task report

| Stage | Command | Result | Evidence |
| --- | --- | --- | --- |
| RED | `gradle testLogoffDebugUnitTest --no-daemon` | Expected compile failure | `FbsLocalRecoveryPolicy` did not exist and the new test could not compile. |
| GREEN | `gradle testLogoffDebugUnitTest --no-daemon` | PASS | The focused production-source overlay completed 22 tasks successfully. |
| Regression | `gradle test assembleLogoffRelease --no-daemon` | PASS | All Logoff, Ffullhab and Platform unit-test variants passed; signed Logoff release assembled. |
| Artifact | `apksigner verify --verbose --print-certs` | PASS | Old and new APKs use the same V2 signing certificate. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A normal WB order cannot complete without a real sticker. | `regularWildberriesOrderStillRequiresSticker` | Unit | PASS |
| 2 | An emergency flow that may mutate WB cannot bypass the sticker. | `regularWildberriesOrderStillRequiresSticker` | Unit | PASS |
| 3 | Ozon cannot enter the WB local-recovery bypass. | `regularWildberriesOrderStillRequiresSticker` | Unit | PASS |
| 4 | A WB recovery with `wbMutationAllowed=false` may complete without a sticker. | `localOnlyRecoveryCanCompleteWithoutSticker` | Unit | PASS |

## Coverage and known gaps

The pure decision policy has full branch coverage through four assertions. The
repository baseline lacks several Android production files and flavor settings,
so validation was run against a read-only copy of the exact production Android
source with only this patch overlaid. No API, database schema, inventory or WB
mutation code was changed.

## Merge evidence

- RED checkpoint: `acd57e9 test(tsd): reproduce blocked local recovery without sticker`
- GREEN evidence: all Android unit-test variants and `assembleLogoffRelease`
  passed before the fix commit.
