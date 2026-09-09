# Admin sorting: confirmed empty sources and orphan KIZ

Date: 2026-09-09. Checkout: sorting-free-source-auto-kiz-20260908/wms.
Branch: fix/sorting-admin-empty-and-orphan-kiz.
Proposed PR base: fix/sorting-recorded-source-20260908 (remote a78647fe88f24cf0e48c2c70bfc925c1ba70e9ef).

## Scope and impact

Only the opt-in `WMS_PALLET_SORTING_ENABLED` ADMIN service in WMSFF2207 changes. No FFULHAB, sold-instance configuration, APK, API keys, marketplace statuses or shipment-history changes.

- `apps/api/src/modules/inventory/pallet-sorting.service.ts`: `previewInTx`, `archiveSources`, `recoverWrittenOffUnit`.
  Positive non-AVAILABLE balances are included in explicit shortage consent; ordinary empty boxes archive/detach. Permanent boxes remain active. Negative/corrupt balances still require recount. Missing active marks become BLOCKED; SHIPPING history remains unchanged.
  Recovered accounting sources use existing sorting/inventory locks and logical route invalidation. Already picked/return-required tasks are not treated as free stock.
- `apps/api/src/modules/stock/sorting-written-off-recovery.ts`: `restoreWrittenOffSortingUnit`.
  Orphan BLOCKED marks can use their exact historical movement FK regardless of repair document name, including old receipt-linked physical snapshots. ADMIN gets the existing fingerprint-bound physical-confirmation dialog. When an unmarked AVAILABLE unit exists in the accounting source, use paired MOVE (-1/+1), not an additional receipt. Otherwise confirmed restoration is +1. CAS, source ownership, exact-KIZ order/shipment/print evidence and identity uniqueness remain enforced.
- `apps/api/src/modules/stock/stock-operations.service.ts`: wrapper passes the internal source-validation callback.
- Tests: `pallet-sorting-permanent-boxes.spec.ts`, `pallet-sorting-session.spec.ts`, `sorting-written-off-recovery.spec.ts`, `sorting-written-off-postgres.cjs`.
- `apps/api/src/scripts/repair-sorting-empty-three-20260909.sql`: one-time, guarded, fingerprint-equivalent quantity/timestamp validation, snapshot audit and idempotency for the three user-confirmed empty boxes. Not an automatic migration.

## RED before implementation

16:06 MSK: targeted API suite, 8 failed / 43 passed. PACKING box remained active (preview quantity 2 instead of 4); orphan correction returned a plain refusal rather than `SORTING_WRITEOFF_CONFIRM_REQUIRED`.

16:23 MSK: additional real repair variant reproduced separately: original RECEIPT FK instead of negative adjustment FK, 1 failed / 43 passed before its fix.

16:31 MSK: legacy retained source in an unfinished session reproduced (preview excluded PACKING). Added re-preview and locking, cleared stale retained flags after successful correction.

## GREEN

- API complete suite: 157 files, **1571 tests passed** (16:31 MSK final run).
- Web complete suite: 18 files, **62 tests passed** (16:28 MSK).
- API lint/type-check and build: `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.json`, exit 0.
- Web lint/type-check and build: `tsc --noEmit`, `tsc`, `vite build`, exit 0. Existing asset-resolution and large-chunk warnings remain; web source was not modified. Android source/APK were not modified or rebuilt.
- V8 inspector precise block coverage of `restoreWrittenOffSortingUnit`: **99/104 blocks, 95.19%**. This is function block coverage, not repository line coverage.
- Real PostgreSQL synthetic test, isolated internal Docker network, no production records or WB calls: PASS. Includes confirmations, exact replay, concurrent retry, transaction rollback after debit, orphan transfer without total growth, receipt-linked orphan recovery, PACKING source archival and unchanged SHIPPING mark.
- First isolated fixture run failed on missing `balanceKey` in test seed only; corrected fixture, fresh test database, reran successfully. No production table was used for synthetic tests.

## Production data correction (not application publication)

User explicitly confirmed all three ordinary sources physically empty:

| Box | Previous PACKING | Final quantity | Pallet placement |
|---|---:|---:|---|
| FFL_LKB1807_256 | 1 | 0 | removed, archived |
| FFL_LKB2107_246 | 2 | 0 | removed, archived |
| FFL_LKB2107_44 | 7 | 0 | removed, archived |

Client c76b78f9-1b83-4e9b-bee3-bc28336ee1c9; warehouse afb244a1-50ae-4ae6-9111-afe85949fa58; completed sorting 90d53b46-bbbf-4189-a180-8765d0093c3a.

Dry-run rolled back first. Found and explicitly preserved historical selection in request 469 / RETURN_REQUIRED order 5621053309; unrelated new selections remain blocking. Source-level correction does not claim goods were physically returned or shipped.

Backup: `/opt/logoff-wms-backups/sorting-empty-three-20260909/wms.dump`, 410651850 bytes, pg_restore TOC verified and SHA256 checked before apply. Audit `sorting-confirmed-empty-three-20260909` contains complete before snapshots. Technical executor recorded; no impersonation of a WMS account.

Applied serializable SQL, then replay returned ALREADY_APPLIED. Independent read-only verification: three archived boxes, zero placements, zero balances; 4 correction movements totaling -10 PACKING; **0 changed assembly-history rows, 0 changed SHIPPING marks**. No AVAILABLE credit. Corrections can be investigated/reversed from snapshot history; do not restore the whole production dump over newer work.

## Release boundary

Application changes are local, not published in this task. Production API remains image 21bfb19ce668aa68575c34bf6a43d139af1cdfe80cf344698526805ddfdf9f82. Publish only through an approved PR and a tested overlay against live source; do not replace production from the stale server checkout. Existing TSD physical-consent response contract is unchanged.

The exact KIZ in the new photograph is not reliably readable; a text scan was requested. Multiple orphan identities match barcode 2051754300715. No speculative mutation of any of those individual KIZs was performed.

This is not a blanket bypass of all admin validation: cross-client/warehouse identity changes, actual exact-KIZ shipment/order evidence, conflicting recounts, and duplicated marks still need their dedicated reconciliation/return workflow. Ordinary transfers outside pallet sorting were not modified.
