# FBS physical box claim — TDD evidence

## Scope

The journey was derived from the production incident reported on 2026-08-29:
an employee scans a physical FBS box with available stock and must be allowed to
continue when the box is in any operational WMS state, including `receiving`.
Only `deleted` and `archived` boxes remain ineligible.

## Root cause evidence

The outer scanner and route queries accepted every box state except `deleted`
and `archived`. The serializable claim recheck accepted only `active`. Production
box `FFL_LKB2107_36` was in `receiving` with four `AVAILABLE` units, so the claim
returned `null` and the API incorrectly presented it as another request taking
the product.

## Test specification

| # | What is guaranteed | Test or command | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A `receiving` box with branch-matching `AVAILABLE` stock can be atomically claimed by the physical picker | `claims an FBS box with receiving status instead of reporting another request` | unit/integration boundary | PASS | RED returned `null`; GREEN returned the claimed task |
| 2 | An archived box is still rejected by the locked route recheck | `does not reserve an archived box from a stale background snapshot` | unit | PASS | targeted Vitest run |
| 3 | Live quantity and pallet placement are still rechecked before reservation | `rechecks active placement and quantity before persisting an FBS reservation` | unit | PASS | targeted Vitest run |
| 4 | Route availability and repair selection retain their existing behavior | `fbs-route-availability.spec.ts`, `marketplace-connections.repair-selection.spec.ts` | unit | PASS | 7 tests passed |
| 5 | API types and emitted JavaScript compile | `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.json` | build | PASS | both commands exited 0 |

## RED / GREEN

- RED: the new receiving-box test failed with `expected null to match object`.
- GREEN: the same test passed after aligning the locked status check with the
  scanner and route rules.
- Targeted regression set: 10 tests passed, 0 failed.

## Known baseline test debt

The complete historical `marketplace-connections.service.spec.ts` run executed
128 tests: 99 passed and 29 failed. The failures are unrelated legacy mock and
expectation problems (missing Prisma delegates, stale access expectations and
two existing timeouts). The two expectations touched by this change were updated
to the shared operational-state rule and pass in the targeted regression run.
No unrelated production code was changed.
