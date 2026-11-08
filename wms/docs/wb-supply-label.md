# WB FBS: supply sticker before delivery

Our WMS generates a 58×40 mm supply label as soon as an existing WB supply has orders and a confirmed destination. The QR contains exactly the `WB-GI-…` identifier. Captions show the current full WB supply membership count and the destination name from WB offices, not the selected subset or a guessed local route.

The existing `getFbsAllLabels` ribbon calls `getFbsSupplyStickersPdf`, so both Download all and Print all include the same generated page. One page per cabinet/supply pair; existing PVZ and product/order pages remain. A missing section still produces a warning; authentication errors remain fatal. This does not call deliver, create cargo, debit stock or bill anything. A changed membership must be refreshed. Labels should be regenerated after changing a supply.

Isolation: existing `WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED=true` flag. With it off the original official QR API and delivery guard remain intact. No sold-WMS deployment or configuration change.

Files: `marketplace-connections.service.ts/getFbsSupplyStickersPdf`; `wb-supply-label.ts/readWbSupplyLabels, buildWbSupplyLabelsPdf`; `wb-supply-label.spec.ts`; exact overlay and verification scripts in `scripts/releases/wb-supply-label-20261108/`.

Validation: regression reproduced before fix; 11 focused tests, full API 4618 passed/9 skipped (dedicated DB integration suites excluded), web 614 passed/2 skipped. Real compiled service/ribbon PDF six checks and isolated full API/PostgreSQL boot pass. PDF visually inspected and QR decoded at 203dpi. Read-only WB check for request2823 confirms one member; current office name is «Москва (Белая дача)», whereas the user's older PDF says «Москва_Восток». No physical printing or delivery transition performed. Source-wide API typecheck retains pre-existing stale Prisma/Lamoda fields and two Yandex nullable-SKU errors; no errors in changed files.

Deployment uses the current PR936/938 API baseline and preserves all unrelated runtime bytes. Source/runtime parity is still false. Web and printer agent are unchanged. Target PR branch: `feature/la_panthera`.

Reference layout update: large QR, supply ID above, quantity and destination below; rotate artwork 90 degrees onto 58x40 physical media, with page rotation zero for ribbon compatibility. Long destinations reduce font size to retain one page. Regression12/API4619/runtime6 and isolated API boot pass. 203dpi monochrome and global-threshold QR decode pass; default local-average decoding of antialiased203dpi PNG is inconsistent (144/200/300/432dpi decode). Physical print still requires operator validation.
