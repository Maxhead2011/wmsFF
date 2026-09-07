# Permanent boxes: approved live-code adaptation, 2026-09-06

Konstantin explicitly authorized resolving the two known function conflicts, preserving our live safeguards, testing and publishing to wms.logoff.pro. Sold FFULHAB is out of scope. No stock corrections or mass unarchiving are part of this release; the LKNOV039 correction is already completed separately.

## Scope and implementation

PR56 remains the source of the feature. Its 12 API source files and web changes are applied on a copy of the running images, not by replacing the whole application with older Git sources.

`infra/scripts/permanent-return-live-adapter.cjs` is restricted by SHA256 to two reviewed live functions and the matching PR56 versions in `marketplace-connections.service.ts`. `reserveCompletedWildberriesStock` keeps unconditional deferred-source protection, detached KIZ, boxless PACKING and cleanup of disposable boxes. `returnCompletedWildberriesStockReservation` keeps boxless fallback; a scanned receipt selects its actual destination. The other nine hunks touching these functions are excluded from the ordinary patch; all other hunks must pass git apply --check. Any unreviewed function change aborts. Default-off behavior of source Git/sold deployment is unchanged.

Test-only profile `WMS_TEST_OUR_LIVE_BASELINE=true` describes these pre-existing live differences in three lifecycle/reservation specs. It is passed only to isolated test containers; it is not an application setting. No tests are disabled.

Infrastructure files: `infra/permanent-return.Dockerfile`, `infra/scripts/permanent-return-{candidates,backup,publish}.sh`, `permanent-return-{artifacts,readcheck}.cjs`. Risk: deployment/stock lifecycle high; guarded by immutable base image checks, source and compiled allowlists, backups, auth/health checks and application-only rollback. Web runtime compilation excludes .spec.tsx because runtime has no web Vitest; complete local web tests and typecheck still include it.

## Evidence

- Adapter RED: 3 executed tests, 2 failures on missing adaptation; GREEN 3/3.
- Local API full suite: 1156/1156; web 53/53. API/web typecheck and builds passed.
- Real candidate first run: 264/266; remaining two asserted sold-default behavior rather than our already-deployed behavior. Explicit test profile now preserves both baselines; rerun 266/266 plus full reservation spec 5/5 (no skipped tests).
- Runtime source AND compiled JS manifests: exactly the 12 reviewed API files changed, no unrelated changes.
- Readonly candidate connected to production: feature enabled, FFL_LKBBOX recognized, ordinary box not permanent, existing archived permanent box not eligible for automatic detach, picked cancellation requires receipt. PASS. No actual receipt/transfer executed.
- Browser QA: existing local synthetic form harness passed keyboard flow, duplicate-submit guard, errors/retry, busy/reset/Escape and 375/768/1440 bounds. Visual pixel regression INCONCLUSIVE (no baseline); CWV/axe/screen-reader not measured.
- Private pg_dump created and pg_restore --list validated. No backup data or credentials committed.
- No coverage percentage measured (coverage provider absent); no claim of measured 80% coverage.

Commands: direct installed Vitest, TypeScript tsc --noEmit/tsc, Vite build and `node e2e/fbs-return-receipt.mjs`; runtime commands are recorded in candidates/readcheck scripts. Dependencies were not installed/modified.

## Publication and limits

Review stack: this branch -> fix/lknov039-confirmed-empty -> fix/fbs-picked-return-receipt -> fix/fbs-box-scan-route-consistency. No protected branch pushes.

The publication script verifies old image IDs, code/config manifests and backup integrity, switches only API/web, checks private/public health and authorization, then records publication timestamp. Failure rolls application images back without restoring the database over ongoing warehouse work.

Permanent storage covers configured storage prefixes (currently FFL_BOX_ and FFL_LKBBOX). This does not mass-restore already archived boxes or infer unconfigured legacy prefixes. Re-receipt is the PR56 single-item WB path before DONE, not universal Ozon/post-shipment returns. Android APK unchanged.

This document records preparation. Actual publication result and deployed image IDs will be recorded in the PR after the switch.
