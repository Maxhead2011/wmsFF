# KIZ identity and counted-box transfer

Scope: our WMS, feature branch `fix/kiz-identity-inventory-transfer`, proposed PR base `fix/fbs-transfer-started-at`.

## Incident and behavior

On 16 September a full scan in FFL_LKBBOX_0181 did not match the legacy record without GS separators. Inventory then created another ProductMark. A subsequent ownership correction left a quantity behind in FFL_LKBBOX_0177.

`WMS_KIZ_IDENTITY_TRANSFER_ENABLED=true` enables case-sensitive apparel GTIN/serial matching across standard GS and recognized legacy 91/92 encoding. Full code bytes remain intact for WB and label printing. Multiple records for one identity stop for review instead of picking an arbitrary record. FBS lookup, physical pick, rollback and order/WB-history checks use the same identity.

Inventory confirmation debits a registered unit's previous box in the same Serializable transaction as the count decision, KIZ ownership and audit proof. The target already contains the counted quantity and receives no second increment. Source movement points to the confirming audit; the proof retains old balances and marks. Repeating confirmation is idempotent. Active reservations, concurrent source movements/counts, inaccessible branches, unavailable stock and duplicate identities stop the operation. Old source counts cannot recreate a transferred unit.

The existing approval screens show the source/target and source debit. Android LOGOFF versionCode 173 / `0.1.174-kiz-identity` contains this warning. Other brand version codes are unchanged.

## Changed code

- `apps/api/src/common/kiz-physical-identity.ts`: identity parsing, unique mark lookup and history predicates.
- `apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts`: KIZ lookup/history and pick/return synchronization.
- `apps/api/src/modules/marketplace-connections/fbs-stock-audit.ts`: equivalent identity in the return-to-assembly gate.
- `apps/api/src/modules/inventory/confirmed-kiz-composition.ts`: preserves legacy mark identity and applies source debit.
- `apps/api/src/modules/inventory/confirmed-kiz-transfer.ts`: source locks, availability checks, ledger debit and read-only warning preview.
- `apps/api/src/modules/inventory/inventory.service.ts`: per-operation transaction scope, stale-count guard and warning exposure.
- Web inventory type/panel; Android inventory box model, count/confirmation screen and LOGOFF version.
- `infra/scripts/permanent-return-live-adapter.cjs`: updated hashes of the two intentionally edited functions; existing deployment adaptations and unknown-source rejection remain unchanged.

## Verification

Regression tests first failed on the original composition code: it created an extra mark for a separator variant and left source quantity equal to one after moving the mark.

Automated coverage includes equivalent formats, case sensitivity, duplicate refusal, feature-off isolation, source reserves, branch/client mismatch, concurrent count/movement/update, empty source, replay of stale counts and UI warning visibility.

Dedicated local PostgreSQL tests (`KIZ_DUPLICATE_TEST_DATABASE_URL`, restricted to the existing local test database) verify real SQL lookup, rollback after transfer, the public `resolveBox` rollback with a reserved source, successful public resolution/retry and a subsequent FBS pick/retry. Tests create isolated IDs and clean their own rows only. No production stock or WB calls are used.

Commands: API `vitest run` and `tsc --noEmit`; web `vitest run`, `tsc` and `vite build`; Android `gradle test :app:assembleLogoffDebug --offline --console=plain` (all six brand/build variants).

Results: 2,591 API tests (including five new real PostgreSQL scenarios), 199 web tests, and 528 Android tests passed. API type checking, web production build and LOGOFF debug APK build passed. Local detailed logs are in `D:/WMSFF/_Kof/work/kiz-identity-*-final.log`.

## Release boundary

Feature defaults OFF. Enable only for our WMS after deploying the reviewed API/web and publishing the matching LOGOFF APK. Existing inventory/KIZ audit flags remain required. No schema or mass historical-data migration. Historical duplicate identities require explicit review.

Shared modules are touched: sold WMS must keep the new flag unset/false. Feature-off regression suite and all three Android brands are tested. Publication/deployment have not occurred as part of local implementation; PR creation requires the owner's confirmation under the supplied AGENTS instructions.
