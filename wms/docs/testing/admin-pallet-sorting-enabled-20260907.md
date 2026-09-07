# Enable admin sorting and versioned LOGOFF APK

Konstantin explicitly requested enabling sorting and updating TSD, with sold WMS excluded. Branch: `fix/sorting-enable-tsd-20260907`, PR target `fix/fbs-box-scan-route-consistency`. No direct release-branch push.

## Scope

- `apps/android-tsd/app/build.gradle.kts`: LOGOFF versionCode 159, versionName `0.1.160-pallet-sorting`; default and ffullhab flavor unchanged. No Java behavior edits.
- `infra/pallet-sorting-enable.Dockerfile`: existing API image with only the sorting flag set true; existing web sources rebuilt with the Vite flag true. Versioned APK added; global APK/metadata retained pending choice of rollout scope.
- `infra/scripts/pallet-sorting-enable-release.sh`, `pallet-sorting-enable-verify.cjs`, `pallet-sorting-enable.test.cjs`: guarded build/backup/cutover/rollback, exact artifact/configuration validation and regression tests.
- This report. High operational risk of enabling movement/write-off paths mitigated by existing ADMIN and branch authorization, transaction/confirmation checks, backup and application-only rollback. No inventory correction is run by deployment.

## Tests and artifacts

- Version regression RED: expected 159, existing 158 rejected; GREEN after LOGOFF-only version change. Enable/artifact suite: 7/7.
- Local full API: 1329/1329, 150 files; TypeScript noEmit check passed.
- Full runtime verification with sorting enabled: 1322/1322, 149 files, same explicit live-baseline test profile as previous stage. API source and compiled files byte-identical before/after enabling; runtime configuration differs only by the sorting flag.
- Web 56/56; TypeScript and Vite production build passed. Android LOGOFF and ffullhab unit suites: each 50 tests, zero failures/errors. Signed LOGOFF release build and lintVital passed; ffullhab was tested locally only, not published.
- Existing extended `apps/api/test/pallet-sorting-postgres.cjs` was already dirty on entry and is preserved without edits or inclusion in this PR. Executed copy SHA256 `93133d4ca1115e3d399c16b0b918b318d4feda0b6d0e393658575ef268661a18` passed actual SQL rollback, retries/concurrency, AUTO and ordinary FBS routes, protected physical picks and stock conservation. Source copy and logs retained on the release host; no production rows used.
- Load scenario: 250 source boxes, 5000 units, 20 moves; 4980 shortage units require separate confirmation. Max measured action/completion: 1842 ms, under the test's 24000 ms threshold. This is one synthetic load scenario, not unlimited-capacity certification.
- APK applicationId `pro.logoff.wms.tsd`, minSdk 24, versionCode 159. SHA256 `83497bfba3c025ac3be813ede3329c36da8154883fb1bacaffb2287ff20d30f8`.
- Old and new APK certificate SHA256 match: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`. Existing version 158 downloaded and checksum confirmed. Update in place; never uninstall to update.

## Publication constraints

Only our API/web images are replaced. A fresh custom-format dump and configuration snapshots are retained at `/opt/logoff-wms-backups/admin-sorting-enable-20260907`; archive listing/checksum verified. Full restore of the preceding backup was tested during staged publication; this newer dump is not claimed independently restored. No migrations in this enable step. Prior disabled images remain tagged for rollback; no database restore over ongoing work.

No USB/ADB device is connected. The versioned APK can be published, but actual installation and physical scanner operation cannot be claimed. The global update channel remains version158 until rollout scope is chosen. Browser reaches the login form; authenticated production UI inspection requires an administrator session. API policy allows ADMIN only when enabled and refuses CLIENT, and unauthenticated HTTP requests must still return401.

Deployment outcome and final image IDs will be recorded in the PR comment after public checks. This report itself does not assert that cutover already happened.
