# Client service list: avoid unchanged-row write locks

Prepared 2026-10-27. A production rollback probe for Bushkova hit PostgreSQL 55P03 in BillingService.upsert under a 2-second lock timeout while opening the service list. This confirms a current wait, not the full duration of the user screenshot. Reading the same client list without initialization took26ms. The actual candidate with full initialization checks took70ms for367 services in a database-enforced READ ONLY, RepeatableRead transaction; values exactly matched the existing stored-price list. Server timings exclude browser/network/rendering.

Only BillingService.ensureStandardBillingServices and ensureStandardClientBillingServices change. With WMS_BILLING_SERVICE_READ_FAST_ENABLED=true, read existing standard rows first and upsert only missing/different defaults. Read client binding IDs and create missing bindings only; preserve existing individual price, tax, status and comment. Missing-row upserts retain empty update for concurrent creation. Nomenclature synchronization already skips identical rows and stays unchanged. No result cache or stale-price TTL. Actual changed/missing records still require normal writes and may wait for a genuine concurrent update.

Own API image flag only; absent/false retains the sold behavior. No defaults/prices/invoices/data are changed at release. Exact one compiled file overlay; only two method texts replaced, all other runtime bytes preserved. Web/APK untouched.

Tests: billing-service-read-locks.spec.ts reproduces4 failures before correction and5 successes after; billing.service.spec.ts25 passed; API3772 passed/155 skipped, dedicated KIZ suite excluded (separate DB unavailable); web510 passed/2 skipped; API TypeScript passed. Actual candidate module graph loads and read-only production probe returns identical367 rows in70ms. Scripts: scripts/releases/billing-read-fast-20261027.

Receipt processing settings live under the left navigation Management > Services (Управление > Услуги), then select a client. They are not on Billing > Initial FBO processing.
