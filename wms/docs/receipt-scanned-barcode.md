# Receipt export: recorded label barcode

Published on 2026-10-16 through PR629 into `feature/wb-print-check`. API `sha256:051621eb2e32534f8f5e385aa0b02e0c0fb676c11795b251759d3ba9a06ad851`.

The series receipt XLSX endpoint selected `sku.barcodes[0]` without ordering.
An alternate GTIN could therefore replace the product label barcode. The
receipt operation still contains the original `payload.barcode`.

`ReceiptChannelsController.file` now calls `receiptExportBarcodes`:
- Load accepted `receipt_scan` operations by exact movement idempotency key,
  in batches of 500, selecting only operation key and payload.
- Require matching client, box code and source document before using the scan.
- If no matching scan is available, use a unique primary catalog barcode,
  or the sole catalog barcode. Leave ambiguous legacy identities empty.
- Never derive a product label barcode from the KIZ or its numeric prefix.

No stock, product card, KIZ, receipt membership or quantity writes are performed.
Historical series files are generated on demand and use this selection after
publication. Already downloaded copies are not modified automatically.
Other turnover exports already select the primary barcode; their behavior is
outside this narrow change.

## Validation

`test/receipt-export-barcode.spec.ts`: six failing tests before the change,
six passing afterward, reading the actual generated XLSX cells. Tests cover
the 1310 GTIN regression, a changed primary, legacy fallback, unrelated client,
box/document and ambiguous aliases.

Full local validation: API 3507 passed / 155 skipped; web 445 passed / 2 skipped;
API TypeScript passed. Dedicated `kiz-duplicate.integration` and
`kiz-duplicate-concurrency.integration` database suites were excluded, as in
the current baseline. Actual runtime export replay and the exact two-file
candidate check passed.

Read-only snapshot of `SERIES:2026:FFL_LKB1310`: 4474 movements/units, all 4474
matched saved scans. Corrected native API export contains 4474 data rows and
4474 units, no missing barcodes. Compared with the old first-alias selection
in that snapshot, 1487 rows across 38 SKUs differ. Catalog alias ordering was
undefined, so historical files can have a different affected count.

The captured runtime is API
`sha256:f53038936988e87df3d657981b1aa09336940faf750de0fcbdf1df42be2f0be6`.
`scripts/releases/receipt-scanned-barcode/patch.cjs` verifies the controller's
full preimage hash and changes only its export call plus the new helper module.
`check-candidate` confirms exactly those two files. Source parity remains false.
Deploy only through the usual reviewed PR/release process into our installation;
the sold installation must not receive this shared controller overlay.

After publication: public health, exact hashes and unchanged flags verified. Native live export with persisted administrator permissions confirmed 4474 rows/units and no missing barcodes.
