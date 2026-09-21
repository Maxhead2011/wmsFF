# WB confirmation panel and readable allocation settings

Feature branch: `feature/wb-stock-confirmation-panel`. Target: our VM only.

The production allocation screen is newer than the repository baseline. `production.patch` preserves all current fine settings, reserve editors, SKU exceptions, demand analytics and draft-preserving callbacks. Apply only against the captured source hashes; never replace the live screen or api.ts with the older repository baseline. New files are also present in normal source paths.

## Behavior
- The fifth tile mounts a dedicated paginated confirmation list. Opening it does not calculate demand analytics or publish quantities.
- The check button calls the existing read-only WB stock verification endpoint.
- Cabinet-wide counters and filtered rows share a repeatable-read snapshot. Missing observations remain null, never zero. Client and execution-warehouse scope are enforced.
- Reserve, publication state and recommendation controls are arranged in three cards. Longer explanations and recommendation settings are collapsed. Existing controls and callbacks are preserved.
- Allocation uses a navigation callback to the confirmation section and no longer renders the legacy proof table when the new capability is enabled. With the capability disabled, the legacy table remains available.

## Isolation and rollout
`WMS_WB_STOCK_CONFIRMATION_ENABLED=true` together with existing `WMS_WB_STOCK_FINE_SETTINGS=true` enables the read model. The new flag defaults off. Do not deploy or enable it on the sold VM. Shared modules: marketplace-connections module/registry and stock-management web views. No database migration, physical stock mutation or allocation-rule change.

Release builds extend the exact running images, preserve prior web assets, compare all changed source hashes, and reject concurrent deployment or configuration drift. Restore the captured API/web image tags to roll back.

## Validation
Local API: 2282 passed, 12 skipped. Local web and TypeScript checks pass. New tests cover missing/zero quantities, lossless WB IDs, client/cabinet/warehouse access, feature-off behavior, query validation, endpoint selection and card composition. Real-database read validation checks summary totals, pagination, barcode search, warehouse/status filters and denial of cross-client access. Synthetic UI verifies cards, navigation and mismatch filtering. Production full-suite comparison must have no failures beyond the baseline before publication.
