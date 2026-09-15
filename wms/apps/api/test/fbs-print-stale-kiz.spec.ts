import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const code = '0104640569959539215eCUd%lbPYtuV';
function fixture(status = 'RELEASED') {
  const rows = [
    { id: 'old', orderId: '5528228869', status, kiz: code + '\u001d91EE12\u001d92OLD' },
    { id: 'new', orderId: '5761274080', status: 'COMPLETED', kiz: code + '\u001d91EE12\u001d92NEW' },
  ];
  const db: any = {
    fbsTsdAssembly: { findMany: vi.fn(async ({ where }: any) => rows.filter(t =>
      t.status !== where.status.not && !where.status.notIn?.includes(t.status) &&
      where.OR.some((p: any) => t.kiz.includes(p.kiz.contains)))) },
    fbsWebKizStickerPrint: { findFirst: vi.fn(async () => null), create: vi.fn() },
  };
  const service: any = new MarketplaceConnectionsService(db, { resolveClientFilter: () => 'client' } as never);
  // TEST: stop at the first external action; selecting the correct order is observable without printing.
  service.loadFbsTsdOrderSticker = vi.fn(async () => { throw Error('sticker boundary'); });
  return { db, service, rows, run: () => service.scanWebOrderAssembly(code, { clientIds: [] }) };
}
it('prints the current order when the same SGTIN remains on a released task (5761274080)', async () => {
  // TEST: before the fix, a released historical record makes the scan ambiguous.
  const f = fixture();
  await expect(f.run()).rejects.toThrow('sticker boundary');
  expect(f.service.loadFbsTsdOrderSticker).toHaveBeenCalledWith(f.rows[1]);
  expect(f.db.fbsTsdAssembly.findMany.mock.calls[0][0].where.clientId).toBe('client');
});
it.each(['COMPLETED', 'IN_PROGRESS', 'RETURN_REQUIRED'])('does not choose arbitrarily between live matches: %s', async status => {
  const f = fixture(status);
  await expect(f.run()).rejects.toThrow('неоднозначно');
  expect(f.service.loadFbsTsdOrderSticker).not.toHaveBeenCalled();
});
it('keeps the existing duplicate-print guard for the selected current order', async () => {
  const f = fixture();
  f.db.fbsWebKizStickerPrint.findFirst.mockResolvedValue({ printedAt: new Date(), printedBy: 'Operator' });
  await expect(f.run()).rejects.toThrow('Повторная печать запрещена');
  expect(f.service.loadFbsTsdOrderSticker).not.toHaveBeenCalled();
});
