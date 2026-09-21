# FBO remainder release 247

The production source includes newer FBO close-pick, monitoring and parallel-packing changes than this feature branch. The user explicitly authorized resolving the overlapping changes on 2026-09-21. `server-overlay.patch` is the exact reviewed additive patch against that production baseline; `source-hashes.json` pins the before/after source bytes. No unrelated source or compiled API modules are replaced.

The release preserves STOP_PICK, fast acknowledgements, parallel packing, monitoring, existing web assets and terminal downloads. The opt-in flag is WMS_FBO_REMAINDER_TRANSFER_ENABLED; sold installations remain disabled.

Validation: 2727 API tests passed locally (60 skipped; database-specific suites additionally exercised separately), 207 local web tests, API/web type checks. On the merged production sources: 50 FBO PostgreSQL integration tests and 174 web tests passed, plus TypeScript and Vite build. `compatibility-tests.py` appends two release-only scenarios to the existing FBO fixture: STOP_PICK while transfer is disabled, and splitting after parallel whole-box packing. These run against an isolated PostgreSQL container without production access.

The WB publication calculator is called by the split regression test before and after both generations of splitting. Sellable quantity does not increase. Read-only live verification of requests 1220/1221 confirms 3088/2108 units included in reservations across all 76 SKUs; no marketplace write is performed by verification.

Deployment applies only migration 20260921170000_fbo_remainder_requests in a transaction, records its checksum in Prisma migration history, and enables the feature for our API. Existing requests are not split automatically. API/web images and configuration are backed up; additive columns can remain if an application rollback is needed.
