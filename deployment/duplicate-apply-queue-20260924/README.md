# WB duplicate settings apply queue — production overlay

The production API and web builder contain later confirmation-key validation and audit fields than the working branch. The user explicitly approved preserving those protections while integrating the durable queue. `production.patch` records the exact approved integration; it must be applied only to the pinned image sources below, not blindly to another revision.

API baseline: `sha256:40248a72417da69b89669703a456fcb9bed21097fcc092c20498e03382c758ca`
Web baseline: `sha256:a76fce3410d9cf6bdde81096d52c7a51b5e0193a3d68493d899d8c238591e55e`
Web builder baseline: `sha256:cdd36b2314efcd28d610e656916eb258bff80d7b93c0f34e5eb7c8f99eb35ea5`

Enable `WMS_DUPLICATE_APPLY_QUEUE_ENABLED=true` only on our VM. The sold VM remains flag-off. No schema migration, physical stock edits, or inferred customer apply request is part of deployment. The client must submit their reviewed settings once after publication. The persisted request survives a restart and records APPLIED only in the same transaction as its settings, audit, and stock recalculation event; this is not WB confirmation.

Local validation: 2324 API tests passed, 12 skipped; 268 web tests passed; both TypeScript checks passed. Exact-image builds and baseline regression comparison gate deployment. Runtime images/configuration must be checked against the baseline again under the API/web release locks; rollback uses the previous images if health checks fail.
