Online request indicator: match the deployed online control and verify its green background, hidden activity icon, pulsing dot and reduced motion in the browser. Web tests 588 passed/2 skipped.

Request actions in a compact two-column grid with a reduced-motion-aware online indicator. Full-width open menus and wrapped status notes. Browser regression in scripts/releases/request-grid-20261101/browser.cjs.

Compact request places: ClientRequestsTable.packagesSummary shows the number of packages and sum of their item quantities. The existing Online action provides details. Web regression suite 588 passed/2 skipped; deployed-module fixtures 0/1/159 places. Own-WMS web-only release.

Published PR813 / 2026-10-31: [Cargo pickup invoices](cargo-pickup-invoices.md). Separate dated cargo invoice alongside independent PRR billing; delivery selection/cost, audited correction, transactional source links, concurrency and cancellation guards. API4280/web587 (156/2 skipped), focused18, TypeScript, isolated PostgreSQL8/full health, browser6/bootstrap5/public5 passed. Exact API5/web2; own-image flag enabled. Live routes/flag verified, no production cargo charges created. Schema/APK/sold unchanged. Baseline2026-10-31-cargo-pickup, sourceParityVerified=false.

Published PR811 / 2026-10-31: [Background FBO delivery](fbo-background-delivery.md). Browser-independent Ozon/WB confirmation with durable leases/backoff and locked idempotent shipment. API4262/web587 (156/2 skipped), TypeScript, baseline8/exact API4, isolated PostgreSQL9/full health. Own-WMS flag enabled; web/APK/schema/sold unchanged. Live Ozon2601/2602 and WB2494 DONE, one confirmation audit each, SHIP totals20/12/578 exactly. Baseline2026-10-31-fbo-background-delivery; sourceParityVerified=false.

Published PR809: client required KIZ at receipt/inventory, including new SKU; adjacent responsive switch; REJECT validation and unresolved review badge. API4233/web587, TypeScript, isolated PostgreSQL/runtime15/full health, browser6/bootstrap5/public5 and live3 passed. Exact API14/web3, flags/schema/APK249/sold unchanged. Lukin/Kubrin/Eletskaya enabled; 3 newly unmarked Eletskaya cards aligned after publication, audit retained, no quantity changes. Baseline sourceParityVerified=false. [Details](client-required-kiz.md).

Release candidate on PR807/808: required KIZ per client plus review REJECT validation/attention badge. Exact API14/web3 overlay; responsive adjacent display/KIZ settings, existing flags and single main entry retained. API4233/web587, both TypeScript checks, browser6/bootstrap5 and baseline8 passed. See client-required-kiz.md; sourceParityVerified=false.

Prepared, not deployed: [Client required KIZ](client-required-kiz.md). Client cabinet switch, server receipt/inventory enforcement, new-card marking and audit. Own-WMS flag plus explicit client setting; stock unchanged. Authorized settings and 97 card flags applied for Lukin/Kubrin/Eletskaya. See document for release boundary and tests.

Prepared, not published: [KIZ review rejection and attention badge](kiz-review-reject-counter.md). Scoped OPEN review count, REJECT DTO, successful-decision refresh; no stock mutations.

Published PR807 / 2026-10-31: [FBO completion reliability](fbo-completion-reliability.md). Batched exact box checks and selections, safe same-token recovery after connection failures, busy/check-result UI and stage diagnostics. API4217/web586 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health and browser6. Exact API3/web2; own-image WMS_FBO_COMPLETION_RELIABILITY_ENABLED=true. APK249/schema/business records/sold unchanged. Baseline2026-10-31-fbo-completion-reliability, sourceParityVerified=false.

Published PR805 / 2026-10-31: [FBO shipment prefix lookup](fbo-shipment-prefix.md). Request2565 KIZ read47.940s ->4.513s,1710 identities/evidence unchanged. API4206/web582 (151/2 skipped), TypeScript, baseline8, PostgreSQL10/full health;1710-unit/159-box synthetic finish16s and retry passed. Exact2 API overlay, own-image WMS_KIZ_SHIPMENT_PREFIX_ENABLED=true. Web/APK/schema/stock/sold unchanged. Baseline2026-10-31-fbo-shipment-prefix, sourceParityVerified=false.

Published PR800: Ozon FBO shop labels after client/branch scope; separate FBO picking/packing productivity by actor and Moscow day. API4198/web582/TypeScript, PostgreSQL11/full health, artifact browser6/bootstrap5/public5 and baseline8 passed. Exact API3/web3; own-image WMS_FBO_PICKER_STATISTICS_ENABLED=true, sold/schema/APK249 unchanged. Audited Ozon-only directory configured for CL-000016; shared stock and KIZ untouched, strict receipt flag off. Live2529/2530 Monlarti,2531 Braibo verified; WB shop bindings pending separate verification. Baseline sourceParityVerified=false. [Details](fbo-stores-productivity.md).

Подготовлено: [магазины ФБО Ozon и производительность ФБО](fbo-stores-productivity.md). Ozon labels after scope; отдельные picked/packed по исполнителю и дню. API4198/web582/PostgreSQL11/browser6/bootstrap5; own-WMS flag, общий склад сохранён.

Published PR802: [Ozon packed auto-completion](ozon-packed-auto-done.md). PACKED -> DONE after all postings are delivering/delivered, status/history only. Independent own-WMS flag enabled; WB rule preserved. API4194/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime passed. Exact two API modules; web/APK249/schema/stock/sold unchanged. Baseline `2026-10-30-ozon-packed-auto-done`, sourceParityVerified=false.

Published PR799: [WB packed auto-completion](wb-packed-auto-done.md). PACKED -> DONE after all linked WB orders are accepted, status/history only. Own-WMS flag enabled; stock/web/APK249/schema/sold unchanged. API4175/web579/TypeScript, PostgreSQL8/full health, candidate/public runtime and exact two-module verification passed. Baseline `2026-10-30-wb-packed-auto-done`, sourceParityVerified=false.

Published PR797: [FBO counted stock rebind](fbo-rebind-counted-stock.md). Existing counted quantity consumed without extra +1; duplicate/history guards retained. API4155/web579/TypeScript, runtime4/repair4/PostgreSQL9/full health. Exact2 API modules, other700/web/LOGOFF249/schema/flags/sold unchanged. Baseline `2026-10-30-fbo-rebind-stock`, sourceParityVerified=false. Box519 AVAILABLE0,9 units in2565 unchanged.

Published PR795 / 2026-10-30: [WB FBO supply tracking and dispatch](wb-fbo-supply-tracking.md). Scoped binding, six process options, manual vehicle loading, confirmed WB delivery through guarded stock shipment. API4155/web579/TypeScript, PostgreSQL12/full health, browser9/navigation9; own WMS only.

Published PR793 (feature PR787), LOGOFF249: client stores and shared SKU permissions, request/billing/TSD context. Single application entry; Ozon label control and sidebar counts retained. API4149/web578/Android933, TypeScript, runtime12, PostgreSQL15/full Nest health, browser8/sidebar9/bootstrap5 and public bootstrap5 passed. API156/web2 skipped; dedicated KIZ integration suite excluded without URL. WMS_CLIENT_STORES_ENABLED=true only in own API image; strict store receipts disabled. Production store bindings, stock, KIZs, schema and sold WMS unchanged. Source parity false. [Details](client-store-separation.md).

Published PR791 / 2026-10-30: [sidebar request counts](sidebar-request-counts.md), unfinished total (IN_WORK) beside Requests/FBS/FBO and favorites. Scoped WMS requests, full counts, loading/error distinct from zero. API4119/web571/TypeScript, PostgreSQL6/full health, candidate/public browser9 and import10, baseline8. Exact API3/web2; flags/schema/APK248/data/sold unchanged. Baseline `2026-10-30-sidebar-counts`, sourceParityVerified=false.

Published PR789 / 2026-10-30: [single application entry repair](ozon-single-web-entry.md). Exact index.html correction prevents duplicate React roots/blank screen; other3204 web files and API/APK248/schema/data/sold unchanged. Cold entry RED/GREEN6 and public6; API4116/web569/TypeScript, baseline8. Ozon control/history retained. Baseline `2026-10-30-single-web-entry`, sourceParityVerified=false.

Published PR786 / 2026-10-30: packing -> Ozon cargo export -> attach labels -> scan WMS carton/Ozon sticker pair -> finish. Download-click history retained. LOGOFF248; API4116/web569/Android924, PostgreSQL12, candidate/public browser6+10; API156/web2 skipped, dedicated unconfigured KIZ DB suite excluded. Own WMS only, WMS_OZON_LABEL_CONTROL_ENABLED=true; prior flags, PR784 index, schema and sold WMS retained. Baseline `2026-10-30-ozon-label-control`, sourceParityVerified=false. [Control](ozon-label-box-control.md), [download history](ozon-label-click-history.md).

Prepared, not deployed: [FBO batch KIZ shipment verification](fbo-kiz-shipment-batch.md). Same client-scoped decisions, transaction-local bounded reads under identity locks. API4108/web563, TypeScript, PostgreSQL9/full health, baseline8; request2494 read-only check15.7s, synthetic578/57 completion7.45s with both WB exports. Exact2 API modules; web/APK247/schema/sold unchanged.
Published PR784: additive `KizReviewCase_client_identity_idx`, valid/ready, live query uses index. API/web images, containers and duplicate guard unchanged. PostgreSQL RED/GREEN concurrency5/replay2, API4108/web563 passed (156/2 skipped). №2494 completed normally:578 units/57 boxes, both Excel totals verified; guard enabled. [Details](fbo-kiz-shipment-batch.md).

Published PR783 / 2026-10-30: final FBO KIZ reads batched under the existing client identity locks; all per-KIZ duplicate/history/admin/context/binding checks retained. API4108/web563/TypeScript, PostgreSQL9/full health and baseline8 passed; API156/web2 skipped, unconfigured dedicated KIZ suite excluded. Exact2 API modules; other690 files, web/APK247/schema/environment/sold unchanged. Baseline `2026-10-30-fbo-kiz-shipment`, sourceParityVerified=false. [Details](fbo-kiz-shipment-batch.md).


Published PR781 / 2026-10-30: LOGOFF247 permits whole remainder in partial FBO picking, preserving previously picked loose units and pending-operation mode. Android915/API4096/web563, PostgreSQL9/full health, baseline8, signed APK/audio/public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact3 download files; other3199 web files, API/schema/stock/sold unchanged. Baseline `2026-10-30-fbo-partial-whole`, sourceParityVerified=false. Terminal update required. [Details](fbo-partial-whole-remainder.md).


Published PR779 / 2026-10-30: local receipt KIZ reports before first upload, explicit unconfirmed-duplicate notice, durable LOGOFF246 receipt progress/document and scanner focus. API4095/web563/Android912, TypeScript, runtime9, isolated PostgreSQL9/full API health, browser5, APK signature/audio and public hashes passed; API156/web2 skipped, dedicated unconfigured KIZ suite excluded. Exact1 API/2web/3 APK download files; schema/configuration/stock/sold unchanged. Baseline `2026-10-30-receipt-progress`, sourceParityVerified=false. Terminal update required. [Details](receipt-local-kiz-progress.md).

Prepared PR775, not yet deployed: [FBO automatic progress](fbo-progress-status.md). PR776 baseline; API4090/web562, runtime12, PostgreSQL9/full health, browser11, baseline8 passed. Own-WMS flag only.
Published PR775 / 2026-10-30: FBO physical picking restores IN_WORK and exact completion advances to PACKING; WB/Ozon/Lamoda show packed-pending-control without granting shipment permissions. Own-image WMS_FBO_PROGRESS_STATUS_ENABLED=true. API4090/web562 (151/2 skipped), TypeScript, runtime12, disposable PostgreSQL9/full Nest health, candidate/public browser11 and baseline8 passed. Exact5 API/4web on PR776; schema/APK245/stock/sold unchanged. Request2494:578 picked,518 packed; stale SUBMITTED corrected to IN_WORK, packing retained, system audit, no stock movement. Baseline `2026-10-30-fbo-progress`, sourceParityVerified=false. [Details](fbo-progress-status.md).

Published PR776 / 2026-10-30: Ozon file/link imports show aggregated SKU stock and deficits, with full demand or confirmed WMS/Ozon correction. Customer-scoped permissions and file binding retained. API4072/web560 (151/2 skipped), TypeScript, source browser8, candidate/public browser10, runtime11 and baseline8 passed. Exact3 API/2web; schema/APK245/environment/sold unchanged. Baseline `2026-10-30-ozon-import-stock`, sourceParityVerified=false. [Details](ozon-import-stock-review.md).

Published PR773 / 2026-10-30: explicit ADMIN/OWNER found-unit confirmation, unknown FBO KIZ guard and BOX_CHECK review preservation. API4070/web557 passed (155/2 skipped; unconfigured dedicated KIZ DB suite excluded), TypeScript, runtime10, browser7, targeted26 and isolated full Nest/PostgreSQL health passed. Exact9 API/2 web files; schema, APK245, stock quantities, shipment history and sold WMS unchanged. WMS_INVENTORY_FOUND_UNIT_ENABLED=true only on our WMS; all prior environment values retained. Baseline `2026-10-30-found-unit`, sourceParityVerified=false. Public health/hashes verified. [Details](inventory-found-unit-review.md).

КИЗ FBS: повтор текущего отбора, сохранение OPEN-разбора и дата/заказ предыдущей отгрузки. [Описание и проверки](kiz-fbs-review-retry.md).

Published PR769 / 2026-10-29: atomic FBO camera captions record exact product/article, barcode/KIZ, authenticated operator/device, box and packed/target counts in the existing packing transaction. Own-WMS flag enabled; AuditLog index valid/ready, exporter Index Scan 0.128 ms / 7 buffers. API4039/web555, TypeScript, baseline8 and actual-container runtime10 passed. Exact2 API-module overlay; other686 files, web/TSD245, prior188 environment values, other containers and sold WMS preserved. Baseline `2026-10-29-fbo-video-caption`, sourceParityVerified=false. No new real packing occurred in the recorded verification window. [Details](fbo-video-caption.md).

Published PR767 / 2026-10-29: FBS automatic continuation stays inside the selected request. LOGOFF245 restores request/marketplace after pending-operation recovery; lost selection opens the list. Own-WMS `WMS_FBS_EXPLICIT_REQUEST_ENABLED=true` prevents new unscoped assignments. API4028/web555 passed (155/2 skipped), Android897, TypeScript/release, baseline8, actual runtime56 and RED/GREEN regressions. Exact1 API/3 download files; other686 API modules/schema/prior132 flags/environment/business data/sold unchanged. Baseline `2026-10-29-fbs-request-scope`, sourceParityVerified=false. Public hashes/health verified; terminal update required. [Details](fbs-explicit-request.md).

Опубликовано PR765: КИЗ клиента, LOGOFF244; baseline `2026-10-29-kiz-client-guard`. Проверки API4018/web555/Android885/PostgreSQL12/runtime26 и live4 пройдены. [Паспорт](kiz-client-duplicate-guard.md).

КИЗ клиента: `kiz-client-registry.spec.ts`, `kiz-client-receipt.spec.ts`, `kiz-client-review.spec.ts`, `kiz-receipt-conflict-transport.spec.ts`, `kiz-shipment-gates.spec.ts`; release scripts receipt/reuse/shipment/transport runtime + isolated PostgreSQL + full Nest health. Web/source/runtime browser и все Android flavors, включая сохранённую озвучку Софии. [Сценарии](kiz-client-duplicate-guard.md).

Published PR763 / 2026-10-29: LOGOFF TSD243 adds Sofia's approved offline tank voice pack (13 recordings / 17 existing events), selected by immutable account ID in LOGOFF only. Android286 per flavor (858 total), release/lintVital, baseline8, signed payload/certificate and existing25 raw-resource hashes passed. Exact3 download-file overlay on PR761; other3188 web files, all684 API files/schema/other containers/sold unchanged. Public APK/version/hash/health verified; terminal installation required. Baseline `2026-10-29-sofia-tanks-voice`, sourceParityVerified=false. [Details](sofia-tanks-voice.md).

Published PR761 / 2026-10-29: Ozon assembly/cargo and Lamoda FBO open in centered operational modals; Lamoda WB-style rows preserve client scope and label source-plan quantities. Minimize during loading retains its window and dock entry. API3975/web548 passed (150/2 skipped), TypeScript/build, baseline8, candidate/public browser32 each, runtime graph8 and capture guards5. Exact5 web overlay on PR759; all684 API files/schema/APK242/sold unchanged. Baseline `2026-10-29-fbo-modal-rows`, sourceParityVerified=false. [Details](fbo-modal-rows.md).

Published PR759 / 2026-10-29: FBO Ozon defaults to all permitted clients with WB-style rows, client in composition, retained countdown/actions and cursor paging. API3975/web542 passed (150/2 skipped), TypeScript/build, baseline8, runtime34, PostgreSQL9/full API health, candidate/public browser23 each. Read-only live check: 10 active/35 completed requests across3 clients in checked branch, metadata/scope/anonymous401 verified. Exact2 API/3web; schema/APK242/sold unchanged. Baseline `2026-10-29-ozon-all-clients`, sourceParityVerified=false. [Details](ozon-all-clients-list.md).

Applied PR757 / 2026-10-29: audited data-only binding of WMS2506 to manually created Lamoda MPG100007386, with factual composition checks and existing status refresh. No runtime changes. [Operation](lamoda-manual-link-2506.md).

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

Prepared / 2026-10-28: add the missing Lamoda active-request counter to the FBO tile; same scoped queue and status policy as WB/Ozon, no draft plans. Own-WMS flag, not published.

Published PR729 / 2026-10-28: scoped active WB/Ozon FBO card counters without the 200-row list cap. API3875/web530 passed (155/2 skipped), TypeScript, PostgreSQL5/full API health, candidate/public browser5 and marketplace/Lamoda regression50. Exact3 API/3web overlay on PR727; schema/APK236/sold unchanged. Live authorized endpoint200, anonymous401; current actor counts WB2/Ozon3. Baseline `2026-10-28-fbo-counts`, sourceParityVerified=false. [Details](fbo-active-card-counts.md).

Published PR725 / 2026-10-28: Lamoda shortages block assembly creation; review shows warehouse barcode/size/plan/reserves/free/deficit, explicit corrections reduce quantities without reserving, then Serializable recheck protects FBS/FBO demand. Original plan retained; compact PR723 layout and inline execution preserved. API3872/web529 passed (155/2 skipped), TypeScript/build, PostgreSQL7/full API health, candidate/public browser8 and baseline guards8 passed. Exact4 API/3 web overlay; schema/APK/sold unchanged. Baseline `2026-10-28-lamoda-stock`, sourceParityVerified=false. [Details](lamoda-stock-guard.md).

Prepared / 2026-10-28: Lamoda shortage/correction guard. API3872 passed/155 skipped (dedicated KIZ database suite excluded), web529 passed/2 skipped; TypeScript/build; 43 focused API tests; isolated PostgreSQL7 including concurrent creation; candidate browser8 including no write on correction, refreshed FBS deficit, inline execution, mobile and Dark. Four-file runtime delta verified on PR721–723. Not published. [Details](lamoda-stock-guard.md).

Prepared / 2026-10-28: active WB/Ozon FBO card counters, complete scoped request queue, loading/error states and stale-response protection. Own-WMS workspace flags; not published. [Scope and tests](fbo-active-card-counts.md).

Published PR721 / 2026-10-28: Lamoda FBO opens shared execution inline after creation, preserves it across list refresh, resets on account/client/branch switch. API3851/web524 passed (150/2 skipped), build/TypeScript, baseline guards8, candidate/public browser28 passed with synthetic API fixtures. Web-only3 files on PR720; API/schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-inline`, sourceParityVerified=false. [Details](lamoda-inline-assembly.md).

Prepared / 2026-10-28: Lamoda shared FBO execution opens inline after assembly creation; list refresh preserves selection, scope change drops stale response. Web-only follow-up to PR720; API/APK/schema/sold unchanged. Runtime regression28 and full API3851/web524 passed. [Scope and tests](lamoda-inline-assembly.md).

Published PR720 / 2026-10-28: separate marketplace workspaces and scoped client directory; customer connected tiles, staff filtered clients, Lamoda client-card maintenance. Panthera opaque Ozon/FBY/Lamoda surfaces and text removal width fixed. API3851/web524 passed (150/2 skipped), runtime PostgreSQL24/full API health, candidate/public browser24 and CSS regression6 passed. Exact4 API/7 web overlay, schema/APK236/sold unchanged. Baseline `2026-10-28-marketplace-workspaces`, sourceParityVerified=false. [Details](marketplace-workspaces.md).

Prepared PR720 / 2026-10-28: exact marketplace workspace overlay; branch-aware directory preserved, separate four FBO/FBS markets, client filtering, client-card maintenance. Panthera opaque Ozon/FBY/Lamoda surfaces and text removal width. Runtime PostgreSQL24/full API health, browser24 and CSS regression6 passed. Own WMS only; schema/APK/sold unchanged. See [details](marketplace-workspaces.md).

Prepared / 2026-10-28: scoped marketplace client directory, customer-only connected tiles, operational Lamoda layout and client-card maintenance. Own-WMS flags default off; not published. See [plan, affected functions and validation](marketplace-workspaces.md).

Published PR718 / 2026-10-28: scoped client/admin manual Lamoda product correspondence with WMS name/article/barcode search and two-card confirmation. Plans retain Lamoda identities; availability/reservations/directions use warehouse barcodes. API3849/web519 passed,155/2 skipped; TypeScript, isolated PostgreSQL19/full Nest health and candidate/public customer browser14 passed. Live136 Lukin cards loaded and136 unique size-compatible links confirmed through audited service; client search verified. Exact3 API/3 web overlay on PR716, schema/APK236/sold unchanged. Baseline `2026-10-28-lamoda-mapping`, sourceParityVerified=false. [Details](lamoda-contour.md).

Prepared / 2026-10-28: Lamoda manual product mapping for scoped CLIENT and administrators, search own WMS name/article/barcode and explicit two-card confirmation. Marketplace identifiers retained; availability/reservations/directions use warehouse barcodes. Exact3 API/3 web overlay on 2026-10-28-yandex-fby. API3849/web519 passed,155/2 skipped; TypeScript, disposable PostgreSQL19/full Nest health and customer browser14 passed. Schema/APK236/sold unchanged. [Details](lamoda-contour.md).

Published PR716 / 2026-10-28: Yandex FBY existing-supply import and Excel/manual internal assembly, scoped mapping/binding/refresh, separate LOGOFF TSD queue/APK236. Preserves Lamoda FBO and CLIENT access; Lamoda credentials now in client card, four equal marketplace tiles (2/4/1 columns). API3846/web519 passed,150/2 skipped; Android267 per flavor. Exact runtime PostgreSQL12 FBY +19 Lamoda, full Nest health, candidate16/public16 browser scenarios and public file/APK hashes passed. Additive FBY table; exact overlay on PR714; other containers and sold WMS unchanged. Real client Yandex import/physical scans remain unverified; no external supply/cargo-place/label writes. Baseline `2026-10-28-yandex-fby`, sourceParityVerified=false. [Details](yandex-fby.md).

Published PR714 / 2026-10-28: CLIENT access to own Lamoda FBO plans through existing request rights. Excel/ID import, availability and replay-safe assembly allowed; credential management remains administrative. Exact2 API/4 web overlay; schema/APK235/roles/business records/sold WMS unchanged. API3811 plus new controller-guard test, web513 passed;155/2 skipped. TypeScript, disposable PostgreSQL19/full Nest health, customer browser10 and admin13 passed; public customer browser10 and live read-only Lukin account/warehouses verified. Baseline `2026-10-28-lamoda-client`, sourceParityVerified=false. [Details](lamoda-contour.md).

Prepared / 2026-10-28: scoped Lamoda FBO planning for CLIENT users with existing client-requests rights. Credential management remains API-admin only; no role grants. Exact2 API/4 web overlay on 2026-10-28-lamoda-fbo. API3811 and new route-guard test passed, web513 passed;155/2 skipped, dedicated KIZ DB suites excluded. Candidate client browser10 and admin browser13 passed; API/web TypeScript passed. Schema/APK/external writes/sold WMS unchanged. See [Lamoda scope](lamoda-contour.md).

Published PR707 / 2026-10-27: client service lists skip writes to unchanged standard services and existing client price bindings. Exact two methods/one API file; own-image WMS_BILLING_SERVICE_READ_FAST_ENABLED. API3772/web510 passed;155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, targeted30, candidate read-only70ms and published read-only47ms for identical367 Bushkova services passed. Web/APK/prices/invoices/sold WMS unchanged. Baseline `2026-10-27-billing-read-fast`; sourceParityVerified=false. [Details](billing-service-read-performance.md).

Published PR705 / 2026-10-27: corrected HTML entry after PR703. One index.html src changed; prevents dual React roots and blank screen on saved-session restore. Authenticated Panther startup reproduced before and verified after, including public page with synthetic API fixtures. API3767/web510 passed;155/2 skipped, dedicated KIZ DB suite excluded. API/assets/APK/data/sold WMS unchanged. Baseline `2026-10-27-receipt-startup`; sourceParityVerified=false.

Published PR703 / 2026-10-27: receipt availability controls and per-client Gray/White processing profiles. Exact13 API/4 web overlay; WMS_RECEIPT_PROCESSING_ENABLED=true in our image only. API3767/web510 passed;155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, runtime18, browser12/full graph, isolated PostgreSQL/full Nest health and production rollback8 passed. Baseline `2026-10-27-receipt-processing`; sourceParityVerified=false. No client configured, no receipt/stock/invoice changed at deploy; APK/schema/sold WMS unchanged. [Details](receipt-processing-type.md).

Published PR701 / 2026-10-27: selected Ozon FBS labels avoid full marketplace/history reload. Exact2 API files; WMS_OZON_DIRECT_LABEL_ENABLED=true in our API image only. API3748/web510 passed,155/2 skipped; dedicated KIZ DB suite unavailable. TypeScript, candidate runtime/module graph, live health/hashes and read-only request2461 PDF passed (417ms,72205bytes). Baseline `2026-10-27-ozon-direct-label`; sourceParityVerified=false. Web/APK/schema/sold WMS/business records unchanged.

Published PR699 / 2026-10-26: actual Ozon FBO editing deadline countdown. Exact 4 API / 4 web overlay on multishop-auto. API3740/web510 passed, 155/2 skipped; dedicated KIZ database suite unavailable. TypeScript, runtime4/module graph, candidate/public browser (3 themes x6 widths) and live health/hash checks passed. Baseline `2026-10-26-ozon-deadline`; sourceParityVerified=false. Existing requests need an Ozon refresh. Sold WMS, APK, schema and business records unchanged.

Prepared / 2026-10-26: [Обратный отсчёт ФБО Ozon](ozon-edit-deadline.md). Exact API deadline per order; customer list, assembly/cargo details and legacy plans. Own-host UI only; unknown dates never inferred from slots. Not published. Tests: `ozon-edit-deadline.spec.ts`, `OzonEditCountdown.spec.tsx`.

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

Published PR673 / 2026-10-23: FBS WB table checkbox selects all current search/filter results across pages; shop-wide positive-free selection remains separate. Selected/hidden counts and bulk-stop confirmation. Web476/API3564 passed,2/155 skipped; existing dedicated KIZ DB suite unavailable. Nine candidate and public browser scenarios passed with educational API fixtures. Three-file web overlay; all old assets except index retained. API/APK/config/business data/sold WMS unchanged. Baseline `2026-10-23-fbs-filtered-selection`, sourceParityVerified=false. Rollback `logoff-web:before-fbs-filtered-selection-20261023`. [Scope and validation](fbs-filtered-selection.md).

ФБО, другой исходный короб (опубликовано PR671): `apps/api/test/fbo-alternative-picking.spec.ts`, `FboTwoStageScreenTest.alternativeBoxIsValidatedWithoutStockMutation`, `FboScanStateTest.alternativeLocationIsScopedToOurPicker`, runtime `scripts/releases/fbo-alternative-20261022/smoke.cjs`. [Результаты и ограничения](fbo-alternative-picking.md).

Published PR669 / 2026-10-22: FBO picking history retains rows and scroll during polling; no transient loading paragraph above populated table. Source regressions4, candidate/public runtime browser5, web470 passed/2 skipped, TypeScript passed. API3559 passed/155 skipped; existing KIZ integration suite cannot initialise without dedicated DB URL. Exact two-file web overlay on PR667; API/config/stock/sold unchanged. Web sha256:0c70ec6c971bc061ee516eace82da463570b06baf5b1998b5363f1410964d344; baseline `2026-10-22-history-refresh`, sourceParityVerified=false. Rollback `logoff-web:before-history-refresh-20261022`.

Published PR667 / 2026-10-22: modern service menu cards with colored icon backgrounds, compact responsive grid, keyboard focus and reduced motion. CSS-only two-file overlay; API, JavaScript, permissions and sold WMS unchanged. Web466 passed/2 skipped; TypeScript passed; six candidate/public-CSS browser scenarios at1440/768/390 light/dark passed. Actual navigation markup/click handlers retained; test fixture uses placeholder icon paths. Web sha256:dac4d0cbbd175917bac89a3a97b54417b2392d7186d5f3c70514b5363e397a33; API sha256:a44fc2fbb1641fb022ae3902495c3057393d3de737518b7d4cccb33e9ea0ee91. Baseline `2026-10-22-service-tiles`, sourceParityVerified=false. Rollback logoff-web:before-service-tiles-20261022.

Published PR665 / 2026-10-22: original-sticker replacement accepts WB complete/sorted; ordinary repeat still requires complete/waiting. Final/unknown states blocked, actual state shown in errors. API3559/web466, TypeScript, runtime11 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live read-only preview6049802274 succeeded: BOX0205, original sticker59080109672. Exact two-module API overlay; no web/flags/schema/stock/sold changes. Baseline `2026-10-22-original-sorted`, sourceParityVerified=false; rollback logoff-api:before-original-sticker-sorted-20261022.


Published PR663 / 2026-10-22: Service original-sticker replacement for ADMIN/OWNER. HIGH priority, new unit/KIZ consumed once on physical picking, original PNG pinned, first attempt archived. Exact six API modules/two web files over PR661; own-image flags enabled, no schema or business data changes. API3558/web466, TypeScript, isolated PostgreSQL8, runtime8, candidate/public browser4 and live owner capability passed;155/2 skipped, dedicated KIZ DB suite excluded. Baseline `2026-10-22-original-sticker`, sourceParityVerified=false. Rollback tags logoff-api:before-original-sticker-20261022 and logoff-web:before-original-sticker-20261022. Sold WMS unchanged. [Details](fbs-original-sticker.md).

Published PR661 / 2026-10-22: CLIENT stock readers can open turnover Stock (minus requests) and export Excel for their permitted clients. Internal statistics and stock mutations remain restricted. One API module and two web files over PR659; no schema/config/business-data/sold changes. API3551/web466 passed,155/2 skipped; dedicated KIZ DB suite excluded. TypeScript, actual-runtime before/after regression, public runtime and candidate API own/foreign-client checks passed. API sha256:5c63b72b85fd416960409369cb3799d9e8bcb0998dcb73d7e5e8d825dceb95a3; web sha256:df00b7ec0382ab6e7e7c30aa04d4b20b24fa04a4105566c695170da43bb538d1. Baseline `2026-10-22-client-stock`, sourceParityVerified=false. Rollback tags logoff-api:before-client-turnover-stock-20261022 and logoff-web:before-client-turnover-stock-20261022.

Published PR659 / 2026-10-22: CLIENT managers may change receipt FBS/FBO directions within writable client scope; read-only stays disabled. API3550/web465, TypeScript, candidate API11 and candidate/public browser9 passed;155/2 skipped, dedicated KIZ DB suite excluded. Live Svetlana and manager capabilities true; Svetlana read-only client false. Two API modules and two web files; current receipt confirmation, invoice downloads and favorites retained. Baseline `2026-10-22-receipt-manager`, sourceParityVerified=false. No stock/config/schema/APK/sold changes. [Details](receipt-manager-directions.md).

Prepared / 2026-10-22: receipt FBS/FBO directions follow CLIENT writableClientIds for all client managers, not personal grants. API capability and branch checks; UI uses server capability. Read-only/foreign client/foreign branch/demo/disabled installation rejected. Files: receipt-direction-access.ts, receipt-channels.controller.ts, ReceiptDirectionsPanel.tsx; tests receipt-direction-access.spec.ts and receipt-direction-manager.spec.ts. Not published; sold WMS untouched.
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

Prepared: [FBS stage timing](fbs-stage-timing.md), preserves scan/completion behavior; latency cause still under investigation.

Published PR631 / 2026-10-16: Ozon label creation retries explicit HTTP429 with bounded delay. Ambiguous writes are not retried. API3509/web445 and TypeScript passed;155/2 skipped, dedicated KIZ DB suite excluded. Four actual-image checks; one runtime module only. Live client receipt visibility correction preserved. Web/APK233/flags unchanged. Baseline `2026-10-16-ozon-labels`, sourceParityVerified=false. [Details](ozon-label-throttling.md). FBS latency diagnosis remains open.

Prepared: Ozon label explicit 429 regression (fails before fix); transport failure, HTTP500 and long cooldown runtime guards. See [scope](ozon-label-throttling.md).

Published PR629 / 2026-10-16: receipt series XLSX uses recorded product label barcodes instead of unordered GTIN aliases. Scoped accepted TSD scans, unambiguous legacy fallback. API3507/web445, source6, container7, TypeScript and exact two-file delta passed;155/2 skipped, dedicated KIZ DB suites excluded. Live 1310 export verified4474 units. Web/APK233/flags unchanged. Baseline `2026-10-16-receipt-scanned-barcode`, sourceParityVerified=false. [Details](receipt-scanned-barcode.md). [Evidence](releases/receipt-scanned-barcode.json).

Published PR627 / 2026-10-16: interrupted WB auto assembly now persists request ownership atomically, journals supply intents/IDs and recovers under locks with exact WB composition and routing checks. API3501/web445, source11, candidate/live8, PostgreSQL4, TypeScript and baseline8 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules, own-installation durable flag only. Web/APK233 unchanged. Baseline `2026-10-16-auto-assembly-interrupted`, sourceParityVerified=false. [Details](auto-assembly-interrupted.md). [Evidence](releases/auto-assembly-interrupted.json).

Published PR620/621 / 2026-10-15: durable bounded WB reconciliation queue and on-demand request readiness, exact lookup and assigned attention cases. API3487/web443, TypeScript, isolated PostgreSQL6, candidate/live browser7, actual API6, migration runner and baseline8 passed;155/2 skipped, dedicated KIZ DB suite excluded. Six API files, additive queue table and web graph; new flags enabled only on our WMS. PR618 monitoring retained; APK233, printing and sold WMS unchanged. Baseline `2026-10-15-reconciliation-tools`, sourceParityVerified=false. [Details](reconciliation-tools.md). [Evidence](releases/reconciliation-tools-20261015.json).

Published PR618 / 2026-10-15: WB monitoring uses current warehouse routing and exact reservation evidence. EXCLUDED routes are filtered before listing/ingestion/checking; WAITING_STOCK cannot confirm a reserve. API3475/web443, source/runtime13 and Docker6 passed;155/2 skipped, dedicated KIZ DB suites excluded. Four API modules only; WMS_FBS_MONITOR_ROUTING_ENABLED=true. Web/APK233 unchanged. Baseline `2026-10-15-monitor-routing`, sourceParityVerified=false. [Evidence](releases/wb-monitor-routing.json).

Published PR616 / 2026-10-15: bounded API request timing and compact TSD replay receipt reads. API3462/web443, TypeScript, actual-image7 and live read-only SQL verification passed;150/2 skipped, dedicated KIZ DB suites excluded. Three runtime files; two own-WMS flags enabled. Web/APK233/print agent/schema/stock/sold WMS unchanged. Baseline `2026-10-15-operation-reads`, sourceParityVerified=false. [Details](operation-read-diagnostics.md). [Evidence](releases/operation-reads-20261015.json).

Prepared: [request diagnostics and compact TSD replay reads](operation-read-diagnostics.md). Three API runtime files only; API3462/web443 and actual-image7 passed. Queue/schema excluded; sold WMS unchanged.

Published PR614 / 2026-10-15: [объединённый макет Ozon](ozon-combined-layout.md) — компактное создание, 4–6 плиток, выбранная сборка/грузоместа снизу. Web443/API3454, TypeScript, baseline8, candidate/public graph browser и legacy layout passed;2/150 skipped, dedicated KIZ DB suites excluded. Exact34-file web delta; 94 public graph files verified. API/APK233/config/business records/sold WMS unchanged. Baseline `2026-10-15-ozon-combined`, sourceParityVerified=false. [Evidence](releases/ozon-combined-20261015.json).

Published PR612 / 2026-10-15: Ozon FAILED cargo retry requires fresh terminal failure, confirmed empty remote cargo arrays, binding/composition checks and atomic claim with previous-operation audit. Object-form errors now shown. Six regression cases; API3454/web442, TypeScript and actual-image4 passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module (upload/status); web/APK233/flags/stock/sold WMS unchanged. Request2058 retried only SPb and Novosibirsk; all8 directions SUCCESS, other6 submission IDs and labels preserved. Baseline `2026-10-15-ozon-retry`, sourceParityVerified=false.

Published PR610 / 2026-10-15: exact int64 Ozon cargo IDs retained on response parsing and label serialization. Two regressions fail before/pass after; API3448/web442, TypeScript and actual-image smoke passed;150/2 skipped, dedicated KIZ DB suite excluded. One API module, only call/labels methods; web/APK233/flags/stock/sold WMS unchanged. Request2059 cargo IDs restored through audited status check, existing submission preserved; labels generated with 3 correct pages. Baseline `2026-10-15-ozon-ids`, sourceParityVerified=false.

PR608: Ozon closed-carton reopen dispatcher/DTO runtime cases5; source tests9; Android263 per flavor. UI cancellation, ordinary packing after reopening, feature guards and durable replay verified.


Published PR606 / 2026-10-14: Winx welcome now assigned to actual login Eleonora (display name Elkapone), not separate Elya account. Sofia unchanged. Web442/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and six public-site browser cases passed with real network HTML/JS/CSS/video (only API mocked). One account-ID change plus cache-safe graph renaming; API/APK232/configuration/business data/sold WMS unchanged. Baseline `2026-10-14-eleonora-account`, sourceParityVerified=false. [Details](eleonora-account-welcome.md). [Evidence](releases/eleonora-account-20261014.json).

Published PR604 / 2026-10-14: personal welcome after successful login for verified Sofia/Eleonora IDs in all themes; supplied Disney/Winx animations, exact text, skip and completion. Web441/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, baseline8 and actual runtime login/appearance/Ozon tests passed. Exact33-file web delta over sidebar-contrast; API, APK232, configuration, business records and sold WMS unchanged. Baseline `2026-10-14-personal-login`, sourceParityVerified=false. [Details](personal-login-welcome.md). [Evidence](releases/personal-login-20261014.json).

PR601: `scripts/sidebar-count-contrast.browser.test.cjs` verifies actual Light/Dark badge contrast; WMS_TEST_CSS supports candidate and published styles.

Published PR598 / 2026-10-14: Winx and Disney styles in la_panthera, 33 supplied wallpapers, themed cursors and centered personal welcome. Web440/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Candidate/live login, restoration and Ozon inline browser checks passed. Exact 74-file web delta; API, APK232, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-panthera-magic`, sourceParityVerified=false. [Details](panthera-magic-themes.md). [Evidence](releases/panthera-magic-20261014.json).

Published PR599 / 2026-10-14: Ozon online execution embedded below the link-import form in the left column; right assembly list stays usable. Optional embedded mode preserves other modal callers. Web434/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, source/candidate/live browser checks passed. Only workspace and panel display properties changed in current runtime; API, APK232, flags, operations and sold WMS unchanged. Baseline `2026-10-14-ozon-inline`, sourceParityVerified=false. [Evidence](releases/ozon-inline-20261014.json).

Published PR596 / 2026-10-14: compact Ozon customer forms/cards; full assembly list uses page scrolling instead of the 585px inner viewport; themed native file/template controls. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Five-row source/candidate/live browser checks, five widths, three appearances and native file chooser passed. CSS + index only; application JS, API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-compact`, sourceParityVerified=false. [Evidence](releases/ozon-compact-20261014.json).

Published PR594 / 2026-10-14: approved Ozon customer workspace 65/35 layout, responsive import and supply panels, named accounts. Web433/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. Source/candidate/live browser checks at five widths and three appearances, both import entry points and eight baseline tests passed. Exact 34-file web overlay; API, APK232, print agent, configuration, stock and sold WMS unchanged. Baseline `2026-10-14-ozon-layout`, sourceParityVerified=false. [Details](ozon-workspace-layout.md).

PR592: FboTwoStageScreenTest covers restored loose-picking checkpoint without stock mutation, plus prior marking and pending-operation regressions. 260 tests per Android flavor passed.

PR590: `ozon-link-import.spec.ts`, `OzonLinkImport.spec.tsx`, `api.ozon-link-warehouse.spec.ts`; actual runtime browser and read-only smoke in `scripts/releases/ozon-client-access-20261014`. API3437/web431 passed,150/2 skipped; dedicated KIZ DB suites excluded. Both managed clients, named accounts and branch isolation verified.

PR588: FboTwoStageScreenTest covers unmarked manual top-up and definitive rejection in both acknowledgement protocols. 260 tests per Android flavor passed.

PR586: `fbo-unplaced-confirmed.spec.ts` verifies receipt-gated routes and picking, reserves and disabled capability. `wms-stock-availability.service.spec.ts` preserves client pallet-sort filtering. Six compiled runtime checks: `scripts/releases/fbo-unplaced-20261013/smoke.cjs`. API3431/web427 passed.

PR584: Ozon cargo throttling regression tests in `ozon-assembly-supply.spec.ts`; compiled transport/recovery and read-only request2000 proof in `scripts/releases/ozon-rate-20261013/smoke.cjs`. API3423/web427 passed;155/2 skipped.

PR561/562: manual FBS helper/service/PostgreSQL tests; `scripts/tests/fbs-manual-runtime-browser.cjs`; live staging and published preview are rolled back. Source and candidate PostgreSQL scenarios pass; read paging preserves uint64 WB cursor.

PR555: `wb-barcode-identity.spec.ts` and `scripts/tests/wb-barcode-runtime.cjs`; real catalog synchronization and guarded SKU update tested against the pinned candidate.

PR553: `marketplace-product-links.spec.ts`, `marketplace-product-links.integration.spec.ts`, `api.product-links.spec.ts`, `marketplace-product-links-runtime.cjs`, `marketplace-links-browser.cjs`.

PR539 marketplace isolation: `fboRequestScope.spec.ts`, `client-requests.service.spec.ts`; actual runtime `scripts/tests/fbo-marketplace-runtime.cjs` and read-only `scripts/releases/fbo-marketplace-20261009/smoke.cjs`. API3266/web414 passed, 144/2 skipped; runtime2 passed.

LOGOFF223 / PR535: [found-KIZ route](kiz-found-tsd-route.md); `KizFoundRouteTest` verifies actual Retrofit paths for all five actions.

Found KIZ: `kiz-found-review.spec.ts`, `kiz-location.service.spec.ts`, `KizFoundPanel.test.tsx`, `KizFoundPolicyTest`; actual candidates: `scripts/tests/kiz-found-postgres.cjs`, `kiz-found-browser.cjs`, `kiz-found-runtime.cjs`. PostgreSQL uses only localhost:55469 and its own kiz_found_review schema.

Ozon supply link: `ozon-supply-policy.spec.ts`, `ozon-assembly-supply.spec.ts`, `ozon-supply.integration.spec.ts`, `scripts/tests/ozon-supply-browser.cjs`.

## Онлайн-выполнение / PR525

`online-plan-view.spec.ts`, `menu-read-catalog-parallel.spec.ts`; готовый API: `online-window-runtime.cjs`; браузер: `online-window-browser.cjs`, `ozon-customer-browser.cjs`, `ozon-entry-browser.cjs`. Старый граф воспроизводит 251 строку закрытой истории; новый проверяет 100-строчные страницы, ошибку/повтор, сворачивание и восстановление. API3230/web411,142/2 пропущены; KIZ integration требует отдельной БД.

PR520: `OzonCustomerWorkspace.spec.tsx`, проверка scope в `ozon-customer-import.spec.ts`, готовый браузерный граф `scripts/tests/ozon-entry-browser.cjs`.

## ФБО Ozon / PR516

`ozon-customer-import.spec.ts`, `ozon-customer-directions.spec.ts`, `fbo-two-stage.integration.spec.ts`; runtime: `scripts/tests/ozon-customer-runtime.cjs`, браузер: `scripts/tests/ozon-customer-browser.cjs`.

# Индекс проверок

Подготовленный режим [счёта по сданным заявкам](billing-done-requests.md):
API `src/modules/billing/billing-done-requests.spec.ts` и `billing-period.spec.ts`,
web `BillingPeriodGenerationDialog.spec.tsx`; выключенный флаг, права, дата сдачи,
прежние даты услуг, общий черновик, смешанные/оплаченные документы, повтор и устаревший расчёт.

При изменении общей точки входа проверять все связанные строки, а не только новый
экран. Наличие имени в коде не заменяет вызов сценария. Production-данные не использовать
для тестовых записей/списаний. Интеграционные БД — отдельные, пропуски явно указывать.

| Изменяемая область | Проверки API (`apps/api/test/`) | Android / другие проверки |
| --- | --- | --- |
| Меню и онлайн, PR514 | menu-read-performance.spec.ts, receipt-report-evidence.spec.ts, shared-read.spec.ts | menu-read-runtime.cjs, menu-read-browser.cjs; сравнение снимка с откатом |
| Компактная упаковка, PR512 | fbo-packing-receipt.spec.ts, fbo-compact-packing-runtime.cjs | FboPackingReceiptTest, FboCompactPackingScreenTest; все6 Android variants по232 теста |
| Индекс приёмок, PR509/510 | receipt-stock-index.spec.ts, fbo-remaining-plan.spec.ts | receipt-stock-index.sql, receipt-stock-index-runtime.cjs, test_receipt_index_backfill.py; отдельный PostgreSQL и сверка production с откатом |
| Серия и телефон, PR505 | `print-series.spec.ts`, также на готовом runtime | `printSeries.spec.ts`, `print-series.test.cjs`, `phone-layout.browser-test.cjs`, `scripts/print-phone-runtime.browser-test.cjs`, `scripts/build-print-series-agent.test.py` |
| FBS экран, capability, контроллер | `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts` — также на реальном runtime | `FbsAssemblyUiTest`, `OzonLabelSafetyTest` |
| Переклейка и её печать | `tsd-relabel-print.spec.ts`, `tsd-relabel-label.spec.ts`, `fbs-physical-kiz-relabel.spec.ts`, `pick-instruction-relabel-barcode.spec.ts` + предыдущая строка | `FbsRelabelExternalPrintActivityTest`, `FbsRelabelPrintUiTest`, `RelabelPrintGateTest`, `FbsKizRelabelTest` |
| Несколько единиц и последовательная сборка | `tsd-fbs-capability.spec.ts` с runtime-путями, `fbs-online-remaining-progress.spec.ts`, `fbs-box-scan-route-consistency.spec.ts` | `FbsSequentialPickTest`, восстановление после повторного ответа |
| Очередь заявок и роли | `fbs-lukin-batch.spec.ts`, `fbs-terminal-queue.service.spec.ts` | Owner/admin без лимита; сборщики — закреплённая пятёрка Лукина, другие клиенты без этого лимита |
| Остатки/резерв/маршрут | `fbs-stock-allocation.spec.ts`, `fbs-stale-rescan-reservation.spec.ts`, `fbs-picked-stock-proof.spec.ts`, `fbs-stock-transfer.spec.ts` | Сверить API и таблицу заявки; включить сценарий исходный/целевой SKU |
| Печать/подтверждение/списание | `fbs-print-order-scope.spec.ts`, `fbs-print-stale-kiz.spec.ts`, `fbs-print-ack-billing.spec.ts`, `print-job.service.spec.ts` | Повтор запроса не печатает/не списывает ещё раз; тестовый принтер только с разрешением |
| Автостатусы и уведомления | `fbs-request-auto-status.integration.spec.ts` на изолированной БД и candidate runtime | Сохранить ручной статус и поведение выключенного флага |
| FBO | `fbo-two-stage.integration.spec.ts`, `fbo-picked-reservation.spec.ts`, `fbo-archived-shipping.spec.ts` | `FboTwoStageScreenTest`, `FboPackingProgressTest`, `FboScanStateTest` |
| Палет-сортировка | `pallet-sorting-session.spec.ts`, `pallet-sorting-stock.spec.ts`, `pallet-sorting-terminal-route.spec.ts`, `pallet-sorting-admin-access.spec.ts`, `pallet-sorting-policy.spec.ts` | `PalletSortingRestoreConsentTest`, `PalletSortingAutoSubmitTest`; web `workspaces.admin-sorting.spec.ts`, `PalletSortingPanel.spec.tsx`; `owner-sorting-web-overlay.test.cjs` checks OWNER/ADMIN in actual menu and screen |
| Состав выпуска | `python -m unittest discover -s scripts/tests -p test_release_baseline.py` из `wms/` | verify → materialize → check-candidate; свежий image ID обязателен |

Android-тесты находятся в
`apps/android-tsd/app/src/test/java/pro/logoff/wms/tsd/`.
Для Python-тестов задать `BASELINE_TEST_TMP` каталогом внутри рабочей `work/`.

## Команды

Из `wms/apps/api/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1`.
Некоторые интеграции требуют переменные тестовых БД; без них полный зелёный отчёт
не означает прохождение этих интеграций. Из `wms/apps/web/` — та же команда Vitest.
Из `wms/apps/android-tsd/` — `gradle :app:testLogoffDebugUnitTest`.
При затрагивании общего Android-кода добавить тесты других затронутых flavors.

Для проверки **собранного** API выставить абсолютные пути:

```text
FBS_RUNTIME_CONTROLLER=<candidate>/modules/tsd/tsd-device.controller.js
FBS_RUNTIME_ENTRY=<candidate>/modules/marketplace-connections/marketplace-connections.service.js
```

Запустить `tsd-fbs-capability.spec.ts`, `fbs-tsd-sticker-number.spec.ts`,
`tsd-relabel-print.spec.ts`, `tsd-relabel-routes.spec.ts` и `fbs-lukin-batch.spec.ts`.
Кандидату нужны совместимые зависимости; не подменять его файлы локальными
ради успешного импорта. В PR фиксировать источник зависимостей и пропущенные проверки.

При каждой правке: тест воспроизводит проблему до исправления → проходит после →
общие тесты → сверка артефакта → PR → проверка опубликованного контейнера.
Физический результат на ТСД/принтере отмечать отдельно от автоматических тестов.


la_panthera full coverage: web/test/build-la-panthera-coverage.cjs --check (47 component stylesheet inventory), la-panthera-contrast.browser.cjs (26 representative views; optional RUNTIME_CSS), la-panthera-hover.browser.cjs (scale/red gradient, stable neighbour, reduced motion, classic isolation). Browser fixtures do not substitute for an authenticated full-screen walkthrough.


## PR396: заявки и la_panthera

- `apps/api/test/client-requests.service.spec.ts`: архив DONE/CANCELLED/REJECTED, явный статус и доступные клиенты.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: источники хранения, noBox только без источника, упаковка, частичные результаты.
- `apps/web/test/request-release.browser.cjs`: фактический runtime; архив, массовая сдача, сортировка, Excel, WB-статус, пантера при сетевой загрузке. Запуск с `RUNTIME_CANDIDATE` на проверенном каталоге кандидата.
- `apps/web/test/sidebar-groups.browser.cjs`, `sidebar-favorites.browser.cjs`: независимые группы и пользовательские быстрые ссылки.
- `apps/web/src/lib/networkLoading.test.ts`: параллельные fetch, чтение тела и ошибки.
- `apps/web/src/components/client-requests/requestZoneTones.test.ts`: большинство активных заказов, границы 12/19 часов, срочные равенства.

Публикация PR396: Web 328, API 2893, 8 baseline-тестов пройдены; пропуски 2/113, отдельная DB-серия KIZ исключена. Снимок `2026-09-29-request-batch-theme`, source parity false.


## PR400: форма, статусы и безопасная массовая сдача

- `apps/web/test/request-release.browser.cjs`: сворачивание всей формы в трёх темах, сохранение ввода, конкретный статус, цвета таймеров 1/15/20 часов и большинства shipped-заказов.
- `apps/web/src/components/client-requests/requestBatch.test.ts`: БЕЗ КОРОБА, единственный достаточный источник, неоднозначный/недостаточный остаток и сохранение выбора.
- `apps/api/test/request-stock-source.runtime.cjs`: фактический упакованный API; недостаточный остаток и незавершённая сборка запрещены без корректировок; достаточный источник разрешён; DTO сохраняет флаг.
- `apps/api/test/stock-operations.service.spec.ts`: те же ограничения на уровне исходников.

Web334/API2895 прошли; 2/113 пропущены, отдельная KIZ DB-серия исключена. TypeScript, браузерные сценарии и runtime-проверки прошли. Снимок `2026-09-29-request-polish`, source parity false.


## PR402: сверка и быстрые ссылки

`apps/web/test/reconciliation-theme.browser.cjs`: графитовый контейнер, заголовок/дата, пустое и заполненное состояния, другие темы и печать. `sidebar-favorites.browser.cjs`: переход без раскрытия группы, drag в обе стороны, клавиатура, сохранение порядка и изоляция пользователей; NAV_RUNTIME позволяет проверить фактический опубликованный адаптер. Web334/API2895 passed, 2/113 skipped; отдельная KIZ DB-серия исключена.


PR404: `apps/web/test/fbs-zone-colors.browser.cjs` — реальные CSS, три цвета кнопок/таймеров, hover, изоляция тем и печати, верхняя строка выбора и нижняя строка действий, компактная высота и перенос на 390px.

## PR406: ordinary picking, reviews and notifications

- `apps/api/test/ordinary-unmarked-pick.spec.ts`: new flag, complete/unmarked/SOS/source guards and found/packed labels.
- `fbs-request-auto-status.integration.spec.ts`: isolated PostgreSQL concurrent retry and all-or-nothing stock shipment; `FBS_RUNTIME_AUTO_STATUS_ENTRY` and `FBS_RUNTIME_ENTRY` repeat against published JS.
- `ordinary-pick.runtime.cjs`: image module loading and disabled-flag isolation; `tsd-fbs-capability.spec.ts` with `FBS_RUNTIME_CONTROLLER` passed all 11 tests on this runtime.
- `KizReviewQueuePanel.test.tsx`, `markAllNotifications.test.ts`: collapsed cases, seven days, complete pagination, new arrivals and partial failures.
- `reviews-notifications.browser.cjs`, `monitoring-notifications.browser.cjs`: actual adapter interactions and CSS; favorites regression also passed.
- Production public page: HTTP200 and zero JavaScript errors. Full hashes, health, APK216 and all preexisting flags verified.


## Compact request columns / all themes

- `apps/web/src/components/client-requests/ClientRequestColumns.test.tsx`: request identity/supply grouping and client above composition.
- `apps/web/test/compact-request-columns.browser.cjs`: actual release runtime; 11 themes, two request columns, combined due/status and actions/process, existing navigation/status callbacks, 390px mobile overflow. Set `RELEASE_ROOT` to the candidate release directory.
- Web/API general suites, TypeScript, baseline verify/materialize/check-candidate and exact web image hash delta before publication. API is unchanged.


## la_panthera Light

- `apps/web/src/components/layout/themeStyle.test.ts`: Dark default, user-isolated Light persistence, invalid/denied storage.
- `apps/web/test/la-panthera-light.browser.cjs`: 30 operational views, text contrast >=4.5:1, exact zone colours, Dark restoration and print exclusion.
- `apps/web/test/theme-style-runtime.browser.cjs`: actual packaged App, adjacent selector, persistence on reload, theme/user switches and selector fitting narrow header. Set RELEASE_ROOT to the release directory.
- `apps/web/test/build-la-panthera-light.cjs --check`: generated colour-only coverage remains current; images and print styles excluded. Palette tuning in la-panthera-light-tuning.css.

## Request action menus (our modern fulfillment contour)

- `RequestActionMenus.test.tsx`: FBO/FBS grouping, unique route, separate orders navigation, administrator-only recovery, legacy opt-out. Three regression assertions failed before the change.
- `test/request-action-menus.browser.cjs`: source and actual runtime React table (RELEASE_ROOT), 13 distinct callbacks with the same request ID, keyboard disclosures, 11 themes including la_panthera Dark/Light, terminal status and administrator restrictions.
- Enabled by existing `VITE_FBO_WORKSPACE_ENABLED`; no server workflow changes. Sold/legacy contour retains its original layout with the flag disabled.
- Web 347 passed / 2 skipped; API 2929 passed / 115 skipped. `kiz-duplicate.integration.spec.ts` requires a dedicated local database and was excluded after its missing-configuration failure. Web TypeScript passed.
- Published as PR414 after actual runtime browser checks, exact public/image hashes and health checks. API PR412 retained. Source/runtime parity remains false; use the surgical runtime release workflow.


## Request label wrapping and simplified menus

- `request-action-menus.browser.cjs`: long Novosibirsk title in a narrow column, no clipped title or overflowing action labels, 12 retained callbacks, 11 themes plus Light; source and actual runtime.
- `RequestActionMenus.test.tsx`: modern menu excludes manual stages and emergency controls even for administrators; legacy opt-out unchanged. Regression failed before the fix.
- CSS and existing runtime adapter only; no API changes.


## Approved request list and online menus

- `RequestActionMenus.test.tsx`: Online replaces Route; composition downloads move into Documents; manual, emergency, source-selection and standalone instruction actions removed from modern list.
- `onlineRequestToolbar.test.tsx`: original download callbacks, optional edit/cancel, unchanged status predicates, assembly body retained.
- `request-action-menus.browser.cjs`: source and actual runtime; 11 themes plus Light; eight retained list callbacks, online documents/WMS boxes/edit/cancel/refresh/close, denied actions absent, no clipped labels.
- Web351 passed/2 skipped; TypeScript passed. API unchanged.


## Four equal request menu rows

- Browser regression checks four vertically sequential controls, equal width/56px height, identical background/text colour, horizontal and vertical centering for FBS/FBO and all themes. Failed against PR416 before CSS fix. Existing keyboard and callback tests retained.
- CSS-only release; JavaScript/API/APK unchanged.

PR447: `fbo-plan-timeout.spec.ts` and `fbo-plan-timeout.runtime.cjs` cover concurrent plan reads, caller denial, retry/freshness, context isolation and bounded shipped-order lookup.

PR449: `fbo-route-decision-cache.spec.ts` / `.runtime.cjs`: snapshot-local decisions, all contained SKU demands, flag isolation and12 compiled ordering comparisons.

PR451: fbo-recovery-transaction-retry.spec.ts / .runtime.cjs cover external transaction ownership, unchanged ordinary retry and single outer receipt.

PR453: fbo-recovery-route.runtime.cjs verifies no route within recovery, unchanged ordinary route and409after bounded retries; real1568rollback smoke passed after publication.

kiz-unfinished-cancelled.runtime.cjs: cancelled never-shipped binding, physical proof, negative cases; previous kiz-released-review.runtime.cjs unchanged.


PR492: API3109/141 skipped, web390/2 skipped, Android454; exact runtime tests и браузерный smoke в scripts/releases/cabinet-fbo-20261007. [Ограничения](cabinet-export-and-fbo-placement.md).


PR494: API3118/141 skipped, web391/2 skipped, runtime5, actual browser и PostgreSQL rollback; kiz-duplicate.integration требует отдельной тестовой БД.


## Подозрительные ШК приёмки (09.10.2026, не опубликовано)

[Поведение, влияние и ограничения](receipt-barcode-review.md).
API: `receipt-barcode-review.spec.ts`, `receipt-barcode-workflow.spec.ts`, `receipt-barcode-legacy.spec.ts`, `receipt-barcode-box-reuse.spec.ts`, `tsd-receipt-close.spec.ts`.
Web: `workspaces.admin-problems.spec.ts`, `test/receipt-barcode-browser.cjs` (mock HTTP, реальный headless Edge).
Android: `ReceiptBarcodeRescanTest`, `ReceiptCloseSyncTest`, LOGOFF и ФФУЛЛ-ХАБ.
Общий прогон: API 3204 passed / 141 skipped, web 408 passed / 2 skipped, Android по 238 passed в двух flavor. PostgreSQL integration не подтверждён: тестовая БД отсутствует; старый kiz-duplicate.integration.spec.ts исключён из повторного общего прогона из-за ошибки создания клиента без URL.
Receipt review: API `receipt-barcode-*.spec.ts`, `tsd-receipt-close.spec.ts`; scoped administrator FBO access `fbo-problems-admin-access.spec.ts`; actual runtime/browser tests `scripts/tests/receipt-*.cjs`. Live role checks run in a READ ONLY transaction (`releases/receipt-barcode-20261009/smoke-admin.cjs`).


## Агент Windows 2026.10.09.1

`apps/windows-print-agent/ack-regression.test.cjs`, `lifecycle.test.cjs`, `agent.test.cjs`, `print-series.test.cjs`: реальный PowerShell5, имитация HTTP/spooler, потеря ACK, перезапуск, mutex, сохранение ID и task settings. Запуск с AGENT_TEST_ROOT на распакованном архиве; AGENT_OLD_SOURCE воспроизводит старую ошибку. [Ограничения](print-agent-lifecycle.md).


PR604: personal login welcome correction published; see [details and tests](personal-login-welcome.md).


Published PR606 Eleonora account correction: legacy Elya ID differed from actual login. [Details and regression](eleonora-account-welcome.md).


Prepared 2026-10-24: request-removal-policy.spec.ts (11), client-request-removal.spec.ts (15), scripts/releases/request-removal-20261024/browser.cjs (8 compiled UI) and postgres.cjs (9 isolated DB). API3590/web476; TypeScript passed. See [scope and limitations](request-removal.md).

## Lamoda FBO imports (prepared2026-10-28)
- lamoda-fbo-import.spec.ts: ID safety, planned quantities, exact mappings/direction quotas. lamoda.service.spec.ts: assembly gate, request/binding, replay, unmapped rejection. lamoda-client.spec.ts: detail/items pagination and seller isolation. lamoda-wb-isolation.spec.ts: both WB exports blocked.
- fboRequestScope.spec.ts/FboTwoStagePanel.spec.tsx: Lamoda excluded from WB/exports. Android FboTwoStageScreenTest: Lamoda title/no WB export. Full logoff/ffullhab/platform suites passed.
- Synthetic DB constraint proof5: work/lamoda-contour/fbo-db-proof.json; not full runtime migration parity.

Lamoda FBO final candidate: follow-up TSD entry/filter regression reproduced before fix; API3810/155 skipped, web512/2, isolated-schema TypeScript, all3 Android flavors and APK235 build pass. Exact13-file API overlay; isolated runtime PostgreSQL17 scenarios + full Nest health; browser13. Prepared, not yet published. See lamoda-contour.md.

Lamoda PR711/712 final validation: API3810 passed/155 skipped (dedicated KIZ DB suite excluded), web512/2; TypeScript using separately generated Prisma client to avoid shared workspace artifacts; Android logoff/ffullhab/platform passed; PostgreSQL runtime migration parity and17 tests/full Nest health; candidate/public browser13; baseline guards. Public fixtures intercepted every API call. Physical end-to-end cycle awaits client shipment.
# В разработке: магазины одного плательщика

- API `test/client-stores.policy.spec.ts`: 7 тестов общего физического товара и принадлежности кабинетов.
- API `test/client-stores.service.spec.ts`: 9 тестов доступа, изоляции филиала, аудита, выключенного флага и разрешений SKU.
- Web `src/components/fbs/store-filter.spec.ts`: 4 теста фильтра по connectionId.
- API `request-store-context.spec.ts`: 4 теста источников ФБО/ФБС, смешанных магазинов, неизвестных подключений и области доступа.
- Web `ClientStoresSettings.spec.tsx`: 3 теста загрузки, отключения и разрешений общего SKU.
- Android `FboStoreContextTest`: 2 теста старого сервера и смешанных магазинов.
- Повторная проверка 30.10: API 4126 passed / 156 skipped (отдельный PostgreSQL-набор `kiz-duplicate.integration.spec.ts` исключён), Web 570 passed / 2 skipped; полные Android-наборы LOGOFF/FFULLHAB/PLATFORM прошли. TypeScript API/Web и diff check прошли.
- Полная проверка приёмки/ТСД/резервов и публикация ещё не выполнены.
  [Состояние реализации](client-store-separation.md).

Продолжение разделения магазинов: `client-store-receipt.spec.ts` — общий SKU, чужой магазин, старый скан, закрепление документа, выключенный флаг и отказ реального `receiveIntoBox` до изменения остатка. `client-stores.service.spec.ts` — дополнительно конкурентное редактирование разрешений SKU, аудит и чужой клиент. Android `ReceiptCloseBatchTest` проверяет неизменность магазина в очереди, `ReceiptProgressActivityTest` — восстановление с документом после перезапуска.

Выпуск магазинов: API4138/Web570/Android924; runtime.cjs — 12, postgres.cjs — 15 и полный Nest health, browser.cjs — 8 проверок кандидата; TypeScript и точный состав 17 API файлов подтверждены. Скрипты: scripts/releases/client-stores-20261030.
Обновление PR787: API4146/Web576/Android933, runtime12/PostgreSQL15/browser8. `bootstrap.cjs`: RED два createRoot, GREEN пять сценариев с единственным запуском; PUBLIC_URL проверяет опубликованные файлы без записи данных. Строгая приёмка остаётся выключенной.
Актуальная база PR791/792: API4149/Web578, Android933 без изменений; browser8 + bootstrap5 + sidebar9. Повторный полный прогон и TypeScript зелёные; API156/Web2 skipped, отдельный KIZ DB suite исключён без URL.
