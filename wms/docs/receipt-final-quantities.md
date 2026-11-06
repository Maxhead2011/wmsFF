# Final quantities in receipt exports

The linked-correction receipt export previously displayed original movements and signed corrections as separate rows. It now sums them by box and SKU, omits zero totals and rejects negative final quantities. The receipt-list total remains unchanged. Original stock movements and KIZ records are not edited.

The projection applies only when `WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED=true` and the receipt has explicit correction links. Unlinked receipts and file-recovery exports keep their existing behavior; sold WMS is not published or enabled.

Changed functions: `ReceiptChannelsController.file`, new `receiptFinalQuantities`. Runtime build uses `build-receipt-final-quantities.cjs` and the fresh captured production controller, preserving barcode resolution, receipt recovery, client access and unrelated TSD changes.

Validation: regression reproduced with separate movement rows; helper tests cover zero cancellation, grouping boundaries, negative totals and input immutability. Actual controller XLSX test checks one final row instead of three movements. Exact runtime test with the full receipt fixture produces 66 positive data rows, 27 boxes and 961 units; default/off behavior is preserved. Published PR891: actual production list and XLSX verified at 961 units, 27 boxes and 66 positive rows. No business records were changed by this release.
