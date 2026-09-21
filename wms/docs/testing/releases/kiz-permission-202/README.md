# Independent KIZ permission — TSD 202

ADMIN/OWNER scans a KIZ and authorizes the physical unit without any request or picker case.
UNIT-scoped KizReviewCase records use the reserved UNIT:markId key, empty requestId and an explicit UNIT snapshot;
the existing schema has no task/request foreign keys. No migration is needed.
The context binds client, SKU, box, mark and its current version. At the next scan a transaction claims
the permission for one picking attempt and creates the normal task-scoped approval. Acceptance consumes both.
Another active task cannot claim the same permission; changed physical stock invalidates it.
New sale/retirement evidence invalidates REUSE. Approved RELABEL remains mandatory even if external history later becomes unavailable.
The picker sees КИЗ НЕОБХОДИМО ЗАМЕНИТЬ, including after reopening; replacement requires a different unused serial.
Legacy relabel proposals now create a review case before rejecting uncertain evidence; approved REUSE returns to original-code scanning.

Existing our-VM flags gate the API; sold flavors retain existing behavior. No inventory quantity changes or automatic administrator decisions.
Validation: full API 2743 passed / 60 skipped; exact production overlay 4 transaction/unit tests, server typecheck and 3 scanner/unit tests passed.
Exact Android 1146 tests across six variants passed. Signed upgrade 201→202 preserves preferences and pending operations.
Production overlay merged without conflicts; exact source delta is published-source.patch.
