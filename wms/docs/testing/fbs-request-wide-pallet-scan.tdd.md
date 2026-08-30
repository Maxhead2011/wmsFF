# FBS request-wide pallet scan TDD evidence

## Source and user journey

The journey was derived from production request 466: a picker must be able to
scan every pallet shown as needed for the current WMS request, including when
that request contains orders from several WB supplies.

## RED

Command:

```text
vitest run test/marketplace-connections.service.spec.ts -t "accepts a needed pallet across supplies of the same FBS request"
```

Result before the fix: `1 failed`; the scanner calculation returned `[]`
instead of `FFL_LKB0207_219` because it filtered candidates by `supplyId`.

## GREEN

The same command passed after removing the supply-only filter from the
request-wide pallet calculation.

| Guarantee | Test | Type | Result |
| --- | --- | --- | --- |
| A pallet needed by another WB supply in the same WMS request is accepted | `accepts a needed pallet across supplies of the same FBS request` | Unit/service | PASS |
| An untouched active route remains physically claimable | `shows a box on the pallet when another active TSD route is still untouched` | Unit/service | PASS |
| A physical box scan can claim an untouched active route | `switches a physically scanned box from another untouched active TSD route` | Unit/service | PASS |
| Live stock remains bounded by protected physical reservations | `fbs-route-availability.spec.ts` | Unit | PASS |

## Verification

- Related tests: `5 passed`.
- API lint/typecheck: PASS.
- API build: PASS.
- Full API suite: `507 passed`, `74 failed`; the 74 failures are the unchanged
  baseline failures in legacy branch/access mocks and are unrelated to this fix.

## Checkpoints

- RED: `c97af2d test(fbs): reproduce cross-supply pallet rejection`
- GREEN: `443c7a7 fix(fbs): validate pallets across request supplies`
