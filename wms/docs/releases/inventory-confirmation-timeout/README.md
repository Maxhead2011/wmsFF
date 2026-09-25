# Bounded inventory confirmation

Box FFL_LKB0809_6 could not be actualized: production P2028 logs show the default 5-second interactive transaction expired during serial KIZ composition checks. Saved scans survived; the inventory transaction rolled back.

Only InventoryService.runSerializableInventoryDecision changes. WMS_INVENTORY_DECISION_TIMEOUT_ENABLED=true selects a 30-second transaction budget with a 5-second acquisition limit. Expiry returns an actionable 503 retaining saved scans. Nested decisions reuse the same transaction; serialization conflicts remain 409. No automatic retries, partial commits, KIZ-rule changes, or architecture changes.

The shared inventory service is affected, but the behavior is opt-in for our WMS. The sold WMS and flag-off behavior remain unchanged. Runtime/source parity is still false: build.py applies the exact delta over the pinned 2026-09-25-cancelled-kiz runtime and provides the corresponding source overlay. Do not deploy a full historical source build.

Validation: six actual-runtime transaction-boundary tests (three fail before the fix, all six pass afterward), covering timeout, rollback, nesting, flag-off and conflicts. The transaction driver is simulated; these are not PostgreSQL integration tests. Existing API suite: 2761 passed, 94 skipped; kiz-duplicate.integration excluded without a test database. Candidate guard: exactly modules/inventory/inventory.service.js changed among 534 runtime files.

Operational correction: the real InventoryService applied the saved count in a serializable transaction. Audit af21a0b5-0991-4f23-b42b-9e3f0f82d7cd is RESOLVED: 15 units and 15 AVAILABLE marks, independently re-read. No new physical scans were fabricated.

Build: materialize the pinned runtime with scripts/release_baseline.py, run this directory's build.py with the candidate path, then check-candidate allowing only modules/inventory/inventory.service.js. Run runtime.test.cjs with INVENTORY_RUNTIME pointing to the actual candidate with production dependencies available.
