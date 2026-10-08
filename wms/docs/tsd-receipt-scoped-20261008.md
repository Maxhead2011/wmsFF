Fix repeated TSD Internal server errors during FBS completion and FBO stock checks. Receipt approval introduced in PR494 rebuilt all client receipt history inside a 5-second write transaction, causing observed expiration errors.

Limit receipt evidence, box queries and membership lookups to the physical boxes being checked. Keep full history for reports and unchanged shared approval locks, current settings reads, protected FBS orders, client/warehouse scope and grandfathered receipt semantics. No shared cache, timeout increase, approval bypass or business-data repair.

Validation: new regression fails twice before the fix; all 31 focused receipt tests pass. API suite: 3123 passed, 141 existing skips; kiz-duplicate.integration.spec.ts excluded because its isolated database URL is unavailable. Scoped TypeScript check passed. Full TypeScript remains blocked by pre-existing generated Prisma payroll fields missing locally; errors are outside this module. Actual candidate against three live boxes: 108/44/48 ms within 5-second transactions, same decisions as full reference (1877 ms), no writes. Exact single-module runtime allowlist passed.

Only our WMS API is published. Web/APK218/flags/schema/sold WMS remain unchanged. sourceParityVerified=false; matching compiled hunks overlay fresh runtime image 54e63ae72a0b. Rollback logoff-api:before-tsd-receipt-scoped-20261008.
