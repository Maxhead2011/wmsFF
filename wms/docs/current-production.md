Published PR809: client required KIZ at receipt/inventory, including new SKU; adjacent responsive switch; REJECT validation and unresolved review badge. API4233/web587, TypeScript, isolated PostgreSQL/runtime15/full health, browser6/bootstrap5/public5 and live3 passed. Exact API14/web3, flags/schema/APK249/sold unchanged. Lukin/Kubrin/Eletskaya enabled; 3 newly unmarked Eletskaya cards aligned after publication, audit retained, no quantity changes. Baseline sourceParityVerified=false. [Details](client-required-kiz.md).

Published PR807 / 2026-10-31: [FBO completion reliability](fbo-completion-reliability.md). Batched exact box checks and selections, safe same-token recovery after connection failures, busy/check-result UI and stage diagnostics. API4217/web586 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health and browser6. Exact API3/web2; own-image WMS_FBO_COMPLETION_RELIABILITY_ENABLED=true. APK249/schema/business records/sold unchanged. Baseline2026-10-31-fbo-completion-reliability, sourceParityVerified=false.

Published PR805 / 2026-10-31: [FBO shipment prefix lookup](fbo-shipment-prefix.md). Request2565 KIZ read47.940s ->4.513s,1710 identities/evidence unchanged. API4206/web582 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health;1710-unit/159-box synthetic finish16s and retry passed. Exact2 API overlay, own-image WMS_KIZ_SHIPMENT_PREFIX_ENABLED=true. Web/APK/schema/stock/sold unchanged. Baseline2026-10-31-fbo-shipment-prefix, sourceParityVerified=false.

Published PR800: Ozon FBO shop labels after client/branch scope; separate FBO picking/packing productivity by actor and Moscow day. API4198/web582/TypeScript, PostgreSQL11/full health, artifact browser6/bootstrap5/public5 and baseline8 passed. Exact API3/web3; own-image WMS_FBO_PICKER_STATISTICS_ENABLED=true, sold/schema/APK249 unchanged. Audited Ozon-only directory configured for CL-000016; shared stock and KIZ untouched, strict receipt flag off. Live2529/2530 Monlarti,2531 Braibo verified; WB shop bindings pending separate verification. Baseline sourceParityVerified=false. [Details](fbo-stores-productivity.md).

Published PR802: [Ozon packed auto-completion](ozon-packed-auto-done.md). PACKED -> DONE after all postings are delivering/delivered, status/history only. Independent own-WMS flag enabled; WB rule preserved. API4194/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime passed. Exact two API modules; web/APK249/schema/stock/sold unchanged. Baseline `2026-10-30-ozon-packed-auto-done`, sourceParityVerified=false.

Published PR799: [WB packed auto-completion](wb-packed-auto-done.md). PACKED -> DONE after all linked WB orders are accepted, status/history only. Own-WMS flag enabled; stock/web/APK249/schema/sold unchanged. API4175/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime and exact two-module verification passed. Baseline `2026-10-30-wb-packed-auto-done`, sourceParityVerified=false.

Published PR797: [FBO counted stock rebind](fbo-rebind-counted-stock.md). Existing counted quantity consumed without extra +1; duplicate/history guards retained. API4155/web579/TypeScript, runtime4/repair4/PostgreSQL9/full health. Exact2 API modules, other700/web/LOGOFF249/schema/flags/sold unchanged. Baseline `2026-10-30-fbo-rebind-stock`, sourceParityVerified=false. Box519 AVAILABLE0,9 units in2565 unchanged.

Published PR795 / 2026-10-30: [WB FBO tracking and dispatch](wb-fbo-supply-tracking.md). API4155/web579/TypeScript, PostgreSQL12/full health, candidate/public browser9 and navigation9. Exact API6/web3; schema/flags/LOGOFF249/stores/sold preserved. Baseline `2026-10-30-wb-fbo-tracking`, sourceParityVerified=false. WMS2494 bound to WB41834673 (578 units, allowed to ship); vehicle loading not marked.

Published PR793 (feature PR787), LOGOFF249: client stores and shared SKU permissions, request/billing/TSD context. Single application entry; Ozon label control and sidebar counts retained. API4149/web578/Android933, TypeScript, runtime12, PostgreSQL15/full Nest health, browser8/sidebar9/bootstrap5 and public bootstrap5 passed. API156/web2 skipped; dedicated KIZ integration suite excluded without URL. WMS_CLIENT_STORES_ENABLED=true only in own API image; strict store receipts disabled. Production store bindings, stock, KIZs, schema and sold WMS unchanged. Source parity false. [Details](client-store-separation.md).

Published PR791 / 2026-10-30: [sidebar request counts](sidebar-request-counts.md), unfinished total (IN_WORK) beside Requests/FBS/FBO and favorites. Scoped WMS requests, full counts, loading/error distinct from zero. API4119/web571/TypeScript, PostgreSQL6/full health, candidate/public browser9 and import10, baseline8. Exact API3/web2; flags/schema/APK248/data/sold unchanged. Baseline `2026-10-30-sidebar-counts`, sourceParityVerified=false.

Published PR789 / 2026-10-30: [single application entry repair](ozon-single-web-entry.md). Exact index.html correction prevents duplicate React roots/blank screen; other3204 web files and API/APK248/schema/data/sold unchanged. Cold entry RED/GREEN6 and public6; API4116/web569/TypeScript, baseline8. Ozon control/history retained. Baseline `2026-10-30-single-web-entry`, sourceParityVerified=false.

Published PR786 / 2026-10-30: packing -> Ozon cargo export -> attach labels -> scan WMS carton/Ozon sticker pair -> finish. Download-click history retained. LOGOFF248; API4116/web569/Android924, PostgreSQL12, candidate/public browser6+10; API156/web2 skipped, dedicated unconfigured KIZ DB suite excluded. Own WMS only, WMS_OZON_LABEL_CONTROL_ENABLED=true; prior flags, PR784 index, schema and sold WMS retained. Baseline `2026-10-30-ozon-label-control`, sourceParityVerified=false. [Control](ozon-label-box-control.md), [download history](ozon-label-click-history.md).

Published PR784: additive `KizReviewCase_client_identity_idx`, valid/ready, live query uses index. API/web images, containers and duplicate guard unchanged. PostgreSQL RED/GREEN concurrency5/replay2, API4108/web563 passed (156/2 skipped). №2494 completed normally:578 units/57 boxes, both Excel totals verified; guard enabled. [Details](fbo-kiz-shipment-batch.md).

Published PR783 / 2026-10-30: final FBO KIZ reads batched under the existing client identity locks; all per-KIZ duplicate/history/admin/context/binding checks retained. API4108/web563/TypeScript, PostgreSQL9/full health and baseline8 passed; API156/web2 skipped, unconfigured dedicated KIZ suite excluded. Exact2 API modules; other690 files, web/APK247/schema/environment/sold unchanged. Baseline `2026-10-30-fbo-kiz-shipment`, sourceParityVerified=false. [Details](fbo-kiz-shipment-batch.md).

Published PR781 / 2026-10-30: LOGOFF247 permits whole remainder in partial FBO picking, preserving previously picked loose units and pending-operation mode. Android915/API4096/web563, PostgreSQL9/full health, baseline8, signed APK/audio/public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact3 download files; other3199 web files, API/schema/stock/sold unchanged. Baseline `2026-10-30-fbo-partial-whole`, sourceParityVerified=false. Terminal update required. [Details](fbo-partial-whole-remainder.md).

Published PR779 / 2026-10-30: local receipt KIZ reports before first upload, explicit unconfirmed-duplicate notice, durable LOGOFF246 receipt progress/document and scanner focus. API4095/web563/Android912, TypeScript, runtime9, isolated PostgreSQL9/full API health, browser5, APK signature/audio and public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact1 API/2web/3 APK download files; schema/configuration/stock/sold unchanged. Baseline `2026-10-30-receipt-progress`, sourceParityVerified=false. Terminal update required. [Details](receipt-local-kiz-progress.md).

Published PR775 / 2026-10-30: FBO physical picking restores IN_WORK and exact completion advances to PACKING; WB/Ozon/Lamoda show packed-pending-control without granting shipment permissions. Own-image WMS_FBO_PROGRESS_STATUS_ENABLED=true. API4090/web562 (151/2 skipped), TypeScript, runtime12, disposable PostgreSQL9/full Nest health, candidate/public browser11 and baseline8 passed. Exact5 API/4web on PR776; schema/APK245/stock/sold unchanged. Request2494:578 picked,518 packed; stale SUBMITTED corrected to IN_WORK, packing retained, system audit, no stock movement. Baseline `2026-10-30-fbo-progress`, sourceParityVerified=false. [Details](fbo-progress-status.md).

Published PR776 / 2026-10-30: Ozon file/link imports show aggregated SKU stock and deficits, with full demand or confirmed WMS/Ozon correction. Customer-scoped permissions and file binding retained. API4072/web560 (151/2 skipped), TypeScript, source browser8, candidate/public browser10, runtime11 and baseline8 passed. Exact3 API/2web; schema/APK245/environment/sold unchanged. Baseline `2026-10-30-ozon-import-stock`, sourceParityVerified=false. [Details](ozon-import-stock-review.md).

Published PR773 / 2026-10-30: explicit ADMIN/OWNER found-unit confirmation, unknown FBO KIZ guard and BOX_CHECK review preservation. API4070/web557 passed (155/2 skipped; unconfigured dedicated KIZ DB suite excluded), TypeScript, runtime10, browser7, targeted26 and isolated full Nest/PostgreSQL health passed. Exact9 API/2 web files; schema, APK245, stock quantities, shipment history and sold WMS unchanged. WMS_INVENTORY_FOUND_UNIT_ENABLED=true only on our WMS; all prior environment values retained. Baseline `2026-10-30-found-unit`, sourceParityVerified=false. Public health/hashes verified. [Details](inventory-found-unit-review.md).

Published PR771 / 2026-10-30: exact FBS pick retry, durable KIZ review and previous shipment date/order. API4042/web555, TypeScript, runtime30. One of 688 API modules changed; web/APK245/schema/environment/sold unchanged. Baseline `2026-10-30-kiz-fbs-retry`, sourceParityVerified=false. [Details](kiz-fbs-review-retry.md).

Published PR769 / 2026-10-29: atomic FBO camera captions record exact product/article, barcode/KIZ, authenticated operator/device, box and packed/target counts in the existing packing transaction. Own-WMS flag enabled; AuditLog index valid/ready, exporter Index Scan 0.128 ms / 7 buffers. API4039/web555, TypeScript, baseline8 and actual-container runtime10 passed. Exact2 API-module overlay; other686 files, web/TSD245, prior188 environment values, other containers and sold WMS preserved. Baseline `2026-10-29-fbo-video-caption`, sourceParityVerified=false. No new real packing occurred in the recorded verification window. [Details](fbo-video-caption.md).

Published PR767 / 2026-10-29: FBS automatic continuation stays inside the selected request. LOGOFF245 restores request/marketplace after pending-operation recovery; lost selection opens the list. Own-WMS `WMS_FBS_EXPLICIT_REQUEST_ENABLED=true` prevents new unscoped assignments. API4028/web555 passed (155/2 skipped), Android897, TypeScript/release, baseline8, actual runtime56 and RED/GREEN regressions. Exact1 API/3 download files; other686 API modules/schema/prior132 flags/environment/business data/sold unchanged. Baseline `2026-10-29-fbs-request-scope`, sourceParityVerified=false. Public hashes/health verified; terminal update required. [Details](fbs-explicit-request.md).

Published PR765 / 2026-10-29: client-scoped KIZ duplicate receipt stop and contextual administrator-only shipment reuse. LOGOFF244 preserves Sofia voice243. API4018/web555 (155/2 skipped), Android885, TypeScript, PostgreSQL12, actual runtime26/full Nest health, browser10/16/7, baseline8 and live read-only4 passed. Exact18 API modules, three web functions, additive registry+5 concurrent indexes; backfill history only. Baseline `2026-10-29-kiz-client-guard`, sourceParityVerified=false; sold unchanged. [Details](kiz-client-duplicate-guard.md).

Published PR763 / 2026-10-29: LOGOFF TSD243 adds Sofia's approved offline tank voice pack (13 recordings / 17 existing events), selected by immutable account ID in LOGOFF only. Android286 per flavor (858 total), release/lintVital, baseline8, signed payload/certificate and existing25 raw-resource hashes passed. Exact3 download-file overlay on PR761; other3188 web files, all684 API files/schema/other containers/sold unchanged. Public APK/version/hash/health verified; terminal installation required. Baseline `2026-10-29-sofia-tanks-voice`, sourceParityVerified=false. [Details](sofia-tanks-voice.md).

Published PR761 / 2026-10-29: Ozon assembly/cargo and Lamoda FBO open in centered operational modals; Lamoda WB-style rows preserve client scope and label source-plan quantities. Minimize during loading retains its window and dock entry. API3975/web548 passed (150/2 skipped), TypeScript/build, baseline8, candidate/public browser32 each, runtime graph8 and capture guards5. Exact5 web overlay on PR759; all684 API files/schema/APK242/sold unchanged. Baseline `2026-10-29-fbo-modal-rows`, sourceParityVerified=false. [Details](fbo-modal-rows.md).

Published PR759 / 2026-10-29: FBO Ozon defaults to all permitted clients with WB-style rows, client in composition, retained countdown/actions and cursor paging. API3975/web542 passed (150/2 skipped), TypeScript/build, baseline8, runtime34, PostgreSQL9/full API health, candidate/public browser23 each. Read-only live check: 10 active/35 completed requests across3 clients in checked branch, metadata/scope/anonymous401 verified. Exact2 API/3web; schema/APK242/sold unchanged. Baseline `2026-10-29-ozon-all-clients`, sourceParityVerified=false. [Details](ozon-all-clients-list.md).

Published PR755 / 2026-10-29: LOGOFF TSD242 restores KIZ focus after scanner Enter in compact FBO packing with guarded delayed autofocus. Regression RED/GREEN; Android280 per flavor (840 total), release build, signing/payload, public hashes and health passed. Exactly3 download-file overlay on PR753; API/schema/other containers/sold unchanged. Baseline `2026-10-29-fbo-compact-focus`, sourceParityVerified=false. Terminal installation required. [Details](fbo-compact-kiz-focus.md).

Published PR753 / 2026-10-29: LOGOFF TSD241 shows remaining product lines before scanning loose FBO stock, preserving client display settings and server quantities. Request2542 regression RED/GREEN; Android279 per flavor (837 total), release build, signing/payload, public hashes and health passed. Exactly3 download-file overlay on PR750; API/schema/other containers/sold unchanged. Baseline `2026-10-29-fbo-unboxed-display`, sourceParityVerified=false. Terminal installation required. [Details](fbo-unboxed-product-display.md).

Published PR750 / 2026-10-29: LOGOFF TSD240 retains the scanned partial-pick source when server route refresh reclassifies it as a whole box, while preserving unit barcode/KIZ checks and clearing unavailable sources. Request2494 regression RED/GREEN; Android277 per flavor (831 total), release build, baseline guards8, signed payload/certificate, public hashes and health passed. Exact3 download-file overlay on PR749; API/schema/other containers/sold unchanged, 3179 other web files preserved. Baseline `2026-10-29-fbo-partial-source`, sourceParityVerified=false. Physical TSD update required. [Details](fbo-partial-source-refresh.md).

Published PR749 / 2026-10-29: download factual Lamoda XLSX after completed packing/box control without entering commercial prices. Customer fills blank date/number/prices before upload; strict API prices unchanged. API3965/web539 (150/2 skipped), TypeScript, baseline8, PostgreSQL10/full health and candidate/public browser9 each passed. Exact5 API/3web; schema/APK239/sold unchanged. Baseline `2026-10-29-lamoda-blank-price`, sourceParityVerified=false. [Details](lamoda-actual-shipment.md).

Published PR747 / 2026-10-29: Lamoda FBO actual packed shipment XLSX/API creation, durable no-replay receipt, status reconciliation and explicit rejection correction. API3959/web539 passed (150/2 skipped), TypeScript, baseline guards8, PostgreSQL9/full Nest health/exact migration and candidate/public browser6 each. Exact7 API/3web overlay; one additive JSONB column, APK239/sold unchanged. Baseline `2026-10-29-lamoda-actual-shipment`, sourceParityVerified=false. No real marketplace shipment created for testing. [Details](lamoda-actual-shipment.md).

Published PR745 / 2026-10-28: LOGOFF TSD239 automatically refreshes Lamoda packing directions and relabel print completion. Read-only polling pauses for scans/dialogs/mutations, retries transient reads and stops on completion/close. Android275 tests per flavor (825 total), release build, signed payload/certificate, exact3 download-file delta, public hashes and health passed. 3174 web files, API682 files/schema/other containers/sold preserved. Baseline `2026-10-28-lamoda-auto-refresh`, sourceParityVerified=false. Physical terminal update required. [Details](lamoda-fbo-relabel.md).

Published PR743 / 2026-10-28: CL-000014 terminal WB AUTO reservation reconciliation and account-specific monitor identities. Twelve stale reserves released; physical stock hash unchanged. Monitor31: 29 successful, 2 historical WB-delta warnings, no WMS errors/unavailable identities; current publications show no excess. API3934/web537, runtime67, PostgreSQL8/full API health and baseline guards8 passed. Exact4 API overlay; web/schema/APK238/sold preserved. Baseline `2026-10-28-kubrin-stock`, sourceParityVerified=false. [Details](kubrin-stock-reservations.md).

Published PR740 / 2026-10-28: SKU printing searches confirmed active Lamoda cards by article/card/barcode and labels exact Lamoda barcode choices; warehouse barcode remains the default. Client-scoped, existing Lamoda flag; no inventory or mapping writes. API3901/web537 passed (155/2 skipped), TypeScript/build, baseline guards8, actual runtime8, isolated PostgreSQL6/full Nest health, candidate/public browser3 and production read-only lookup6. Exact4 API/2web overlay on PR739; schema/APK238/sold unchanged. Baseline `2026-10-28-lamoda-print`, sourceParityVerified=false. [Details](lamoda-print-barcodes.md).

Published PR739 / 2026-10-28: Lamoda relabel starts from warehouse barcode/KIZ scan and confirmed mapping, without manual unit list. Exact4 API modules, web3 and signed LOGOFF238 over PR737; schema/stock/mappings/sold unchanged. API3894/web536 passed (150/2 skipped), Android268 per flavor, TypeScript, isolated PostgreSQL16/full API health, candidate/public browser8, public hashes and live read-only2506 resolution verified. Baseline `2026-10-28-lamoda-source-scan`, sourceParityVerified=false. Physical printer remains untested. [Details](lamoda-fbo-relabel.md).

Published PR737 / 2026-10-28: restored FBO WB popup, sorting/archive/action styling for staff and clients on cold entry. Existing stylesheet linked in index.html only; 3171 other files unchanged. Web536/API3887 passed (2/155 skipped), TypeScript/build, baseline guards8, candidate/public browser32 each. API/schema/APK237/sold unchanged. Baseline `2026-10-28-fbo-wb-styles`, sourceParityVerified=false. [Details](fbo-wb-style-restoration.md).

Published PR735 / 2026-10-28: Lamoda product relabel printing and exact unit scan before packing; frozen marketplace barcode/size, durable print retries, KIZ identity check and bulk-recovery fence. Exact5 API modules,4 additive columns, web3 files and signed LOGOFF APK237 on PR733. API3887/web535 passed (150/2 skipped); Android268 per flavor; isolated PostgreSQL13/full Nest health, candidate/public browser8, public APK/file hashes and live read-only request2506 label verified. Sold WMS unchanged. Baseline `2026-10-28-lamoda-relabel`, sourceParityVerified=false; physical printer remains untested. [Details](lamoda-fbo-relabel.md).

Published PR733 / 2026-10-28: Lamoda created plans open persisted assemblies instead of disabled draft review; stale-list existingRequest recovery, no false original-plan shortage, preview cleared after creation. API3875/web532 passed (150/2 skipped), TypeScript/build, baseline guards8, candidate/public browser50+11+5. Exact3 web overlay on PR731; API/schema/APK236/sold and request2506 unchanged. Baseline `2026-10-28-lamoda-existing`, sourceParityVerified=false. [Details](lamoda-existing-review.md).

Published PR731 / 2026-10-28: missing Lamoda active-request badge added; scoped persisted assemblies count separately from WB/Ozon, drafts and terminal requests excluded. API3875/web531 passed (155/2 skipped), TypeScript, runtime PostgreSQL5/full API health and browser5 passed. Exact1 API/3web overlay on PR729; schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-counts`, sourceParityVerified=false. [Details](fbo-active-card-counts.md).

Published PR729 / 2026-10-28: scoped active WB/Ozon FBO card counters without the 200-row list cap. API3875/web530 passed (155/2 skipped), TypeScript, PostgreSQL5/full API health, candidate/public browser5 and marketplace/Lamoda regression50. Exact3 API/3web overlay on PR727; schema/APK236/sold unchanged. Live authorized endpoint200, anonymous401; current actor counts WB2/Ozon3. Baseline `2026-10-28-fbo-counts`, sourceParityVerified=false. [Details](fbo-active-card-counts.md).

Published PR727 / 2026-10-28: shared administrative removal in Lamoda FBO cards, request-ID confirmation, scope reset and archive refresh. Preserves PR725 shortage review. API3872/web529 passed (150/2 skipped), TypeScript/build, baseline guards8, candidate/public browser50 plus shortage regression8 passed. Exact web3-file overlay; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-removal`, sourceParityVerified=false. [Details](lamoda-request-removal.md).

Published PR725 / 2026-10-28: Lamoda shortages block assembly creation; review shows warehouse barcode/size/plan/reserves/free/deficit, explicit corrections reduce quantities without reserving, then Serializable recheck protects FBS/FBO demand. Original plan retained; compact PR723 layout and inline execution preserved. API3872/web529 passed (155/2 skipped), TypeScript/build, PostgreSQL7/full API health, candidate/public browser8 and baseline guards8 passed. Exact4 API/3 web overlay; schema/APK/sold unchanged. Baseline `2026-10-28-lamoda-stock`, sourceParityVerified=false. [Details](lamoda-stock-guard.md).

Published PR723 / 2026-10-28: Lamoda operational FBO matches Ozon page layout: compact client/account/branch toolbar, collapsed file/supply forms, full-width active/completed cards with adaptive density4-6. API3851/web525 passed (150/2 skipped), source browser9, candidate/public browser43, TypeScript/build and baseline guards8. Exact web3 files; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-layout`, sourceParityVerified=false. [Details](lamoda-ozon-layout.md).

Published PR721 / 2026-10-28: Lamoda FBO opens shared execution inline after creation, preserves it across list refresh, resets on account/client/branch switch. API3851/web524 passed (150/2 skipped), build/TypeScript, baseline guards8, candidate/public browser28 passed with synthetic API fixtures. Web-only3 files on PR720; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-inline`, sourceParityVerified=false. [Details](lamoda-inline-assembly.md).

Published PR720 / 2026-10-28: separate marketplace workspaces and scoped client directory; customer connected tiles, staff filtered clients, Lamoda client-card maintenance. Panthera opaque Ozon/FBY/Lamoda surfaces and text removal width fixed. API3851/web524 passed (150/2 skipped), runtime PostgreSQL24/full API health, candidate/public browser24 and CSS regression6 passed. Exact4 API/7 web overlay, schema/APK236/sold unchanged. Baseline `2026-10-28-marketplace-workspaces`, sourceParityVerified=false. [Details](marketplace-workspaces.md).

Published PR718 / 2026-10-28: scoped client/admin manual Lamoda product correspondence with WMS name/article/barcode search and two-card confirmation. Plans retain Lamoda identities; availability/reservations/directions use warehouse barcodes. API3849/web519 passed,155/2 skipped; TypeScript, isolated PostgreSQL19/full Nest health and candidate/public customer browser14 passed. Live136 Lukin cards loaded and136 unique size-compatible links confirmed through audited service; client search verified. Exact3 API/3 web overlay on PR716, schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-mapping`, sourceParityVerified=false. [Details](lamoda-contour.md).

Published PR716 / 2026-10-28: Yandex FBY existing-supply import and Excel/manual internal assembly, scoped mapping/binding/refresh, separate LOGOFF TSD queue/APK236. Preserves Lamoda FBO and CLIENT access; Lamoda credentials now in client card, four equal marketplace tiles (2/4/1 columns). API3846/web519 passed,150/2 skipped; Android267 per flavor. Exact runtime PostgreSQL12 FBY +19 Lamoda, full Nest health, candidate16/public16 browser scenarios and public file/APK hashes passed. Additive FBY table; exact overlay on PR714; other containers and sold WMS unchanged. Real client Yandex import/physical scans remain unverified; no external supply/cargo-place/label writes. Baseline `2026-10-28-yandex-fby`, sourceParityVerified=false. [Details](yandex-fby.md).

Published PR714 / 2026-10-28: CLIENT access to own Lamoda FBO plans through existing request rights. Excel/ID import, availability and replay-safe assembly allowed; credential management remains administrative. Exact2 API/4 web overlay; schema/APK235/roles/business records/sold WMS unchanged. API3811 plus new controller-guard test, web513 passed;155/2 skipped. TypeScript, disposable PostgreSQL19/full Nest health, customer browser10 and admin13 passed; public customer browser10 and live read-only Lukin account/warehouses verified. Baseline `2026-10-28-lamoda-client`, sourceParityVerified=false. [Details](lamoda-contour.md).

Published PR711+712 / 2026-10-28: Lamoda FBO Excel/ID imports, replay-safe OUTBOUND assembly and isolated LOGOFF TSD queue/packing, APK235. API3810/web512 passed,155/2 skipped; all3 Android flavors, TypeScript with isolated Prisma types, runtime PostgreSQL17/full Nest health, candidate/public browser13 passed. Exact13 API/7 web files, two additive tables; own-image assembly gate enabled, external writes disabled, sold untouched. Baseline `2026-10-28-lamoda-fbo`, sourceParityVerified=false. Live account works; no client shipment yet for physical end-to-end test. [Details](lamoda-contour.md).

Published PR709 / 2026-10-28: Lamoda check/catalog now supply country=RU; catalog pages25 (was100). API3773/web510 passed,150/2 skipped; dedicated KIZ DB suites excluded. Actual candidate and published OAuth201/catalog200 verified. One API file; baseline `2026-10-28-lamoda-country`, sourceParityVerified=false. Web/APK/schema/keys/business data/sold WMS unchanged. [Details](lamoda-country-fix.md).

Published PR707 / 2026-10-27: client service lists skip writes to unchanged standard services and existing client price bindings. Exact two methods/one API file; own-image WMS_BILLING_SERVICE_READ_FAST_ENABLED. API3772/web510 passed;155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, targeted30, candidate read-only70ms and published read-only47ms for identical367 Bushkova services passed. Web/APK/prices/invoices/sold WMS unchanged. Baseline `2026-10-27-billing-read-fast`; sourceParityVerified=false. [Details](billing-service-read-performance.md).

Published PR705 / 2026-10-27: corrected HTML entry after PR703. One index.html src changed; prevents dual React roots and blank screen on saved-session restore. Authenticated Panther startup reproduced before and verified after, including public page with synthetic API fixtures. API3767/web510 passed;155/2 skipped, dedicated KIZ DB suite excluded. API/assets/APK/data/sold WMS unchanged. Baseline `2026-10-27-receipt-startup`; sourceParityVerified=false.

Published PR703 / 2026-10-27: receipt availability controls and per-client Gray/White processing profiles. Exact13 API/4 web overlay; WMS_RECEIPT_PROCESSING_ENABLED=true in our image only. API3767/web510 passed;155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, runtime18, browser12/full graph, isolated PostgreSQL/full Nest health and production rollback8 passed. Baseline `2026-10-27-receipt-processing`; sourceParityVerified=false. No client configured, no receipt/stock/invoice changed at deploy; APK/schema/sold WMS unchanged. [Details](receipt-processing-type.md).

Published PR701 / 2026-10-27: selected Ozon FBS labels avoid full marketplace/history reload. Exact2 API files; WMS_OZON_DIRECT_LABEL_ENABLED=true in our API image only. API3748/web510 passed,155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, candidate runtime/module graph, live health/hashes and read-only request2461 PDF passed (417ms,72205bytes). Baseline `2026-10-27-ozon-direct-label`; sourceParityVerified=false. Web/APK/schema/sold WMS/business records unchanged.

Published PR699 / 2026-10-26: actual Ozon FBO editing deadline countdown. Exact 4 API / 4 web overlay on multishop-auto. API3740/web510 passed, 155/2 skipped; dedicated KIZ database suite unavailable. TypeScript, runtime4/module graph, candidate/public browser (3 themes x6 widths) and live health/hash checks passed. Baseline `2026-10-26-ozon-deadline`; sourceParityVerified=false. Existing requests need an Ozon refresh. Sold WMS, APK, schema and business records unchanged.

Published PR697 / 2026-10-26: opt-in shared/allocated WB-Ozon stock publication with durable queue, canonical reservation reader, explicit preview/activation/stop and legacy writer fence. No client activated; Kubrin retains old settings. API3736/web502 passed;155/2 skipped; dedicated KIZ integration excluded. TypeScript, runtime8, isolated PostgreSQL12/full API health, editor13/runtime15/public15 browser and baseline guards8 passed. Exact14 API/3 web delta; baseline `2026-10-26-multishop-auto`, sourceParityVerified=false. Sold WMS/APK/schema unchanged. [Details](multishop-shared-stock.md).

Published PR695 / 2026-10-26: official local WB/Ozon/Yandex Market icons in FBS and WB/Ozon in FBO. Web504 passed/2 skipped, TypeScript,14 candidate/public browser scenarios and8 baseline guard tests passed. Seven-file web overlay; API/schema/APK/business records/sold WMS unchanged. Baseline `2026-10-26-marketplace-icons`, sourceParityVerified=false. Rollback `logoff-web:before-marketplace-icons-20261026`.

Published PR693 / 2026-10-26: Lamoda tile uses the supplied la icon and official lowercase SVG wordmark, local assets and shared 84px badge. Web503 passed/2 skipped, TypeScript and11 candidate/public browser scenarios passed. Exact five-file web overlay; API/schema/APK/business records/sold WMS unchanged. Baseline `2026-10-26-lamoda-icon`, sourceParityVerified=false. Rollback `logoff-web:before-lamoda-icon-20261026`. Sources: `apps/web/public/brand/README.md`.

Published PR691 / 2026-10-26: isolated Lamoda preparation workspace (FBO → Lamoda), encrypted OAuth, read-only sync, manual product links, Excel drafts and availability preview. Assembly/TSD, stock publication and shipment writes remain unimplemented. API3682/web502 passed;150/2 skipped; dedicated KIZ suites excluded. Real PostgreSQL migration,10 candidate DB scenarios, full isolated API health,10 candidate/public browser scenarios and read-only production checks passed. Nine API/four web delta, five additive tables, server-only encryption key. Baseline `2026-10-26-lamoda-preparation`, sourceParityVerified=false; sold WMS/APK unchanged. [Scope](lamoda-contour.md).

Published PR689 / 2026-10-26: multi-shop WB/Ozon group drafts and canonical SKU assignments. External stock publication NOT enabled; existing writers and legacy pair editor retained. API3643/web497 passed;155/2 skipped; dedicated KIZ DB suite excluded. TypeScript,8 candidate API checks,15 candidate/public browser scenarios and read-only live reads passed. Exact5 API/4 web delta. Baseline `2026-10-26-multishop-groups`, sourceParityVerified=false. Rollback `logoff-api:before-multishop-groups-20261026` / `logoff-web:before-multishop-groups-20261026`. [Details](multishop-stock-groups.md).

Published PR687 / 2026-10-24: catalog sorting by article/color/physical stock, in-stock and confirmed WB/Ozon-pair filters, scoped pagination. API3617/web497 passed;155/2 skipped; dedicated KIZ DB suites excluded. TypeScript, eight compiled API checks and seven candidate/public-browser scenarios passed with isolated data. Four API/four web files only; stock, operational linking rules, APK, configuration and sold WMS unchanged. Baseline `2026-10-24-catalog-sorting`, sourceParityVerified=false. Rollback tags `logoff-api:before-catalog-sorting-20261024` / `logoff-web:before-catalog-sorting-20261024`. [Details](catalog-sorting.md).

Published PR685 / 2026-10-24: catalog WB/Ozon identities and separate barcodes, scoped administrator enablement and read-only consistency check. API3609/web496 passed;155/2 skipped; dedicated KIZ DB suites excluded. TypeScript, eight compiled API checks and six candidate/public-browser scenarios passed with isolated data. Four API/three web files only; stock, operational linking rules, APK, configuration and sold WMS unchanged. Baseline `2026-10-24-catalog-overview`, sourceParityVerified=false. Rollback tags `logoff-api:before-catalog-overview-20261024` / `logoff-web:before-catalog-overview-20261024`. [Details](catalog-marketplace-overview.md).

Published PR683 / 2026-10-24: removal accepts complete audited FBO returns/transfers without erasing historical scans. Current physical/print/delivery guards retained. API3604/web487 passed,150/2 skipped; dedicated KIZ DB suites excluded. TypeScript, exact two-file candidate delta, module graph and candidate/public read-only preview2367 passed (allowed=true). API sha256:6c684dd449ec2fed17aeece99b2d81d2af314cac3ee057103a0094f18556cd1c; web unchanged. Baseline `2026-10-24-returned-fbo-removal`, sourceParityVerified=false. Sold WMS and business records unchanged. [Details](request-removal.md).

Published PR681 / 2026-10-24: seven FBS tiles, penalties inside problem orders, large active-orders tile beside two rows of three. Existing stock hub, reports and permissions retained. Web487/API3590 passed; 2/155 skipped, dedicated KIZ DB suite excluded; TypeScript, candidate/public browser geometry and 8 baseline guard tests passed. Three-file web overlay; API/APK/config/business data/sold WMS unchanged. Baseline `2026-10-24-fbs-seven-menu`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-seven-menu-20261024`. [Details](fbs-seven-menu.md).

Published PR679 / 2026-10-24: FBS menu reduced to 8 tiles; stock management, history, cost settings and problem orders grouped. Existing 5-section stock hub and read-only completed orders retained. Web485/API3590 passed; 2/155 skipped and dedicated KIZ DB suite excluded. Source/runtime/public browser checks and TypeScript passed. Exact three-file web overlay; API/APK/config/business records/sold WMS unchanged. Baseline `2026-10-24-fbs-compact-menu`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-compact-menu-20261024`. [Details](fbs-compact-menu.md).

Published PR677 / 2026-10-24: administrative removal of untouched FBO/FBS requests for ADMIN/OWNER. Mandatory reason/number/confirmation, atomic audit, preserved composition and Ozon bindings, durable FBS recreation block. Own-image WMS_REQUEST_REMOVAL_ENABLED=true. API3590/web476, TypeScript, compiled-UI8, isolated PostgreSQL9 and module-graph2 passed;155/2 skipped, unconfigured dedicated KIZ DB suite excluded. Seven-module API/four-file web delta; physical stock, KIZs, other containers and sold WMS unchanged. Baseline `2026-10-24-request-removal`, sourceParityVerified=false. [Details](request-removal.md).

Published PR675 / 2026-10-24: only Gushcha CL-000015 hidden in our-company FBS; Noginsk and other 46 clients preserved. Our-image-only WMS_FBS_GUSHCHA_VISIBILITY_ENABLED. API3564/web476/runtime12/FBS33 passed;155/2 skipped, dedicated KIZ DB suites excluded. Three-module overlay, other containers and business records unchanged. Baseline `2026-10-24-fbs-gushcha`, sourceParityVerified=false. Rollback `logoff-api:before-fbs-gushcha-20261024`. [Details](fbs-gushcha-visibility.md).

Published PR673 / 2026-10-23: FBS WB table checkbox selects all current search/filter results across pages; shop-wide positive-free selection remains separate. Selected/hidden counts and bulk-stop confirmation. Web476/API3564 passed,2/155 skipped; existing dedicated KIZ DB suite unavailable. Nine candidate and public browser scenarios passed with educational API fixtures. Three-file web overlay; all old assets except index retained. API/APK/config/business data/sold WMS unchanged. Baseline `2026-10-23-fbs-filtered-selection`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-filtered-selection-20261023`. [Scope and validation](fbs-filtered-selection.md).

Published PR671 / 2026-10-22: FBO alternative source box validation, LOGOFF APK234. Existing client/warehouse/receipt/reservation/KIZ guards retained. Two API files and three download files over PR669; WMS_FBO_ALTERNATIVE_PICK_ENABLED=true in our image only. API3564/web470/Android265 per flavor passed,155/2 skipped; dedicated KIZ DB suite unavailable. Eight candidate runtime cases and public download hashes passed; published read-only request2284 confirms526/527/528 with unchanged730/747. Physical device scan remains to be checked after installing APK234. Baseline `2026-10-22-fbo-alternative`, sourceParityVerified=false. Rollback tags logoff-api:before-fbo-alternative-20261022 and logoff-web:before-fbo-alternative-20261022. Sold WMS unchanged. [Details](fbo-alternative-picking.md).

Published PR669 / 2026-10-22: FBO picking history retains rows and scroll during polling; no transient loading paragraph above populated table. Source regressions4, candidate/public runtime browser5, web470 passed/2 skipped, TypeScript passed. API3559 passed/155 skipped; existing KIZ integration suite cannot initialise without dedicated DB URL. Exact two-file web overlay on PR667; API/config/stock/sold unchanged. Web sha256:0c70ec6c971bc061ee516eace82da463570b06baf5b1998b5363f1410964d344; baseline `2026-10-22-history-refresh`, sourceParityVerified=false. Rollback `logoff-web:before-history-refresh-20261022`.

Published PR667 / 2026-10-22: modern service menu cards with colored icon backgrounds, compact responsive grid, keyboard focus and reduced motion. CSS-only two-file overlay; API, JavaScript, permissions and sold WMS unchanged. Web466 passed/2 skipped; TypeScript passed; six candidate/public-CSS browser scenarios at1440/768/390 light/dark passed. Actual navigation markup/click handlers retained; test fixture uses placeholder icon paths. Web sha256:dac4d0cbbd175917bac89a3a97b54417b2392d7186d5f3c70514b5363e397a33; API sha256:a44fc2fbb1641fb022ae3902495c3057393d3de737518b7d4cccb33e9ea0ee91. Baseline `2026-10-22-service-tiles`, sourceParityVerified=false. Rollback logoff-web:before-service-tiles-20261022.

Published PR665 / 2026-10-22: original-sticker replacement accepts WB complete/sorted; ordinary repeat still requires complete/waiting. Final/unknown states blocked, actual state shown in errors. API3559/web466, TypeScript, runtime11 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live read-only preview6049802274 succeeded: BOX0205, original sticker59080109672. Exact two-module API overlay; no web/flags/schema/stock/sold changes. Baseline `2026-10-22-original-sorted`, sourceParityVerified=false; rollback logoff-api:before-original-sticker-sorted-20261022.

Published PR663 / 2026-10-22: Service original-sticker replacement for ADMIN/OWNER. HIGH priority, new unit/KIZ consumed once on physical picking, original PNG pinned, first attempt archived. Exact six API modules/two web files over PR661; own-image flags enabled, no schema or business data changes. API3558/web466, TypeScript, isolated PostgreSQL8, runtime8, candidate/public browser4 and live owner capability passed;155/2 skipped, dedicated KIZ DB suite excluded. Baseline `2026-10-22-original-sticker`, sourceParityVerified=false. Rollback tags logoff-api:before-original-sticker-20261022 and logoff-web:before-original-sticker-20261022. Sold WMS unchanged. [Details](fbs-original-sticker.md).

Published PR661 / 2026-10-22: CLIENT stock readers can open turnover Stock (minus requests) and export Excel for their permitted clients. Internal statistics and stock mutations remain restricted. One API module and two web files over PR659; no schema/config/business-data/sold changes. API3551/web466 passed,155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, actual-runtime before/after regression, public runtime and candidate API own/foreign-client checks passed. API sha256:5c63b72b85fd416960409369cb3799d9e8bcb0998dcb73d7e5e8d825dceb95a3; web sha256:df00b7ec0382ab6e7e7c30aa04d4b20b24fa04a4105566c695170da43bb538d1. Baseline `2026-10-22-client-stock`, sourceParityVerified=false. Rollback tags logoff-api:before-client-turnover-stock-20261022 and logoff-web:before-client-turnover-stock-20261022.

Published PR659 / 2026-10-22: CLIENT managers may change receipt FBS/FBO directions within writable client scope; read-only stays disabled. API3550/web465, TypeScript, candidate API11 and candidate/public browser9 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live Svetlana and manager capabilities true; Svetlana read-only client false. Two API modules and two web files; current receipt confirmation, invoice downloads and favorites retained. Baseline `2026-10-22-receipt-manager`, sourceParityVerified=false. No stock/config/schema/APK/sold changes. [Details](receipt-manager-directions.md).

Published PR657 / 2026-10-20: Panthera favorites and ordering synchronize per authenticated user. Existing local list imports only into an uninitialised account; explicit empty lists remain empty. Refresh on focus/online and every 30 seconds in visible tabs. Revision conflicts prevent stale overwrites. Three independent browser contexts passed on downloaded public JS, including account isolation and offline recovery; unauthenticated endpoint returns401. Disposable PostgreSQL concurrency proof passed. Web465 passed/2 skipped; API full3538 passed/155 skipped with two registry count failures fixed and targeted46 passed; dedicated KIZ DB suite excluded. API/web TypeScript passed. API sha256:bba911ad88300347e3290bd18af70db1d13e7c782c439175f30db19e06b74f65; web sha256:2c1a0164ba1d0883246d7d8c39d1430557bfd03956733986d3e76b0c5b2a4898. Exact four-module API/two-file web overlays; schema, config, other containers and sold WMS unchanged. Rollback tags logoff-api:before-panthera-sync-20261020 and logoff-web:before-panthera-sync-20261020. sourceParityVerified=false.

Published PR655 / 2026-10-20: receipt-batch list reuses one Moscow date formatter instead of constructing up to50000 in the API event loop. Exact two-module overlay; all other helper callers retain default behavior. Read-only repeatable-read comparison10339ms to2101ms with identical19 batches/50001 units; published handler2178ms. API3537 passed,155 skipped; dedicated KIZ integration suite unavailable (missing DB URL), TypeScript and actual-image1000-row regression passed. API sha256:3c5b5fb80636201167d0c80ce8f286bc6f14e12d76a2a0ca2abf7f38b918f459; web unchanged sha256:88566809fce505f160ef66bb109a5ae5f37b3aebc4b50610c6c8d857a8ba2cec. Rollback logoff-api:before-receipt-date-fast-20261020. No stock/schema/flags/sold changes; source parity false. This is a direct server-handler benchmark, not a full browser/network timing.

Published PR653 / 2026-10-20: scoped modern receipt panel refresh/filter/file buttons; active filter highlighted and modal descendants excluded. CSS-only two-file overlay, all prior assets/API/other containers preserved; sold WMS unchanged. Actual receipt closure browser regression fails before styling and passes seven scenarios; web462 passed,2 skipped. Public hashes verified. Web sha256:88566809fce505f160ef66bb109a5ae5f37b3aebc4b50610c6c8d857a8ba2cec; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-receipt-panel-buttons-20261020. Source parity false.

Published PR651 / 2026-10-20: scoped modern FBO separate WB download/footer controls, wrapping and disabled/focus states. CSS-only two-file overlay; all prior assets and API preserved, sold WMS unchanged. Web462 passed,2 skipped; before-fix browser regression fails, candidate/public CSS pass desktop/mobile checks. Web sha256:7e3f764d8becf22773ed6972e3c4f43446ee753898be399de79db34eda808493; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-fbo-download-buttons-20261020. Source parity false.

Published PR649 / 2026-10-20: receipt access confirmation renders before server preflight; confirmation remains disabled until validation succeeds and failed validation closes the dialog. Scoped modern buttons and visible checking/saving states. Seven browser scenarios pass on downloaded public JS; prior PR647 fails held-response regression. Web462 passed,2 skipped; TypeScript passed. Exact three-file overlay; API and other containers unchanged. Web sha256:fd0e9ebdcfccfbd32e389170b99bcf59f8a22cc77bfe63dede0283fb1d0db6c7; API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Rollback logoff-web:before-receipt-dialog-fast-20261020. Source parity remains false. This improves time to display, not server validation duration; direction preview computation remains unchanged.

Published PR647 / 2026-10-20: final effective ReceiptDirections declaration now uses native modal dialogs. Both production declarations are executed in order in regression; previous public runtime fails, corrected public JS passes five browser scenarios. Web461 passed,2 skipped. Web sha256:bf71856d59e7cf4f1420f778475b7af0c100499307ea81aea86003e6219aebc0, API unchanged sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Two-file overlay, other containers unchanged. Rollback logoff-web:before-receipt-dialog-effective-20261020. Source parity false; PR643/645 did not patch the final overriding panel.

Published PR645 / 2026-10-20: fixes PR643 dialog helper React scope. Complete receipt closure browser regression fails before fix and passes after; five cases also passed on JS downloaded from public site. Web461 passed,2 skipped. Web sha256:48da1ab9f56461e1c66ff87ebc8055ccdd87a87ab25d7b0f4535a3fccfbe4118; API unchanged at sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85. Exact two-file overlay, old assets retained; rollback logoff-web:before-receipt-dialog-scope-20261020. Source parity remains false.

Published PR643 / 2026-10-20: receipt approval and direction confirmations open centered in the native modal top layer, with backdrop and busy-safe cancellation. Web461/browser5 and web TypeScript passed;2 skipped. Exact three-file web overlay over live invoice-purpose/billing-fbo-filter runtime; all old assets, API and other containers preserved. API sha256:1a961e8f56c6ad3ee53fb8caf0230841fd8e353954ef1bb5a75920e867770c85, web sha256:63354801a6b954ba25c89a5ec1c197dc6dcf5b1e0d0ace0da816259cd19df640. Source parity remains false; the older PR641 archive is NOT the current production baseline. [Pinned release evidence](releases/receipt-dialogs-20261020.json).

Published PR641 / 2026-10-19: separate receipt and unfinished sorting tiles in the common administration grid for ADMIN/OWNER. Lazy tool content removes the empty upper card. Web459/API3535/browser4 and web TypeScript passed;2/155 skipped, dedicated KIZ DB suite excluded. Web-only; API/schema/flags/APK unchanged. Baseline `2026-10-19-admin-tiles`, sourceParityVerified=false. [Details](administration-operational-tiles.md).

Published PR639 / 2026-10-19: ADMIN/OWNER empty sorting cancellation from administration; scoped, versioned, idempotent and audited without stock writes. API3535/web453, runtime13/browser5 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Two API files, web graph overlay with old assets retained. Schema/flags/APK unchanged. Baseline `2026-10-19-sorting-cancel`, sourceParityVerified=false. [Details](sorting-cancellation.md).

Published PR637 / 2026-10-18: explicit first WB publication verifies exact fresh barcode identity, initializes and confirms zero, then publishes the reserved-stock plan. API3522/web446/helper10/runtime11 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Two-file API overlay; automatic/allocation paths, web/APK/config unchanged. Kubrin warehouse2271741 verified41 positions,40 positive,968 units. Baseline `2026-10-18-wb-first-publication`, sourceParityVerified=false. [Details](wb-first-publication.md).

Published PR635 / 2026-10-18: Dark FBS/catalog/cabinet/scanner surfaces and standalone relabel layout fixed. Web446/API3512, TypeScript and production-CSS browser checks passed;2/155 skipped, dedicated KIZ integration DB suite excluded. Exact two-CSS overlay plus index, 3005 old assets retained. API/APK/config unchanged. Baseline `2026-10-18-dark-surfaces`, sourceParityVerified=false. [Details](dark-surfaces.md).

Published PR633 / 2026-10-16: bounded named timings for FBS KIZ scan, completion, preflight, reservation, response, request status, notifications, sticker and task load. Existing behavior preserved; this is diagnosis, not a latency fix. API3512/web445 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Three actual-image checks; one runtime module only. Web/APK233/flags unchanged. Baseline `2026-10-16-fbs-stage-timing`, sourceParityVerified=false. [Details](fbs-stage-timing.md).

Published PR631 / 2026-10-16: Ozon label creation retries explicit HTTP429 with bounded delay. Ambiguous writes are not retried. API3509/web445 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Four actual-image checks; one runtime module only. Live client receipt visibility correction preserved. Web/APK233/flags unchanged. Baseline `2026-10-16-ozon-labels`, sourceParityVerified=false. [Details](ozon-label-throttling.md). FBS latency diagnosis remains open.

Published PR629 / 2026-10-16: receipt series XLSX uses recorded product label barcodes instead of unordered GTIN aliases. Scoped accepted TSD scans, unambiguous legacy fallback. API3507/web445, source6, container7, TypeScript and exact two-file delta passed;155/2 skipped, dedicated KIZ DB suites excluded. Live 1310 export verified4474 units. Web/APK233/flags unchanged. Baseline `2026-10-16-receipt-scanned-barcode`, sourceParityVerified=false. [Details](receipt-scanned-barcode.md). [Evidence](releases/receipt-scanned-barcode.json).

Published PR627 / 2026-10-16: interrupted WB auto assembly now persists request ownership atomically, journals supply intents/IDs and recovers under locks with exact WB composition and routing checks. API3501/web445, source11, candidate/live8, PostgreSQL4, TypeScript and baseline8 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules, own-installation durable flag only. Web/APK233 unchanged. Baseline `2026-10-16-auto-assembly-interrupted`, sourceParityVerified=false. [Details](auto-assembly-interrupted.md). [Evidence](releases/auto-assembly-interrupted.json).

Published PR625: [all-response shift latency summaries](shift-latency-summary.md). Two diagnostic API modules, WMS_OPERATION_HISTOGRAM_ENABLED=true only here. API3490/web445, TypeScript, actual-runtime4 and first live minute verified;155/2 skipped. Web/APK233/printing/backup settings/sold unchanged. Baseline `2026-10-16-shift-latency`, sourceParityVerified=false.

Published PR623: [FBS hidden-window polling](fbs-window-polling.md). Four recurring reads and two synchronization retries pause in hidden/minimized windows; refresh on restore. API3487/web445, TypeScript, candidate/live browser5 and exact33-file overlay passed;155/2 skipped. API/APK233/printing/sold unchanged. Baseline `2026-10-15-fbs-window-polling`, sourceParityVerified=false.

Published PR620/621 / 2026-10-15: durable bounded WB reconciliation queue and on-demand request readiness, exact lookup and assigned attention cases. API3487/web443, TypeScript, isolated PostgreSQL6, candidate/live browser7, actual API6, migration runner and baseline8 passed;155/2 skipped, dedicated KIZ DB suite excluded. Six API files, additive queue table and web graph; new flags enabled only on our WMS. PR618 monitoring retained; APK233, printing and sold WMS unchanged. Baseline `2026-10-15-reconciliation-tools`, sourceParityVerified=false. [Details](reconciliation-tools.md). [Evidence](releases/reconciliation-tools-20261015.json).

Published PR618 / 2026-10-15: WB monitoring uses current warehouse routing and exact reservation evidence. EXCLUDED routes are filtered before listing/ingestion/checking; WAITING_STOCK cannot confirm a reserve. API3475/web443, source/runtime13 and Docker6 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules only; WMS_FBS_MONITOR_ROUTING_ENABLED=true. Web/APK233 unchanged. Baseline `2026-10-15-monitor-routing`, sourceParityVerified=false. [Evidence](releases/wb-monitor-routing.json).

Published PR616 / 2026-10-15: bounded API request timing and compact TSD replay receipt reads. API3462/web443, TypeScript, actual-image7 and live read-only SQL verification passed;150/2 skipped, dedicated KIZ DB suites excluded. Three runtime files; two own-WMS flags enabled. Web/APK233/print agent/schema/stock/sold WMS unchanged. Baseline `2026-10-15-operation-reads`, sourceParityVerified=false. [Details](operation-read-diagnostics.md). [Evidence](releases/operation-reads-20261015.json).

Published PR614 / 2026-10-15: [объединённый макет Ozon](ozon-combined-layout.md) — компактное создание, 4–6 плиток, выбранная сборка/грузоместа снизу. Web443/API3454, TypeScript, baseline8, candidate/public graph browser и legacy layout passed;2/150 skipped, dedicated KIZ DB suites excluded. Exact34-file web delta; 94 public graph files verified. API/APK233/config/business records/sold WMS unchanged. Baseline `2026-10-15-ozon-combined`, sourceParityVerified=false. [Evidence](releases/ozon-combined-20261015.json).

Published PR612 / 2026-10-15: Ozon FAILED cargo retry requires fresh terminal failure, confirmed empty remote cargo arrays, binding/composition checks and atomic claim with previous-operation audit. Object-form errors now shown. Six regression cases; API3454/web442, TypeScript and actual-image4 passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module (upload/status); web/APK233/flags/stock/sold WMS unchanged. Request2058 retried only SPb and Novosibirsk; all8 directions SUCCESS, other6 submission IDs and labels preserved. Baseline `2026-10-15-ozon-retry`, sourceParityVerified=false.

Published PR610 / 2026-10-15: exact int64 Ozon cargo IDs retained on response parsing and label serialization. Two regressions fail before/pass after; API3448/web442, TypeScript and actual-image smoke passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module, only call/labels methods; web/APK233/flags/stock/sold WMS unchanged. Request2059 cargo IDs restored through audited status check, existing submission preserved; labels generated with 3 correct pages. Baseline `2026-10-15-ozon-ids`, sourceParityVerified=false.

Published PR608 / 2026-10-15: Ozon TSD closed-carton top-up before cargo submission. LOGOFF APK233, explicit REOPEN_BOX, existing destination/quota/KIZ guards and idempotent audit. API3446/web442/Android263 per flavor passed;155/2 skipped; five actual-runtime cases and public file hashes verified. Three API modules and three download files only; WMS_OZON_REOPEN_BOX_ENABLED=true. Baseline `2026-10-15-ozon-reopen-233`, sourceParityVerified=false. [Evidence](releases/ozon-reopen-233.json).

Published PR606 / 2026-10-14: Winx welcome now assigned to actual login Eleonora (display name Elkapone), not separate Elya account. Sofia unchanged. Web442/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and six public-site browser cases passed with real network HTML/JS/CSS/video (only API mocked). One account-ID change plus cache-safe graph renaming; API/APK232/configuration/business data/sold WMS unchanged. Baseline `2026-10-14-eleonora-account`, sourceParityVerified=false. [Details](eleonora-account-welcome.md). [Evidence](releases/eleonora-account-20261014.json).

Published PR604 / 2026-10-14: personal welcome after successful login for verified Sofia/Eleonora IDs in all themes; supplied Disney/Winx animations, exact text, skip and completion. Web441/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and actual runtime login/appearance/Ozon tests passed. Exact33-file web delta over sidebar-contrast; API, APK232, configuration, business records and sold WMS unchanged. Baseline `2026-10-14-personal-login`, sourceParityVerified=false. [Details](personal-login-welcome.md). [Evidence](releases/personal-login-20261014.json).

Published PR601 / 2026-10-14: readable section count in la_panthera Light. White badge text, contrast12.19 (was1.20); Dark6.01 unchanged. Web431 passed,2 skipped; source/candidate/published CSS browser checks passed. Only index.html and one hashed CSS asset changed over current live web; API/APK232 unchanged. Baseline `2026-10-14-sidebar-contrast`, sourceParityVerified=false. [Evidence](releases/sidebar-contrast-20261014.json).

Published PR598 / 2026-10-14: Winx and Disney styles in la_panthera, 33 supplied wallpapers, themed cursors and centered personal welcome. Web440/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Candidate/live login, restoration and Ozon inline browser checks passed. Exact 74-file web delta; API, APK232, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-panthera-magic`, sourceParityVerified=false. [Details](panthera-magic-themes.md). [Evidence](releases/panthera-magic-20261014.json).

Published PR599 / 2026-10-14: Ozon online execution embedded below the link-import form in the left column; right assembly list stays usable. Optional embedded mode preserves other modal callers. Web434/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, source/candidate/live browser checks passed. Only workspace and panel display properties changed in current runtime; API, APK232, flags, operations and sold WMS unchanged. Baseline `2026-10-14-ozon-inline`, sourceParityVerified=false. [Evidence](releases/ozon-inline-20261014.json).

Published PR596 / 2026-10-14: compact Ozon customer forms/cards; full assembly list uses page scrolling instead of the 585px inner viewport; themed native file/template controls. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Five-row source/candidate/live browser checks, five widths, three appearances and native file chooser passed. CSS + index only; application JS, API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-compact`, sourceParityVerified=false. [Evidence](releases/ozon-compact-20261014.json).

Published PR594 / 2026-10-14: approved Ozon customer workspace 65/35 layout, responsive import and supply panels, named accounts. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Source/candidate/live browser checks at five widths and three appearances, both import entry points and eight baseline tests passed. Exact 34-file web overlay; API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-layout`, sourceParityVerified=false. [Details](ozon-workspace-layout.md).

Published PR592 / 2026-10-14: LOGOFF APK232 clears restored unmarked FBO picking checkpoints after upgrade. Marked products and uncertain commands preserved. Android261 tests per flavor (783 total), release build, signature and public hashes passed. Only three APK download files changed over live October14 web; API853c97df unchanged. Baseline `2026-10-14-fbo-restore-232`, sourceParityVerified=false. Physical scanner requires APK232 installation. [Evidence](releases/fbo-restore-232.json).

Published PR590 / 2026-10-14: Ozon link import uses authorized customer warehouse selection and shows client owner beside account number. Both managed Korolev clients verified read-only. API3437/web431 and both actual browser entry points passed;150/2 skipped, dedicated KIZ DB suites excluded. API/web TypeScript passed. One API module and Ozon import UI; APK231, stock, configuration and sold WMS unchanged. Baseline `2026-10-14-ozon-client-access`, sourceParityVerified=false. [Details](ozon-client-link-access.md).

Published PR588 / 2026-10-14: LOGOFF APK231 fixes unmarked FBO manual top-up and stale barcode after definitive picking rejection. Marked products and uncertain commands preserved. Android260 tests per flavor (780 total), release build, signature and public hashes passed. Only three APK download files changed over live October14 web; API89534e60 unchanged. Baseline `2026-10-14-fbo-unmarked-231`, sourceParityVerified=false. Physical scanner requires APK231 installation. [Evidence](releases/fbo-unmarked-231.json).

Published PR586 / 2026-10-13: warehouse FBO picking from confirmed receipt boxes without pallet-sort placement, any receipt age. Shared route/command evidence guard; reservations, KIZ and client visibility preserved. WMS_FBO_UNPLACED_PICKING_ENABLED=true only in our API image. API3431/web427 passed,155/2 skipped; dedicated KIZ DB suite excluded. Six actual-runtime cases and Lukin PALLET_SORT read-only proof passed. Two API modules; web/APK230/stock unchanged. Baseline `2026-10-13-fbo-confirmed-unplaced`, sourceParityVerified=false. [Evidence](releases/fbo-unplaced-20261013.json).

Published PR584 / 2026-10-13: Ozon cargo HTTP429 bounded retry and verified empty-cargo recovery. Ambiguous writes remain blocked. One API module only; API3423/web427 passed,155/2 skipped; dedicated KIZ DB suite excluded. Three candidate/live runtime cases and request2000 read-only proof:5 confirmed directions,9 cargoes. APK230/web/flags/stock unchanged. Baseline `2026-10-13-ozon-rate`, sourceParityVerified=false. [Evidence](releases/ozon-rate-20261013.json).

Published PR582 / 2026-10-13: explicit administrator physical-KIZ reuse despite disputed historical WB sale. Per-task/unit/evidence approval; former binding archived, shipment history preserved. Active FBS/FBO, duplicate marks, stale evidence and confirmed retirement blocked. Flag WMS_KIZ_SOLD_PHYSICAL_REUSE_ENABLED only on our WMS. API3417/web427, KIZ runtime24/FBS runtime33, actual browser and PostgreSQL approval/scan with mandatory rollback passed;155/2 skipped, dedicated KIZ DB suites excluded. Two API modules and review UI only; APK230 and stock preserved. Baseline `2026-10-13-kiz-physical`, sourceParityVerified=false. [Evidence](releases/kiz-physical-20261013.json).

Published PR580 / 2026-10-13: LOGOFF APK230 restores picking after a saved Ozon product-packing mode. Pending commands preserved; regression reproduced before fix. 258 tests per flavor, release build, APK certificate and public hashes verified. Lint:11 existing errors in unchanged files. Three APK download files only; API/flags/business data unchanged. Baseline `2026-10-13-ozon-picking-230`, sourceParityVerified=false. [Evidence](releases/ozon-picking-230.json).

Published PR578 / 2026-10-13: confirmed Ozon-to-WMS composition sync beside stock adjustment. Preserves picked/packed units, exact registered barcode identity, reopens picking for added demand, and rejects stale previews or unsafe reductions. Four API modules and existing web panel only. API3416/web426 passed,155/2 skipped; dedicated KIZ DB suite excluded. Candidate browser and three runtime cases passed; live request2000 read-only preview205/205. APK229, flags and business records unchanged. Baseline `2026-10-13-ozon-sync`, sourceParityVerified=false. [Evidence](releases/ozon-sync-20261013.json).

Published PR576 / 2026-10-13: FBO registered SKU barcode aliases accepted during picking and packing; LOGOFF APK229. Request2000 Greta receipt barcode4610389218703 and request barcode4630584392961 retained as one SKU. KIZ/state/direction checks retained. API3404/web424/Android256 per flavor passed;155/2 skipped, dedicated KIZ duplicate DB suite excluded. Six actual runtime packing cases and live read-only request2000 plan passed. Two API modules and three APK download files only; PR574 Ozon adjustment retained, flags unchanged. Baseline `2026-10-13-fbo-aliases`, sourceParityVerified=false. [Evidence](releases/fbo-aliases-20261013.json).

Published PR574 / 2026-10-13: Ozon FBO actual-stock adjustment preview and explicit WMS/Ozon confirmation; picked + available minus other reservations, including accepted unplaced stock. Original box locations are shown. Durable external intents, no ambiguous retries, packing/cargo guard, atomic WMS commit after confirmed fresh Ozon composition. API3398/web424 passed,155/2 skipped; dedicated KIZ duplicate DB suite excluded. API/web TypeScript and actual runtime browser passed. Live request2000 read-only proof:206 planned,185 available,7 pending boxes; business quantities unchanged. Eight API modules overlay verified PR572; Ozon panel source parity checked. Web base flattened offline with preserved image configuration and files to resolve Docker mount-layer limit. APK228/flags/sold unchanged. Baseline `2026-10-13-ozon-adjustment`, sourceParityVerified=false. [Evidence](releases/ozon-adjustment-20261013.json). [Behavior](ozon-stock-adjustment.md).

Published PR572 / 2026-10-13: Ozon assembly workspace defaults to active requests with a separate Completed list for DONE/CANCELLED/REJECTED. Server filters before take100; completed packing remains active until handover. History and cargo access retained, completed assembly opens read-only. API3372/web424 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. Web TypeScript and source/candidate browser tests passed. Two source-parity API modules and one workspace overlay the pinned runtime. Live scoped list smoke passed without writes. APK228/flags unchanged. Baseline `2026-10-13-ozon-completed`, sourceParityVerified=false. [Evidence](releases/ozon-completed-20261013.json).

Published PR570 / 2026-10-12: client Telegram notifications support persisted forum topic IDs. Automatic and test messages include message_thread_id; legacy forms preserve it for the same group and clear it when the group changes. Six regression tests, API3370/web423 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. One parity-verified runtime module, equivalent decorator metadata normalized; candidate/live mock-network smoke passed. Web/APK228/flags unchanged. Baseline `2026-10-12-telegram-topic`, sourceParityVerified=false. [Evidence](releases/telegram-topic-20261012.json).

Published PR568 / 2026-10-12: Ozon client workbook import now resolves the only active client warehouse or requires an explicit scoped choice. Preview, commit and list use the same warehouse. Template download/link import retained. Candidate and live read-only Koroleva preview/list passed; mocked commit and actual-runtime browser passed. API3364/web423 passed,155/2 skipped; dedicated KIZ duplicate integration excluded. Web TypeScript passed; API source typing retains existing local Prisma drift. Four API runtime modules and scoped web functions over the pinned current graph. APK228 and flags unchanged. Baseline `2026-10-12-ozon-client-warehouse`, sourceParityVerified=false. [Evidence](releases/ozon-warehouse-20261012.json).

Published PR565 / 2026-10-12: FBO Ozon workbook download beside upload, plus existing supply-link import below it. Client/account/warehouse-scoped read-only preview, destination quotas, explicit atomic creation and duplicate/order-overlap protection. Live preview of 134006772 returns 50 units / 5 destinations / existing request 1951 without writes. API 3358 / web 422 passed, 150/2 skipped; dedicated KIZ DB suites excluded. Runtime changes: 6 API modules, 2 import functions in preserved web graph, 1 XLSX. APK228 and flags unchanged. Baseline `2026-10-12-ozon-link-import`, sourceParityVerified=false. [Evidence](releases/ozon-template-20261012.json).

Published PR563 / 2026-10-12: LOGOFF APK228 supports FBO WB/Ozon picking directly from unboxed client stock in the selected warehouse. Shared reservations, physical KIZ and idempotency preserved; packing by destination unchanged. New WMS_FBO_UNBOXED_PICK_ENABLED=true only on our WMS. API3349/web421/Android253 per flavor passed;150/2 skipped, dedicated KIZ DB suites excluded. Real PostgreSQL concurrency, replay and packing rollback passed. Four API modules overlay fresh PR562 runtime; three APK downloads only. Baseline `2026-10-12-fbo-unboxed`, sourceParityVerified=false. Request1951 created separately:50 units,5 directions,zero shortage; confirmed physical stock restored and reserved atomically,1 free unit remains. Existing five Ozon cargoes were read only. Physical scanner verification pending APK228 installation. [Evidence](releases/fbo-unboxed-20261012.json).

Published PR561 + PR562 / 2026-10-11: «Сервис → Сборка ФБС по номерам». ADMIN/OWNER, выбор филиала и короба, одна обычная заявка с сохранением поставок WB, повтор без дублей. Точный uint64-курсор WB; WMS_FBS_MANUAL_ASSEMBLY_ENABLED=true только в нашей WMS. API3344/web421 passed,145/2 skipped; два специализированных KIZ DB suite исключены. PostgreSQL5 на исходниках и5 на кандидате, браузерный граф31, live preview с откатом и блокировкой дубля №1921 прошли. Baseline `2026-10-11-fbs-manual`, sourceParityVerified=false. APK227, прочие флаги и проданная WMS сохранены. [Evidence](releases/fbs-manual-20261011.json).

Published PR559 / 2026-10-10: Excel mapping of WMS boxes to confirmed Ozon cargo IDs, directions and supply/order numbers. Download available after all directions succeed; exact text identifiers and scoped read-only export. Request1861 verified:27 boxes/11 directions. API3313/web417 passed,145/2 skipped; dedicated KIZ DB suites excluded. TypeScript, candidate runtime, live controller and browser download passed. Baseline `2026-10-10-ozon-cargo-export`, sourceParityVerified=false. APK227, print agent, flags, sold WMS and business records preserved. [Evidence](releases/ozon-cargo-export-20261010.json).

Published PR557 / 2026-10-10: Windows print agent2026.10.10.1 restores duplicate KIZ station heartbeat/polling and includes KizDuplicate.ps1 in package/installation. Only agent download changed. API/APK227/configuration/sold WMS unchanged; physical printer update required. 31 source and31 packaged agent tests, API3303/web416 passed;145/2 skipped, dedicated KIZ DB suites excluded. Baseline `2026-10-10-kiz-agent`, sourceParityVerified=false. [Details](kiz-duplicate-agent-station.md).

Published PR555 / 2026-10-10: exact unique WB barcode permits description synchronization on the same SKU. API-only three-file patch; 2409 Lukin cards updated,53 restored catalog blocks,37 genuinely missing cards retained. API3303/web416 passed,150/2 skipped; actual runtime sync/upsert and14 FBS checks passed. Configuration/schema/web/APK227 preserved. Baseline `2026-10-10-wb-barcode`, sourceParityVerified=false. Reserve display source in PR ancestry is not deployed. [Evidence](releases/wb-barcode-20261010.json).

Published PR553 / 2026-10-10: account-scoped WB/Ozon product links on shared warehouse SKUs. Enabled only for Kubrin; WB1438 linked/4 review, Ozon1713 preserved,1376 shared SKUs. Available stock subtracts active reservations from request creation, without subtracting picked units twice. API3298/web416, PostgreSQL6, runtime14, browser graph and isolated Prisma TypeScript passed;144/2 skipped, dedicated KIZ DB suite excluded. Additive MarketplaceProductLink table; no stock movements or publication settings changed. APK227 preserved. Baseline `2026-10-10-marketplace-links`, sourceParityVerified=false. [Evidence](releases/marketplace-links-20261010.json).

Published PR551 / 2026-10-10: LOGOFF APK227 adds last-unit packing undo and immediate Ozon destination barcode checks. Exact-unit receipt, atomic stock/KIZ return and audited idempotent undo; closed/stale/intervening operations rejected. WMS_FBO_PACK_UNDO_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing/schema and business records untouched by deployment. API3287/web414, Android252 per flavor (756), runtime7 and real PostgreSQL concurrency/rollback/KIZ return passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-fbo-packing-undo`, sourceParityVerified=false.

Published PR549 / 2026-10-10: LOGOFF APK226 adds Ozon packing by product alongside packing by destination. Barcode/KIZ → suggested direction → carton scan; atomic packing, durable replay, quota checks. WMS_OZON_PACK_BY_PRODUCT_ENABLED=true only on our WMS. Three API modules and three APK download files changed; sold WMS, routing and business records untouched. API3283/web414, Android249 per flavor (747), runtime7 and real PostgreSQL concurrency/rollback passed;139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot1861 verified capability and18 suggestions; route allocation excluded. Physical scanner check pending APK installation. Baseline `2026-10-10-ozon-packing-product`, sourceParityVerified=false.

Published PR547 / 2026-10-10: LOGOFF APK225 displays barcode, product, size, destination quantity and packed/remaining counts for the selected Ozon destination. Existing response only; no added requests. 245 Android tests per flavor (735 total), release/lint and signed package checks passed. Regression reproduced before fix. Physical scanner verification pending installation. Only three APK download files changed; API, print agent, flags, sold WMS and stock unchanged. Baseline `2026-10-10-ozon-direction-items`, sourceParityVerified=false.

Published PR545 / 2026-10-10: Ozon packing command now counts loaded units for unoptimized progress. Existing parallel-packing flag required; final phase and direction guards preserved. API3276/web414 and four runtime guard tests passed; API139/web2 skipped, dedicated KIZ integration excluded. Tests stop before physical mutation; production snapshot is read-only and excludes route allocation. APK224, web, sold WMS and business records unchanged. Baseline `2026-10-10-ozon-packing-command`, sourceParityVerified=false.

[Evidence and rollback](releases/ozon-packing-command-20261010.json).

# Published PR543 / 2026-10-10 — Ozon parallel packing

Removed only the Ozon exclusion from parallelPackingSupported. Existing APK224 can pack already picked units before FINISH_PICK. Direction quotas, physical picked-unit checks and final control guards are unchanged. Existing parallel-packing flag required.
Only one API runtime module changed; APK224, web, configuration, stock and sold WMS untouched.
Baseline `2026-10-10-ozon-parallel-packing`, sourceParityVerified=false.
API3272/web414/runtime2 passed; 139/2 skipped, dedicated KIZ integration excluded. Read-only production snapshot confirmed request1861 PICKING, 202/393 picked, packing available; route allocation omitted from this capability proof. Physical terminal scan pending.
[Evidence and rollback](releases/ozon-parallel-packing-20261010.json).

# Published PR541 / 2026-10-10 — LOGOFF APK224

Picking and packing each expose WB/Ozon lists. The API filters persisted ozonShipment identity before pagination; legacy requests remain unchanged. APK224 installation required. Progress and stock untouched; sold WMS not deployed.
Two API runtime modules patched against the current baseline, preserving parallel packing. Web changes only three LOGOFF APK downloads. Signed APK hash and published handlers verified.
Baseline `2026-10-10-tsd-fbo-marketplace`, sourceParityVerified=false.
Android244 release tests per flavor, API3268 plus 2 controller checks, web414 and 3 runtime tests passed. API139/web2 skipped; dedicated KIZ DB integration excluded. Read-only live proof: picking WB2/Ozon1, packing WB0/Ozon1. Physical terminal test pending installation.
[Evidence and rollback](releases/tsd-fbo-marketplace-20261010.json).

Published PR539 (2026-10-09): WB/Ozon FBO lists separated by persisted Ozon shipment relation. API sha256:fe92f300071c6b51a2a8e5452bfef661910711c4e5b629f9e40d2c191aeb9f24, web sha256:302d0ae012e1317cad9b55b07080adc59472a48ca0367a85b21a4ea3af861dfd. Baseline `2026-10-09-fbo-marketplace`; sourceParityVerified=false. APK223, flags and business records unchanged. API3266/web414, runtime2 and read-only live list handler passed; 144/2 skipped, dedicated KIZ DB integration excluded. Rollback tags: logoff-api:before-fbo-marketplace-20261009 and logoff-web:before-fbo-marketplace-20261009.

# Published PR537 / 2026-10-09: print agent 2026.10.09.2

A 409 result acknowledgement is retained and retried once per minute without blocking subsequent jobs. No automatic reprint or change to shipment accounting. One-time installation on the printing PC is required.
Only downloads/LOGOFF-FBS-Print-Agent.zip changed; API, APK223, flags, stock and sold WMS preserved.
Baseline `2026-10-09-print-agent-ack`, sourceParityVerified=false.
27 source agent and 24 packaged tests passed; API3258/web412 passed, 138/2 skipped. Dedicated KIZ integration excluded. Physical printer unavailable locally.
[Release evidence](releases/print-agent-ack-conflict-20261009.json). Rollback: `logoff-web:before-print-agent-ack-conflict-20261009`.

# Published PR535 / 2026-10-09: LOGOFF APK223

Corrected found-KIZ terminal API path. [Details](kiz-found-tsd-route.md).
Baseline `2026-10-09-kiz-route`, sourceParityVerified=false.
API `sha256:42a700c2b000e6f21663d0efd4846630f501a3ead5825db4726b61887948df82` unchanged; web `sha256:d35ba057effb4be38e410df657ed00ff9da30dfc31eeda61de7bae32592a99b3`.
Only three LOGOFF download files changed. APK223 signed and public hashes verified.
API/Ozon/printing/configuration/business records/sold WMS unchanged.
Android243 per tested flavor, API3265/144 skipped, web412/2 skipped passed.
Dedicated unconfigured KIZ DB suite excluded. Retrofit regression fails before fix.
GitHub checks not reported. Physical test pending APK223 installation.
Rollback: `logoff-web:before-kiz-route-223`.

# Published PR533 / 2026-10-09 — multiple Ozon orders per assembly

[Workflow](ozon-multiple-orders.md), [release record](releases/ozon-multiple-20261009.json).
API `sha256:42a700c2b000e6f21663d0efd4846630f501a3ead5825db4726b61887948df82`; web `sha256:8e095a14a7a1d7109b52885def84952ba7862065cf1fc4bd8e59ae5524da44da`.
Baseline `2026-10-09-ozon-multiple`; sourceParityVerified=false.
Two Ozon API runtime modules and web graph changed; additive OzonFboOrderBinding table.
Existing flags, APK222, PR529 found-KIZ fixes and PR531 print-agent download preserved.
One WMS assembly owns multiple Ozon orders with unique ownership and per-supply receipts.
Request1861 linked to four verified orders:393 units/11 directions, zero barcode/quantity differences.
Demand/picking unchanged. No external cargo submission or physical print performed.
API3265/web412 passed,144/2 skipped; unconfigured dedicated KIZ suite excluded.
Separately42 PostgreSQL tests, TypeScript and actual candidate browser graph passed.
Old implementation fails new regression. GitHub checks not reported for PR533.
Health, public hashes and live API snapshot verified; other containers/configuration preserved.
Rollback: before-ozon-multi-20261009 images; retain additive table. Old UI supports only first order,
so suspend cargo operations until multi-order code is restored after rollback.
Sold WMS untouched. Customer Excel template deferred for separate agreement.

# Опубликовано PR531 / 09.10.2026 — постоянная станция печати

Агент **2026.10.09.1** доступен в downloads/LOGOFF-FBS-Print-Agent.zip.
[Установка и границы проверок](print-agent-lifecycle.md), [запись выпуска](releases/print-agent-lifecycle-20261009.json).
Web `sha256:5ba62bbe07c2d30c0b5bf2399580ecd8233a86a04aae44ef4f452ffccac6f85c`; API `sha256:d2b82098fe83c40e6dd170150631b5962ef102139140b4cb241c1ec8a84dc195` сохранён.
Baseline `2026-10-09-print-agent`, sourceParityVerified=false.
Ровно один изменённый файл загрузки; весь веб-граф PR529, API, APK222, БД и настройки сохранены.
Сохранённый stationId, автозапуск при входе пользователя Windows, ограниченный HTTP/повторный вход,
журнал результата без автоматической перепечатки. Серия остаётся одним документом Windows.
26 тестов исходников агента, 24 готового пакета; API3258/web412 прошли,138/2 skipped;
отдельные KIZ integration исключены. Старый ACK-баг воспроизведён; публичный SHA проверен.
Печать на реальном TSC и установка на станции пока не выполнены. Однократное обновление требуется.
Медиана накладных расходов журнала ~39мс на задание; это не замер физического принтера.
Проданная ВМС не затронута. Откат web: `logoff-web:before-print-agent-lifecycle-20261009`.

# Published PR529 / 2026-10-09 — found KIZ without a box

[Scenario](kiz-found-review.md). Baseline `2026-10-09-kiz-found`, sourceParityVerified=false.
API `sha256:d2b82098fe83c40e6dd170150631b5962ef102139140b4cb241c1ec8a84dc195`;
web `sha256:85ad285a25fb94d2874e229b54c274f8b41e13a49f0d8b2c0bd09565aa616078`.
LOGOFF APK222, `WMS_KIZ_FOUND_REVIEW_ENABLED=true` only on our WMS.
Independent FOUND cases, explicit permission without stock, separate atomic return,
one-use UNIT permission. Active assemblies still require their stock return.
No production business records changed; no schema migration; FFULHAB untouched.

Validation: API3258 passed /143 skipped, web412 /2 skipped, Android242 per tested
LOGOFF/FFULHAB flavor; TypeScript, candidate runtime17, actual bundled browser,
isolated PostgreSQL concurrent OPEN/RETURN, rollback and one-use consumption.
Dedicated KIZ DB suite excluded without its configuration. No GitHub checks were reported.
Live read-only check on the reported mark: SHIPPING, box=null, found action offered.
Public hashes, signed APK certificate, health and unchanged other containers verified.
Physical scanner confirmation remains after installing APK222.
Rollback: `logoff-api:before-kiz-found-20261009`, `logoff-web:before-kiz-found-20261009`.

# Published PR527 / 2026-10-09 - unified Ozon supply binding

[Workflow](ozon-assembly-supply-link.md), [release record](releases/ozon-supply-20261009.json).
API `sha256:ac9b9eafc1e7885df9feab152486b9e8854664a5d9436c8cb0d8aaae3f37d3af`; web `sha256:857127eee62fb1c3b187751bd12d38d00d528eae8339ab43bcf97934d2fc4636`.
Baseline `2026-10-09-ozon-supply`; sourceParityVerified=false.
Existing Ozon order binding, destination/barcode reconciliation, verified physical cargo submission,
durable per-supply delivery claims and frozen packing. Unknown outcomes never auto-retry.
Two nullable OzonFboShipment columns and unique externalOrderKey. Existing flags, APK221 and print agent preserved.
API3240/web411 passed; 143/2 skipped, dedicated KIZ DB suite excluded. Separately 41 PostgreSQL tests passed.
TypeScript, actual bundled-browser workflow, runtime allowlist, live health/hashes and read-only assembly view passed.
Real Ozon read-only check: order133455152 has 239 units/8 destinations vs customer file393/11.
No actual cargo write or label printing was performed. Reconcile quantities before the first real send.
Sold WMS and warehouse business records unchanged. GitHub checks were not reported for PR527.
Rollback: logoff-api:before-ozon-supply-20261009, logoff-web:before-ozon-supply-20261009; retain additive fields.

# Опубликовано PR525 / 09.10.2026 — быстрые окна онлайн-выполнения

[Сценарий](online-window-performance.md), [запись выпуска](releases/online-window-20261009.json).
API `sha256:2cb306003ed72669d57c6a948130c6675c44668cf8b373e92c403b4804750b8e`; web `sha256:4e86185feedabdb76f2ba0c27a7b039e353db976a90a284ee91d659932c5e0b7`.
Baseline `2026-10-09-online-window`, sourceParityVerified=false.
Существующий WMS_MENU_READS_ENABLED; настройки и схема не изменены.
История ФБО по раскрытию, страницы по100; компактный ответ 1467254→92731 байт.
Скрытые окна приостанавливают запросы, восстановление сразу обновляет план.
Каталог ФБС читает независимые проекции параллельно (577–584→328–332мс).
Локальный браузер: построение блока ФБО 456–471→4–8мс, обновление около2мс.
Это не замер полного ответа через сеть планшета; полная история пока вычисляется сервером.
3230 API /411 web прошли,142/2 пропущены; отдельный KIZ DB integration исключён.
TypeScript,8 runtime-проверок, пагинация/повтор/сворачивание и Ozon-импорт/направления прошли.
Рабочий снимок сверён с обязательным откатом; складские данные не менялись.
PR523/522 сохранены, APK221/печать/проданная ВМС/прочие контейнеры не изменены.
Health, публичный index и хеши проверены. Откат: logoff-api:before-online-window-20261009,
logoff-web:before-online-window-20261009.

# Published PR523 / 2026-10-09 - administrator branch access

Baseline `2026-10-09-receipt-admin`, sourceParityVerified=false. API `sha256:70cd3860dc154f4bdd0077df3c3a7cc576a8393c13cc8f6c455221109399f8ac`; web `sha256:fa6f4af3634f85e7156348573e166354e5286e589a4c78a43c9b4ddf43f40c10` remains PR522. LOGOFF APK221 and all flags unchanged. Administrators use only their persisted active warehouse with existing read/write grants. Sold FFULHAB is untouched. [Release record](releases/receipt-admin-20261009.json).

API3228 passed/142 skipped; the unconfigured KIZ DB suite remains excluded. Runtime regression fails before and passes after. Actual six ADMIN/OWNER cards were verified in READ ONLY transactions after publication. Four receipt issues remain pending, available stock excluded, no duplicate receipt. Rollback API `logoff-api:before-receipt-admin-20261009`.

# Опубликовано PR520 / 09.10.2026 — импорт на экране FBO Ozon

[Запись выпуска](releases/ozon-entry-20261009.json). API `sha256:0d28742818119992b0139e661f5c8b2cde7344a6d072d8187679849944b2507c`; web `sha256:7408d8f2984fee6864d8c50ed4021464bdc0cc45ae385c9252e80f86742445bf`.
Baseline `2026-10-09-ozon-entry`, sourceParityVerified=false.
FBO Ozon открывает «Файл клиента — единая сборка»: выбранный клиент, проверка файла,
создание и список сборок с открытием выполнения. Старый формат остался в режиме
«План через API Ozon». PR518 с нейтральным баннером сохранён.
3177 API / 403 web теста прошли; 142/2 пропущены. TypeScript и браузер готового
графа прошли: файл клиента, preview 393/11, создание/список, прежний режим.
Серверная проверка списка read-only. Health и хеши проверены. GitHub checks
для PR520 не запускались. APK220, конфигурация, схема и рабочие остатки не менялись.
Откат: logoff-api:before-ozon-entry-20261009, logoff-web:before-ozon-entry-20261009.

# Опубликовано PR518 / 09.10.2026 — нейтральный баннер FBO Ozon

FFULLHAB WMS × OZON заменено на WMS × OZON. Web `sha256:e74c0dd9e1b91f5b8a78c18a89201a9df54bab8a19932bf92bb59b07dbc00f25`.
Изменение поверх baseline 2026-10-09-ozon-customer: новая версия JS-графа,
ровно одна замена текста; обратное преобразование ссылок подтвердило неизменность логики.
API, APK220, конфигурация и другие контейнеры не изменены. Health и публичные хеши проверены.
402 web-теста прошли, 2 пропущены. Откат: logoff-web:before-ozon-brand-20261009.
[Точный состав выпуска](releases/ozon-brand-20261009.json). Source parity false;
при следующем выпуске учитывать этот delta, не перезаписывать web старой сборкой.

# Опубликовано PR516 / 09.10.2026 — ФБО Ozon по файлу клиента, APK220

[Структура](ozon-fbo-customer-file.md), [запись выпуска](releases/ozon-customer-20261009.json).
API `sha256:dc42c71e014a7e7e41b44070cb7caa4396e19af849c6d790b2514bfc38ea0935`; web `sha256:bac9c1dc69f9089e85bca922469bce5ab443d26f4df382799be8405a5c37db00`.
Baseline `2026-10-09-ozon-customer`, sourceParityVerified=false.
Одна сборка, общий поштучный отбор, квоты и короба по направлениям. Флаг
WMS_OZON_FBO_IMPORT_ENABLED=true только нашей WMS; сохранены PR514 и прежние флаги.
Добавлены OzonFboShipment и FboAssemblyBox.direction; серверная Prisma-схема сохранена
в снимке. 3176 API / 401 web / 40 отдельных DB-проверок и Android прошли.
Проверка реального файла в откатываемой транзакции: 393 единицы, 18 SKU,
11 направлений, повторный импорт без дубля. Рабочая заявка не создавалась.
Health, хеши и подпись APK220 проверены; физическая проверка на ТСД ещё необходима.
Проданная WMS и физические остатки не изменялись. Установить APK220 поверх текущего.

# Опубликовано PR514 / 09.10.2026 — приёмки и онлайн-выполнение

[Изменения и ограничения](menu-read-performance.md), [запись выпуска](releases/menu-reads-20261009.json).
API `sha256:74dcc406760aa10115691126330c90fc87c512315f4405a2de3fd6fbc6cd8607`; web `sha256:7b9056af1ac204476f31d4d2126b432dc1e94b2b9c43a6468f5ad2290e14f1db`.
Baseline `2026-10-09-menu-reads`, sourceParityVerified=false.
WMS_MENU_READS_ENABLED=true только нашей ВМС. Шесть API-модулей и web-граф.
ФБС: облегчённые чтения карточек; ФБО: прямой браузерный план с прежними проверками;
приёмки: отчётная SQL-агрегация и короба по раскрытию. Одновременные GET объединяются
без хранения завершённого ответа. Миграций и складских изменений нет.
3163 API / 400 web прошли, 141/2 пропущены; отдельный KIZ DB suite исключён.
TypeScript, 6 runtime-тестов, browser-граф и управление окном ФБО прошли.
Сравнение на одном снимке с откатом совпало: ФБС 3,7–3,8→1,3с,
ФБО1813 5,8→0,59с, 29 приёмок 1,32→0,37с. Это серверные замеры.
APK219/агент печати/проданная ВМС/остальные флаги сохранены.
Health и хеши проверены. Откат: logoff-api:before-menu-reads-20261009,
logoff-web:before-menu-reads-20261009 и прежнее значение нового флага.

# Опубликовано PR512 / 08.10.2026 — компактная упаковка ФБО, APK219

[Сценарий](fbo-compact-packing.md), [запись выпуска](releases/fbo-compact-packing-20261008.json).
API `sha256:e45f6338a89e1fbe08e878d80811bf5209a11ce397c5f94140ed4a6f9276718c`; web `sha256:835462a2792073b16ee3b9352edc7022b4ee14ca001f8ee42f8bbd30ecbd7232`.
Baseline `2026-10-08-fbo-compact-packing`, sourceParityVerified=false.
WMS_FBO_COMPACT_PACKING_ENABLED=true только нашей ВМС. APK219 с прежней подписью
нужно установить поверх текущего приложения; старые ТСД совместимы.
После подтверждения упаковки передаются абсолютные счётчики и короба без всей
истории КИЗов; поле сканирования сохраняется. Отбор/ФБС/проданная ВМС не изменены.
3156 API тестов, по232 Android теста в6 вариантах,2 runtime проверки прошли.
API141 пропущены, отдельный KIZ integration исключён. Сверка с откатом совпала:
1462977→82487 байт,136→26мс формирования ответа. Это не физический scan-to-ready замер.
Проверены health, хеши API/пакета, подпись APK и сохранность остальных флагов.
Миграций и изменений складских данных нет. Откат: logoff-api:before-compact-packing-20261008,
logoff-web:before-compact-packing-20261008 и прежнее значение флага.

# Опубликовано PR509/510 / 08.10.2026 — индекс доступности приёмок

[Схема и проверки](receipt-stock-index.md), [запись выпуска](releases/receipt-stock-index-20261008.json).
API `sha256:5725c2d33e7548b431b1e3fdaa8c004a951a04c17692d804d6f5079dee28d6e3`. Baseline `2026-10-08-receipt-stock-index`, sourceParityVerified=false.
WMS_RECEIPT_STOCK_INDEX_ENABLED=true только на нашей ВМС. Добавлена таблица
ReceiptStockIdentity и транзакционные триггеры; физические остатки не изменены.
Web/APK218/остальные флаги/проданная ВМС сохранены.
Сверка постоянного индекса: 319 недоступных коробов, 1421 правило, весь план ФБО
совпали со старым расчётом. План 5339→1717 мс; проверки короба ФБС 29–77→4–6 мс.
Это компоненты сервера, не время полного сканирования. API3149/web398 прошли;
API141/web2 пропущены, отдельный KIZ DB suite исключён. Миграция и конкурентные
записи проверены в отдельном PostgreSQL. Первая миграция откатилась по таймауту;
исправленная групповая загрузка завершилась. Откат API: logoff-api:before-receipt-stock-index-20261008.

# Published PR507 / 08.10.2026: FBO receipt approval plan scope

API sha256:91cc1fb9ac47b6af22bc0f0c4da578f8aa9111a97f5f7d01172c3bbc9fad0216. Baseline `2026-10-08-fbo-receipt-plan`; sourceParityVerified=false.
Only `modules/tsd/fbo-fbs-reservations.js` changed from the fresh live base sha256:7536d590a09322e160611f23e81fbb7d5f8d9ea5969e69386dd76c02c37f97a4.
Request 1813: 231 lines, full snapshot 6344 ms after publication (candidate 6584 ms); mandatory rollback, no business records changed. Existing client approval and FBS reservations preserved. Web/APK218/flags/sold WMS unchanged.
3126 API tests passed, 141 skipped; dedicated KIZ integration suite excluded because an isolated database was unavailable. Scoped TypeScript passed.

# Опубликовано PR505 / 08.10.2026 — серии печати и телефон

[Сценарий и проверки](print-series-phone-layout.md), [запись выпуска](releases/print-phone-20261008.json).
Серия коробов отправляется одним заданием; Windows-агент печатает один многостраничный документ.
На телефоне заявки занимают ширину экрана, меню сворачивается, широкие блоки прокручиваются,
масштабирование браузера разрешено. Требуется обновить оба скрипта агента из опубликованного ZIP.

API `sha256:7536d590a09322e160611f23e81fbb7d5f8d9ea5969e69386dd76c02c37f97a4`;
web `sha256:2ba4b44a40bdf6051645f43449effdcb92ec240b7f5366a056e6b4a7e057b527`.
Baseline `2026-10-08-print-phone`, sourceParityVerified=false. Флаг
WMS_PRINT_SERIES_ENABLED=true только в нашей ВМС. Исправления PR501/503 сохранены;
APK218, остальные флаги, схема БД и проданная ВМС не изменены.
3129 API / 398 web тестов, 9 тестов готового API, 8 проверок агента,
проверка упаковки и 6 сценариев опубликованного Web прошли. API141/web2 пропущены;
отдельный KIZ DB integration исключён. Физические принтер и телефон пока не проверены.
Откат: `logoff-api:before-print-phone-20261008`, `logoff-web:before-print-phone-20261008`
и прежнее значение нового флага. Данные склада и задания печати при публикации не создавались.

# Published PR503 / 08.10.2026: bounded TSD receipt approval

[Change and checks](tsd-receipt-scoped-20261008.md). API sha256:100c581357a3e892a6aa021f7111b03338519ee094d67ea11edff7039c2c13dc.
Per-box FBS/FBO checks preserve client approval and shared locks without reading unrelated receipt history.
Published live checks: 38-101 ms; no business records changed. Web/APK218/flags/sold WMS unchanged.
Baseline `2026-10-08-tsd-receipt-scoped`; sourceParityVerified=false.

# Published PR501 / 08.10.2026: FBO window controls

[FBO window verification](fbo-window-controls-20261008.md). Web sha256:6b9bca6b3394eb7d5a4b387d267090834495249dd73764e699334ae3ed56b353.
Minimize/restore, close during reads and persisted-operation reconciliation verified on published code with isolated API fixtures.
395 web tests passed, 2 skipped; TypeScript and existing multi-window browser suite passed. API/APK218/flags/sold WMS unchanged.
Baseline `2026-10-08-fbo-window-controls`; sourceParityVerified=false.

# Published PR498 / 08.10.2026: single React runtime

[Incident and review](single-react-incident-20261008.md). Web sha256:41b53ba7bea7475d139d8366e2a9b08064fde9904c64619b63fe5c4563bb5e6c.
Requests/FBS/FBO/monitoring/administration verified in la_panthera, Soul and modern.
API/APK218/flags unchanged. Baseline `2026-10-08-single-react`; sourceParityVerified=false.

# Опубликовано PR494 / 07.10.2026 — согласование приёмок

[Описание и проверки](receipt-stock-approval.md). Клиент подтверждает собственную
приёмку; имя/время фиксируются в истории. Пока не подтверждено, товар исключён из
остатков и отбора ФБС/ФБО. Хранение начисляется с физической приёмки.
Включено только для Лукина / ФФ Москва; 29 прежних приёмок сохранены доступными.

API `sha256:b6a46b789d318c44837b823169ca60f169c01fe76fe42f1e3363b62b7b242d41`, web `sha256:1097a5ae42c410f54439f4c3ac066ed857398e9275c0a1e9f6bce0e8951dd0c2`.
Baseline `2026-10-07-receipt-approval`, sourceParityVerified=false.
WMS_RECEIPT_APPROVAL_ENABLED=true; остальные флаги/APK218/sold WMS не изменены.
Проверены runtime-хеши, health, права клиента, подтверждение в rollback-транзакции,
реальный браузер и общие тесты. Физические остатки не изменялись.

# Опубликовано PR492 / 07.10.2026 — журнал выгрузок и ожидание размещения ФБО

[Описание и проверки](cabinet-export-and-fbo-placement.md).
Excel фиксирует точные строки, фильтры, пользователя и IP запроса. ФБО допускает
подтверждённый приход за 7 суток без палет-сорта с ожиданием размещения.
LOGOFF ТСД218 опубликован; установка поверх старой версии.

API `sha256:4b83320f4ec8250aeb8bab8843a1db69e22c84363a372ab4908bb30f4ffeb8c8`, web `sha256:926bc59fbb684076283200ec073352e3ac568ecefec7231be2680cfd60530e9e`.
Baseline `2026-10-07-cabinet-fbo`, sourceParityVerified=false.
Флаги, схема, бизнес-записи и sold WMS не изменены. Проверены health, все хеши,
подпись APK, read-only приёмка0610. Откат: `logoff-api:before-cabinet-fbo-20261007`
и `logoff-web:before-cabinet-fbo-20261007`.

# Опубликовано PR490 / 07.10.2026 — планшет учёта времени 0.4.0

APK: https://wms.logoff.pro/downloads/logoff-attendance-0.4.0-pilot.apk
VersionCode 7; SHA256 `28e77833b3e692aaae423ee2f46ee595cfe26cefd9bc04207476c016a5c3cba0`.
Адаптивные экраны, крупные имена/действия, сохранение черновика при возврате/повороте,
видимая кнопка сохранения, локальная история работ и доставки. Обновление поверх старого
приложения с тем же ключом. Тихая установка отсутствует. Физический планшет пока не проверен.
92 Android tests, lintDebug, assembleRelease и проверка APK прошли.

Web `sha256:bf4632ada0da13bf1fab7c2847a374b4cc676b2b3345f978f33d1423977c4d84`:
добавлен только версионный APK в downloads; все остальные файлы сверены по SHA256.
API `sha256:961d496898b8e5fbdf809afdcce4197795f9ed6de0fb6cf7fcbb91ac8d717c05` сохранён;
baseline `2026-10-06-payroll-corrections` остаётся актуальным для API, sourceParityVerified=false.
БД, флаги, ТСД217 и sold WMS не изменены. Откат web: `logoff-web:before-attendance040-20261007`.
[Запись выпуска](releases/attendance-adaptive-040.json).

## Опубликовано PR488 / 06.10.2026 — исправления и история ФОТ

Исправлен фильтр сводки выплат (PR487): пустые суммы скрыты. В редакторе смены
можно выбрать правильного сотрудника, а у погрузки/разгрузки — участников,
время и объёмы. В настройках: История изменений → выбрать → Отменить изменение.
[Сценарий и ограничения](payroll-corrections.md), [запись выпуска](releases/payroll-corrections-20261006.json).

Новый флаг `WMS_PAYROLL_CORRECTIONS_ENABLED=true` только в нашей ВМС. Оплаченные
и изменённые позже записи защищены от отката; старые события без снимка доступны
для просмотра. Миграции БД нет, рабочие записи при выпуске не менялись.

API `sha256:961d496898b8e5fbdf809afdcce4197795f9ed6de0fb6cf7fcbb91ac8d717c05`; web `sha256:3471d224cc152b9ac7bdea36469b2fa607dc56a7f53883136d6bb580ec41e374`.
Снимок `baselines/our-wms/2026-10-06-payroll-corrections`; sourceParityVerified=false.
Изменены ровно пять API-модулей, web сохраняет прежние файлы и APK217/attendance.
3096 API + 387 web тестов прошли; 141/2 пропущены, отдельная KIZ DB suite исключена.
Отдельно прошли 18 PostgreSQL-тестов, 9 на готовом API и браузерный сценарий
на публикуемом JS. TypeScript и серверная история (только чтение) проверены.
Первый запуск автоматически откатился из-за рабочей папки проверочного скрипта;
повторная публикация успешна. Проданная ВМС не изменена.

## Опубликовано PR485 / 05.10.2026 — ТСД217

Отбор ФБО LOGOFF разделён на «Сборку целых коробов» и «Частичный отбор».
[Сценарий и тесты](fbo-two-stage-picking.md), [запись выпуска](releases/fbo-separated-picking-217.json).
Подпись совместима с216; 678 Android-тестов прошли. Воспроизводимость базового APK216
проверена по всем неподписанным записям; остальные классы217 сохранены.
Физический скан на ТСД ещё не проверен. Обновление устанавливается поверх текущего приложения.

API `sha256:fb456470d653863bf080da21a1eef7284de775f06e6f2221d8ae63cc4d1fabcf` сохранён без перезапуска; web `sha256:cab415deba5d10f5c920f86480d85601ec9a7876789da4a7d12e3fe45de14d86` меняет только три файла downloads.
Веб-приложение, флаги, конфигурация, БД и проданная WMS не изменены.
Снимок `baselines/our-wms/2026-10-05-fbo-picking-217` содержит свежий API runtime,
его неизменность проверена baseline guard. API sourceParityVerified=false;
это не разрешение полной сборки API/web из исходников. Откат web: `sha256:7d2b02b61b91203417468dc808432711eaaa407533268b270b6108cf73a70f36`.

# Published PR472 / 04.10.2026

<!-- FIX: permanent client/branch closure and signed documents preserve original finances. -->
«Биллинг → Клиенты и расчёты»: выбрать клиента, даты и активный филиал.
Закрытие требует предварительной проверки и основания; неоплаченные счета сохраняют долг.
Доначисление/уменьшение — отдельный документ с причиной и автором; поздняя работа — отдельный счёт.
Флаг `WMS_BILLING_PERIOD_CLOSE_ENABLED=true` только в нашей WMS.
Миграция `20261003220000_billing_period_close` применена атомарно и записана в Prisma history;
хеши исходных BillingInvoice/Item/Payment/Charge в транзакции не изменились.
Первый запуск остановлен lock timeout и полностью откатился; повтор после проверки блокировок успешен.
API `sha256:7ff2c21d01327774b1ff328cc9c842ec25b02eef031dbda79753050676dbbd3e`;
web `sha256:9af39b73ad64bb3930496e46f4ff3b47c6d28d2adfaf25238c6eb5a173f910ce`.
10 API-файлов, 29 новых JS chunks, 1714 старых assets сохранены. API569/web1744.
Перед выпуском сохранён новый live FBO TSD runtime из API `3ef0489614fe...`; он не изменён overlay.
Полные runtime/public hashes, offline candidate, два браузерных сценария и health прошли.
GET history/invoices/settlements200; гипотетические signed previews201; запись документов не выполнялась.
INV-202609-0007: оплата450000 и долг100535,37 сохранены. Новых closes/corrections0.
API3059/web372 passed, API132/web2 skipped; отдельная KIZ DB suite исключена.
TypeScript/Prisma validate/Vite прошли. Изолированный PostgreSQL проверил защиту, конкурентные строки,
взаимную блокировку до исправления и exact publication SQL с откатом финансового вмешательства.
Проданная WMS/FFULHAB/APK/compose и прочие контейнеры не менялись. Source parity false.
Локальная копия `C:/WMSFF2207/baselines/our-wms-runtime-period-close-20261004`;
current pointer обновлён; полный эталон01.10 неизменён.
До появления новых документов rollback images `logoff-api:before-billing-period-close-20261004`
и `logoff-web:before-billing-period-close-20261004`. После использования корректировок нельзя выключать
их учёт старым runtime: нужен совместимый расчёт и восстановление вперёд.
[Запись выпуска](releases/billing-period-close-20261004.json).

# Published PR469 / 03.10.2026

<!-- FIX: register hides settled clients while preserving unfinished calculations. -->
«Клиенты и расчёты» скрывает полностью рассчитавшихся клиентов, включая архивных.
Долг, невыставленные услуги, черновики, работа без начисления и нерешённые проверки
сохраняют строку. Один аванс строку не удерживает и не вычитается из долга.
Документы и деньги не менялись. Фильтр относится к реестру, не к удалению клиентов.
API `sha256:e7aa81ff68a153426ea7fdd4efc8a994f3119f107ee8b4b2d58ce4bdefd6a67b`;
web `sha256:7fab10dcd44ce9813cd63689ea03fbc7ad4e5b461c57950ceec8e59bd8200532`.
Один API-модуль, сообщение пустого списка, 29 новых JS chunks; 1685 старых assets сохранены.
Полные runtime/public hashes, offline candidate, browser и health прошли.
READ ONLY сравнение: 44 → 8 строк, скрыты 36 рассчитавшихся, из них 9 архивных;
суммы оставшихся и issues идентичны. Published GET settlements200, 5644ms;
invoices200, прежняя оплата INV-202609-0007 450000 и остаток100535,37 сохранены.
API3036/web368 passed, API132/web2 skipped; KIZ DB-suite требует отдельной БД.
TypeScript API/web прошёл. Проданная WMS/FFULHAB/APK/compose и другие сервисы не затронуты.
Source parity false; опубликован только проверенный overlay актуального runtime.
Локальный runtime: `C:/WMSFF2207/baselines/our-wms-runtime-settlements-visible-20261003`
(API564/web1715); current pointer обновлён, полный эталон 01.10 сохранён.
Rollback: `logoff-api:before-billing-settlements-visible-20261003`,
`logoff-web:before-billing-settlements-visible-20261003`.
[Запись выпуска](releases/billing-settlements-visible-20261003.json).

# Published PR467 / 03.10.2026

Исправлены ошибка 500 «Клиенты и расчёты» и подстановка полной оплаты вместо
введённого поступления в «Приход ДС». Подробности начислений ограничены датами
услуг, историческая FBS-проверка сохранена в лёгкой проекции. READ ONLY/RepeatableRead,
timeout30s, долг по всем выставленным счетам филиала и отдельный аванс сохранены.
Галочка распределяет только введённую сумму; история поступлений включает оплаченные
счета и отменённые записи. Прежние фильтр статуса и кнопка по сданным заявкам сохранены.
API `sha256:6c7be0f55b5334f80d8d78880beead3b19967b2018d5dba13ec633f00b2ecbf2`;
web `sha256:30fbd82b11b051a579f2b00b2f4bef1170570b6ba035297a66b85cdbaeab49cb`.
Два API-файла, 29 новых JS chunks, 1656 прежних assets сохранены. Compose не менялся.
Другие сервисы/sold WMS/FFULHAB/APK не затрагивались. Source parity false.
Коррекция по подтверждению владельца: INV-202609-0007, проведено 450000 ₽,
остаток 100535,37 ₽, ISSUED; первоначальный ошибочный платёж отменён и сохранён.
Есть before/after audit; dry run с rollback и проверка после commit прошли.
Published GET settlements и invoices вернули 200; запись оплаты/история/остаток проверены.
Повторная проверка под рабочей нагрузкой: settlements 22304 мс, оба GET вместе
63124 мс. Это HTTP-время; 2853 мс ниже относится к отдельному READ ONLY кандидату.
API3034/web367 passed, TypeScript, Vite, 5Node+1Python, browser, offline candidate,
полные хеши runtime/public assets/health прошли. READ ONLY кандидат2853ms.
Локальная копия: `C:/WMSFF2207/baselines/our-wms-runtime-partial-receipt-20261003`
(API564/web1686); указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json` обновлён.
Полный эталон 01.10 не менялся. Runtime rollback отдельно от денежной коррекции:
`logoff-api:before-billing-settlements-timeout-20261003`,
`logoff-web:before-billing-settlements-timeout-20261003`.
[Описание](billing-partial-receipt-fix.md), [запись](releases/billing-partial-receipt-20261003.json).

# Published PR465 / 03.10.2026

«Биллинг → Счета → Статус счёта»: Все статусы / Черновик / Выставлен / Оплачен /
Отменён. Доступен в списке и темах, выбор сохраняется, метрики тем учитывают статус.
API и документы не изменялись; прежняя кнопка счёта по сданным заявкам сохранена.
Web `sha256:019e9c307cb64eb4da299c8643f1b59607416ca257e6aeb363682720ecfa6587`;
API остаётся `sha256:f541c929317c030370f40d360c25bc19f0cf69ea568762b8f18fbdd64cfbcf3a`.
1627 прежних assets сохранены, новый граф 29 JS-файлов. Пересоздан только web.
Локальный runtime: `C:/WMSFF2207/baselines/our-wms-runtime-invoice-status-20261003`
(API564/web1657), указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json` обновлён.
Source parity false: только точечные изменения поверх свежего runtime.
Полный эталон 01.10 не менялся; sold WMS/FFULHAB не затрагивались.
Web365/API3033 passed, TypeScript/Vite, Node/Python guards, browser actual graph,
server candidate/full hash verification/public graph/health прошли.
Откат: `logoff-web:before-billing-invoice-status-20261003`.
[Описание](billing-invoice-status-filter.md), [запись выпуска](releases/billing-invoice-status-20261003.json).

# Published PR463 / 03.10.2026

«Биллинг → Счета → Создать счёт по сданным заявкам»: обе даты выбирает оператор,
отбор по последнему переходу в «Сдано» (МСК), единый новый черновик на клиента/филиал
из утверждённых начислений всех услуг. Все существующие счета, включая черновики,
сохраняются: охваченные заявки и пересекающиеся периоды исключаются с номером счёта.
Пропущенные начисления не восстанавливаются автоматически; исключения видны в расчёте.
Флаг `WMS_BILLING_DONE_REQUESTS_ENABLED=true` включён только в нашей WMS.

API `sha256:f541c929317c030370f40d360c25bc19f0cf69ea568762b8f18fbdd64cfbcf3a`;
web `sha256:28b7131de8ddd6bd02b2062a58872f1eb98ad57e95e7e3784143769c31291007`.
Точный delta: шесть API-файлов из свежего runtime, новый граф из 29 JS-файлов.
1598 прежних web assets сохранены; остальные контейнеры/APK/sold WMS/FFULHAB не менялись.
Откат: `logoff-api:before-billing-done-requests-20261003`,
`logoff-web:before-billing-done-requests-20261003`; compose-before.yml в каталоге выпуска.

API 3033 passed / 132 skipped, web 364 passed / 2 skipped; отдельная KIZ DB suite
исключена. TypeScript, Vite, 3 Node + 3 Python release tests, browser actual graph,
offline candidate smoke и published HTTP read-only preview прошли. Реальный расчёт
01–02.10: 60 сданных заявок, 72 существующих счета, 87 исключений, новых документов 0.
Сверка до/после: финансовые поля всех 5458 счетов и все 51375 строк неизменны.
Health, все API-хеши/прежние web assets/новый public graph и флаг проверены.

Проверенная локальная копия runtime:
`C:/WMSFF2207/baselines/our-wms-runtime-done-requests-20261003`
(API564/web1628 файлов), указатель `baselines/OUR_WMS_CURRENT_RUNTIME.json`.
Исходный полный серверный эталон 01.10 сохранён без изменений. Source parity false:
полную локальную сборку публиковать нельзя; перед следующей правкой сверить сервер.
[Описание](billing-done-requests.md), [запись выпуска](releases/billing-done-requests-20261003.json).

## Предыдущие выпуски

# Published PR461 / 03.10.2026

Cancelled unfinished KIZ reuse: physical admin confirmation, RELEASED/non-completed tasks in closed requests, no shipment history, exact saved WB cancellation and later per-mark sorting/movement proof. Fresh contradictory WB evidence rejects. Full task/evidence saved before conditional removal of old KIZ binding. Current review still needs manager approval. Sold WMS unchanged; existing flags only.

API `sha256:2638fbfc2e62e83d75bcd6ddbaf5bf7b1c3fc781f36a9b1f9a1dc757ad4aa8cc`. Baseline `2026-10-03-kiz-unfinished-release`; rollback `logoff-api:before-kiz-unfinished-release`. One module changed from fresh563-file runtime containing parallel payroll releases. Web/APK/other containers unchanged. Source parity false; do not replace with historical TypeScript build.

11new compiled tests and12previous returned-KIZ regressions passed. Regression failed before patch. Real request1676 KIZ validated with mandatory transaction rollback; binding unchanged afterwards. Local API2989passed/129skipped; separate KIZ database integration excluded. Health and runtime hashes checked after publication.

# Published PR457 / 02.10.2026

Завершение упаковки FBO: существующий неизменившийся справочник услуг и тариф
клиента читаются без повторного upsert. Исправлен наблюдавшийся источник конфликтов
и тайм-аутов для №1568. Флаг `WMS_FULFILLMENT_CATALOG_READ_FIRST=true` включён
только в нашей WMS; исходные флаги сохранены, проданная WMS не затронута.

API `sha256:e144daf31ad40c114c7b16561e06b5e3b3338e198fe17bfe0c0ffc143950b960`.
Web `sha256:347633f1079ad90a969e216911a1a83b59ea1acec2e19e4bada36fd0b061db2d` без изменений.
Baseline: `wms/baselines/our-wms/2026-10-02-fbo-finish-catalog` (API, 563 файла).
Точный delta — одна функция `ensureStandardFulfillmentService` в
`modules/stock/stock-operations.service.js`. APK и остальные контейнеры сохранены.
Откат: `logoff-api:before-fbo-finish-catalog`. Source parity остаётся false.

API 3014 passed / 129 skipped; отдельная KIZ DB suite исключена. TypeScript
с актуальным изолированным Prisma-клиентом прошёл. Два регрессионных теста
фактической функции падают до исправления и проходят после; девять прежних
runtime-тестов recovery проходят в собранном образе без сети.
На опубликованном API оба способа завершения №1568 проверены с обязательным
откатом: обычный 4220 мс, административный 3795 мс. Оба Excel на 585 единиц:
42 товарные строки и 191 строка распределения по коробам. Повторный запрос
не дублирует начисления. Тестовые изменения полностью отменены; заявка
сохранена в CONTROL, а не закрыта автоматически. Health и все хеши проверены.

[Подробности и ограничения](testing/fbo-finish-catalog-conflict.md).

## Previous release

# Published PR455 / 02.10.2026

«Биллинг → Клиенты и расчёты»: суммы по клиенту/активному филиалу, расшифровки
до начисления/заявки/заказа/тарифа/счёта и очередь проверок. Новый GET
`/billing/settlements` читает PostgreSQL в RepeatableRead READ ONLY. Флаг
`WMS_BILLING_SETTLEMENTS_ENABLED=true` включён только в нашей WMS.
Миграций, корректировок начислений и изменений остатков нет. Проданная WMS
не затрагивалась. Поиск выполненной работы без начисления покрывает подтверждённую
FBS-обработку WB/Ozon; это не полный контроль FBO/хранения/доставки.

API `sha256:1b186bf6e015f0144c973bff8b67b1825739b2774d7556666bab53d8a8157764`;
web `sha256:347633f1079ad90a969e216911a1a83b59ea1acec2e19e4bada36fd0b061db2d`.
Точный delta: три новых billing-settlements модуля, подключение BillingModule,
запись каталога API; существующие расчётные сервисы не заменялись. Сайт сохраняет
1537 прежних assets, добавляет новый граф и CSS. Остальные контейнеры и APK
сохранены. Откат: `logoff-api:before-billing-settlements-20261002`,
`logoff-web:before-billing-settlements-20261002`; compose-before.yml в каталоге выпуска.

API 2956 / web 360 passed, 115 / 2 skipped; отдельная KIZ DB integration исключена.
После объединения повторно проверена актуальная интеграционная версия:
API 3006 / web 361 passed, 129 / 2 skipped; отдельная KIZ DB suite исключена.
TypeScript API/web, 6 тестов выпуска, offline runtime smoke, actual runtime browser,
полные опубликованные хеши и health 200 прошли. GET без входа возвращает 401.
Read-only проверка в опубликованном API: 44 строки, 52 проверки, 23 случая
WORK_WITHOUT_CHARGE за 1–2 октября на активном складе владельца.
Исправленный тест воспроизводит прежний отказ реестра на 42 144 начислениях.

Свежий локальный runtime API/web:
`C:/WMSFF2207/baselines/our-wms-runtime-billing-settlements-20261002`.
Архивы и каждый файл проверены `release_baseline.py verify`; эталон 01.10 не менялся.
[Машинная запись выпуска](releases/billing-settlements-20261002.json),
[описание и ограничения](billing-settlements.md). `sourceParityVerified=false`.
Перед следующим выпуском читать свежие image ID; полный source build по-прежнему
не заменяет опубликованный runtime.

## Previous release

# Published PR453 / 02.10.2026

Follow-up to PR451: real recovery still exhausted serialization retries. recoverInTransaction now uses executeAction without unused route calculation. apply keeps3fresh transactions, waits50/100ms between retries, and reports409with repeat-preview guidance on exhaustion. All permissions, revision checks, inventory validators and receipts preserved.

API `sha256:3278a1e6c2f0f959324f5f0000c546b960927ef96793ad49663171c88807cfe7`; baseline `2026-10-02-fbo-recovery-route`; rollback `logoff-api:before-fbo-recovery-route`. Only2runtime modules changed. Source parity false; web/APK/flags/sold WMS unchanged.

2989 local API tests passed,129skipped; dedicated KIZ DB integration excluded.4new runtime regressions and5prior retry tests passed. Actual preview/apply for1568 intoFFL_LKBFBO0110_013 succeeded on published image in1346ms with mandatory outer rollback; persisted unit remainsPICKED. Before-fix smoke also passed during a quiet interval: contention is intermittent, not claimed impossible. Health and560file hashes verified.

# Published PR451 / 02.10.2026

Administrative FBO recovery no longer retries within an aborted transaction. The recovery-scoped service propagates P2034 to FboProblemsService.apply, which rolls back and retries the whole operation using the same preview receipt. Ordinary actions retain three attempts. Request1568 business data unchanged.

API `sha256:b5241036c24526715e4d880950f98f3ecf18fda00e6fea16be1ad390afc94209`; API-only baseline `2026-10-02-fbo-recovery-retry`; rollback `logoff-api:before-fbo-recovery-retry`. Web/APK/flags/other containers unchanged. Sold WMS not deployed. sourceParityVerified=false; only modules/tsd/fbo-two-stage.service.js changed, not a full source rebuild.

2989 local API tests passed,129 skipped; dedicated KIZ database integration excluded. Five compiled runtime checks passed: PACK_UNITS, CLOSE_PICK, ordinary retry bounds, non-conflict propagation and outer retry with a single receipt. Regression reproduced25P02 before correction. Runtime checks simulate transactions without business writes; real user operation still requires retry after publication. Published health and all560runtime hashes verified.

# Published PR449 / 02.10.2026

Follow-up to PR447: live terminal requests still required8–11seconds. CPU profiling isolated repeated per-box marking/composition decisions. Cache only within one snapshot, keyed by box object and every contained SKU demand. Recalculate when demand changes; no cross-request cache. Same our-WMS-only flag, sold unchanged.

API `sha256:7713bd2033c56cb079b9ee2c1147be454cb3f87b177dca573cefb62c0b0388fb`. API-only baseline `2026-10-02-fbo-cache`; sourceParityVerified=false; rollback `logoff-api:before-fbo-cache`. Web/APK/other containers unchanged.

2987 API tests passed,129 skipped; dedicated KIZ database integration excluded. TypeScript limitation from pre-existing local payroll Prisma types remains. New regression failed before/pass after; compiled route comparison passed12fixtures. Same-transaction comparison №1626 matched496boxes;5.14→1.42seconds. Full getDeviceRequestPlan with actual Konstantin permissions succeeded after publication in2247ms,301505-byte response. This is server-handler verification, not a physical-device UI test. No business writes. Published hashes/health/flag verified.

# Published PR447 / 02.10.2026

FBO route timeout: bounded shipped-order lookups and in-flight plan coalescing with independent caller authorization. Same request/context shares only an unfinished calculation; no settled cache. Flag WMS_FBO_PLAN_COALESCE_ENABLED=true only on our WMS; sold WMS unchanged.

API `sha256:8243c12ea763172e91c493b5142b0b7bc82948e1ee8cb221abb84feb02b322df`. Baseline `2026-10-02-fbo-plan` contains API only. Web/APK and other running containers unchanged by PR447. Source parity remains false. Rollback `logoff-api:before-fbo-plan`.

Validation: 2985 API tests passed across full run and two environment-corrected reruns;129 skipped; dedicated KIZ database integration excluded. Six new source tests (two reproduced the old failure) and three compiled-runtime tests passed. TypeScript check blocked by stale local Prisma types for pre-existing payrollBreak/handling fields; no errors reported in changed modules. Read-only same-transaction route comparison for1626 matched exactly:496 boxes;shipped links32727→7215. Published read-only calculation5366ms. Health, all560 runtime file hashes and flag verified. No business data changed.

# Published PR442 / 30.09.2026

PR442: receipt channel/membership changes atomically invalidate WB stock plans through the durable existing queue. API3010 passed/83 skipped; TypeScript and exact one-module delta verified. Web/APK216/flags/sold WMS unchanged from PR441. Source parity false. User-authorized FBO-only directions applied to FFL_LKB2409 (with ten corrected memberships) and current FFL_LKB2709; no physical stock movements, nine archived boxes preserved. Old active FBS order access retained.

API `sha256:c44796f1b9a7ce9ecbfba629c868e8195aa73da91f2e547f43b2e32a034db6a7`; web `sha256:fe8830d5764458a7e35cf722ec99f5d443fb98429805f7c9202cdf255a443abb`. Baseline `2026-09-30-receipt-channel-event`.

# Published PR441 / 30.09.2026

Receipt directions and FBO/FBS reservation protection. API `sha256:f21ecba233d3e5f6cf01de4594f906786e1456bf9bd0c8b4450852cfd7afa252`; web `sha256:fe8830d5764458a7e35cf722ec99f5d443fb98429805f7c9202cdf255a443abb`. Baseline `2026-09-30-receipt-channels`. API3007/83 skipped, web355/2 skipped, exact runtime8 and browser checks passed. Flag WMS_RECEIPT_CHANNELS_ENABLED=true only on our WMS. APK216 and sold WMS unchanged; source parity false. Business policies have not yet been applied at this snapshot.

# Published PR439 / 30.09.2026

PR439: la_panthera minimize control aligned in the existing action toolbar. Separate retained instances allow multiple independent request windows from one workspace. Browser tests reproduce old misalignment and verify separate drafts, restore/close and theme isolation. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, actual runtime and published section smoke passed. API/APK/flags/sold WMS unchanged; source parity false. Rollback logoff-web:before-panthera-multi.

Web `sha256:607e51b40f86b03b08f2e1e2e003744e264426a3757258b2fdf3ed98d5b54e3e`; API `sha256:d976a490b412d33585d24a0eddb6392ea7304e5b50c2ae9699ffadd3f72327dc`.
Baseline `2026-09-30-panthera-multi`.

# Published PR437 / 30.09.2026

PR437: opt-in la_panthera operational windows retain the current page, minimize to one right-edge dock and preserve forms across navigation. WB tiles2-15 are square, tile1 spans two rows with clients; narrow screens reflow. Web355/API2939 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, before/after browser regression, actual runtime and published Requests/FBS/FBO smoke passed. API/APK/flags/sold WMS unchanged. Concurrent Soul card CSS retained. Source parity false. Rollback logoff-web:before-panthera-windows.

Web `sha256:05edd360afae5837ff5d586093cd054b790e6b4097a5533be2f9ebc885011954`; API `sha256:d976a490b412d33585d24a0eddb6392ea7304e5b50c2ae9699ffadd3f72327dc`.
Baseline `2026-09-30-panthera-windows`.

# Published PR435 / 30.09.2026

PR435: saved seller warehouse identity in FBS fallback display. Two fields in one API module. API2939/115 skipped, four runtime tests, TypeScript, baseline8 and live45-order read-only proof passed. Health/hashes/flags verified; web/APK/sold WMS unchanged. Source parity false. Rollback logoff-api:before-fbs-saved-names.

Baseline: 2026-09-30-fbs-saved-names.

# Published PR433 / 30.09.2026

Fast active FBS display skips historical loading; historical shipment identity restored from durable columns. API-only exact delta. API2939 passed/115 skipped, three runtime regressions, TypeScript and live read-only checks passed. Published health/hashes/flags verified; web/APK/sold WMS unchanged; sourceParityVerified=false. Rollback logoff-api:before-fbs-active-fast.

Baseline: 2026-09-30-fbs-active-bootstrap.

# Published PR431 / 30.09.2026

PR431: RELEASED historical KIZ bindings may be archived by authenticated physical review only with proven post-shipment return, closed historical request and shipment history. Active bindings and missing proof remain blocked. API-only one-module delta; web/APK/flags/sold WMS unchanged. API2933 passed/115 skipped, 12 runtime tests, TypeScript and live read-only return proof passed; dedicated KIZ database suite excluded. sourceParityVerified=false. Rollback logoff-api:before-kiz-released-review.

API sha256:a27867a356fdfd534bd9a7c6e9fa70eacbecb7d4dcf2324f6c54a801861070d7; web sha256:3687e663dd006cd194de3f8a25c1d9ad56f7033481368250298086a37f32bfb0.
Baseline: 2026-09-30-kiz-released-review (API).

# Published PR424 / 29.09.2026

PR424: compact attendance editor in opt-in la_panthera. Max width720, content height, two-column fields and inline actions; narrow-screen stacking. Save/delete/time calculation unchanged. Web351 passed/2 skipped, TypeScript, source and actual runtime browser checks passed. API PR422, APK216, flags and sold WMS unchanged. Exact hashes/health verified; source parity false. Rollback logoff-web:before-payroll-compact.

Web `sha256:0b41f6ce4ae558cee000289e724e41acfb3cb48f436fd9f94d3a43213fe8ecf0`; API `sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a`.
Baseline `2026-09-29-payroll-compact`.

## Previous release

# Published PR422 / 29.09.2026

PR422: request-scoped FBO remainder route. Setting activated only for request 1550; preferred receipt FFL_LKB2409. Whole reconciled boxes first, largest useful partial balances next; current unpicked demand and local pallet context retained. Application under request row lock: 1019 picked units preserved; remaining814, route144->134 boxes, whole75/606units->77/624units, no shortage. Two API modules only; web, APK216, flags and sold WMS unchanged. API2933 passed/115 skipped; dedicated KIZ DB suite excluded. TypeScript and read-only actual runtime comparison passed. Exact hashes/health verified; source parity false. Rollback logoff-api:before-fbo1550-remainder-route (preference becomes dormant on old runtime).

API `sha256:ff9265aa3b693bba2038053967ba690dcac36d325ec621eb7265a746e3fd348a`; web `sha256:bab947a845a51d3a02eef205658b2114474e9eef11bd725b754c58d0c533a438`.
Baseline `2026-09-29-fbo1550-route`.

## Previous release

# Published PR420 / 29.09.2026

PR420: equal-height FBS navigation headers and aligned counters, with client list in a separate row. Shared marketplace UI across themes. CSS-only delta; all JS, API PR412, APK216, flags and sold WMS unchanged. Web351/2 skipped; 72 browser theme/viewport/client-list cases passed. Exact hashes/health verified; source parity false. Rollback logoff-web:before-fbs-equal-tiles.

Web `sha256:bab947a845a51d3a02eef205658b2114474e9eef11bd725b754c58d0c533a438`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-fbs-equal-tiles`.

## Previous release

# Published PR418 / 29.09.2026

PR418: four equal request menu rows, 56px high and full width, with centered labels/icons and identical theme-aware backgrounds. Native Documents/More disclosures retained. CSS-only delta; all JS, API PR412, APK216, flags and sold WMS unchanged. Web351/2 skipped; source and actual runtime checks across 11 themes plus Light, FBO/FBS, geometry, colours, centering, keyboard/callbacks passed. Exact hashes/health verified; source parity false. Rollback logoff-web:before-request-menu-four-rows.

Web `sha256:124f6f71375505e845600ce174efc7fb4aefb7c66474133513bb78bfb7f4a958`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-four-rows`.

## Previous release

# Published PR416 / 29.09.2026

PR416: approved request and online menus. Online replaces Route; downloads grouped in Documents; obsolete manual/emergency/source-selection actions removed. Edit/cancel moved inside Online with original permission/status predicates and confirmation. Long names and narrow action labels wrap fully. Web351 passed/2 skipped, TypeScript, source and actual runtime browser across 11 themes plus Light; 8 list callbacks and online toolbar actions verified. API PR412/APK216/flags/schema/sold WMS unchanged. Exact image/public hashes and health verified. Source parity false. Rollback logoff-web:before-request-title-wrap.

Web `sha256:83443774025472e37c58d4ef7249bf7219088a84117f49d95b8310c7b3bbb227`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-wrap`.

## Previous release

# Published PR414 / 29.09.2026

PR414: compact FBO/FBS request actions with Documents and More disclosures; unique route, explicit edit/cancel, manual stages and administrator recovery. Existing callbacks retained. Web347/API2929 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript and actual runtime browser checks across 11 themes plus Light passed, including 13 callbacks, keyboard and permissions. API PR412/APK216/flags/schema/sold WMS unchanged. Full hashes/health verified; source parity false. Rollback logoff-web:before-request-action-menus.

Web `sha256:fe944ebb4ba1486f1284e91a6dfae3f2aa529ece11e69943299bd413ef217a4e`; API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.
Baseline `2026-09-29-request-action-menus`.

## Previous release

# Published PR412 / 29.09.2026

PR412: explicit administrator/owner KIZ reuse with a later audited physical sorting return when historical WB status is unavailable. Two API modules only. WMS_KIZ_PHYSICAL_REVIEW_ENABLED=true only on our WMS. Runtime tests33, API2929/web343 passed;115/2 skipped; isolated PostgreSQL suite excluded. API TypeScript passed. Live physical proof verified read-only. Exact runtime hashes, health, flags and unchanged web/APK/other containers verified. No business records changed. Source parity false. Rollback logoff-api:before-kiz-physical-review.

Baseline: `2026-09-29-kiz-physical-review`. API `sha256:78c06803de1b44099824175217cceb2e6899066de9e485cc6954971b49691957`.

# Published PR410 / 29.09.2026

PR410: la_panthera now offers an independent Dark/Light style selector next to the theme. Dark remains default; style persists per browser/user, isolated from other themes and accounts. Light uses pale teal/white surfaces, dark text and pastel accents; request zones and original panther remain visible. Web343/API2929 passed, 2/115 skipped; dedicated KIZ DB suite excluded. TypeScript, 30-view contrast >=4.5:1, print exclusion, actual App persistence/theme/user checks and request table browser checks passed. Main selector, CSS and versioned import paths only; API/APK216/flags/schema/sold WMS unchanged. Full hashes/health verified; source parity false. Rollback logoff-web:before-la-panthera-light.

Web `sha256:eb0e9d15040e6512d3363ec3d87f99c2c280c9d47f709be4886cb244332880bb`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-la-panthera-light`.

## Previous release

# Published PR408 / 29.09.2026

PR408: compact request table in all 11 themes. Two identity columns, client above composition, due date above status, actions above process. Existing actions and permissions retained. Web340 passed/2 skipped, API2929 passed/115 skipped (DB-dependent cases skipped, dedicated KIZ DB suite excluded), TypeScript and 11-theme actual-runtime mobile/desktop checks passed. Only request markup, CSS and versioned import paths changed. API, APK216, flags, schema and sold WMS unchanged. Full image/public hashes and health verified; source parity false. Rollback logoff-web:before-compact-request-columns.

Web `sha256:4d3bb184e13764d8bfbced614cb042986b24c4da16b1174e37889afc43c6f771`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-compact-request-columns`.

## Previous release

# Published PR406 / 29.09.2026

PR406: ordinary WB unmarked non-SOS picking shows found/packed, then atomically ships stock and closes the complete request. Our-WMS flag only. Reviews collapsed individually over seven days. Mark-all-read uses existing scoped endpoints and full history pagination. Gold bell/count and monitoring top row in la_panthera. API2929/web339 passed, 91/2 skipped; isolated PostgreSQL24 plus packaged runtime24 passed; dedicated KIZ duplicate DB suite excluded. TypeScript, actual runtime browser, all hashes and health verified. APK216, schema, sold WMS unchanged; source parity false. Rollback logoff-api:before-ordinary-pick-reviews and logoff-web:before-ordinary-pick-reviews.

Web `sha256:299f32d7fb3eb66ab08bc4bb22bb870226cf3d9250e628ba03090ad658ea7034`; API `sha256:aba843bb78a45c4a1f06a25315f53210b8eaad6992d44f1bc02dfff97a8208e5`.
Baseline `2026-09-29-ordinary-pick-reviews`.

## Previous release

# Published PR404 / 29.09.2026

PR404: compact FBS selection controls along the top and action buttons below; matching green/amber/red request palette for zone buttons and elapsed timers. CSS-only, two files changed, all JavaScript/API unchanged. Desktop/narrow layout and actual runtime CSS browser tests passed, including other themes and print isolation. Web334/API2895 passed; 2/113 skipped, dedicated KIZ DB suite excluded. Full hashes and health verified; APK216, flags, schema, sold WMS unchanged. Source parity false. Rollback logoff-web:before-fbs-zone-colors.

Web `sha256:95ef7bb7954cf2ff21060cfcd25f408b455158f41b97109ee09cc9b78086fa71`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-fbs-zone-colors`.

## Previous release

# Published PR402 / 29.09.2026

PR402: graphite reconciliation surface, readable teal heading and subtle border in la_panthera. Personal shortcuts no longer expand their original navigation group; edit mode supports drag reorder in both directions and keyboard arrows, persisted per user in browser storage. Original groups and authorization remain intact. Web334/API2895 passed, 2/113 skipped, dedicated KIZ DB suite excluded. Browser source/runtime regressions and TypeScript passed. Full hashes and health verified; API277d5, APK216, flags, schema, sold WMS unchanged. Source parity false. Rollback logoff-web:before-reconciliation-nav.

Web `sha256:e17e49f27e77dce52f86e18386cf8fc29d9bd3e1102e181ad059c00d036f1fc9`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-reconciliation-navigation`.

## Previous release

# Published PR400 / 29.09.2026

PR400: complete creation form collapse with draft retention, exact status filters and stage sort labels in every theme. Safe batch DONE recognizes no-box sentinels and selects only a sole sufficient source; server strict stock guard rejects shortages and incomplete assembly without adjustments. Request majority colors include shipped orders until WMS terminal; individual timers use actual order age. Softer route/FBS buttons in la_panthera. Based on PR398 runtime, preserving OWNER sorting access. Web334/API2895 passed, 2/113 skipped, dedicated KIZ DB suite excluded. Browser tests and packaged API fixture passed; complete runtime/public hashes and health verified. APK216, schema, flags, sold WMS unchanged. Source parity remains false. Rollback logoff-web:before-request-polish and logoff-api:before-request-polish.

Web `sha256:6fb21ea4193cd208c1a989ea81b41b87a1cba9ea928394738611091360c171c0`; API `sha256:277d5a2c9c5dc21acb28df6d4197688cdb81c4bbf3ca8db4290a5340d855986b`.
Baseline `2026-09-29-request-polish`.

## Previous release

# Published PR398 / 29.09.2026 — OWNER sorting access

OWNER now sees and can open «Сортировка и перемещение», matching the existing server authority. Both OWNER and OWNER+ADMIN expose the same37 sections. Two web authorization checks and explanatory message changed; versioned29-module import graph retains current requests/themes. Web `sha256:aeda927dca4331f4978a15c96a4cbdc9fd0dd5142042d66d1fececfffb557218`. API/APK216, flags, data and sold WMS unchanged.

Validation: OWNER menu and screen failures reproduced before fix; web331 passed/2 skipped, API2917 passed/113 skipped; isolated KIZ integration suite unavailable. Web TypeScript, actual runtime menu/screen/role/demo checks, exact delta, public artifact hashes and health passed. Baseline `2026-09-29-owner-sorting`; source parity false. Rollback `logoff-web:before-owner-menu-20260929`.

## Previous release

# Published PR396 / 29.09.2026

PR396: request status sorting, collapsed Excel assembly, sequential bulk DONE with per-request results and strict no-source-only noBox. Cancelled and rejected requests are archived in all themes. Russian WB status badge. la_panthera: graphite/cyan navigation, independent collapsible groups, user-scoped browser favorites, toned request identities, original panther during fetch/body loading, dark panels and muted gradients. Runtime based on Soul Winx PR395 and API a83204; two web behavioral modules plus import graph/CSS, one API module with two archive predicates. Full hashes and public health verified; APK216, flags, schema and sold WMS unchanged. Web328/API2893 passed; 2/113 skipped and dedicated KIZ DB suite excluded. TypeScript and browser/runtime tests passed. Source parity remains false; full source rebuild must not replace production. Rollbacks: logoff-web:before-request-batch-theme and logoff-api:before-request-batch-theme.

Web `sha256:2262deb8564c040b6186b4c4016e738fd4cf7f56a1796d547a6b9ebc6fee7248`; API `sha256:7334f195b90d4d8e4f4915993974511c8ce49b3198f6a46569b0edabd799b2db`.
Baseline `2026-09-29-request-batch-theme`.

## Previous release

# Published PR385: la_panthera / 28.09.2026

PR385: la_panthera web contrast correction across 27 representative component states, larger dashboard/FBS labels, saturated icons and dark gradients. Original diploma GIF loader with reduced-motion still frame; readable graphite supply group headings, buttons and warehouse badges. Parallel spirit Cambria release (previous web 9636e1f3), API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-panther-loader.

Web `sha256:d6670224e2817dbcd893912ac1ae5ed773a10771b58c3dcec3278a026d2aae48`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-panther-loader`.

## Previous release

# Published PR381: la_panthera / 28.09.2026

PR381: la_panthera web contrast correction across 26 representative component states and 47 module stylesheet audit, larger dashboard/FBS labels, saturated icons and dark gradients. Red gradient navigation hover with reduced-motion support; compact dark payroll editor. Parallel spirit PR378/380 (previous web da2baf1a), API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-la-panthera-complete.

Web `sha256:97781c96c22ef56db57f31f301477b164cde4b525da76e8d5025e5cb19da16dc`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-la-panthera-complete`.

## Previous release

# Published PR377: la_panthera / 28.09.2026

PR377: la_panthera web contrast correction across 17 representative screens, larger dashboard/FBS labels, saturated icons and dark gradients. API PR375, APK216, settings and other containers preserved. 281 web and 2891 API tests passed, 113 skipped; dedicated KIZ DB suite excluded. Browser contrast/isolation/print and runtime graph/font checks passed. Source parity false; runtime CSS overlay only. Rollback logoff-web:before-la-panthera-contrast.

Web `sha256:e0c20c3932d110e206e3e7c85748f2dcca61193029e542d6657ad1765258f20d`; API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`.
Baseline `2026-09-28-la-panthera-contrast`.

## Previous release

# Published PR375: archive empty FBO boxes / 28.09.2026

API `sha256:a83204a8bb4819193a11ba7ba8a3b462c960ef772fc9d659c88a122dfd531f62`. Two-module overlay on PR372; web/APK216, configuration, other containers and previous flags preserved. `WMS_FBO_EMPTY_BOX_ARCHIVE_ENABLED=true` only for our WMS. After individual FBO picking and shipment history capture, genuinely empty active boxes are archived and detached from pallet-sort in the same transaction. Permanent boxes, nonzero balances, marks and active bindings remain protected. Default/sold behavior unchanged.

Validation: API2915 passed,113 skipped; separate KIZ integration suite unavailable. TypeScript passed. Eight regression/guard tests. Actual candidate processed12 PALET_SORT_141 boxes with idempotence, then rolled back; original12 active boxes and placements verified. After publication, these exact12 boxes were archived in a Serializable transaction with fresh scope/stock/mark/task checks and audit records. No stock/KIZ/history mutation. Before-state backup `/opt/logoff-wms-releases/dovoz-relabel-20260917/pallet141-before-archive.json`. Post-commit12 archived and0 placements verified. Runtime hashes/health verified.

Baseline `2026-09-28-fbo-empty-boxes` is API-only with web hash metadata; retain current web independently. Source parity remains false. Rollback image d5038358 / `logoff-api:before-fbo-empty-box-archive`; rolling back code does not undo audited box archival.

## Previous release

# Published PR374: la_panthera / 28.09.2026

PR374: opt-in la_panthera web theme with self-hosted Inter (SIL OFL), graphite panels and violet accents. Existing section layout retained. Android, printing, Excel, API image and other containers unchanged. Full web274 tests, TypeScript and actual runtime graph/browser/font loading passed. Public index, entry, CSS, WOFF2 and license hashes verified. Source parity false; source-reference remains historical. API runtime captured from verified PR372 snapshot. Rollback: logoff-web:before-la-panthera.

Web `sha256:5cee65f8c9b91255ee1beb174ef3c232942dfa51559d22c8e457181da47ca570`; API `sha256:d503835845d4684bb5388552dc9304aa4cfd61e71b40bb3f1b393247bc8a9b2c`.
Baseline `2026-09-28-la-panthera`.

## Previous release

# Published PR372: bounded FBS assignment retries / 28.09.2026

API `sha256:d503835845d4684bb5388552dc9304aa4cfd61e71b40bb3f1b393247bc8a9b2c`. One-method overlay on live OpenClaw image51484e2; all other runtime files preserved. `WMS_FBS_ASSIGNMENT_BUSY_GUARD_ENABLED=true` only for our WMS. Busy employee/device requests return Conflict without releasing the active lock or accumulating retries. The original operation is not forcibly cancelled; its historical hang remains unproven. API restart during publication cleared in-memory pending requests.

Validation: 2907 API tests passed, 113 skipped; dedicated KIZ database suite excluded. TypeScript and actual candidate enabled/disabled, exclusion and recovery tests passed. After publication the device-context request for Marifat returned the correct closed-request response for1508 in107ms. Physical open-request picking remains to be confirmed on TSD. No stock or KIZ changes; web, APK216, configuration and other containers unchanged. Sold WMS untouched. Rollback image51484e2 / tag `logoff-api:before-marifat-assignment-wait`.

Baseline `2026-09-28-fbs-assignment-wait` captures API runtime and records web hashes without a web archive; retain current web independently. Source parity remains false.

## Previous release

# OpenClaw опубликован 28.09.2026

Наша WMS: [PR355](https://github.com/Maxhead2011/wmsFF/pull/355),
[PR363](https://github.com/Maxhead2011/wmsFF/pull/363),
[PR366](https://github.com/Maxhead2011/wmsFF/pull/366), база `feature/wb-print-check`.
API image `sha256:51484e2ea51ba0ea5594fd0dcd741cfdd2363681fbe7f33333191ae8c93c09b8`.
Web нашего выпуска `sha256:cdaa134f2f0806b28310ae7ec872f7104840967042cfbbb2218beb7b3d36c019`;
последующее оформление уже дало web `sha256:912149dad82a9c0683326f4a66a797b077b65a6fd9e34b9ab3f33f0743ec43cf`.
В последнем web сохранены entry `openclaw-20260928-0.js`, новый помощник и его маршруты.
Перед следующим выпуском заново считать фактические image ID.

OpenClaw 2026.9.6, Node 24.19.0, модель `openai/gpt-5.6-sol`, ChatGPT/Codex OAuth.
Сервис `wms-openclaw` включён при загрузке. API получает приватную конфигурацию из
`/etc/wms-openclaw/wms-api.env`; доступ разрешён действующим владельцам и администраторам.
Прокси применяется только к OpenClaw. Firewall разрешает 18789/tcp только через мост
нашей сети `infra_default` из 172.18.0.0/16 к 172.18.0.1. Публичного слушателя нет.

Проверено через работающий API: задание `d8293e10-adb1-466f-95ec-4a700c4f4c85`
завершено `DONE`, команда выполнена один раз, повтор requestId вернул тот же ответ.
Клиенту отказано 403, прежнему чату — 409. Временные проверочные сессии закрыты.
Первое сетевое задание осталось UNKNOWN без повторения; файл им не создан.

Снимок API содержит 554 файла. `sourceParityVerified=false`: полная пересборка
не разрешена. Проверенный локальный снимок:
`C:/WMSFF2207/baselines/openclaw-published-20260928`.
Серверный снимок и отчёты:
`/opt/logoff-wms-releases/openclaw-wms-20260928/published-baseline`,
`published.json`, `end-to-end.json`. Для следующего кандидата применять
`release_baseline.py --baseline <этот снимок>` и сверять свежий image ID.
Предыдущие снимки ниже являются историей.

Тесты актуальной интеграционной базы: API 2905 passed / 113 skipped, web 280 passed, 6 Node и 11 Python проверок,
TypeScript web и изолированный серверный кандидат. KIZ integration suite требует
выделенную тестовую БД и не запускался на production. Резервные образы:
`logoff-api:before-openclaw-20260928`, `logoff-web:before-openclaw-20260928`.
Поздний откат не должен затирать последующие выпуски интерфейса.

# Published PR364: cabinet loading / 28.09.2026

API `sha256:2c5e58b7d57ac148e1bb8e6068c305b52679210eba74a68f8d2401da8a6a5ea2`; web `sha256:ebd933aef735ee17d2721121a939c715797c14c7e958fbdd7f1abff9f9cc358c`.

Published PR364: cabinet-only compact stock projection and issued/paid invoice list without unused charge metadata. Product display settings expanded above branch tiles and all-client overview; loading/errors visible. Same database snapshot confirms identical balance quantities and visible invoice totals/payments/items. Stock payload 74.7MB to7MB, invoice50.9MB to1.4MB; server6.5s to4.1s and6.7s to0.33s respectively. API2872/web271 passed;113 API tests skipped. Four runtime API modules only; latest Spirit CSS, other assets, flags, APK216 and other containers preserved. Sold WMS untouched. Source parity false.

Baseline `2026-09-28-cabinet-fast`.

## Previous release

# Published PR358: client product display / 28.09.2026

API `sha256:09a4f4cc84a4ad1bb08279f8c2c236ab679accf7f1a50131c8e990647cd10cfb`; web `sha256:d204e622e626f793f63d733fa9efea41e701f3f77d2e10a506f8c8a138c83d59`.

Published PR358: per-client selection of name, article, barcode, size and color in assembly/packing WMS and Android TSD. Default behavior retained until explicitly configured. WMS_CLIENT_PRODUCT_DISPLAY_ENABLED=true only on our WMS. SystemSetting storage, no migration or preference writes during release. Raw scanner fields, cached plans, print labels and Excel unchanged. API2868/web266/Android220 passed; API113 skipped. Runtime and browser graph checks passed; APK216 signature matches215 and DEX checks passed. Public assets/APK, exact API/web hashes, settings read and unauthenticated HTTP401 verified. Sold WMS and other containers untouched. Source parity remains false; source reference historical. Physical TSD interaction pending.

Baseline `2026-09-28-client-display`.

## Previous release

# Published PR356: weekly inventory review / 28.09.2026

API `sha256:882d31805242c776406f5f9fb8ed7e6887a33b07be9343c9abe14457dcc89c6c`; web `sha256:0c52bd5273ae6e32eaeefe356bcb71e6440e3e266e3b50a4f21815ef01b6eba2`.

Published PR356: inventory default reads bounded to seven days under the existing our-WMS physical-resolution flag; exact-ID historical access and global full-inventory movement lock retained. Both live admin reconciliation and legacy FBS queries are bounded. Audit error details identify SKU/counts and conflicting physical KIZ identities. Quick lookup hides zero-balance locations. API delta is two files against payroll352; web delta preserves the newer Spirit warm build e764be7 and consistently renames its shared module graph to avoid a second React runtime. All other runtime hashes, old web assets, APK215, flags, config and other containers unchanged. No operational data writes or new migration. API2884/web265 tests and TypeScript passed; 113 skipped, dedicated KIZ integration DB unavailable. Eight runtime flag combinations and nine browser notification/navigation scenarios passed. Published read-only dashboard plus detail checks took 798ms. Source parity remains false; source reference is historical, not a complete build source.

Baseline `2026-09-28-inventory-weekly`.

## Previous release

# Published PR352: payroll corrections / 28.09.2026

API `sha256:edaec90e3b3b9e777c0dc9d4f3083a4ad9fe60036a454c6e0022f016b629797b`; web `sha256:c958929305d4139a6f884cd2f6742a598c2cb307701d36a613aef01505e7a04e`. Shift time/lunch editing, audited cancellation, initial employee rates. Additive migration and generated Prisma Client deployed. Spirit PR350/351, KIZ PR348, FBS, flags and APK215 preserved. Exact runtime/public asset hashes and health verified. Candidate migration/CRUD checked in isolated database. API2899 passed/94 skipped, dedicated KIZ database suite excluded; web260 passed. Dark physical camera capture remains unresolved; APK unchanged.

Baseline `2026-09-28-payroll352`; source parity false. Live Prisma schema captured separately. Old API ignores cancelled shifts: rollback after user cancellations requires reconciliation.

## Previous release

# Published PR348: sorting KIZ review / 28.09.2026

PR348 опубликован 28.09.2026. API `sha256:9a3ec430469e30afeb1620b1a75852815976eba477325d5c06fcb9778313a9a9`. Только два модуля КИЗов; WMS_KIZ_SORTING_ADMIN_REUSE_ENABLED=true. Web, APK, остальные контейнеры и настройки сохранены. 30 runtime-тестов passed, точные хеши и health проверены. Read-only проверка рабочего API подтверждает поступление КИЗа заявки1494 через сортировку после прежней отгрузки. Разрешение администратора и физический повторный скан ещё не выполнялись. Source parity всей системы остаётся false.

Baseline `2026-09-28-kiz-sorting`.

## Previous release

# Published PR346: handling review / 27.09.2026

API `sha256:12fa527baadc9a49bee0422932e49311dd96f2a8ddc32cbc4a34f0a18af92f38`; web `sha256:a0d4dec5f81901fee35ffa90533051b2610fd5c6a53e39deed1062b4e439df86`. One-off operation tariff, correction/cancellation of REVIEW handling and employee activity filter. No migration; previous flags and APK215 unchanged. PR345 waves retained. Verified exact runtime hashes, public web assets, health and candidate transaction rollback. Tests: API2894 passed/94 skipped (dedicated KIZ duplicate suite excluded), web255, Android72, TypeScript and Android lint. Attendance APK0.2.2 built; physical UI validation pending. Baseline `2026-09-27-handling346`; source parity remains false.

## Previous release

# Published PR343: tablet attendance / 27.09.2026

API `sha256:d67de6f69a8ebd5902a913be8662f67ab0e79b6c8d775dc9987bcf8ea13b8c90`; web `sha256:597d5e296a51dcbf0d353321461255d3c55e4b8de0225f2732afdbfaf955e71b`. FOT settings: device registration, photo requests and disputed marks. Additive Attendance migration; device flag enabled only on our WMS. API2885, web248, Android72 tests passed; 94 API tests skipped and dedicated KIZ DB suite excluded. Candidate registration/shift/photo-request/revocation verified with rollback on server DB; exact deployed hashes and HTTP assets verified. APK215 unchanged; attendance0.2.1 installed by user, camera pending physical verification. Baseline `2026-09-27-attendance343`; source parity remains false.

## Previous release

# Published PR341 (27.09.2026): own ADMIN/OWNER ACCEPT_AS_IS now permits FBS continuation when the privileged picker personally accepted unchanged system stock. API `sha256:dbc95e8faadbb7188e4637a41ef95b55d336977ea1e7f02367f33f455570afc0`; baseline `2026-09-27-admin-accept-audit`. Existing our-WMS flag only; two runtime modules (validator and authenticated-role call-site). Saved BOX294 acceptance passed read-only on candidate and production; WORKER rejected. API2870, web247, TypeScript passed; 97 skipped, dedicated DB suite unavailable. Stock, KIZs, web, APK215 and other containers unchanged. Source parity false. Rollback `logoff-api:before-admin-accept`.

## Previous release

# Published PR339: completed FBO history / 27.09.2026

API `sha256:487a1cb0235e22d037643835be01f9e320243a9f97949d80b2a185afc06368f5`. Historical PACKED units of COMPLETED FBO no longer block an administrator recount; explicit active bindings remain protected. One runtime module changed; all flags, web and APK retained. API2860, web247, TypeScript passed; full current BOX_0222 confirmation with five KIZs verified on the published image and rolled back. No recount required for the saved 18:45 scans. No history/billing mutation. Baseline `2026-09-27-completed-fbo-history`; source parity false. Rollback `logoff-api:before-completed-fbo`.

## Previous release

# Published PR337: administrator physical KIZ confirmation / 27.09.2026

API `sha256:8d84800a7dbc197451799055bb3b0659dd1dd1a0f57b94cbf3e7963c7f8fc921`. Opt-in `WMS_INVENTORY_PHYSICAL_RESOLUTION_ENABLED=true` only on our WMS. Two inventory modules changed; all other runtime files, existing flags, web and APK215 preserved. Confirmed old registration conflicts can be corrected without duplicate destination stock; current assembly and newer-movement guards remain. API2859, web247, TypeScript and two real-data rollback checks passed. Baseline `2026-09-27-admin-physical-kiz`; 544 API files and 413 web files verified. Source parity remains false. Rollback: `logoff-api:before-admin-physical-337`. No migration.

## Previous release

# Published PR334: payroll employee card / 26.09.2026

API unchanged: `sha256:91f592f9ea0420cecefd508b0c3bf64c9ffc1385d35070fe3d601a3832896cd6`. Web: `sha256:f71d461f6762387b3ef16471e0862daf0bda734e4ee76b530a86e9026007bd64`.
Independent settings selection; card opens in view mode with edit/save/cancel. Current rates and individual conditions shown independently of report dates. Web246 tests, TypeScript and actual overlay browser checks passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-card`. Source parity remains false. Rollback web: `logoff-web:before-payroll-card`. No API/database/APK changes.

## Previous release

# Published PR332: payroll editor, dates and sorting / 26.09.2026

API: `sha256:91f592f9ea0420cecefd508b0c3bf64c9ffc1385d35070fe3d601a3832896cd6`. Web: `sha256:693a0d1f72469302bd77233790260e31de44a9621a9411c19cdf335930342f57`.
Employee card/rate isolation, explicit save messages, all-staff sorting and dd.mm.yyyy in UI/exports. Web245, API2844 passed/97 skipped; KIZ integration suite excluded because its local DB is not configured. TypeScript/build and actual candidate browser/export checks passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-editor`. Source parity remains false. Rollback web: `logoff-web:before-payroll-editor`. Single API export delta; APK unchanged. Imported 17 September handling operations / 30750 RUB with payment REVIEW; historical hourly entries preserved.

## Previous release

# Published PR330: payroll payment summary / 26.09.2026

API unchanged: `sha256:a9684a191ca599ba7180c769fc5d33e9583af885ff794426c7d4765d9117cb7f`. Web: `sha256:e9dcce013f1ca121d7c05ca2a89e7a91175bda42c65c2b7e1d0bce96481065c4`.
Employee name, period amount and payment phone/bank shown together; paid/unpaid/review distinguished. Web244 tests, TypeScript and browser fixture passed. Exact live API/web/APK/flags verified. Baseline `2026-09-26-payroll-payment-summary`. Source parity remains false. Rollback web: `logoff-web:before-payroll-payment-summary`. No API/database/APK changes.

## Previous release

# Published PR328: FOT navigation and corrections / 26.09.2026

API `sha256:a9684a191ca599ba7180c769fc5d33e9583af885ff794426c7d4765d9117cb7f`.
Web `sha256:33e9a07f126cbccc9804ea1af0e270175d1c8d1829063df629233ad5940f6097`.
Standalone FOT submenu, back navigation, explicit manual entry, start/end columns and audited editing of historical/manual times. Paid records must be reviewed before correction. No migration or historical data changes. Verified 31 cards, 1263 rows, total 354401550 kopecks; PDF/Excel and branch isolation passed. API2844 passed/97 skipped, web242, TypeScript and browser regression checks passed. APK215 unchanged.
Baseline `2026-09-26-payroll-navigation`; source parity remains false. Rollback: `logoff-api:before-payroll-navigation`, `logoff-web:before-payroll-navigation`.

## Previous release

# Published PR326: ФОТ / 26.09.2026

API `sha256:9228a39f63d7ea929418635d9b1564cacb560a18eae8b2b00d47def3720d7a53`.
Web `sha256:21fab23236192311d421c4ae8bf170a32caee99c6e9aa2ce58d4f004ba3bbc15`.
New workforce module enabled only on our WMS. Additive migration `20260926150000_payroll_attendance`. Imported 1263 historical rows into ФФ Москва, total 3,544,015.50 RUB; August row48 excluded, name aliases pending. All monthly totals reconciled. API2841 passed/97 skipped, Web240, TypeScript, browser and runtime/export/access checks passed. APK215 and other containers unchanged.
Baseline `2026-09-26-payroll`; source parity remains false. Rollback images: `logoff-api:before-payroll-attendance`, `logoff-web:before-payroll-attendance`. Rollback retains new payroll data/tables.

## Previous release

# Published PR323: turnover / 26.09.2026

API `sha256:1ce3f6acbfd09b562fcf48bd7a57cda6d6208c1f8f051e8baad8e5dbf413029f`.
Web `sha256:3695f20eab55822b447412a77adf06be31bec7ee229ed65b8daa0434d48358fd`.
Relabel/recount proof without duplicate deduction; no automatic full-history load and stale responses ignored. APK215, flags, database and other containers unchanged. API2815 passed/94 skipped, Web238, TypeScript passed; runtime delta and public hashes verified. Baseline `2026-09-26-relabel-close`; source parity remains false.
Rollback: `logoff-api:before-turnover-relabel`, `logoff-web:before-turnover-relabel`.

## Previous release

# Published PR321: turnover / 26.09.2026

API `sha256:16ed6b5fb0440b41b1093e6ae4748e486feffad7b9185e8c53b41cc45933a326`.
Web `sha256:d6cd84011bca7995d92eabd27785c16fd71d3549e6ca1e64e46fedba74f31b05`.
Boxless deduction, archived current-stock exclusion, independent stock/statistics loading. APK215, flags, database and other containers unchanged. API2806 passed/94 skipped, Web236, TypeScript passed; runtime delta and public hashes verified. Baseline `2026-09-26-turnover`; source parity remains false.
Rollback: `logoff-api:before-turnover-321`, `logoff-web:before-turnover-321`.

## Previous release

# Published PR319: direct FBS reserved box route

API `sha256:e86c2e3beee1fcee76e5833a45c9c572338be740156501d01470a1a0881d75a2`. Published 25.09.2026 23:33 MSK.
Only tsd-assembly.service.js changed; environment, web and APK215 unchanged.
Request 1368 / order 5864079913 verified against real instruction: 1 unit, FFL_LKB0909_356, PALET_SORT_140.
2801 API tests passed, 94 skipped; TypeScript and four candidate route tests passed.
Baseline `2026-09-25-direct-route`; sourceParityVerified=false. Rollback `logoff-api:before-fbs-direct-route-319`.

## Previous releases

# Current published release PR317: bounded FBS box scans

API `sha256:45d6c29e16eb49035603749f58ef0272fa3e414eea269a5ee3f0a7f9bbe4acf4`. Published 25.09.2026 22:25 MSK.
`WMS_FBS_BOX_SCAN_BOUNDED_ENABLED=true`; all other environment and containers unchanged. Web/APK215 retained. Baseline `2026-09-25-fbs-box-scan`; sourceParityVerified=false. Runtime hash set and health verified. Rollback: `logoff-api:before-fbs-box-scan-317`.

## Earlier releases

# Current published release PR315 / LOGOFF215

API `sha256:a72064a45a06563f59e1051dbf1feddec037683685fb9f73dc061c3f3c58d00f`.
Web `sha256:a70b61112fc7c03ba29eacb86ccc249c6ec7dfb16b34fca3dd8e5c432c05d756` (public site preserved, APK downloads only).
APK215 SHA256 `405e13998427f8dd2b24f03d7cb89d99997a3eba9410486fe21f4a6cd11e38fd`.
Baseline: `2026-09-25-ozon-lines`. Migration applied; `WMS_OZON_MULTILINE_PICKING=true` only on our WMS. 46 runtime tests; public hashes and health verified. Terminal installation not verified. Source parity remains false.

## Historical releases

# Current published release PR313: light public website / APK214 unchanged

Web image: `sha256:41c8224ac636afde20e72e3123d640093ada1e447e3af43d1f9f74000709cde3`.
API remains `sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6`.
Only the external MarketingLanding component changed. All pre-existing public
assets/downloads retained; operational JS unchanged except consistent versioned ESM URLs.
Public page, mobile menu and login entry verified. 234 web tests, TypeScript,
7 release guard tests passed. API container and APK unchanged.
Web overlay: `baselines/our-wms/2026-09-25-public-site-light`; combine with the
PR311 web baseline, never replace current web with the earlier archive alone.
API baseline remains `2026-09-25-fbs-display`; sourceParityVerified remains false.
Rollback image: `logoff-web:before-public-light-20260925`.

## Previous published release PR311 / APK214

API sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6
Web sha256:475778f6b2d1fd9b51378d9c0db682d2f0f8345acfb69c64451cc4beedb4c18f
APK214 de67aee47f3f419e8e89e4a4a13974f945f988d9bd58bb51a4fd6e7261e771aa

Historical release notes below. Current baseline: 2026-09-25-fbs-display.

# Current release: PR309, 25.09.2026

[PR309](https://github.com/Maxhead2011/wmsFF/pull/309), merge adb8d2ca. Bounded 30-second inventory confirmation. Six runtime tests; API 2761 passed / 94 skipped. All previous KIZ and printing changes retained.

# Опубликованная база нашей WMS

Обновлено **25.09.2026 после PR307**. Интеграционная ветка `feature/wb-print-check`.
[PR307](https://github.com/Maxhead2011/wmsFF/pull/307), merge `3c20d0e5`.
Это привязка точечного выпуска, а не заявление о полном совпадении исходников с runtime.

| Компонент | Фактическая версия |
| --- | --- |
| API image | `sha256:edaed8c4b41b55a5cda87a4590dc0b32d5a6f2e667ed0627e22e0f3137426444` |
| Web image | `sha256:5bdcb162e03f2539795b379bcdc6644888e07fc7dcdbfc9456ed93c254a5193d` |
| Android LOGOFF | `213 / 0.1.213-relabel-external-print` |
| APK SHA-256 | `2537deeaa0079d3cf121132e1d42efff32c7e5e636f1e40509e144ee8ff8a295` |

PR307 меняет только три модуля КИЗов: отменённая принятая поставка допускает решение администратора при неизвестном погашении. Продажа и погашение блокируются. Проверки: 18 runtime, API 2763 passed / 92 skipped; DB-интеграция исключена. Остальные файлы после PR305 сохранены по хешам.

Текущий [снимок](../baselines/our-wms/2026-09-25-fbs-display/README.md) сохраняет
последний выпуск с маршрутом WMS к исходному коробу и восстановленной печатью.
В промежуточном API `be2a182a...` снова потерялись функции PR302 и маршруты/DI
переклейки. PR305 восстановил три файла, остальные 530 файлов API и весь web
оставлены без изменения. APK 213 не пересобирался. Старые снимки сохранены.

Проверки PR305: API 2761 passed / 94 skipped (kiz-duplicate.integration исключён
без тестовой БД), runtime 33, baseline guard 8. Health и wiring работающего
контейнера проверены, станция 2409 онлайн. Новая физическая печать после PR305
пока не подтверждена. [Описание](releases/relabel-regression-after-213/README.md).

PR302 восстановил потерянные вызовы контекста и очереди печати переклейки, а также
закреплённую пятёрку Лукина. APK 213 разрешает скан нового ШК без ACK станции.
ADMIN/OWNER видят все заявки. Текущая пятёрка не пополняется до полного завершения.

Проверки PR302: API 2754 passed / 94 skipped; DB-dependent kiz-duplicate.integration
не запускался без тестовой БД. Android LOGOFF 216, FFULLHAB 216; runtime 26;
baseline guard 8. Подпись APK совпадает с 212, health и публичные хеши проверены.
**Сборка 213 принята пользователем 25.09.2026:** «все заработало, проверили на трех
последовательно обновленных тсд». Это успешная отправная точка для следующих
изменений нашей WMS. Подтверждение относится к проверенному рабочему сценарию,
а не ко всем возможным функциям системы.
[Детали и состав исправления](releases/relabel-print-runtime-context/README.md).

## Что подтверждено

- Пользователь после PR300: «озон работает корректно».
- Реальный контейнер: capability нового ТСД проходит через 9 действий сборки.
- Проверка артефакта: ответ Ozon без вызова загрузчика наклейки, счётчик единиц,
  блокировка преждевременного завершения; сохранена последовательная сборка WB.
- Android: 215 тестов; API: 2750 прошли, 94 пропущены; web: 227 прошли;
  runtime: 12 проверок. Пропуски не считаются успехом. БД-интеграции требуют
  отдельной тестовой БД. Эти результаты относятся к PR300.
- Настройки `WMS_TSD_PHYSICAL_PICK_CONFIRMATION`, `WMS_OZON_TSD_UNIT_SCANS`,
  `WMS_FBS_SEQUENTIAL_PICK_ENABLED` включены. Полный список **булевых** WMS-флагов
  находится в манифесте; секретная конфигурация туда не включена.

## Что ещё не сведено

`sourceParityVerified=false`. Историческая сверка перед PR302 показала:

| Слой | Только на сервере | Только локально | Различаются | Совпадают |
| --- | ---: | ---: | ---: | ---: |
| Активные TypeScript-файлы API | 80 | 14 | 52 | 398 |
| API runtime относительно локальной сборки | 80 | 11 | 46 | 407 |

Контейнерные исходники также не равны исполняемому коду автоматически.
Веб/Android исходники не объявляются воспроизводимыми по одному номеру версии.
Схемы и миграции сохранены как файлы; состояние применения миграций в БД этим
снимком не подтверждается. Снимок не является резервной копией БД или Docker image.

Следующие изменения начинают с сохранённого runtime и явно проверяемого изменения
нужных файлов. Для перехода к полной сборке из TypeScript нужно отдельно переносить
и тестировать расхождения по модулям; массовая подмена текущих исходников серверной
папкой не выполнялась. Проверка состава выпуска ловит потерю файлов, но не заменяет
поведенческие тесты внутри намеренно изменяемого файла.

Проданная WMS не обследовалась и не обновлялась. У неё отдельная база и конфигурация.
# Published PR522 / 2026-10-09 — suspicious receipt barcode review

Baseline `2026-10-09-receipt-review`, sourceParityVerified=false. API `sha256:4c503cd55442b51467dc23038d0ff7568c9f921875ca478ecf9fa918b98a9b72`; web `sha256:fa6f4af3634f85e7156348573e166354e5286e589a4c78a43c9b4ddf43f40c10`. LOGOFF APK221, WMS_RECEIPT_BARCODE_REVIEW_ENABLED=true only on our WMS. Prior Ozon release, other flags and sold WMS retained. Four reported 0610 scans were atomically held for review after a successful rollback dry-run; no duplicate receipt created. [Release record](releases/receipt-barcode-20261009.json).

Validation: API3218/web411, Android239 per LOGOFF/FFULHAB, actual receipt runtime39, browser tests and public artifact hashes. API142/web2 skipped; dedicated unconfigured KIZ DB test excluded. Physical scanner test remains after installing APK221.
