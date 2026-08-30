# FBS pallet physical priority — TDD evidence

## Source and user journey

The journey was derived from the production incident on 2026-08-30:
an FBS picker must be able to use a required pallet and box when another TSD
has only a virtual, completely untouched route to that stock. A route with a
physically scanned box, product barcode or KIZ must remain protected.

## Task report

| Behaviour | Validation | Result | Evidence |
|---|---|---|---|
| An untouched `IN_PROGRESS` route does not hide its box from pallet validation | `vitest run test/marketplace-connections.service.spec.ts -t "switches a physically scanned box...|shows a box on the pallet..."` before the fix | RED | Expected `FFL_LKB0807_009`, received `[]`. |
| The first physical box scan can take an untouched active route | The same focused Vitest command before the fix | RED | Expected the target task, received `null`. |
| Both pallet visibility and physical reassignment work after the fix | The same focused Vitest command after the fix | PASS | 2 passed, 132 skipped. |
| Existing API test baseline remains characterized | Full `vitest run` | BASELINE | 506 passed, 74 pre-existing failures in stale branch/access mocks; neither new regression test failed. |
| API TypeScript remains valid | `tsc -p apps/api/tsconfig.json --noEmit` and `tsc -p apps/api/tsconfig.json` | PASS | Both commands exited successfully with no diagnostics. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A required box remains visible after its order was only virtually assigned to another online TSD | `shows a box on the pallet when another active TSD route is still untouched` | Unit/service | PASS |
| 2 | The first employee to physically scan the box receives the untouched order | `switches a physically scanned box from another untouched active TSD route` | Unit/service | PASS |
| 3 | Reassignment remains blocked after any box, product barcode, KIZ or relabel evidence exists | Existing query and transaction predicates exercised by both tests | Unit/service | PASS |

## Coverage and known gaps

Focused regression coverage is complete for the changed predicates. The full
repository suite is not globally green on the production baseline: 74 existing
tests use stale mocks for branch/access requirements. This change neither edits
those modules nor adds failures to that baseline.

## Merge evidence

- RED checkpoint: `a41160d test(fbs): reproduce pallet route ownership conflict`
- GREEN checkpoint: `eccdd3e fix(fbs): honor first physical pallet claim`
