# Local validation — 2026-10-04

## 0.6.3-soul (26) release

- Signed release assembly and Android Lint succeeded (6m04s): 0 errors, 109 warnings.

- 33 JUnit, 12 Node contracts, 2 release guard tests and 3 emulator instrumentation
  tests passed. Metadata/build-version regression failed before the release update.
- Signed APK SHA-256: `2edea8d0893e909ec5af28821604bf27c296f7e3d3f5d08fb52344a7cadd8e34`.
- Signature matches published 0.6.2 and original 0.5.3.
- On isolated Android 15 emulator: removed our disposable debug install, installed
  published signed 0.6.2, then `adb install -r` signed 0.6.3 successfully. Package
  reports versionCode 26; LoginActivity cold launch succeeded. No user credentials.
- Authenticated business workflows and full feature parity remain unverified.
- Release changes only APK and metadata; rollback retains published 0.6.2.

## Local client-settings / catalog increment (not published)

- Added nine typed client settings and eleven SKU metadata/dimension fields.
- RED: missing settings policy failed compilation; missing catalog API failed the
  Node contract; zero-weight normalization regression failed JUnit before its fix.
- Final: 33 JUnit tests, 12 Node contracts passed; debug assembly and Lint passed
  (0 errors, 109 warnings). No production data was changed.
- Installed Android Emulator + Android 15 Google APIs image in the existing SDK;
  isolated AVD `logoff_wms_native_test`, WHPX, 1080x2340 at 420dpi, serial emulator-5556.
- App and instrumentation APK installed successfully. `adb shell am instrument -w
  pro.logoff.wms.mobile.test/androidx.test.runner.AndroidJUnitRunner`: OK (3 tests).
- Empty login rejected locally, default permissions denied, native policies run
  on Android. Login screenshot inspected. No authenticated business workflow tested.
- Gradle connected-test task could not resolve an uncached UTP plugin offline;
  the compiled instrumentation suite was instead executed directly through ADB.
- Device still needs authenticated read/write scenarios with test fixtures, rotation,
  accessibility/font scaling, client/branch switching and connection interruption.
- Original mobile module, API, TSD, sold WMS and published 0.6.2 are unchanged.

## 0.6.2-soul (25) release

- Signed release assembly, all 17 JUnit tests and Android Lint passed (5m14s).
- 10 Node contracts and the download-only release guard test passed.
- Lint: 0 errors, 106 warnings. Physical-device and authenticated E2E pending.
- Certificate matches existing APK; SHA-256:
  `2b667f5409b9062cdc1948ab1ad8a20222f7375a84292e1b2b9915a94de899f6`.
- Includes the two increments below; full native function parity is NOT complete.
- Deployment replaces only APK and version metadata over the pinned web image.

## Unpublished client editor increment

- Client API contract failed before implementation; final Node contracts: 10 passed.
- All 17 JUnit tests passed, including allowlist/minimal PATCH, null/empty values,
  validation and preflight conflict detection.
- `testLogoffDebugUnitTest assembleLogoffDebug lintLogoffDebug`: successful (4m44s).
- No live customer record was edited. Physical-device verification pending.
- Partial implementation: 14 contact/requisite fields, not full client administration.

## Unpublished financial actions increment

- New API contract test failed before implementation, then passed.
- 12 JUnit tests and 9 Node contracts passed; debug assembly successful.
- Android Lint successful; no production financial mutation performed.
- Native period close, adjustment and late-work preview/confirmation added.
- Pending body/identity persisted before POST; uncertain result blocks fresh actions.
- Screen generation and user/client/branch checks guard stale callbacks/confirmation.
- Physical-device and authenticated end-to-end validation remain pending.
- Not included in published APK 0.6.1; debug APK is not for distribution.

## 0.6.1-soul (24): correction history

- New correction-history contract failed before implementation, then passed.
- Node contracts: 8 passed. JUnit: 9 passed, no failures/errors/skips.
- `testLogoffDebugUnitTest assembleLogoffRelease lintLogoffDebug`: successful (5m34s).
- Lint: 0 errors, 99 warnings (including inherited/localization warnings).
- Signed non-debuggable release certificate matches attached APK.
- SHA-256: `64da5179dea15e760efdf7431a40eccb93e3d6052c5e265c812bfb2a320ccdeb`.
- Candidate: `C:/WMSFF2207/outputs/mobile-soul-20261004/logoff-wms-0.6.1-soul-candidate.apk`.
- Read-only history uses existing server scope and labels its 2000-record/all-date limit.
- No connected Android device; physical installation, login and UI remain unverified.
- Original mobile module, TSD, server and sold tenants untouched.

## Previous 0.6.0-soul (23)

- Initial contract run: 3 failures before isolation, Soul entry and financial API additions.
- Additional rejected-OpenClaw-request regression: failed before response classification fix.
- Final Node contracts: 7 passed.
- Final JUnit policies: 6 passed, 0 skipped/failures/errors.
- `testLogoffDebugUnitTest assembleLogoffRelease lintLogoffDebug`: BUILD SUCCESSFUL.
- Android Lint: no errors; warnings remain (localization and inherited code/dependencies).
- `git diff --cached --check`: passed before commit.
- Signed release: package `pro.logoff.wms.mobile`, 23 / `0.6.0-soul`, non-debuggable.
- APK certificate matches the user's attached 0.5.3 certificate.
- APK SHA-256: `1ba33fb919e861243c93fb0a95bfa4c55683c65dbbb331be6ed13eb6a361f8ef`.
- Candidate file: `C:/WMSFF2207/outputs/mobile-soul-20261004/logoff-wms-0.6.0-soul-candidate.apk`.

NOT verified: physical-device rendering, installation/data migration, authenticated
end-to-end operations against the current server, all roles/branches, and full web
feature parity. `adb devices` returned no connected device. No production mutation,
APK distribution/upload or server deployment was performed. This is a local candidate.
