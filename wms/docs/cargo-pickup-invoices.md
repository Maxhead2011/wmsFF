# Cargo pickup invoices

Prepared for our WMS only, `WMS_CARGO_PICKUP_ENABLED=true`. Default off in source. PRR handling and its invoice remain independent.

## Workflow

Warehouse / goods arrivals: choose our delivery or external delivery. Our delivery requires a positive RUB cost, maximum two decimal places. The arrival date is the pickup service date. Existing arrivals do not gain charges automatically.

The arrival stores the delivery amount with its original author/time. Delivery-only edits store operator/time and a before/after audit. Client and active-warehouse write scope are checked again on the server. An active cargo invoice blocks edits/deletion; cancelling a permitted draft releases the source. Issued/paid corrections continue through existing billing rules.

Select client and period, then use the separate cargo invoice button. Each eligible pickup becomes one dated line with arrival reference, quantity one and its entered cost. The invoice comment and purpose are cargo pickup. PRR bag/box quantities, tariffs and the existing PRR invoice button remain independent. The invoice appears in the existing billing registry and uses the existing PDF renderer.

## Consistency

The invoice writer, charges and arrival links share `runBillingMutation` and its existing PostgreSQL advisory lock. Concurrent requests produce one invoice; a write failure rolls back all financial records and links. A second attempt after a committed invoice finds no eligible sources. Cancelled cargo invoice charges become CANCELLED and cannot reappear as unbilled approved work. Invoice eligibility also follows the original charges into a merged active invoice.

The source link is separate from `billingInvoiceId` used by PRR. Cancellation of one kind does not release the other kind. Cargo cost is passed explicitly with included tax mode; unrelated client tariffs do not change the entered sum.

## Scope and release

API: WarehouseService goods arrival/create/delete/summary and new cargo invoice/edit methods; WarehouseController routes; cargo-pickup-policy; BillingService cargo charge cancellation; administration API registry count. Web: GoodsArrivalPanel and API bindings. No schema or APK changes. Sold WMS keeps the flag off.

Exact runtime overlay: API5/web2. Preserve runtime-only billing registry purpose labels and the concurrently published PRR-label repair. Source/runtime parity remains false. The API/web base images are pinned in the release evidence; a changed live base stops publication.

Docker's accumulated layer chain reached its mount-option limit during staging. Release preparation exports a never-started base container and imports an equivalent compact image; all original image config and artifact hashes must match before overlays. No production container or environment file is changed by compaction. Original images remain rollback targets.

## Validation

18 focused tests; full API4280 passed/156 skipped, web587 passed/2 skipped, TypeScript checks. Unconfigured dedicated KIZ integration suite excluded. Candidate browser6 and root-bootstrap5. Isolated PostgreSQL8/full API health passed; exercises invoice/charge/source rollback, concurrent billing, dated totals, immutable billed deliveries, cancellation/rebilling, warehouse scope, disabled flag and separate PRR invoicing. Real billing writer is used; only bank-account snapshot is stubbed in the synthetic test. Full Nest health is required before publication. Production test invoices must not be created.
