# Atomic FBO video captions — prepared, not deployed

The camera archive needs product, article, barcode/KIZ, operator, box and packed/target quantities at the accepted operation. Fast ACK can omit its packing plan, including Ozon and PACK_PRODUCT. Today's catalog cannot reconstruct historical evidence.

## Scope and transaction

`WMS_CONTOUR_FBO_CAPTIONS_ENABLED=true` opts **our WMS only** into `AuditLog.payload.contourScan`. Default off means no extra database reads or audit fields. No new table, endpoint or TSD build. Sold WMS configuration stays off.

The existing `executeAction` locks the request and writes stock, operation receipt and audit in one Serializable transaction. The hook follows the accepted unit mutation and precedes the existing audit. It covers PACK_PRODUCT, PACK_UNIT, both manualPack paths, and PACK_BOX. The unit comes from the actual update/create result, never a barcode guess or the next product in a plan. ManualPack returns that unit after its existing request/partial-pick closure updates.

The helper refreshes request lines/SKU article, reads the recorded pick closure, and counts packed units in the same transaction. `packed_count` means the request's packed unit count after this action; `total_count` is its current physical target (validated partial-pick closure when present). Zero is valid; unknown metadata remains null and unresolved. Actor and device come exclusively from authenticated AuthUser. Missing device code skips caption creation. Selected unit request, packed state and packedByUserId are checked. KIZ retains ASCII GS, including trailing GS; ordinary text follows the portal's control-character removal. PACK_BOX is an explicit “Упаковка короба” summary with empty product codes.

Rejected actions and replays create no new caption. Snapshot read or audit failure aborts the enclosing transaction: a newly committed enabled action cannot lose its audit evidence. **Enabling adds a failure dependency on three small reads.** Disable the flag to remove that dependency. The helper never repeats a committed business operation or loads the full plan.

## Contract

`schemaVersion:1`, `source_id:fbo:<requestId>:<operationId>`, `occurred_at` UNIX seconds from packedAt (whole-box acceptance time), `kind:assembly`, `status:accepted|unresolved`. Strings: barcode256, KIZ1024, product_name500, actor_name200, product_sku200, box_number200, order_ref200, device_code100, source_id200. Counts are integers0..1e9 or null. Unknown names are explicit “Товар не определён по журналу” / “Сотрудник не определён по журналу”.

Evidence contains request_id, operation_id, action, actor_id, nullable device_id, device_code, nullable unit_id/sku_id/request_item_id. The bridge verifies evidence and forwards only the event field allowlist. Direct atomic AuditLog and best-effort TsdOperation share the same dedup source ID. Canonical audit proof also accompanies a TSD row if its transaction timestamp fell behind the cursor. Historical rows without a snapshot are not rewritten from the mutable catalog.

## Source/runtime provenance

Branch `feature/fbo-video-caption-snapshot` starts at PR765 merge `ab4c8550a567d0fe02ef9b33f1b07a5e4c745743` from `publish` (`Maxhead2011/wmsFF`). Proposed PR target is the actual integration branch `feature/wb-print-check`, pending confirmation. Nothing pushed/deployed.

**Source parity is false.** Current captured production image: `sha256:5c9b375d8ccbad42664bfe34dbfd909bbb5f35c6a367ce9b797265c0f664ce70` (`logoff-api:fbs-request-scope-20261029`); FBO service SHA256 `619439abded8c265324fc5a3412dbb27699797754b507684e648b0fe89f298fb`. Source TS lacks some ACK/manual extensions. Its hook is a source reference for reconciliation, never a full runtime replacement.

`scripts/releases/fbo-video-caption-20261029/patch.py` verifies all687 baseline file hashes and image, rejects mismatched anchors/existing output, transpiles only the new helper, and inserts exact hooks into the captured service. Candidate changes exactly2 modules (existing service + new helper); other686 files remain byte-identical. It emits payload/ and proof.json without deploying.

```powershell
python scripts/releases/fbo-video-caption-20261029/patch.py --baseline work/contour-caption-baseline --output work/contour-caption-candidate-v2 --node <node.exe>
$env:WMS_CAPTION_RUNTIME_DIR = (Resolve-Path work/contour-caption-candidate-v2/dist).Path
node --test scripts/releases/fbo-video-caption-20261029/runtime.test.cjs
```

Before future release verify live image and complete inventory again. If changed, capture/review/retest a fresh overlay. Never force an old patch or rebuild stale source dist. Pin the baseline in the release Dockerfile and copy only approved payload after PR/release approval.

## Audit polling index and rollback

Read-only probe: AuditLog about506k rows /476.7MB; recent-window lookup scanned ~234MB buffers in ~68ms even with no matches. Before enabling5-second audit polling apply own-WMS-only `audit-index.sql` after approval. It creates `(createdAt,id)` with CREATE INDEX CONCURRENTLY outside a transaction. Existing same-name index must be valid, ready, nonpartial and exactly defined; otherwise stop for review without automatic drop. Verify pg_indexes/pg_index and retain actual exporter EXPLAIN (ANALYZE,BUFFERS) afterward. Canonical operation lookup already has an entity/action/time index.

Rollback disables the caption flag and bridge audit polling and may restore the exact previous image. Keep the additive index and historical snapshots; no deletion or reverse schema migration.

## Verification

11 helper tests passed after a reproduced regression, including exact-unit/authenticated attribution, refreshed manual closure, zero/unknown counts, absent SKU/name, control characters and terminal KIZ GS. Actual captured baseline ACK service failed the caption assertion. Ten tests against the candidate's actual service pass: four actions, manual create/expanded closure, manual fallback, flag off, rejected action, replay, atomic audit failure rollback. Database/stock boundaries are mocked, not production service/manualPack; this is not a live database transaction test.

Full API: **4029 passed / 158 skipped**, 393 files passed / 13 skipped, with no file exclusions (`work/caption-api-vitest-final.log`). Full web: **555 passed / 2 skipped** (`work/caption-web-vitest-final.log`). API and web `tsc --noEmit` pass; release baseline guards **8/8** pass; runtime syntax and `git diff --check` pass. Runtime test mocks are explicitly separate from the skipped PostgreSQL integrations. No production scan was manufactured.

The unchanged optional `kiz-duplicate.integration.spec.ts` constructs Prisma even inside its skipped suite. With an undefined URL, collection fails before skip. Run it with `process.env.KIZ_DUPLICATE_TEST_DATABASE_URL=''` via Node so its existing skip works; no test was changed or excluded, and no database connection occurs. Other optional dedicated test DSNs remain unset; DATABASE_URL/ANALYTICS_DATABASE_URL are safe dummy `postgresql://codex_tests@127.0.0.1:1/unavailable` values. No production changes have been made.
