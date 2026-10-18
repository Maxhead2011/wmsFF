# Dark surfaces and standalone relabel layout

Prepared 2026-10-18. Dark FBS, catalog and client cabinet containers now override legacy Modern white backgrounds. Scanner status uses readable dark neutral/success colors. ArticleMappingPanel imports its existing directory layout directly so standalone navigation does not depend on first visiting DirectoryPanel.

Runtime delta: prepend the existing directories.css before the current stylesheets and append the scoped Dark override. Only index.html and two new CSS assets change; all previous assets and JavaScript remain intact. Published web base: sha256:1393f26ad7c5c6abc14f12b079ddcd9e7bda5586dec394e97fc601bd31eaae33. API pinned at sha256:f91615a1ae1b64f6ee99a1595061463977eff193dc036f74263ccf105e1ca6de. sourceParityVerified remains false. Shared CSS classes are affected only in the deployed own-WMS image; no sold deployment.

Validation: regression failed before the fixes. Web446 passed/2 skipped, API3512 passed/155 skipped. Dedicated kiz-duplicate.integration.spec.ts cannot initialize without the separate integration database and is excluded in the supported run. TypeScript passed. Chromium with actual production CSS plus the exact overlay verifies Dark/Light, success colors, and separate labels/controls at 1440px and 390px. scripts/dark-panel-surfaces.test.cjs accepts LIVE_CSS_FILE for the captured production styles.

Publication uses scripts/releases/dark-surfaces-20261018/publish.py, an image/index guard, release lock, exact file hashes, rollback tag and public asset verification. No business data, API, APK or configuration updates.
