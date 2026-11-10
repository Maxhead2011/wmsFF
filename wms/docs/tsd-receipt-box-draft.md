# LOGOFF TSD: durable unfinished box receipts

Prepared LOGOFF 251 (`0.1.251-receipt-draft`); not published or installed yet.

## Defect and behavior

Opening a box cleared `receiptCurrentItems` before the unsent scans reached the Room outbox. Reopening the same box or switching to another one could discard the receipt while the local duplicate cache still remembered its KIZs. Queue zero did not prove receipt completion.

Only the `logoff` flavor now persists each accepted box scan synchronously before showing success. Reopening retains the current list; opening another box is blocked until the unfinished one is closed. After Activity/process recreation, opening the same box restores its scans, barcode-rescan evidence and local duplicate guard. Preferences are scoped by operator/device receipt key, client, receipt document and normalized box. Damaged drafts fail closed.

The close batch is persisted with its original operation keys before Room handoff. A restarted or retried handoff reuses those keys; Room's existing IGNORE insert retains terminal rows. The draft is removed only after its batch has entered the durable outbox. Network failure leaves the existing queue responsible for retry.

## Scope and sold-WMS impact

`MainActivity` and `ReceiptCloseBatch` are shared source files, but new UI/storage behavior is gated by `BuildConfig.FLAVOR == logoff`. Ffullhab/platform paths and their versions remain unchanged. New draft helpers are not invoked in those flavors. No API runtime, database schema, server configuration or sold deployment changed.

## Validation

The old-code Activity regression reproduced the incident: reopening a box dropped 99 unsent items to zero. Corrected code passes that regression. Ten new tests cover same-box reopen, other-box protection, real Activity recreation, restored duplicate checks, 99 persisted items, scope separation, original close/dependency keys, box normalization, isolated clearing, corrupt JSON and incomplete batches.

Full local suites: LOGOFF 321, Ffullhab 321, platform 321; zero failures/errors/skips. LOGOFF release assembly and lintVital passed. Candidate APK is unsigned; production signing and publication require the normal PR/release flow. Device upgrade and physical scanner checks remain pending.

## Eletskaya recovery on 2026-11-10

The original TSD version did not persist the lost drafts. Recovery therefore used surviving nginx `check-kiz` request records, receipt-open timelines, the local-duplicate review record, existing registry/mark claims, and standard receipt API duplicate guards.

* `FFL_ELE0811_06`: 99 unique candidate KIZ identities between the first and repeated opening, all one product. One identity was already accepted in the target box. The other 98 were restored through standard receipt API calls with deterministic recovery keys. Result: 99 units / 99 unique marks. Original mark retained; other client balances were identical before/after. Recovery audit `f9a06629-980b-4390-8948-4dcdfc0157d2`.
* `FFL_ELE0811_10`: Gulruh opened the box, then opened box 20 without sending a close for box 10. Of the unclaimed checks in the time window, 51 belong to its product and include the KIZ in its local-duplicate case. Konstantin confirmed 51 units. All 51 were restored via standard receipt API with deterministic keys. Standard TSD close correctly rejected the administrative recovery device because it differs from the original opening device. After verifying all 51 accepted recovery operations, 51 unique marks, target client/warehouse/SKU and quantity under the box lock, an owner-scoped administrative correction completed the receipt. No original TSD closure was fabricated. Result: 51 units / 51 unique marks, active. Audit `071347b5-41cd-414e-93c1-236e38169766`.

Recovery comments/audits identify the original worker and check-request time separately from the actual recovery time/administrator. Raw KIZs, signed tokens and private logs are outside the repository. This evidence identifies submitted KIZ checks; it does not independently establish the physical contents of either box. Existing local-duplicate review cases were not turned into physical-check approvals.
