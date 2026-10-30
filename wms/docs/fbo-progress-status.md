# Automatic FBO progress

PR775: fix/fbo-progress-release into feature/wb-print-check. Verified on published PR776, pending production deployment.

Physical picking restores IN_WORK. Exact per-item completion moves PICKING to PACKING. Packed units count as picked, RETURNED units do not. Excess for one SKU cannot cover another shortage. Older terminals may repeat FINISH_PICK after the automatic transition.

WB/Ozon/Lamoda lists display packed-pending-control separately from ClientRequest.status. The frozen pickClosure target is respected. PACKED permissions still require normal carton control; handover is not automatic. Terminal/cancelled requests are not reopened.

Reconciliation runs within the scan transaction and request lock, alongside idempotency and audit. Retry only confirmed transaction aborts: P2034 or P2010 SQLSTATE40001/40P01, maximum two retries. Timeouts/unknown outcomes do not retry. Settled packing does not reload all units to reconcile status. Read-only labels use grouped queries scoped to authorized page IDs.

WMS_FBO_PROGRESS_STATUS_ENABLED defaults off; enabled only in our image. Sold WMS, APK245, schema, stock quantities and shipment permissions remain unchanged. Exact overlay:5 API files,3 status renderer modules and index.html. Baseline2026-10-30-ozon-import-stock, sourceParityVerified=false; never publish full local dist.

Validation: API4090 passed/151 skipped, web562 passed/2 skipped, API/web TypeScript, helper18, actual service12, disposable PostgreSQL9 with concurrent transactions/rollback, full isolated Nest health, browser11 against actual module graph with synthetic APIs, baseline8. Dedicated kiz*.integration.spec.ts excluded without a dedicated database. RED failures reproduced unnecessary packing reads and unhandled PostgreSQL P2010/40001.

Release script checks current images, exact file hashes, merged PR, test proofs, health, retained environment and other containers; saves rollback images and rolls back on failure. No real stock writes during tests.

Request2494 repair: scripts/fbo_progress_reconcile_2494.cjs defaults to dry-run. --apply changes only stale progress when exact full picking is proven, never stock movements. System audit userId=null does not impersonate an employee.
