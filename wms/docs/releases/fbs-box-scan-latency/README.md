Published via PR317 on 25.09.2026 at 22:25 MSK. API healthy; flag enabled.
Original preparation and test evidence below. Current baseline: `2026-09-25-fbs-box-scan`.

# Bounded FBS box scanning — 25 September 2026

An unrelated physical box triggered a full-request fallback for relabeling. For
the observed 114-order request, the search made 1,410 database calls, including
317 reservation reads. Production scan responses took 116–160 seconds while
identical retries overlapped. Other background CPU load was not fully diagnosed.

## Change and scope

- `marketplace-connections.service.ts`: `scanFbsTsdBox` shares identical pending
  authenticated scans; the original handler is `performFbsTsdBoxScan`.
- `switchFbsTsdAssemblyToBox` narrows request SKUs to the box's positive physical
  stock plus same-size reverse article mappings. No full-request relabel fallback
  when enabled; known local requests do not refresh WB just because no SKU fits.
- `fbs-box-scan-search.ts` supplies candidate selection, per-search bulk reservation
  snapshots and in-flight deduplication. Snapshots are invalidated on reservation
  release. Stock and reservations are checked again in the existing Serializable
  claim transaction before writes. Physical scans and lease checks remain protected.
- Feature flag `WMS_FBS_BOX_SCAN_BOUNDED_ENABLED=true`, default off. Sold WMS must
  retain the flag off; this is a shared marketplace service, not a sold-WMS release.

Deduplication is process-local and pending-only. Different tasks, devices, users
or payloads do not share a result. Completed/error responses are not cached, and
existing transaction/lease checks remain the authority across API instances.

## Evidence

Two behavioral tests failed before the change (unfiltered 114-order fallback and
two executions of an identical pending scan) and passed afterward. Six new Vitest
tests cover these cases, reverse mappings/sizes, empty boxes, reservation snapshot
invalidation and pending response isolation. Six candidate runtime tests cover
successful cross-box switching, fresh competing reservations, empty boxes,
duplicate scans, isolation and disabled behavior.

All API tests: 2,790 passed, 94 skipped, zero failures. The DB-dependent
`kiz-duplicate.integration.spec.ts` was excluded because no test database was
configured. TypeScript `--noEmit` passed. Candidate: 15 Ozon line-picking and
11 capability/physical-pick/sequential-WB tests passed, plus relabel print route,
DI, print-context and fixed-batch smoke checks. No physical print was requested.

Read-only replay against the same request data: 16 database calls; box search
74 ms, versus 9,665 ms / 1,410 calls before. The replay used isolated candidate
modules, blocked database mutations and HTTP, and made zero writes. These are
separate-process measurements, not a claim that production terminal latency
has already improved. Production was not changed by this fix preparation.

## Candidate/release

Base: verified PR315 runtime, image
`sha256:a72064a45a06563f59e1051dbf1feddec037683685fb9f73dc061c3f3c58d00f`.
Baseline `2026-09-25-ozon-lines`; source parity remains false. Use
`scripts/release_baseline.py materialize`, then `node docs/releases/fbs-box-scan-latency/build.cjs <candidate>`.
The builder asserts the old switch method matches runtime, transplants only the
new switch/wrapper and preserves the deployed scan body by renaming it.
`check-candidate` passed with exactly these two allowed files:

- `modules/marketplace-connections/marketplace-connections.service.js`
- `modules/marketplace-connections/fbs-box-scan-search.js`

Before publication reread live image and refuse a stale base. No APK, web,
database, stock or KIZ edits are part of this change. Target PR branch:
`feature/wb-print-check`; development branch `fix/fbs-box-scan-latency`.
