# Linked receipt corrections

Published PR887 to our WMS. Target: `feature/la_panthera`.

The original receipt reports only RECEIPT movements. Explicitly approved inventory corrections can now be linked to that receipt for reporting and XLSX export without writing stock a second time. Signed corrections retain their SKU, box, timestamp and original inventory movement.

`WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED=true` enables the reporting path only. Default/off preserves sold-WMS behavior. A scoped `receipt.adjustments.v1:<client>:<warehouse>:<receipt>` setting contains the receipt series and exact movement snapshots, including original box receipt document. Unknown, changed, duplicate, cross-client or cross-warehouse movements fail closed. File-recovered receipts require separate reconciliation rather than combining two recovery sources.

Affected functions: `receiptDocuments`, `ReceiptChannelsController.file`, new `applyReceiptLinkedAdjustments`. Routing, approval and balances are untouched. Existing runtime recovery and barcode handling must be preserved; `scripts/build-receipt-linked-adjustments.cjs` overlays exactly three runtime files on captured live modules, not the full local build.

Validation: baseline reproduction returned 953 rather than expected 961. Source regression, disabled flag, operational path, stale movement scope, signed XLSX sum and captured-runtime helper are tested. Full API suite passed 4475 with 9 skipped before the added XLSX test; integration/PostgreSQL-named suites were excluded. TypeScript passed. Production publication and the explicitly approved receipt binding are complete. The binding changes only SystemSetting and AuditLog; original stock movements remain intact.
