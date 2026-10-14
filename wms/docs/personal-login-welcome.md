Correction PR606: the historical Eleonora ID below was Elya, a separate account. See [corrected account mapping](eleonora-account-welcome.md).

# Personal login welcome correction

Published on 2026-10-14 through PR604 from fix/personal-login-welcome into feature/wb-print-check.

## Cause and fix

Fresh login bypassed the loading-only MagicWelcome. Eleonora retained the old welcome outside la_panthera. Sofia has login `софия` but display name `Соня`, so matching display name `София` failed. Read-only production lookup verified Sofia ID f89c0efe-dcd2-4dfa-9cea-e35c0c492f83 and Eleonora ID d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82.

AuthPanel.submit now plays the supplied Winx/Disney animation once after successful login regardless of visual theme. MagicWelcome uses the exact requested text, centered bounded layout, skip and video-ended completion. Media error proceeds to the application; reduced motion uses a still for 1.5 seconds; a 30-second watchdog prevents blocked autoplay trapping login. Existing restoration/loading fallbacks retain their loading lifecycle. No name-based assignment to other accounts.

## Runtime and isolation

Fresh live capture: web sha256:519e5f4d3e0bd10215b5cd545d5b8efaa0228fa170ccd2cd4a4f8f5f2cdfaa8a; API sha256:853c97dfaa475a33eedcb14c1d1c746dbbbb06602707f361983fef060e6b6838. Sidebar contrast release is retained. sourceParityVerified=false; scripts/personal-login-runtime.cjs replaces only the appearance bundle and login invocation in the current graph, then renames its JS graph (33 files including index). Existing CSS/media/API remain unchanged. Host allowlist protects sold WMS; its old login behavior remains unchanged.

## Tests

Before fix: account-ID regression returned null; actual runtime fresh-login browser test timed out waiting for the welcome. After fix: web 441 passed / 2 skipped; TypeScript passed. API 3437 passed / 150 skipped; dedicated test/kiz*.integration.spec.ts DB suites excluded as in the baseline. Actual runtime login/restoration for both users, six fresh-login cases across la_panthera/spirit/soul, skip/end/media-error, all 33 wallpapers/cursors/viewport/reduced motion and Ozon inline regression passed. No business writes: browser APIs are mocked.

Files: apps/web/src/components/AuthPanel.tsx (submit); components/layout/MagicWelcome.tsx and magicAppearanceState.ts (welcomeStyle); magicAppearance.test.ts; test/magic-appearance.fixture.tsx; scripts/personal-login-runtime.cjs; scripts/releases/panthera-magic-20261014/{app-browser.cjs,browser.cjs,personal-login.browser.cjs}.

## Published evidence

Web sha256:d84c5629fe4fbe73c81ffa0fca9d71577134a8ee12fb54c5484d228f38352db0. Public hash checks passed for all33 changed files; API/APK/configuration/other containers unchanged. Rollback logoff-web:before-personal-login-20261014. Baseline 2026-10-14-personal-login.
