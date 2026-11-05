# Candidate: administrator reuse after confirmed inventory recount

Branch: `fix/kiz-inventory-review-20261004`. Integration target: `feature/wb-print-check` in Maxhead2011/wmsFF. Owner authorized PR/publication on 4 October 2026, including the identical 45 pre-existing test failures. Publication outcome is recorded separately in `published.json`.

## Exact runtime reference

- API: `sha256:7ff2c21d01327774b1ff328cc9c842ec25b02eef031dbda79753050676dbbd3e`
- Web: `sha256:1a5e6d8847002aae15640e22052cc6c1682ff9f4c7c6e742d5438f4b7dac53d1`
- Capture: sibling `base.tgz`, SHA256 `777fac4aadba89b1fc06ee1fcc95f950bbcec36e8e86793642fe2929088b9e10`, identical server/local hashes.
- Server capture: `/opt/logoff-wms-releases/kiz-inventory-review-20261004/base.tgz`.
- Compared to the October 3 reference: ten API files added/changed in billing/administration. KIZ helpers are unchanged. All current runtime files preserved except the scoped helper below. Web remains untouched.
- This is a runtime capture, not a full database backup. Existing BASELINE.md is not advanced by this candidate.

## Scope and safety

Only `wms/apps/api/dist/common/kiz-cancelled-reuse.js` changes in the runtime. Source/runtime parity remains false; do not build and deploy the stale TypeScript tree. The accompanying runtime patch is the authoritative change, to be overlaid only on the pinned current image after rechecking production identities.

`releaseCancelledBindings` adds `inventoryReturnProof`, gated by `WMS_KIZ_INVENTORY_ADMIN_REUSE_ENABLED=true` AND the existing physical/admin-reuse flags and explicit administrator confirmation. Default-off preserves the sold WMS behavior. No UI changes, migrations, automated approvals, stock adjustments, WB writes or history deletion.

New path requires:

- Only historical COMPLETED, WB_ACCOUNTED or RELEASED bindings in closed requests.
- Fresh verified cancellation evidence for every relevant order; supplier cancel/complete; KIZ absent from WB metadata; supply acceptance explicitly false. Sold, retired, written-off, unknown and contradictory evidence cannot use this new path.
- Unique AVAILABLE mark with matching client/box/warehouse, positive available stock, no other FBS binding or active FBO unit.
- Matching immutable INVENTORY_KIZ_COMPOSITION_CONFIRMED record, with authenticated actor, exact serial/SKU/mark, count begun after every prior shipment and historical binding update.
- Advisory/mark locking and conditional binding update. All operations remain within the caller transaction.
- Archive the full old task, evidence, inventory proof and deciding user before clearing ONLY old task.kiz. Shipment history, stock and mark registration are unchanged.

The existing button remains the authorization point. No permission was granted to the actual review during development.

## Verification

- `test/kiz-inventory-review.runtime.cjs`: 40/40 pass on candidate. Published runtime reproduces the WB_ACCOUNTED rejection; 3 candidate-specific tests fail before the patch.
- Full local source suite: 1479 tests, 1434 pass / 45 fail, on BOTH original and candidate runtime. Exact failed assertion names match; two existing suites also have missing source files. This is not a green full-suite claim.
- Read-only production replay for request 1684 uses fresh WB evidence and finds the exact later confirmed recount. Audit/update writes are intercepted and reported, not executed. Row/advisory locks are omitted only in this read-only replay; concurrency assertions are separately covered by unit tests.
- Runtime diff: one file. Candidate SHA256 `20d99a8e5b6af7cbb7e71742668a5d4c9f9d8a77c1c12d7bf85f269add6b5d8f`.

## Before release

Get owner confirmation for PR/publication with the identical pre-existing full-suite failures. Recheck current API/web IDs; capture any newer delta. Apply this one-file overlay, enable the new flag only for our WMS, test exact candidate image, preserve rollback image and both release locks. After health checks, verify the task read-only; administrator must still press the button. Record new image IDs and advance BASELINE.md only after successful verification. Never publish a full rebuild from these source files.
