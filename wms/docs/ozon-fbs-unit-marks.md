# Ozon FBS: per-unit marking and administrative packing recovery

Prepared, not published. Branch: `fix/ozon-multiline-kiz`.

The existing assembly has one scalar KIZ although an Ozon posting may contain
different products. The own-installation flag `WMS_OZON_UNIT_MARKS_ENABLED`
adds versioned unit marks in `OzonFbsPickState`; legacy and sold installations
retain scalar behavior with the flag disabled.

Each unit retains its product, physical SKU, request item, full KIZ, source,
actor and recording time. Guard queries, shipment validation and shipment
history expand these units without substituting the first SKU. The original
task identity is retained for KIZ claims; shipment history uses stable unit IDs.

Administrative recovery is currently an internal service function, not a UI
endpoint. It checks current Ozon composition, client/warehouse access, stock,
other reservations and existing operations in a serializable transaction.
It repairs request quantities, records marks and packing, and records the
actual recovery actor/time. PACKED mode does not debit stock. SHIPPED mode requires DONE and Ozon delivering/delivered, debits each unit once and preserves the confirmed status/timestamp. Neither mode submits to Ozon. Retries are idempotent; partial failure rolls back all units.
Ordinary marked multi-product TSD picking is not enabled by this change.

## Verification

- API: 4,793 tests passed, 9 skipped; integration files excluded from that run.
- Dedicated PostgreSQL: 4 integration tests passed with real guards and
  reservations, including rollback on second-unit failure, idempotent recovery,
  unchanged stock and no shipment history before handover.
- The successful integration also validates both KIZs at handover, captures two
  shipment records once and finishes both claims; a repeated capture adds none.
- Eight focused transaction tests passed after correcting the request-item
  relation used to detect existing box selections.

- Web: 640 tests passed, 2 skipped.
- The same 4 PostgreSQL integration tests also passed against the compiled
  server candidate, including SHIPPED debits, preserved DONE timestamp,
  idempotent retry and full rollback after a second movement fails.
- Runtime baseline comparison passed: only five intended API modules differ;
  unrelated deployed modules are preserved.

## Recovery precondition changed

Read-only recheck of request 2964 on 2026-11-13 found that marketplace status
reconciliation had already changed it from SUBMITTED to DONE at 16:19 MSK,
based on Ozon delivering. No request stock movement or per-unit state was
found. The packing-only recovery correctly rejects this terminal request.
The owner authorized restoring shipped units and KIZs. SHIPPED mode preserves DONE. Production recovery has not yet been applied.

No production data, flags or deployed modules have been changed by this work.
Before publishing, compare against the then-current runtime and preserve its
unrelated changes; source/runtime parity is not assumed.

## Release checks

The merged PR1010–1011 baseline passed 4,793 API tests (9 skipped).
The five-module image passed compiled reader checks and a live read-only preview.
A live recovery rehearsal wrote both units inside one serializable transaction,
verified two debits and two shipping marks with unchanged DONE time, then
forcibly rolled back and verified the original request, marks and balances.
The guarded release script preserves every other runtime module/environment
value and container; production apply remains a separate authorized operation.
