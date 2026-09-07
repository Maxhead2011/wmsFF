# Admin sorting: staged publication, 2026-09-07

Konstantin authorized publication. This stage deploys our API/web with the new sorting regime disabled. It does not enable mass write-offs, modify stock, update TSD devices or change the APK channel. Sold FFULHAB remains outside scope.

## Files and risk

- `infra/scripts/pallet-sorting-staged-release.sh`: backup, isolated restore/migration, startup/rollback checks and guarded application cutover. High operational risk, constrained to exact our-WMS image IDs and two application services. Release locks, config/manifests and merged PR63 are mandatory. No checkout replacement, `db push`, bulk migrations, Docker pruning or production database restore.
- `infra/scripts/pallet-sorting-artifacts.cjs`: source/compiled allowlist, immutable existing web assets/downloads, exact runtime config except the explicitly disabled sorting flag.
- `infra/scripts/pallet-sorting-artifacts.test.cjs`: 14 tests, including prevention of TSD history regression, download-channel replacement, removed old bundles and altered runtime safeguards.
- This report. No additional application business functions changed.

## Regression discovered before cutover

The first web candidate was based on `permanent-return-20260906`. The current interface additionally contains `tsd-admin-recount-20260907` changes in `TsdOperationHistoryPanel.tsx`, `tsdOperationHistory.ts` and its test. The initial suspicion of terminal-queue changes was corrected after comparing actual source manifests.

RED: the artifact verifier rejected the first candidate with `unapproved change: components/tsd/tsdOperationHistory.ts`. The three files were retained byte-for-byte from the current release source. GREEN: exact six reviewed web source changes only; eight API source and eight compiled files only. Existing APKs, manifests and lazy-loaded assets are identical. Runtime config differs only by `WMS_PALLET_SORTING_ENABLED=false`.

## Verification

- Local full API: 1329/1329, 150 files, no skipped; web 56/56, 15 files.
- Final immutable API verification image: previous completed run 1322/1322, 149 files. Application source and image unchanged in this stage.
- Artifact tests: 14/14. Staging adapter unit tests: 12/12. `bash -n` and Git whitespace checks passed.
- Refreshed web: TypeScript and Vite production build passed, new mode remains disabled.
- Fresh private custom-format database dump plus API and web tar archives, all SHA256 checked, retained in `/opt/logoff-wms-backups/admin-sorting-staged-20260907`.
- Full dump restored into dedicated tmpfs PostgreSQL on an internal Docker network, no host ports. New migration applied successfully there; no customer data sent externally or committed.
- Old and new API booted against the restored, migrated database; health passed and protected routes rejected unauthenticated access. New policy rejects even ADMIN while disabled. These tests invoke the existing start script's underlying `node dist/main.js` directly because isolated Corepack cannot access npm. Production launcher is unchanged; its pinned pnpm bootstrap separately passed on the production network without starting another API.
- Prisma `migrate resolve --applied` for this single immutable migration passed on the restored database. Production script executes only that committed SQL file and records it; it does not apply unrelated pending migrations.
- Backup-restore setup initially checked server readiness before the requested database existed; corrected to a successful `SELECT 1` on that database. No production write occurred during this setup error.

## Rollback and deferred work

Rollback switches application images only, retaining the additive table and current warehouse work. Dropping the table or restoring an earlier database is deliberately not an automatic rollback. Any future schema reversal requires a separate forward migration and explicit handling of session data.

Physical TSD pilot, large-pallet load testing and the complete ordinary-online-request PostgreSQL route scenario remain prerequisites to enabling the new regime. The synthetic AUTO-request scenario does not substitute for these. No claim of full enabled-mode readiness.

Publication result is to be recorded in the PR after cutover and public checks. This document records completed preparation, not an already completed production switch.
