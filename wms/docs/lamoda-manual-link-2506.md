# Link manually uploaded Lamoda shipment to WMS request2506

Authorized by owner on29.10.2026. Scoped data-only operation: WMS2506 -> MPG100007386 / external number1. Runtime PR755/756 remains unchanged. No release images, schema, APK242 or sold-WMS changes.

scripts/operations/lamoda-link-2506.cjs validates seller scope through the official read API, exact remote card/EAN mapping, actual completed21 units with confirmed boxes, quantities and prices. It reuses deployed LamodaSubmission.build under a Serializable request-row lock. Dry check performs no writes; rehearsal executes the same transaction and rolls it back.

Apply creates a SUCCEEDED manual-file receipt and operation journal, sets LamodaPlan.remoteShipmentId and the unique assembly externalKey, writes an audit entry, then verifies existing refresh against Lamoda. No marketplace mutation is called. Physical assembly and request status hashes are checked unchanged. Repeated apply recognizes the existing link. Remote API does not return marking codes; EAN/quantity/card/prices are compared, remote KIZ equality is not claimed.

Validation:7 automatic guard tests; dry-run21 matched; full transaction rehearsal rolled back with persisted receipt still null. Full API/web regressions run before commit. Runtime hashes for the three used Lamoda modules match the published template baseline; latest TSD242-only update verified. Execute only after merged PR using the guarded local wrapper (work/lamoda-link-2506/run.py), with fresh image verification and release lock.

Full regressions: API3965 passed/150 skipped; web539 passed/2 skipped. No source/runtime code changed.

Applied after merged PR757 on29.10.2026. Existing refresh succeeded and returned VALIDATION. Receipt links WMS2506 to MPG100007386, external number1;21 units. Payload hash0bb5f9a9e3a9b9b1cfc865efcfa5dab3f704c0a1b6048b086a70d453412b89f0. Physical assembly/request status assertions passed. The operation is recorded in AuditLog as LAMODA_MANUAL_SHIPMENT_LINKED. No runtime publication or external creation occurred.
