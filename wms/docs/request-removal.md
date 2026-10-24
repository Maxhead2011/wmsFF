# Administrative removal of mistaken FBO/FBS requests

## Prepared correction: completed FBO disposition

`request-removal-return-proof.ts` validates the `FBO_PICKED_UNITS_REDISTRIBUTED` audit before historical `assembly_stage` scans can stop blocking removal. Every source unit must be RETURNED with no active KIZ ownership or target carton; the holding box must contain no stock. Audit mappings must cover every unit and match its original SKU/KIZ. Returned marks must be AVAILABLE in the original scoped box; transferred marks must belong to a matching PICKED unit of an active request in the same client/warehouse and its holding box. Scans after the audit and legacy scan types remain blocking. Unsupported recovery audit formats remain blocking pending review.

All previous guards for active units, stock movements, packaging, printing, FBS tasks, waves and deliveries remain. Preview and removal both execute this read-only proof. No history is deleted and this correction does not itself cancel any request. Existing installation flag isolates sold WMS. Regression reproduced before the fix; 14 return/transfer scenarios added to service tests. Read-only live proof for request2367 returns true. Validation: API 3604 passed /150 skipped; web 476 passed /2 skipped; API TypeScript passed. KIZ integration suites excluded because dedicated database configuration is unavailable. Not yet published.

Published through PR677 on 24 October 2026. ADMIN/OWNER only; default-off `WMS_REQUEST_REMOVAL_ENABLED` is enabled only in our deployment. CLIENT, workers, demo sessions and users outside writable client/warehouse scope cannot remove requests.

The request list and Ozon unified-assembly list offer “Удалить заявку”. Preview shows quantity, blockers and external links. Commit requires a 5–2000 character reason, the exact request number, explicit confirmation and an unchanged preview revision. Removal sets CANCELLED, preserves request/items/Ozon bindings, records an event and a full before snapshot in AuditLog, cancels untouched FBS tasks and releases their box reservations. Physical stock and KIZ records are never changed. Cancelled requests remain in archive.

This version supports untouched outbound requests. Physical picking/packing/movements, accepted legacy TSD operations, print jobs, employee task ownership, active shared waves, linked deliveries and packed/terminal requests block removal. Historical physical operations require separate review; this tool does not reverse them. A row lock and serializable transaction repeat all checks at commit. Duplicate submissions do not create duplicate audit events; database conflicts return 409 and require another preview.

WB/Ozon supplies and orders are NOT cancelled. The dialog explicitly states this. FBS links retain ADMIN_REMOVED ownership; manual creation, automatic assembly and incoming supply synchronization cannot silently recreate the request. External orders remain in their marketplace lists and require a separate operational decision. Ozon import keys/order bindings remain owned by the archived request. No schema migration, marketplace calls or production data cleanup accompanies publication.

## Files and impact

- `apps/api/src/modules/client-requests/client-request-removal.service.ts`: capability, inspect, preview, remove.
- `client-request-removal.controller.ts`: validated capability/preview/commit endpoints.
- `request-removal-policy.ts`: role/physical guards, request/order ownership locks and tombstones.
- `client-requests.module.ts`: additive controller/service registration.
- `client-requests.service.ts`: updateStatus cannot revive administratively removed requests.
- `modules/marketplace-connections/marketplace-connections.service.ts`: createFbsRequest, syncOneFbsRequest, syncFbsRequestsFromMarketplace, syncFbsPalletSortReservations.
- `modules/administration/administration-internal-api.service.ts`: three routes in the existing request group.
- `apps/web/src/components/client-requests/RequestRemoval.tsx`, ClientRequestsPanel, ClientRequestsTable and `ozon-fbo/OzonCustomerWorkspace.tsx`: server capability, confirmation and list refresh.
- `scripts/releases/request-removal-20261024`: narrowly scoped runtime overlay, compiled-UI browser tests, isolated PostgreSQL tests, staging and publication.

Shared modules have default-off guards; sold WMS receives neither images nor flags. Source/runtime parity remains false. Runtime additionally guards runAutoAssembly and createFbsRequestUnlocked, which exist in production but are not fully represented by historical TypeScript. Overlay preserves all unrelated runtime methods, including the latest company visibility and Telegram UI changes.

## Validation before publication

26 new policy/service tests; full API 3590 passed /155 skipped (dedicated KIZ database suite excluded because it is not configured); web 476 passed /2 skipped. API and web TypeScript passed. Eight compiled-UI browser scenarios cover confirmation, wrong number, physical blockers, stale preview and account change. Nine isolated PostgreSQL scenarios exercise exact candidate runtime: concurrent duplicate removal, FBS tombstones, changed composition, physical evidence, atomic rollback on failed audit, permissions, feature flag and unchanged stock/KIZs. No production business data is used.

Fresh staging base: API `sha256:d0382f39ef4097feb528f41aaab9619e1aa08761d747a3ca8c87e18e3b00b9ad`, web `sha256:75e52dd5feab388fb5441b104601844928251c8c04dd0b94ccd5224177696396`. `release_baseline.py check-candidate` verified precisely seven API modules; web overlay has four files and preserves all existing assets. Recheck both live images under deployment locks before publication. PR target: `feature/wb-print-check`.

Published API `sha256:e1b84e9e5cd46892eafb5d0810334092da7e4a97a535ce82974e4bacc918de05`, web `sha256:e3c50c050224df1e513cd36ab95baa98ceb94edf294699906095c45062b37613`. Public file hashes and health passed. Live capability: ADMIN/OWNER true, CLIENT/demo false; unauthenticated endpoint401. Both candidate screen modules loaded without browser exceptions. Rollback tags `logoff-api:before-request-removal-20261024-v2`, `logoff-web:before-request-removal-20261024-v2`. No business requests removed during deployment.
