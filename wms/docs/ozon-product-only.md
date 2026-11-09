# Ozon FBO packing by product — LOGOFF TSD 259

Scope: only LOGOFF Ozon packing. Lamoda keeps its two modes; WB, Yandex and sold application flavors retain their flow. No API, stock or schema changes.

The packing screen starts at product barcode, then KIZ when required, then the suggested destination carton. Destination rows open a read-only composition dialog. Wrong cartons, closed cartons and destination quotas use existing validation. Last-unit undo and explicit carton top-up remain available.

Saved destination-mode checkpoints migrate only in PACKING and only without an unanswered command. Carton, barcode and undo identity are retained. An unanswered PACK_UNIT keeps its action, payload and operationId; product mode activates after acknowledgement. Missing product-packing capability blocks scans rather than silently reverting to destination mode.

Source: apps/android-tsd/app/src/main/java/pro/logoff/wms/tsd/FboTwoStageScreen.java. Tests: FboTwoStageScreenTest.java. LOGOFF version only changes to 259. Both original and .servers package identities must retain the certificate of published 258.

Validation: LOGOFF Android349/349 passed. Other two flavors each339 passed,8 skipped,2 existing failures (ReceiptPlacementActivityTest and ReceiptProgressActivityTest); both failures reproduced with the original FboTwoStageScreen from HEAD. All43 real-screen FBO tests pass in every flavor. The default-mode test fails against the old code and passes after the fix. API4643 passed/9 skipped (dedicated DB integration excluded); web622 passed/2 skipped. Both release APK builds and vital lint complete; overall Gradle test exit is nonzero solely for the documented existing receipt failures.

Both APKs are signed and verified against published258 certificate. Package/version/payload checks pass. Publication is pending PR checks. Physical terminal verification remains necessary after installation. API/web runtime source parity is not asserted by an Android-only release.
