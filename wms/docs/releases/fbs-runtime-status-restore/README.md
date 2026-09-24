# Restore FBS status hooks lost by release 212

Release 212 replaced the compiled marketplace connection service without the
automatic request-status and post-commit Telegram hooks. The helper, notification
module registration and newer TypeScript remained on the server. Consequently,
checking source code or `/health` alone did not detect the loss.

This change restores the previously verified hooks from PRs 281/284 on top of
the latest PR294 source. It preserves the PR294 physical-pick screen and same-size
KIZ behavior. The `WMS_FBS_REQUEST_AUTO_STATUS_ENABLED` flag defaults off; the sold
installation must retain its existing configuration. No schema changes or
historical backfill are included. Manual status changes remain authoritative.

## Changed service entry points

- `sosWbClaimResponse` and `formatFbsTsdAssembly`: reconcile actual task start/resume.
- `completeFbsTsdAssembly`: record PACKED in the stock transaction after all picks.
- `finishFbsPrintJob` and `reconcilePrintedWildberriesStock`: reconcile DONE only
  after successful SOS printing and durable warehouse shipment evidence.
- `reconcileFbsTaskRequestStatus` and `notifyFbsAutoStatusChanges`: invalidate
  request cache and send through existing client Telegram routing after commit.

`marketplace-connections.module.ts` imports `ClientNotificationsModule` in Git.
The running production module already has this import and must not be overwritten
with a complete build from this worktree: production contains additional modules.

## Verification

The restored 22 integration scenarios run against a dedicated local PostgreSQL
database on port 55479. Before the service fix, 6 failed and 16 passed. Afterward,
all 22 passed, including the real completion and SOS acknowledgement entry points,
rollback, manual overrides, concurrent completion and disabled-feature isolation.

Both the integration suite and sticker screen test accept `FBS_RUNTIME_ENTRY`:

```powershell
$env:FBS_AUTO_STATUS_TEST_DATABASE_URL='postgresql://codex_tests@127.0.0.1:55479/fbs_auto_status_tests'
$env:FBS_RUNTIME_ENTRY='ABSOLUTE_PATH_TO_CANDIDATE/dist/modules/marketplace-connections/marketplace-connections.service.js'
node node_modules/vitest/vitest.mjs run test/fbs-request-auto-status.integration.spec.ts test/fbs-tsd-sticker-number.spec.ts --maxWorkers=1 --minWorkers=1
```

Run from `wms/apps/api`. Database must be isolated and initialized with the project
schema. Leave production credentials out of the test environment. These 23 tests
passed against a copy of the actual production dist with the attached narrow
patch applied, using its existing dependencies/helpers. `FBS_RUNTIME_ENTRY` must
point to the candidate artifact: running only the TypeScript variant does not
verify a deployment.

Final local results: TypeScript build passed; API 2,794 passed, 38 skipped;
web 227 passed; production-derived runtime 23 passed. The API run was split into
the main 2,759-test group and the three PostgreSQL suites (35 tests) run without
file parallelism. Parallel execution of those database suites produced three
failures in `kiz-identity-transfer.integration.spec.ts`; the same five-test file
passed independently on both the parent and candidate. The sequential group
passed in full. No unrelated test or inventory code was changed to hide failures.

## Narrow production candidate (not deployed)

`runtime-delta.patch` records the compiled before/after delta derived by compiling
the parent and fixed TypeScript with the same project compiler options. Only
`dist/modules/marketplace-connections/marketplace-connections.service.js` changes
in the production snapshot. All other runtime files are byte-identical.

`artifact-manifest.json` binds the patch to the inspected base API image and
SHA256 of the original service. Before any deployment, require an exact image
and file match. If another release has occurred, stop and prepare/test a new
candidate; never overlay a stale complete module. Check the resulting file hash
and run the runtime test command above before publishing. The patch does not
update APKs, web assets, environment flags, databases or source files on the server.

The wider source/dist divergence is pre-existing and remains outside this narrow
repair. A full server rebuild is not validated by these checks.
