# FBS physical box claim timeout — TDD evidence

## User journey

As an FBS picker, I can scan a physically suitable box from an alternative pallet-sort and keep working even when a background route refresh delays the database claim beyond Prisma's five-second default.

## Evidence

| Guarantee | Test | Type | Result |
| --- | --- | --- | --- |
| The physical box claim uses an explicit 10-second acquisition wait and 15-second transaction timeout | `MarketplaceConnectionsService > claims an FBS box with receiving status instead of reporting another request` | Unit/integration boundary | PASS |

RED command:

```text
vitest run apps/api/test/marketplace-connections.service.spec.ts -t "claims an FBS box with receiving status"
```

RED result: the transaction call contained only `isolationLevel: Serializable`; expected `maxWait: 10000` and `timeout: 15000` were absent.

GREEN result: 1 test passed, 131 skipped.

Additional verification:

- API TypeScript lint/typecheck: PASS.
- API TypeScript build: PASS.
- Full API suite: 496 passed, 74 pre-existing baseline failures caused by stale branch/access mocks and unrelated fixtures; the targeted test remains green.

## Scope

Only the transaction options for `claimFbsTsdBoxAtomically` changed. Pallet routing, stock calculation, and the sold-VM branch are unchanged.
