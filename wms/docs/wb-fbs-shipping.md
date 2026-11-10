# WB FBS shipping points and cargo places

## B2B supply separation

Prepared 2026-11-10, not published. Request 2870 exposed a mixed WB supply: four retail orders were accepted, while a B2B order was rejected. WB reports this distinction as `options.isB2B`; the supply itself uses `isB2b`.

With `WMS_AUTO_ASSEMBLY_DURABLE_ENABLED=true`, `moveFbsOrdersToSupply` fetches selected current WB metadata before creating any supply. It requires an explicit boolean for every selected order, then adds B2B/retail to the existing cabinet/warehouse/cargo/cross-border grouping. Missing metadata or a changed new-order status stops creation. The flag-off path remains unchanged for sold deployments. No schema, inventory or billing changes.

Regression: `wb-b2b-supplies.spec.ts` runs the actual creation handler with a WB mock rejecting mixed groups, checks 4+1 grouping, homogeneous groups, warehouse/cargo boundaries, missing metadata, changed status and flag-off isolation. `wb-label-orders.spec.ts` verifies true/false/unknown parsing. The mixed-group regression failed before the fix and passes after it. These tests make no live supply writes.

Validation: focused 24 passed; merged API suite 4697 passed / 9 skipped, dedicated `*.integration.spec.ts` database suites excluded. Full TypeScript check reports two errors in unchanged `yandex-fby.service.ts` (nullable SKU IDs, lines 46 and 54), none in changed files. No live shipment or physical TSD test was performed.

The current server API image was inspected before development and remains unchanged. Source/runtime parity is false: a release must overlay only the two changed runtime modules onto a freshly verified baseline, retaining the runtime durable-operation journal. Do not deploy the complete locally compiled service.

The delivery dialog separates the destination warehouse from the hand-in point. Select city, point type, date and an available address; save the selection in WB. Self-shipping is supported. Enter the desired total cargo-place count and create missing places. Use existing Documents labels and TSD packing/closing.

Before delivery, verify the saved point/date/type, current availability, cargo IDs and complete closed-box membership. Point/cargo configuration does not write stock or billing.

## Scope
- marketplace-connections.service.ts: configureFbsShipping, resolveFbsSupplyDeliveryOptions, deliverFbsSupplies.
- Controller/DTO: shipping-points, shipping-save, shipping-cargo; client write authorization.
- wb-shipping-points.ts / wb-shipping-workflow.ts: per-supply WB results, confirming GET, distributed lock. Pending cargo audit precedes POST; uncertain outcomes require reconciliation before another POST.
- FbsSupplyDeliveryDialog/FbsShippingEditor, FbsPanel, lib/api.ts: address search, save/error feedback, responsive controls.
- Own-only WMS_WB_SHIPPING_POINTS_ENABLED flag defaults false. Sold installation retains existing behavior.

## Validation
API4674 passed/9 skipped; web622 passed/2 skipped. Dedicated database integration suites excluded from the general run; isolated PostgreSQL8 and exact-runtime10 passed separately. New unit14 cover authorization, point selection, WB errors, cargo reconciliation/concurrency and no recovery after a configuration failure. Exact dialog browser checks cover save/cargo at 1440/768/375; no page errors. Request header/disclosures and compact controls checked. Web typecheck passes; two pre-existing Yandex API nullable-SKU type errors are outside scope.

Source/runtime parity=false: exact API6/web3 overlay on fresh production images, inverse proof preserves other bytes. No live shipment mutations or physical printer tests; live WB check was read-only.

Official contract: https://dev.wildberries.ru/api/swagger/yaml/ru/03-orders-fbs.yaml?region=ru

## First search and latency correction
Prepared follow-up: the browser omits shippingPointId until saving a selected point; the DTO normalizes the empty value sent by older tabs but still rejects malformed IDs. Shipping options and point/cargo operations use the selected-order reader with fresh WB statuses instead of full client refresh. Destination and date metadata are retained. Final delivery retains its existing fresh checks. Official SupplyOrderIDsAPI uses orderIds; cargo and final membership validation now follow that shape.

Regression: wb-shipping-search.spec.ts (empty DTO RED/GREEN, malformed ID, no full refresh), workflow point-search request count, browser first request without point ID, exact runtime DTO/service tests. Read-only live selected-supply check: two orders, options1471ms, points1620ms/5432 points; no mutations. Network/browser latency is not included in those server timings.

Release candidate: exact API2 additive overlay on the PR975 runtime, preserving manual request linkage and the durable auto-assembly journal. Inverse-byte proof, full image file hashes, actual-runtime6 RED/GREEN and module loading passed. Release scripts: `scripts/releases/wb-b2b-20261110/`. Web and environment remain unchanged.
