# FBO completion reliability

Published 2026-10-31 via PR807 into feature/wb-print-check. Public health and API/web hashes verified; other containers and environment file unchanged. Baseline: 2026-10-31-fbo-completion-reliability.

## Impact

- `apps/api/src/modules/tsd/fbo-completion-batch.ts`: validateFboPackedBoxes batches exact box, balance and mark checks under deterministic box locks in the existing transaction. fboCompletionPackages aggregates packed units once; saveFboCompletionSelections uses createMany. fboCompletionError and installFboRecoveryReliability preserve business errors and explain uncertain technical outcomes.
- `fbo-two-stage.service.ts`: FINISH opts into these helpers only with WMS_FBO_COMPLETION_RELIABILITY_ENABLED=true. Existing transaction, idempotency, KIZ guard and document generation remain.
- `AdministrationFboProblems.tsx`, `fboRecoveryResult.ts`: busy state, check-result action, preserve preview token until acknowledgement; failed refresh after acknowledgement is not reported as failed mutation. Token survives retries within the screen, not a page reload.
- fbo_completion_stage logs box_validation, kiz_validation, selections, stock_and_packages, recovery_apply. The last includes inner stages: do not add durations. No KIZ or personal data in new logs.

Sold WMS is not deployed or reconfigured. API flag defaults off. Schema, APK, physical stock and request status are not changed by testing.

## Tests and limits

API4217/web586 passed (151/2 skipped); API/web TypeScript. New11 API/4 web tests. PostgreSQL10/full Nest health against actual candidate:1710 units,159 boxes, complete FINISH, safe repeat, both WB exports.159 boxes require four validation queries and one createMany for selections.

Actual-artifact browser6 with mocked API: lost acknowledgement, identical retry token, refresh failure after commit, completed state. Legacy RED reproduces missing busy indication. No production mutation used for testing.

Synthetic completion15.769s: box60ms, KIZ13762ms, selections30ms, stock_and_packages1553ms. This does not establish a material end-to-end speedup versus prior16s. Batch checks remove per-box query growth; reliable result handling addresses connection failures. KIZ verification remains mandatory; absence of all future timeouts is not guaranteed.

## Release

sourceParityVerified=false: prepare.cjs creates exact PR805 runtime overlays, never full local dist. API3: new helper, TSD service, runtime-owned administration apply seam. Web2: index import map and replacement child chunk. All other deployed modules retained.

release.py checks pinned live images, exact hashes, merged PR, tests, isolated image proof, environment and other containers. Own-image flag only. Rollback tags: logoff-api:before-fbo-completion-reliability-20261031 and corresponding web tag. For uncertain operation outcome check the request before retrying; never force another stock write.
