# Normal FBS WB KIZ replacement: regression contract

## Scope and decision

Konstantin confirmed automatic replacement on 2026-09-05 ("заменяем"). An ordinary
physical FBS scan may replace existing WB metadata only after the existing
client, SKU, quality, usage-history, current task lease and fresh WB `confirm`
checks. This is not permission to replace KIZs in bulk or to bypass validation.

Branch: `fix/wb-kiz-auto-replacement`, based on
`05b963794e3596d2d085d6b44f15c50a6eb3e3e8`.

Runtime scope: `scanFbsTsdKiz` and a private replacement helper in
`apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts`.
Test scope: `apps/api/test/marketplace-wb-kiz-replacement.spec.ts`.
No SOS, Ozon, Android, schema, inventory movement or sold-system changes.

## Safety contract

- Store the scanned KIZ as PENDING and durably audit the exact previous array
  and scanned value before deleting WB metadata. An audit failure blocks WB writes.
- Recheck the real task lease/version immediately before each remote mutation.
- At most one DELETE and one PUT of the new value per attempt. Already attached
  values are an idempotent success without mutation.
- On a remote error, perform a read-only reconciliation. Finding the new value
  proves acceptance; otherwise keep PENDING and retain the historical mark.
- Never restore the previous array automatically: even a fresh empty read is
  not an atomic precondition against a delayed PUT or another WB writer.
- Unknown results do not consume stock, do not become a proven WB rejection,
  and do not roll back registration of a KIZ which WB may already have accepted.
- A lost lease prevents further WB writes and local task mutations by the old
  owner. Old/new evidence has already been persisted.
- Preserve the existing ordinary PUT path when WB had no previous KIZ, and
  preserve normal stock consumption only after confirmed acceptance.

## Evidence to record

RED: run the new public-service tests against unchanged HEAD with stateful
Prisma and WB fixtures; keep genuine behavior failures separate from fixture errors.

GREEN: rerun the same tests after the bounded source patch, then integrate the
exact patch into the previously green audit-validation candidate and run the
entire API/web suites, typechecks, builds and `git diff --check`.

Do not commit or publish a thin old-baseline branch while its full suite has
known failures. Production source/migration reconciliation remains a separate
release gate; these tests do not authorize deployment or migration metadata writes.

## Executed evidence (2026-09-05)

- Initial RED on unchanged HEAD: 20 tests, 12 behavior failures / 8 passed.
- Initial patch GREEN: 20/20; combined API 871/871 and web 32/32.
- Independent review found a retry defect: empty WB after an unknown replacement
  could return to the legacy REJECTED path. Retry RED: 24 tests, 2 failed / 22 passed.
- FIX: recognize unfinished replacement before historical registration by the
  stored PENDING KIZ and matching STARTED action/entity/task/client/connection/order.
  Audit lookup failure blocks writes. Empty recovery skips DELETE but still audits
  the current empty preimage and checks the lease before PUT.
- TEST: three sequential scans retain the mark and PENDING through two uncertain
  PUTs, then accept an already attached value without another write. Near-miss
  audit records and lookup errors cannot authorize recovery.
- Intermediate retry validation exposed a fixture assertion still expecting only
  one STARTED event for two attempts. The assertion now checks exactly two events,
  the original old array and the second empty preimage before PUT; it is not relaxed
  to ignore audit cardinality. Final narrow GREEN: 24/24.
- Final combined API: 875/875; web: 32/32, zero failed/pending. API/web typechecks,
  API build and web production build passed. Existing web asset-resolution and
  large-chunk warnings remain; no unrelated frontend changes were made.

Evidence directory: `C:/WMSFF2207/reports/wms-audit-20260905/remediation`.
JSON/log prefixes: `wb-kiz-replacement-red`, `wb-kiz-replacement-green`,
`wb-kiz-replacement-retry-red`, `wb-kiz-replacement-retry-first-green`
(intermediate assertion failure, not final GREEN), `wb-kiz-replacement-retry-green`,
`combined-wb-kiz-retry-api-tests`, `combined-wb-kiz-web-tests`.
Lint/build logs: `combined-wb-kiz-retry-api-lint.log`,
`combined-wb-kiz-retry-api-build.log`, `combined-wb-kiz-web-lint.log`.

These are local mocked service tests, not real WB, database concurrency or Android
acceptance tests. Stock-reserve is observed by a spy in this new spec; quantity
algorithms are unchanged and covered separately by the existing suite. No commits,
PR, deployment, live KIZ writes or migration metadata updates were performed.

## Publication preparation after the user's request

The user requested publication. Release branch `fix/wb-kiz-auto-replacement-release`
was created from current HEAD and fast-forwarded to the latest our-WMS work branch
`publish/fix/fbs-box-scan-route-consistency` (`9cadc6f`). This preserves the separately
published marketplace stock-control feature. No main/sold branch was used.

On that release base: all 820 API tests and 34 web tests passed, as did API/web
typechecks and builds. Earlier 875/32 evidence belongs to the combined audit
candidate, which contains other unpublished audit fixes.

Production must use an immutable derivative of the current running API image,
changing only this source module and compiled JS. Preserve server-only functions
and post-success replacement audit/message. No dependencies, web, Android, schema,
migrations or client settings may change. Targeted tests must pass on the actual
image before cutover. Full source/migration reconciliation remains separate.
