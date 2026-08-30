# FBS product-first source selection: TDD evidence

## Scope

The TSD may scan a product barcode before a box. After WMS confirms that the product is needed by the current FBS request, the employee must either scan the physical source box/pallet or defer the source with `БЕЗ КОРОБА`; deferred stock is resolved by the existing manager workflow when the request is closed.

## RED checkpoint

Commit: `8044fc9 test(fbs): reproduce product-first source selection`

The initial test run reproduced three failures:

- a task with an accepted product barcode could not claim its physical source box and returned `FBS_TASK_STALE`;
- `БЕЗ КОРОБА` was resolved as a normal warehouse code before the deferred-source workflow;
- a deferred source still entered the stock reservation path and could create a phantom `PACKING` deduction.

## GREEN protection

The focused test file covers:

1. attaching a physical source box after the product barcode;
2. deferring the source only after WMS accepts the product;
3. refusing deferred source selection before product validation;
4. preventing stock reservation until the manager resolves the deferred source.

Android validation overlays the two changed TSD files on the current production Android source before running the Logoff unit-test and APK build tasks. This is necessary because the published Git baseline does not contain several supporting Android source updates already used by its `MainActivity`.

## Commands

```text
vitest run test/fbs-product-first-source-choice.spec.ts
vitest run test/fbs-product-first-source-choice.spec.ts test/fbs-stock-reservation-mark.spec.ts
vitest run
gradle testLogoffDebugUnitTest assembleLogoffDebug
tsc -p tsconfig.json --noEmit
tsc -p tsconfig.json
```

## Known baseline failures

The full API run is not green on the selected published baseline: 74 of 585 tests fail across 23 legacy files because old fixtures do not provide newer warehouse scope, Prisma delegate and access-scope data. In the largest `marketplace-connections.service.spec.ts` file, 27 of 135 tests fail and two integration-style cases exceed their five-second timeout. The focused tests for this change and the adjacent stock-reservation tests pass.
