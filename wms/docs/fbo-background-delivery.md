# Background FBO delivery confirmation

Published PR811 on PR809 runtime, own WMS only. Flag WMS_FBO_DELIVERY_SYNC_ENABLED defaults off. Target branch feature/wb-print-check.

## Problem and behavior

Ozon refresh previously saved the remote snapshot without closing the WMS request. WB refresh could close it, but required a visible browser component and an authorized viewer. The new server worker checks PACKED/COMPLETED FBO requests independently of browser sessions.

Ozon uses read-only `/v3/supply-order/get` with the connected client's exact order IDs. Every order and every linked direction must be returned exactly once. Explicit accepted states: ACCEPTED_AT_SUPPLY_WAREHOUSE, IN_TRANSIT, ACCEPTANCE_AT_STORAGE_WAREHOUSE, REPORTS_CONFIRMATION_AWAITING, COMPLETED. Pending, rejected, cancelled, missing and unknown statuses do not close a request. Acceptance at the supply warehouse follows the user's agreed definition of delivery, not customer sale or final reconciliation of discrepancies.

WB retains binding, completed packing, recorded vehicle loading, exact planned quantity and status4/5/6 checks. No other marketplace or FBS request is included. Demo, removed, cancelled, incomplete and historically FBS requests are excluded.

## Implementation / influence

- `fbo-delivery-policy.ts`: exact remote evidence rules and bounded retry delay.
- `fbo-delivery-sync.service.ts`: module lifecycle timer, per-request durable SystemSetting leases/cooldowns, sequential bounded processing, read-only marketplace calls, fresh-context comparison and audit evidence.
- `client-requests.module.ts`: register worker; flag off starts no timer.
- `stock-operations.service.ts::shipClientRequest`: optional internal callback executes under the request lock before billing or stock writes. Existing callers unchanged. Worker uses normal shipping/idempotency (`ship-request:<id>`), never direct stock/status repair. System actor is not attributed to a human and preserves existing assignee.
- `test/fbo-delivery-sync.spec.ts` and release PostgreSQL fixture: policy, startup without browser, shutdown, leases, rollback, binding race and concurrent completion.

Startup delay30s, next cycle60s after preceding cycle, max10 claimed requests/cycle, ascending-ID cursor over100 candidates. Successful pending check cooldown5min; errors back off1вЂ“30min. Lease10min recovers after process failure. Timing is bounded polling, not a promise of exact one-minute completion. SystemSetting stores attempt/outcome; logs contain request IDs and safe status codes, not credentials or KIZs.

The stock transaction rechecks current client/warehouse/items/binding/dispatch, active connection and completed phase before accepting the remote proof. Proof expires after4min. Rebound requests cannot consume an earlier reply. Audit evidence rolls back with failed shipment. Already completed requests are not shipped again. Existing stock/KIZ/billing checks can require manual resolution; this worker does not bypass them.

## Release and validation

Exact API4 overlay only: two new modules, ClientRequestsModule and the internal shipping callback seam. Base PR809 API1786651d; webd1e43909 retained. Source/runtime parity remains false; preserve runtime-only applyClosedFboTarget and all client-required-KIZ changes. Schema/APK/web/sold WMS unchanged. No marketplace mutation or synthetic production shipment used for tests.

Checks: unit/API/web and TypeScript; actual candidate isolated PostgreSQL full Nest health,1710-unit finish/exports and shipping; concurrent delivery has one shipment and one evidence audit; changed binding and forced verification exception leave stock unchanged; WB requires dispatch. Existing baseline guards verify the exact file delta. Publication checks image identity, merged PR, isolated image proof, environment preservation, health and hashes. Rollback tag logoff-api:before-fbo-background-delivery-20261031. Stock transactions already committed must not be reversed by a code rollback.

Validated: API4262 passed/156 skipped; web587 passed/2 skipped; both TypeScript checks; isolated actual-image PostgreSQL9 and full Nest health. Dedicated KIZ database suite excluded without its configured isolated URL. No claimed performance improvement.

## Production proof

Published API sha256:fc415f8d55329bffdc9e443c5ab860749d7289d662e858433d042a4ef70a198e; prior web image retained. First autonomous cycle at 2026-10-31 15:11 UTC completed Ozon2601/2602 and WB2494; one FBO_DELIVERY_CONFIRMED audit each, total SHIP quantities -20/-12/-578. Image hashes, health, prior environment and other containers verified. Baseline captures all715 API modules and schema; web continues from 2026-10-31-client-required-kiz. No direct status repair.
