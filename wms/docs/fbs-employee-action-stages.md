# FBS employee action stages — published PR983

Scope: own WMS only. Branch `fix/fbs-action-status-and-marketplace-schedule`, intended PR base `feature/la_panthera`.

- WB and Ozon: PICK completion alone does not set PACKED. Successful SOS agent acknowledgements must cover every active order and the current request composition.
- Configured Bushkova/Khrupova client IDs use `fbs.action-status.v1:<clientId>` with `startOnRibbon: true`. No name-based routing. These two own-WMS production settings are now enabled.
- Ribbon download alone is not proof: the server records the PDF hash, requesting user and selected orders. The branch-bound print agent acknowledgement starts the request.
- Other clients retain TSD start behavior.
- Marked Ozon printing is allowed only after completed picking, ACCEPTED KIZ and marketplace submission. Unconfirmed marking, incomplete picks and unknown sources remain blocked.
- Marketplace evidence controls DONE through existing WB/Ozon FBS and FBO guards. Stock finalization remains separate from the visible stage.
- Server schedule: 08:00, 12:00, 15:00, 18:00, 21:00 Europe/Moscow. Durable per-request lease, bounded batches, retries after errors. Lamoda/Yandex are not added to this scheduler.

Flags default off: `WMS_FBS_ACTION_STATUS_ENABLED`, `WMS_MARKET_STATUS_SCHEDULE_ENABLED`. Existing request auto-status, SOS post-pick printing and marketplace verification capabilities must be enabled on the own installation before activation.

## Verification

New tests: `test/fbs-action-status.spec.ts`, `test/fbs-action-print-ack.spec.ts`, `test/fbs-ribbon-evidence.spec.ts`, `test/market-status-schedule.spec.ts`. Expanded `src/modules/marketplace-connections/sos-post-pick.spec.ts`.

Marked Ozon regression failed before the fix and passed afterwards. Focused 51 tests passed. Full API unit/service suite: 4732 passed, 9 skipped; dedicated database integrations excluded. Two existing Yandex FBY TypeScript errors reproduced independently against HEAD with unchanged dependency state.

## Published verification

Exact API11 overlay on PR981 verified with release_baseline.py and all image hashes. Runtime17 covers stage transitions, PR979 ribbon registration and PR981 Ozon API dispatch. Disposable PostgreSQL verifies concurrent leases, next-slot handling and scheduler query; full API startup passes. Web624 passed/2 skipped. Client IDs independently verified. PR983 merged after green CI; candidate published and public health verified. Current source/runtime parity is false; whole dist replacement is forbidden. Publication enabled the two documented flags and the two client policies. No manual stock or request-status rewrites were performed; scheduled processing now runs normally.
