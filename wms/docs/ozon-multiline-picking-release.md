# Ozon FBS: picking distinct product lines

Published via PR315 in `feature/wb-print-check`; LOGOFF215. Migration applied and flag enabled on our WMS. Public health, image deltas, APK signature/hash and 46 runtime checks passed. Physical terminal test pending. Preparation details below describe the pre-release candidate.

## Scope

Order 73641454-0104-12 contains two different products. The old total counter
could accept two scans of the first product; submission then rejected the order.
The fix persists a separate scan ledger for every Ozon product line and validates
the complete composition before submission. Legacy totals do not become evidence
for individual lines: unfinished orders require new scans.

WB status notifications include deduplicated supply IDs (commit `784006b5`).

## Files and functions

- `apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts`:
  queue availability, scan endpoints, formatting, posting submission, request sync,
  and `notifyFbsAutoStatusChanges`.
- `ozon-fbs-pick-lines.ts` in that directory: composition validation, SKU matching,
  count-based retry handling and durable state access.
- `ozon-fbs-pick-workflow.ts` in that directory: initialization, source selection,
  per-line scans, completion and ambiguous submission reconciliation.
- `apps/api/src/common/stock/fbs-request-auto-status.ts`: completed quantities by line.
- `apps/api/src/modules/tsd/tsd-assembly.service.ts`: online progress by line.
- `apps/api/prisma/schema.prisma` and migration `20260925202000_ozon_fbs_pick_lines`:
  new state table; no existing stock data changed by the migration.
- Android `MainActivity.java` and `TsdFbsAssemblyResponse.java`: article counters
  and explicit deferred source selection in LOGOFF.
- Tests: `ozon-fbs-pick-lines.spec.ts`, `fbs-online-remaining-progress.spec.ts`,
  `fbs-status-supply-notification.spec.ts`, `OzonPickLinesDisplayTest.java`.
- `scripts/build_ozon_multiline_candidate.cjs`: narrowly patches the deployed runtime.

## Isolation and release prerequisites

`WMS_OZON_MULTILINE_PICKING` defaults to false. Apply the migration before enabling
it only on our WMS. The sold WMS keeps its existing flow. Shared API modules are
touched; reviewers must check the disabled flag path as well as the LOGOFF path.

The published runtime differs from TypeScript sources. Do not deploy a complete
TypeScript rebuild over it. The candidate script patches exactly five runtime
files against API image
`sha256:57c41c094bf9e3e45eea8adca8e7d666b17cc2f24432b52cbb149b6e1c5f2cf6`.
Existing packing, relabel, source-location and monitoring fields are preserved.
Reverify the live image before any publication. APK215, migration and feature enablement are published. Production health,
exact runtime hashes and public APK hash are verified; physical terminal testing
remains pending.

## Limits

Marked or relabelled multi-product Ozon orders remain blocked for administrator
review. An ambiguous ship response is reconciled by reading Ozon; if the order
still awaits packaging, no blind second submission is attempted. Existing Ozon
stock accounting is retained; this change does not introduce WB stock debiting.

The already owner-confirmed incident order is historical and is not rewritten as
individual scan evidence. Real PostgreSQL integration tests require a separate
test database; the local transactional tests use serialized rollback-capable mocks.

## Verification

Regression reproduction fails against the previous implementation. The candidate
passes 35 focused tests covering per-line scans, duplicate requests, resuming,
concurrent initialization, request capacity, shipping payload, online progress and
notifications. TypeScript and Prisma schema validation pass. Web: 229 tests;
Android: 218 tests for each flavor; baseline tooling: 8 tests.
Full API: 2,784 passed, 94 skipped, with the database-dependent
`kiz-duplicate.integration.spec.ts` excluded. The first full run timed out in an
unrelated PDF test; the complete rerun with 2–4 workers passed without changing
that test. These tests did not exercise production shipping. The additive PostgreSQL migration
was subsequently applied and verified during publication.
