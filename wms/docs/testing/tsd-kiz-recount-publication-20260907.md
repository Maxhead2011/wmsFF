# Publication attempt — WMSFF2207 — 2026-09-07

Status: **CANDIDATE VERIFIED, awaiting PR/cutover**. The initial conflict gate
stopped safely. Konstantin subsequently authorized the reviewed adaptation and
publication. The sections below retain evidence of the initial stop; current
candidate results are recorded at the end. No stock repair or migration is part
of this publication.

## Prepared changes / risk

- `apps/android-tsd/app/build.gradle.kts`: Logoff-only version 157 /
  `0.1.158-kiz-recount`; default and Ffullhab versions unchanged. Low risk.
- `infra/scripts/tsd-recount-stage.sh`: copies live source and records images and
  configuration privately, checks patch before creating a database backup.
- `infra/tsd-recount.Dockerfile`: proposed live-image overlay; not built or
  deployed. WMSFF2207 flag enabled only in proposed API image. Release risk
  remains blocked until live differences are reviewed.

## Conflict gate

`git apply -p2 --check` failed in staging, and **nothing was applied**:

- administration-internal-api.service.ts: live TSD routeCount is 75; patch
  expects 84. Count real handlers before adapting, do not guess 86.
- stock-operations.service.ts: mixed CRLF/LF around
  storageBoxTransferKizIdentity; preserve live stock safeguards.
- tsd-device.controller.ts: CRLF import context.
- tsd-storage-box-transfer.spec.ts: mixed CRLF/LF fixture context.

At the initial stop, adaptation required direction. After explicit direction,
the guarded continuation script applied the patch to the staging copy and
created/validated a private pg_dump. Do not rerun the one-shot staging script
against those directories.

Production images verified unchanged after the failed check:

- API `sha256:b95cd99376819f463669d1867ba49c9ce416c9eee338d829910792b5c8342338`
- web `sha256:a335aa12bd09a087414faf95ae7e71fff51804e82f574f0e58643c3b0d8fed1a`

## Verification

- Full local API suite rerun: **1273/1273**, 144 files.
- Secured signing helper: testLogoffDebugUnitTest,
  testFfullhabDebugUnitTest, assembleLogoffRelease — BUILD SUCCESSFUL.
  Logoff tests: 45. Release lintVital also passed; this does not supersede
  previously recorded full Android lint failures.
- Signed APK: `apps/android-tsd/app/build/outputs/apk/logoff/release/app-logoff-release.apk`.
- applicationId `pro.logoff.wms.tsd`, versionCode 157, minimum SDK 24.
- APK SHA256 `1e1d5b15078d97e64f5c84485ac324b1cfcf3f9c4f2d07cbb2e8214a97fbce1a`.
- No physical device install or warehouse mutation smoke test.

Proposed PR remains `fix/tsd-kiz-recount-review` →
`fix/fbs-box-scan-route-consistency` in Maxhead2011/wmsFF.
FFULHAB not published or changed.

## Approved candidate verification

- Counted 84 real live TSD handlers before the patch, 86 after it. Registry is
  display-only; three other adaptations are CRLF/LF normalization, not logic.
- Adapter tests: 3/3, refuses unexpected handler count/registry.
- Candidate API and web builds passed with installed dependencies, no network.
- Candidate targeted suite: 383/383; permanent-box/reservation safeguards: 5/5.
- Full runtime comparison on identical isolated settings: baseline **1090 pass,
  40 fail**; candidate **1208 pass, 39 fail**; **zero new failed tests or suites**.
  These results do not imply that the production baseline has no existing bugs.
- Local API: 1273/1273; web rerun: 54/54; API/web typecheck and builds passed.
- Artifact allowlist: exactly seven API source files and seven compiled JS files
  changed. All old web files except index remain byte-identical; new hashed
  assets and the versioned APK are additive. Shared APK/update JSON and pilots
  unchanged. No forced device update command.
- Signed APK certificate SHA256:
  `52916d7797ade50cc1c50bba8787b9d2307b1e5dfd4ea725bd7c3be0e64f989b` (matches installed lineage).
- Candidate read-only DB transaction: PASS, feature enabled, CLIENT denied,
  prior permanent-box and FBS queue flags preserved, 86 TSD handlers.
- Full Android lint has pre-existing 10 errors/20 warnings (see implementation
  report); release lintVital passed. No suppression or unrelated fix.
- No physical ATOL installation, end-to-end real recount, or PostgreSQL
  concurrency mutation test was performed. Warehouse quantities untouched.
- Rollback retains immutable old images and reverts only API/web, never the
  database. Publication script checks merged PR evidence, source/asset manifests,
  backup checksum, full-suite comparison, authorization, public health and APK hash.
