# WB FBS shipping points and cargo places

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
