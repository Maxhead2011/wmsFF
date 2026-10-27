# Receipt stock access and processing kind

Published through PR703 on 2026-10-27. Own WMS only; `WMS_RECEIPT_PROCESSING_ENABLED=true` is set in the candidate API image. Sold WMS remains on its existing image/configuration.

## User flow

In client billing services, configure the Gray and White unit prices, tax handling, and included PIECE services. Then choose exactly one kind for the entire receipt in Warehouse > Receipts, between availability and FBS/FBO directions. Mixed receipts must be split operationally. Saving a kind requires a configured profile and records the actor, time, and revision. Stale changes are rejected. CLIENT can view; only authorized ADMIN/OWNER can change these settings.

Unselected historical receipts retain legacy billing. Existing invoices and charges are not recalculated. Recognized return boxes retain their previous billing rules. Storage accrual is independent of receipt approval/kind. Setting a receipt kind neither reserves nor moves goods. Profiles are scoped to each client.

For previously unconfigured stock-approval scopes, the first administrator action creates a manual scope with `defaultAvailable:true`. This preserves availability of all untouched receipts (including future receipts), while explicit per-receipt confirmation/revocation works normally. Existing pending-by-default scopes are unchanged. Merely publishing does not create scopes or change stock.

## Billing integration

Regular FBS primary processing, completed FBS work, and FBO processing read the same saved receipt selection through the materialized ReceiptStockIdentity SQL index. Production's generated Prisma client does not expose a Box relation for this index. Included services are suppressed by service ID; unrelated extra services, FBS order processing and packaging retain their rules. FBO snapshots retain selection and pricing revisions. Tax rounding is performed on the line amount.

Ambiguous FBO physical evidence or partially included relabeling with no per-unit attribution is rejected explicitly rather than charged at a guessed rate. Such a request requires evidence reconciliation before completion. Profiles are not activated on any real client during deployment.

## Files and functions

- warehouse/receipt-channel-policy.ts: manual approval scope and default state; receipt-stock-index.ts: same default in operational reads.
- warehouse/receipt-channels.controller.ts: list capabilities, processing/enable-management endpoints, combined audit history.
- billing/receipt-processing.ts and receipt-processing.controller.ts: selected kind, client pricing, validation, scope, audit and batch lookup.
- billing/receipt-processing-fbo.ts, fbo-processing-pricing.charges.ts, stock/stock-operations.service.ts: grouped FBO primary charges and included services.
- billing/completed-fbs-billing.ts, lukin-primary-policy.ts, marketplace-connections/marketplace-connections.service.ts: FBS billing paths and invoice preservation.
- billing/billing.module.ts and administration/administration-internal-api.service.ts: route registration.
- web ReceiptDirectionsPanel.tsx, ReceiptProcessingSettings.tsx/.css, ClientBillingServicesPanel.tsx: choice and per-client profiles.

## Validation and release

Source tests include manual availability, SQL index reading, sold flag-off behavior, profile validation, permissions, exact tax calculation, included-service suppression, legacy/return preservation and existing-charge snapshots. The dedicated KIZ integration suite requires a separately configured test database and is excluded from the general run.

Candidate checks: 18 runtime/module checks; 12 bundled UI scenarios; full actual browser module graph; isolated PostgreSQL/full Nest health; 8 read/write checks against production in a forced rollback transaction. No physical balances or invoices change in that transaction.

Build exact overlays on the fresh published API/web images, because sourceParityVerified=false. Never replace all production modules with the local dist. Scripts: scripts/releases/receipt-processing-20261027. Release requires merged PR, matching image base, rollback/isolated/browser proofs, release locks, public health/hash checks, unchanged APK/env/other containers. Rollback tags: logoff-api:before-receipt-processing-20261027 and logoff-web:before-receipt-processing-20261027.
