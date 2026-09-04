# Inventory: physical barcode + KIZ counting

## Scope

User request (2026-09-04): add KIZ scans alongside barcodes during actualization.
Branch: `feature/inventory-barcode-kiz-counting`, based on `9aaa534`.
Only LOGOFF enables the new Android mode. FFULHAB retains barcode-only requests.
No schema changes. Publication explicitly authorized by the user on 2026-09-04.

### Behaviour

- LOGOFF defaults to “ШК + КИЗ”; the user can switch to “Только ШК”.
- `captureKiz: true` with a marked product barcode returns `SCAN_KIZ` without
  incrementing the count. The following request carries the same barcode and KIZ.
- One KIZ counts one physical unit. Unmarked goods and legacy requests retain
  their barcode/quantity behaviour.
- The full KIZ and barcode/SKU, physical box, worker/device and round timestamp
  are stored as `AuditLog` evidence, in the same serializable transaction as
  the count. Deterministic evidence IDs use the box, counting-round start and
  GS1 identity; repeat scans/changed crypto tails cannot increment twice.
- A repeated identity paired with another SKU in the same round is rejected.
- Reopening a box starts a fresh round; old audit evidence is retained.
- Counting does not create/change ProductMark, StockBalance or order ownership.
  A stale or missing KIZ association does not prevent recording physical evidence.
  APPLY_ACTUAL and reservation/packing reconciliation remain separate operations.

## Files and risks

- `inventory.service.ts`: `scanItem` opt-in branch. Medium data-integrity risk;
  writes limited to audit evidence/count, with active-box transaction guard.
- `dto/inventory.dto.ts`: optional `captureKiz`; legacy wire contract preserved.
- `MainActivity.java`: mode toggle, scan-state transitions, pending-KIZ finish
  guard and matching instructions. FFULHAB cannot enable the mode from this UI.
- `InventoryKizScanState.java`: small box-scoped pending-barcode state and payload.
- `TsdInventoryLine.java`: optional `scanState`/`duplicate` response fields.
- New API/Android tests below. No stock-transfer or actualization decision code changed.

## RED / GREEN

API RED before implementation: 9 failures / 2 passes in
`test/inventory-kiz-counting.spec.ts`. The old implementation counted a barcode
immediately, ignored KIZ evidence, and counted repeats/bulk KIZ requests.

API GREEN: all 11 tests pass. Command:

```text
pnpm --filter @logoff/wms-api test test/inventory-kiz-counting.spec.ts
```

Android compile-time RED: the new tests referenced the missing
`InventoryKizScanState`, producing `cannot find symbol` in unit-test compilation.
GREEN: 31 LOGOFF Android tests pass including 5 new state/payload tests.

```text
gradle --no-daemon testLogoffReleaseUnitTest assembleLogoffRelease
```

| Guarantee | Test | Result |
| --- | --- | --- |
| Barcode preflight does not count marked goods | asks for KIZ after barcode | PASS |
| Full KIZ is recorded without mutating stock/mark | records full KIZ | PASS |
| Identity/crypto-tail repeats do not count again | does not recount | PASS |
| Pair cannot silently switch SKU during round | rejects same KIZ with another SKU | PASS |
| Explicit new round can recount the physical unit | allows recounting | PASS |
| Malformed and bulk KIZ input is rejected | malformed/bulk cases | PASS |
| Audit failure rolls back count | saving scan evidence fails | PASS |
| Concurrent close stops counting | finished concurrently | PASS |
| Legacy/unmarked counting remains valid | preserves barcode-only counting | PASS |
| Client permissions still required | client access checks | PASS |
| Android sends one paired scan and resets pending state safely | InventoryKizScanStateTest (5 tests) | PASS |

Other checks:

- API full suite: 600 passed / 75 failed. Failed test names exactly equal the
  previous release report (`tsd-kiz-rebind-tests-20260904.json`); zero new failures.
  Two failures in `inventory.service.spec.ts` are part of that baseline, not
  failures of the new scan path. No tests disabled or rewritten to hide them.
- Web: 32/32 pass.
- API lint (`tsc --noEmit`) and build: pass.
- LOGOFF release assembly and lintVital: pass.
- FFULHAB variant compilation and unit-test task: pass; no FFULHAB release deployed.
- `git diff --check`: pass.

## Limitations / handoff

Tests use service mocks with rollback simulation, not a live PostgreSQL race.
No physical handheld UI session was exercised. Coverage percentage is not claimed
(coverage provider is not installed). No dependencies were installed.

Existing manual quantity overrides and barcode-only mode can intentionally change
count totals independently of captured evidence. Evidence remains historical;
this feature does not promise complete KIZ coverage when modes are mixed.

Before publication: review PR to `baseline/our-vm-production-20260827`, compare
server changes, deploy API first, then release a newly versioned signed LOGOFF
APK. Do not publish this shared code/APK to FFULHAB without a separate request.
No RED commit was made because the user's green-before-commit rule takes priority.

Release candidate: LOGOFF 0.1.155 / versionCode 154. Signed with the existing
production certificate (verified exact SHA-256 certificate match), APK SHA-256
`1cd9dfcd67353d75c45ce6f180168f795405397eaf93c6a0adfa6de8e6cbc483`.
FFULHAB version metadata unchanged. The user approved publication after disclosure
of the 75 unchanged baseline test failures; this is not a claim of a fully green suite.

## Related incident (read-only findings)

The reported transfer refusal was a scan from `FFL_LKB1007_094`, SKU
`Соул_свмел_молоч`, S / 42, barcode `2051621250518`. Its KIZ still pointed to
`FFL_LKZ32708_03`, moved there by consolidation on 2026-08-31. That old box has
one unit of this SKU in PACKING. The scanned source has six RESERVED units and
six AVAILABLE units after an inventory adjustment on 2026-09-04. These are
database observations, not proof of physical quantities. No stock, reservations
or KIZ bindings were modified during diagnosis. The generic monitor screen had
stale unrelated SKU metadata; the actual API request was used for identification.
