# LOGOFF TSD: durable unfinished box receipts

Source fix: PR995, LOGOFF 251 (`0.1.251-receipt-draft`). Actual public channel is already 260; the compatible runtime candidate is **261**, not a downgrade to 251. See the release record below.

## Defect and behavior

Opening a box cleared `receiptCurrentItems` before the unsent scans reached the Room outbox. Reopening the same box or switching to another one could discard the receipt while the local duplicate cache still remembered its KIZs. Queue zero did not prove receipt completion.

Only the `logoff` flavor now persists each accepted box scan synchronously before showing success. Reopening retains the current list and retries the server-open request if its original response was lost; opening another box is blocked until the unfinished one is closed. After Activity/process recreation, opening the same box restores its scans, barcode-rescan evidence and local duplicate guard. Preferences are scoped by operator/device receipt key, client, receipt document and normalized box. Damaged drafts fail closed.

The close batch is persisted with its original operation keys before Room handoff. A restarted or retried handoff reuses those keys; Room's existing IGNORE insert retains terminal rows. The draft is removed only after its batch has entered the durable outbox. Network failure leaves the existing queue responsible for retry.

## Scope and sold-WMS impact

`MainActivity` and `ReceiptCloseBatch` are shared source files, but new UI/storage behavior is gated by `BuildConfig.FLAVOR == logoff`. Ffullhab/platform paths and their versions remain unchanged. New draft helpers are not invoked in those flavors. No API runtime, database schema, server configuration or sold deployment changed.

## Validation

The old-code Activity regression reproduced the incident: reopening a box dropped 99 unsent items to zero. Corrected code passes that regression. Ten new tests cover same-box reopen, other-box protection, real Activity recreation, restored duplicate checks, 99 persisted items, scope separation, original close/dependency keys, box normalization, isolated clearing, corrupt JSON and incomplete batches.

Full local suites: LOGOFF 321, Ffullhab 321, platform 321; zero failures/errors/skips. LOGOFF release assembly and lintVital passed. Physical worker-device scanner checks remain pending.

## Compatible runtime 261 release

The public update channel lives in `/var/www/wms-updates`, behind host nginx. Container downloads are stale (249), while the public package is 260, `0.1.260-receipt-voice`. An initial container-only publication attempt detected that mismatch and restored the original web image; it did not change the public APK channel. The API image was unchanged. Publishing the source-built 251 would downgrade Android and discard newer runtime features.

Production APK260 SHA256: `bb86b6a078e8760a412d54ef5e0c023e7ef85e26d4f45ba58223a3dc68446c87`. Actual production signing certificate SHA256: `70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da`. The stale container package has a different signing certificate and must not supply the release signing key.

`wms/scripts/releases/tsd-receipt-draft-261/build_runtime.py` pins APK260 and the reviewed PR995 auxiliary APK, compiles the adapter, preserves all original method bodies under private wrapper names, adds the reviewed draft store and batch-restore method, and changes only five receipt hook points plus version metadata. It fails closed on unexpected classes, method changes, item fields, package versions, manifest structure or signing certificate. All other APK resources are byte-identical. Voice prompts, server selection, scan timestamps and caption snapshots from 260 are retained; map-valued caption snapshots are serialized and restored. `sourceParityVerified=false`: this is a method overlay over the actual runtime, not a claim that Git builds all production features.

The reproducible candidate has SHA256 `8c45ee36187dc3b6f5e29e5a0e713cb4f3baa6ed28db9d6e00463e07f2b0b17a`, size 5997593. `runtime-proof.json` records the exact changed/added classes and binary guards. Signing credentials remain outside Git.

Android35 instrumentation used a disposable emulator, fake credentials and inert network executors. On the actual signed 260 APK the test fails: 99 scans become zero on reopening. On signed 261 both tests pass: same-box reopening retains 99; after process force-stop the same 99 scans, duplicate guard and 100 original operation keys reload. Switching boxes is blocked. Room insertion of the restored batch twice retains the same keys, and the draft is removed only after durable insertion. Upgrade from the original 260 succeeds using the production certificate. The three Python release-guard tests pass; all 963 source tests and release assembly pass.

`publish.py RELEASE_DIR` performs read-only preflight. Adding `--publish` updates only the main APK alias, versioned archive and metadata, under all three release locks. It verifies public downloads/hashes, unchanged server-choice feed and unchanged API/web container IDs/images; on error it restores nginx and metadata. Old 260 remains available for operator-assisted rollback. Publication status is recorded separately in `published.json`; candidate validation alone is not publication.

## Whole Eletskaya receipt reconciliation

Konstantin confirmed expected total 2598, including МШБК8 = 398 and МШБК4 = 300. WMS has 2594: МШБК8 = 397 (short 1; box17 is the first search candidate), МШБК4 = 297 (short 3; box25 is the first search candidate). Those locations are approximate, not a physical determination. All 2594 unique KIZ identities that reached the receipt-check logs are already registered. The 2598 HTTP requests include repeated identities and one retried request; they do not establish four additional pieces. No inventory quantities were increased without identifiable KIZs.

## Eletskaya recovery on 2026-11-10

The original TSD version did not persist the lost drafts. Recovery therefore used surviving nginx `check-kiz` request records, receipt-open timelines, the local-duplicate review record, existing registry/mark claims, and standard receipt API duplicate guards.

* `FFL_ELE0811_06`: 99 unique candidate KIZ identities between the first and repeated opening, all one product. One identity was already accepted in the target box. The other 98 were restored through standard receipt API calls with deterministic recovery keys. Result: 99 units / 99 unique marks. Original mark retained; other client balances were identical before/after. Recovery audit `f9a06629-980b-4390-8948-4dcdfc0157d2`.
* `FFL_ELE0811_10`: Gulruh opened the box, then opened box 20 without sending a close for box 10. Of the unclaimed checks in the time window, 51 belong to its product and include the KIZ in its local-duplicate case. Konstantin confirmed 51 units. All 51 were restored via standard receipt API with deterministic keys. Standard TSD close correctly rejected the administrative recovery device because it differs from the original opening device. After verifying all 51 accepted recovery operations, 51 unique marks, target client/warehouse/SKU and quantity under the box lock, an owner-scoped administrative correction completed the receipt. No original TSD closure was fabricated. Result: 51 units / 51 unique marks, active. Audit `071347b5-41cd-414e-93c1-236e38169766`.

Recovery comments/audits identify the original worker and check-request time separately from the actual recovery time/administrator. Raw KIZs, signed tokens and private logs are outside the repository. This evidence identifies submitted KIZ checks; it does not independently establish the physical contents of either box. Existing local-duplicate review cases were not turned into physical-check approvals.
