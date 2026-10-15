# Winx / Disney in la_panthera

Published on 2026-10-14 through PR598 into feature/wb-print-check. Implementation branch feature/panthera-magic-themes.

## Behavior and isolation

Dark / Light / Winx / Disney share the existing per-user preference key. Magic styles are enabled only on wms.logoff.pro, localhost and 127.0.0.1. Other hosts fall back to Dark without loading assets. No API, Android, warehouse operations or configuration changes.

Wallpaper covers the viewport without distortion (edges may crop). Working panels retain opaque light surfaces. Changing menu selects a random wallpaper excluding the currently displayed image; typing and data refreshes keep it. Failed downloads preserve the previous background. Only the selected image loads.

Supplied Winx wand and Disney pointing glove cursors, bounded Winx dust (12 particles). Native pointer remains on image failure, form fields and touch devices. Reduced motion disables dust. Theme changes/logout clean up attributes, listeners and particles.

Welcome appears only during real session restoration or lazy-module loading; no artificial delay and no overlay for routine data requests. Eleonora uses existing ID d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82. Following the user's clarification, Disney matches the exact confirmed Cyrillic display name Sofia (trimmed, case-insensitive), never a substring or guessed email. A different full profile name would require a confirmed ID.

Welcome is centered in the viewport and limited to 560px, with proportional video and a skip button underneath. Reduced motion uses a still poster. Skipping does not cancel business loading.

## Implementation map

- apps/web/src/components/layout/themeStyle.ts and ThemeStyleSwitcher.tsx: selection, storage, host boundary and root attributes.
- magicAppearanceState.ts: host check, image lists, no-repeat selection and welcome identity.
- MagicAppearance.tsx and magic-appearance.css: wallpaper, cursors, resource cleanup.
- MagicWelcome.tsx and apps/web/src/App.tsx: session-restoration and Suspense fallback only; business components unchanged.
- apps/web/public/themes/magic/: 13 Winx, 20 Disney wallpapers, two videos, two posters, two cursor sources. sources.json maps wallpaper paths to original filenames. User originals unchanged.

## Validation

Regression reproduced before fixing: both new saved styles restored as Dark. After fixing: web 439 passed, 2 skipped; API 3437 passed, 150 skipped. Dedicated test/kiz*.integration.spec.ts DB suites excluded as in baseline. Android/print-agent suites not rerun (no changes).

Web TypeScript and Vite build passed. Existing missing Jura-Medium.ttf and chunk-size warnings remain.

Run test/magic-appearance.browser.cjs against Vite on 127.0.0.1:5187. Optional MAGIC_TEST_URL, PLAYWRIGHT_MODULE, MAGIC_SCREENSHOT_DIR. Real components and production CSS verify all 33 images, navigation without repetition, input stability, viewport at 1440/360px, opaque panel, cursor/input behavior, user isolation, cleanup, failed-image retention, welcome centering/skip/completion and reduced motion. No business API calls.

## Release boundary

sourceParityVerified=false: the full local build is not a production candidate. Before publication recheck the live image, prepare the exact delta on the fresh runtime graph, and browser-test that candidate. Do not transfer to sold WMS. This document does not change the published baseline.

## Integration update

Merged integration base 58e34076 (PR599/600 included). Retained both the prepared-feature note and published Ozon release records in README, project map and test index. On the merged tree: web 440 passed / 2 skipped, TypeScript and appearance browser checks passed.

## Verified publication candidate

Captured live web 4bf81180386a60041a691af48eda87318506ed4af7311177a3d965e7e1c0875b with unchanged API 853c97df. Runtime builder scripts/panthera-magic-runtime.cjs compiles only the appearance components using the live React owner and patches the switcher, restore fallback and 16 compiled workspace fallbacks. Source has one additional build-conditional FBO fallback. Existing personal login delay is bypassed only for la_panthera; other themes retain it.

Candidate browser checks execute the real compiled App for both users (fresh login and restoration), appearance fixtures, and latest inline Ozon regression. All API calls are mocked. scripts/releases/panthera-magic-20261014 contains the tests and locked publication scripts. Stage verifies exactly 74 changed/added web files, no deletion, unchanged image configuration, unchanged API and source file hashes. The JS graph is renamed to keep one React owner and avoid stale caches. API materialization check reports no changed files.

## Published result

Web sha256:8c11d364063678308fd110690b7071823eb10a810d7a26225be678b7e222bff9. API and APK232 unchanged. Rollback tag `logoff-web:before-panthera-magic-20261014`. Public hashes of all 74 files and health passed; captured live graph passed the actual App login/restoration and Ozon inline browser suites. No business records changed. See releases/panthera-magic-20261014.json and baseline 2026-10-14-panthera-magic.
