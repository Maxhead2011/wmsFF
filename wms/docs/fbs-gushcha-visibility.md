# Gushcha FBS visibility exception

Prepared, not published. Scope confirmed by Katerina: only Gushcha.

Client d7b835c1-6273-4b2c-be39-c96476fa7b5d (CL-000015) belongs to Noginsk, company 4c2d1e0a-37ed-4c13-9214-5f69348ed514. No client or warehouse data is changed.

Default-off flag WMS_FBS_GUSHCHA_VISIBILITY_ENABLED must be enabled only in our installation. The authenticated active warehouse determines company context. Our company 0f31c965-66c3-4882-af0a-a390feb15a98 hides this one client from the explicit FBS client selector, active-order client list, and stale selected-client order reads. A missing warehouse/company also hides only this client. Known other companies, CLIENT accounts, demo accounts and ordinary Clients lists retain existing behavior. All other clients retain previous filters. Existing permissions remain in force.

Files/functions:
- apps/api/src/common/fbs-client-visibility.ts: hiddenFbsClientIds, assertFbsClientVisible.
- scripts/fbs-client-visibility-runtime.cjs: exact runtime patch for ClientsService.list, MarketplaceConnectionsService.listFbsActiveClients/listFbsOrders/listFbsOrdersForDisplay.
- scripts/tests/fbs-gushcha-visibility.runtime.cjs: actual-runtime regression, 12 scenarios.

Source parity is false. Do not rebuild the complete API from historical TypeScript. Materialize the current release baseline and apply the exact patch. Current prepared baseline: 2026-10-23-fbs-filtered-selection; API sha256:027b57a6b6bed28d8188e72c8d5a463ba9f1615c06cd1e4266a420899a453d8f. Before publication recheck actual deployed image and rebase the candidate if changed.

Regression evidence: before fix four failures; after fix twelve passing cases. Tests include both order readers, dropdown, active clients, Noginsk, disabled flag, client role, ordinary Clients list, missing context, other clients and retained client scope. Run using FBS_VISIBILITY_RUNTIME pointing to the materialized patched runtime and node --test scripts/tests/fbs-gushcha-visibility.runtime.cjs.

No publication, database writes, stock changes or changes to sold WMS are part of this preparation. Proposed PR target: feature/wb-print-check (current documented our-WMS integration branch).

Final validation, 24 October: patch reapplied to a fresh read-only capture of live API sha256:027b57a6b6bed28d8188e72c8d5a463ba9f1615c06cd1e4266a420899a453d8f. The repository baseline image is older (854abc7...), so it is not the deployment base. Fresh-image regression: 12 passed. Exact file comparison: three changed/added modules, 636 other files unchanged; hashes in fbs-gushcha-runtime-proof.json.

Full API suite: 3564 passed, 155 skipped; web: 476 passed, 2 skipped. Two dedicated KIZ integration suites excluded because their isolated database environment is unavailable. FBS/TSD runtime suites: 33 passed; routes initially failed to resolve local Prisma after removing the dependency junction, then all seven route tests passed after restoring it. No business database used for tests.
