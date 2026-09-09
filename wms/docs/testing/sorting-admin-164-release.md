# LOGOFF sorting release 164

2026-09-09. Feature branch `fix/sorting-admin-recovery-reopen`; integration base `fix/sorting-recorded-source-20260908`.

## Release scope

- API: only `inventory/pallet-sorting.service` and `stock/sorting-written-off-recovery`, source and compiled JavaScript.
- Web: only `PalletSortingPanel.tsx` and `pallet-sorting-api.ts` source changes, new bundles and index; retain all old assets and downloads.
- Android: signed LOGOFF APK 164, version name `0.1.165-sorting-admin`; package and certificate unchanged. Sold flavor unchanged and not deployed.
- No database migrations, production stock corrections, environment edits or marketplace writes. Reserved/non-AVAILABLE sources are retained, not repaired or written off.

Risk: stock recovery remains an explicit ADMIN-confirmed transaction with exact-KIZ history guards, idempotency and rollback. Reopening is limited to destinations of the current FORMING session. See `sorting-admin-recovery-reopen.tdd.md` for implementation tests and limitations.

## Preservation gates

The production API had a newer independent TSD performance fix. Patch the actual running image, not the stale checkout:

- API baseline: `sha256:13a51591aeb6e7d534927b3b870d4485f330b42b54c51e93a44d3502b75b897b`.
- Web baseline: `sha256:820ad805a999f37c024143063a423fdd8e85f34c3ef74d9248dec7fce81cb50b`.
- Rebuild the saved current web sources first and compare index plus every generated asset against live bytes before applying the two-file web patch.
- Full image configuration and source/compiled/static manifests checked. Only approved differences allowed; retain unrelated changes and previous APKs.
- Full database backup validated with `pg_restore --list`; release locks, exact baseline gates, merged-PR and tested-image gates before switching. Rollback restores previous API/web images, never the database.
- SQL verification uses a fresh internal-only PostgreSQL container, production schema only and synthetic data. Previous isolated test databases are preserved.

## APK and release tests

- Signed APK bytes: `2259749`.
- SHA256: `0f8cfd075641b880527b333548e0b3ca47c66e776685176a98677f4d812b7025`.
- Certificate SHA256: `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b`.
- Package `pro.logoff.wms.tsd`, versionCode 164, minimum Android API 24.
- `node --test infra/scripts/sorting-admin-164.test.cjs`: 2 passed. RED checks rejected stale 163 metadata and the initially missing artifact validator; GREEN after implementation.
- Signed Android build and both flavor unit-test tasks passed. No physical TSD was available; hardware interaction is not claimed as verified.
- Actual production-candidate API: **1573/1573**, plus **3/3** TSD message integration tests. All **24/24** tests present in the published web baseline plus the new retained-source test passed; the extended local web suite previously passed **62/62**.
- Isolated PostgreSQL service/ledger integration: **PASS**, including administrator confirmation, retry, concurrency, rollback, late shipment guard, AVAILABLE zero-balance recovery, preservation of old debit, missing request and closed-target reopening.
- Two web test-runner setup attempts failed before running tests (nested read-only mount, missing package symlink); corrected only the runner and reran the entire release test phase successfully.
- API TypeScript and web TypeScript/Vite builds passed. No production migration is required.
- Deployment evidence is retained in `/opt/logoff-wms-backups/sorting-admin-164-20260909`; stage passed source/bundle parity and artifact/configuration gates. Tests passed before release commit. Publication status and public download hashes are recorded separately by the release script.

Install over the existing LOGOFF application without uninstalling or resetting its sorting session.
