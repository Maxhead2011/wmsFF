# Windows print agent: Cyrillic login and sorting label parity

Date: 2026-09-13. User: Константин. Scope: LOGOFF WMS only.
Branch: `fix/warehouse-print-agent-label-parity`.
Proposed PR base: `fix/fbs-transfer-started-at`.

## Request and implementation

Allow the existing «Склад» account to use the Windows print station and make its supplementary label match direct WMS printing.
Read-only production inspection found the account active with TSD/OPERATOR roles, `print:write`, and Moscow warehouse access. No role, permission, stock, shipment or user records were modified.
The public production ZIP's sources were imported into `apps/windows-print-agent`; no live config or credentials were imported.

Changed execution paths:

- `Setup-Agent.ps1` and `LOGOFF-FBS-Print-Agent.ps1`: shared `WmsApi.ps1` transport, explicit UTF-8 JSON bytes and one expired-token retry.
- `fbs-sorting-label.ts`: one Russian PNG layout, including fitting long warehouse names.
- `MarketplaceConnectionsService.scanWebOrderAssembly`, `reprintWebOrderAssemblyHistory`, `claimFbsPrintJob`: supply the shared PNG. Generate before recording print history/claiming a job.
- `OrderAssemblyPanel.printLabels`, `orderAssemblyPrintHtml`, API result type: consume the server PNG instead of another local template.
- `Build-Package.ps1`: explicit five-file allowlist; no config.json; UTF-8 BOM for Windows PowerShell 5 source decoding. Refuses to overwrite an existing ZIP.

## RED → GREEN evidence

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| Cyrillic WMS login/password and station name survive Windows PowerShell HTTP | Actual local fake HTTP server received `?????` instead of `Склад`; Node test failed | Actual powershell.exe sends original Unicode and charset=utf-8 |
| Setup/background use identical transport | Missing helper assertion failed | Both dot-source WmsApi.ps1 |
| Windows uses server supplementary PNG | Old GDI/English layout assertion failed | Agent consumes sortingLabel.imageBase64 |
| Direct scan, reprint and station label match | sortingLabel undefined assertion failed | All three actual service results contain byte-identical PNG |
| Web prints supplied image and rejects absent/non-PNG labels | New helper missing, intended missing-implementation RED | Two web tests pass |
| Long destination is not clipped | Visual preview clipped destination; new fit helper test failed | Fit test passes; generated short and long previews visually checked |
| Existing operator access remains valid | Existing behavior protected, not a new permission grant | PermissionsGuard accepts Склад fixture on all five agent routes |
| Rejected token retries at most once | Additional error-path regression checks | HTTP integration verifies success after refresh and persistent 401 failure |

## Final validation

From apps/api:

`node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=dot`

198 files, **2167 tests passed** (90.80s).

From apps/web:

`node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1`

31 files, **159 tests passed**.

From WMS root:

`node --test apps/windows-print-agent/agent.test.cjs` — **5 passed**, using actual Windows PowerShell against localhost only.

`node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` — passed.

`node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` — passed.

From apps/web: `node node_modules/vite/bin/vite.js build` — passed; existing asset-resolution/chunk-size warnings remain.

Package built locally at `C:/WMSFF2207/tmp/LOGOFF-FBS-Print-Agent-20260913.zip`.
ZIP entry allowlist, all PS1 BOMs, and parsed PowerShell syntax checked successfully. No installer, scheduled task or real print was executed during validation.

Coverage attempt: Vitest `--coverage` could not run because `@vitest/coverage-v8` is not installed. No coverage percentage claimed; no dependencies changed merely for this report.
No physical printer/TSD end-to-end test performed. Automated tests verify transport, API image parity and web consumption, not physical paper output.

## Release and isolation

Not deployed in this task. No APK changes needed. Release must include API, web and the new Windows ZIP together; then stop the old Windows scheduled task and reinstall/reconnect the new agent using the existing Склад credentials.
New agent requires sortingLabel support on the server and reports an error if absent; it does not silently print a different template.
Standard layout is 58×40 mm. Other configured paper sizes change physical scaling.

Shared marketplace API/web modules are affected: carry this warning into the PR. Sold VM/FFULHAB is neither deployed nor changed; do not merge or deploy this branch there implicitly. No schema migrations.
Checkpoint deviation: user rules require all tests green before any commit, so RED was run and recorded here but not committed separately. Do not represent unrelated ancestor commits as TDD checkpoints.
