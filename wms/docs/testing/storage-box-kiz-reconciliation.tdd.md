# Storage-box transfer: reconcile a stale KIZ location

## Scope and impact

Journey derived from Konstantin's reported physical scan: inventory corrected the
quantity in the actual source box, while the known ProductMark still points to an
old box with no quantity of that SKU. The user approved changing this behavior.

Branch: `fix/storage-box-kiz-reconciliation`, created from
`feature/tsd-box-to-storage-box` at `e648ddb`.

Production file: `apps/api/src/modules/stock/stock-operations.service.ts`.
Changed functions: `inspectTsdTransferItem`, `executeTsdTransfer`,
`resolveStorageBoxTransferItem`; added `resolveStorageBoxTransferMark`.

Only `transferMode: BOX_TO_STORAGE_BOX` uses reconciliation. Legacy single/batch
transfers, FBS assembly, inventory reconciliation, APK sources, schemas and the
sold WMS deployment are not changed. This is shared API source: a future deployment
to another WMS must review the opt-in mode; there is no claim of tenant-level
isolation if another deployment explicitly calls that same mode.

## Behavior

- First scan must resolve to an available product barcode in the source box.
- Full KIZ must already exist for the same client and SKU, with AVAILABLE status.
  Unknown KIZs are not created. Other KIZ records are not replaced.
- A stale association is eligible only if the old box belongs to the same client
  and explicitly the same warehouse, and has no nonzero SKU balance in any status.
- The physical source must have an available unit not already covered by an
  AVAILABLE mark. No quantity is fabricated to repair the association.
- Existing FBS assembly, shipment history or web sticker-print records for that
  KIZ block automatic correction. GS-separated identity is checked without its
  cryptographic tail. Active or return-required box/SKU tasks also block it.
- Inspection stays read-only. Eligibility is rechecked during execution in the
  existing Serializable transaction. The normal movement is source -1, target +1.
- The mark moves directly from its stale association to the destination. A
  conditional update detects a changed association, and an AuditLog row records
  old/physical/destination boxes, full KIZ, client, branch, worker, device and
  operation key. Audit failure or conditional-update failure aborts the transaction.
- Retrying the completed operation key returns ALREADY_APPLIED without a second
  movement or audit row. Existing destination and source access checks remain.

## TDD evidence

Runner detected from `apps/api/package.json`: Vitest (pnpm repository).
The installed Vitest CLI was invoked directly with the bundled Node runtime;
no package installation or automatic package-manager download was needed.

1. Before production changes, the reproducer ran:
   `node node_modules/vitest/vitest.mjs run test/tsd-storage-box-transfer.spec.ts`.
   **18 failed / 17 passed**. Positive reconciliation failed with the original
   `В коробе FFL_SOURCE нет товара с кодом ...` exception. Rejection-reason and
   rollback-path tests also failed because the intended path did not yet exist.
2. After the minimal fix, the same target: **35 passed**.
3. Added GS/full-value, client access and invalid-destination cases:
   final targeted run **40 passed** (16 original + 24 additional tests).
4. `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: **PASS**.
5. `git diff --check`: **PASS** (only Git's configured LF/CRLF conversion warnings).

| Guarantee | Test target | Evidence |
|---|---|---|
| Read-only inspection accepts the stale known mark | stale KIZ reconciliation suite | PASS |
| One physical transfer, no invented stock, exactly one audit on retry | same suite | PASS |
| Old stock in AVAILABLE/RESERVED/SHIPPING blocks repair | same suite | PASS |
| Wrong SKU, client, warehouse or missing old box blocks repair | same suite | PASS |
| Fully marked source cannot replace an existing mark | same suite | PASS |
| Order/shipment/print history and active tasks block repair | same suite | PASS |
| Changed eligibility between scans is rechecked | same suite | PASS |
| Conditional-update or audit error restores fixture state | same suite | PASS, simulated transaction |
| Full KIZ including GS is retained in audit | same suite | PASS |
| Legacy inspection remains strict | same suite | PASS |

## Full-suite comparison and limitations

Fresh unchanged baseline at e648ddb: **542 passed / 75 failed** (617 tests).
First full run after 19 new cases: **561 passed / the same 75 failed**.
All failing full test titles were compared; no differences in that run.

An intermediate full run after the final five cases had one extra failure:
`BillingPdfService объединяет счета одного клиента в один многостраничный PDF`
timed out at 5000 ms under concurrent test/typecheck load. Its isolated rerun
passed all three PDF tests (the affected test completed in 454 ms). A full rerun
with at most two workers is used to verify the final failure set.

Final command:
`node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=C:/WMSFF2207/kiz-reconciliation-final.json`.
Result: **566 passed / 75 failed** (641 tests). The set of failing full test titles
is identical to the fresh baseline; **zero new or missing failure titles**.
Baseline report: `C:/WMSFF2207/kiz-reconciliation-baseline.json`.

Proposed PR: `fix/storage-box-kiz-reconciliation` into our currently published
`baseline/our-vm-production-20260827` line (subject to user confirmation).

The tests call the real transfer service with mocked Prisma delegates and simulated
transaction rollback. Actual PostgreSQL concurrent transactions and physical TSD
end-to-end behavior have not been exercised. The Serializability guarantee relies
on the existing Prisma transaction configuration, not on the mock's rollback test.

Measured source coverage is not available: no Vitest coverage provider is installed.
A NODE_V8_COVERAGE run produced runtime coverage but did not contain the transformed
stock service, so it is not counted as source coverage or as proof of 80% coverage.

During implementation no RED or GREEN checkpoint commit was made: the user's explicit green-only commit
rule takes precedence over the skill's checkpoint recommendation, and the baseline
suite already fails. No commit, push, PR creation, deployment or further live data
repair is part of this turn. The working diff is preserved for review and an
explicit decision about the existing failing-test gate.

## Publication authorization (2026-09-03)

After receiving the report of 75 unchanged baseline failures, Konstantin explicitly
authorized publication. The pre-commit full API suite was repeated: 566 passed,
75 failed, with the same failing test titles as the unchanged baseline.

Production drift was checked before file replacement. The live stock service also
contains a pre-existing unconditional calculated-overweight warning instead of
blocking closure. That separate production change must be retained: deploy the
scoped KIZ patch on top of the current live file, not the complete local file.
No database migration or APK update is needed. Build a derivative of the current
API image and replace only the stock service source and compiled module; leave
all other runtime modules and the web container unchanged.
