import { expect, it, vi } from 'vitest';
import { WbStockObservations, wbStockCheckDto } from '../src/modules/marketplace-connections/wb-stock-observations';

// TEST: the production ID exceeds signed INT4; storage must use bigint, JSON/WB must use a safe number.
it('stores large WB IDs without truncation and returns JSON-safe identifiers', async () => {
  const upsert = vi.fn(async () => ({ id: 'proof' }));
  await new WbStockObservations({ wbStockPublicationCheck: { upsert } } as any).recorder('c', 'conn')({ warehouseId: 'w', chrtId: 2331826459, amount: 1, status: 'PLANNED', phase: 'PLAN' });
  expect(upsert.mock.calls[0][0].create.chrtId).toBe(2331826459n);
  expect(upsert.mock.calls[0][0].where.connectionId_warehouseId_chrtId.chrtId).toBe(2331826459n);
  expect(JSON.stringify(wbStockCheckDto({ chrtId: 2331826459n, status: 'PLANNED' }))).toContain('2331826459');
  expect(() => wbStockCheckDto({ chrtId: 9007199254740992n })).toThrow();
});
