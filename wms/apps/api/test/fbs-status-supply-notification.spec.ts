import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { MarketplaceConnectionsService } = process.env.OZON_LINES_RUNTIME ? createRequire(import.meta.url)(process.env.OZON_LINES_RUNTIME + '/marketplace-connections.service.js') : await import('../src/modules/marketplace-connections/marketplace-connections.service');

const change = {
  clientId: 'client', requestId: 'request', number: 1359, title: 'FBS',
  from: 'IN_WORK', to: 'PACKED',
};
const makeService = () => {
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = { fbsOrderRequestLink: { findMany: vi.fn() } };
  service.telegram = { notifyClient: vi.fn().mockResolvedValue(undefined) };
  service.logger = { warn: vi.fn() };
  return service;
};

// TEST: exercise the actual notification path, including lookup and delivery failures.
describe('FBS status notification supply numbers', () => {
  it.each([
    [[{ lastSupplyId: 'WB-GI-1' }, { lastSupplyId: 'WB-GI-1' }], 'Заявка №1359 · Поставка WB-GI-1: FBS'],
    [[{ lastSupplyId: 'WB-GI-2' }, { lastSupplyId: ' WB-GI-1 ' }], 'Заявка №1359 · Поставки WB-GI-1, WB-GI-2: FBS'],
    [[{ lastSupplyId: null }, { lastSupplyId: '  ' }], 'Заявка №1359: FBS'],
    [[], 'Заявка №1359: FBS'],
  ])('includes only real supply IDs', async (links, line) => {
    const service = makeService();
    service.prisma.fbsOrderRequestLink.findMany.mockResolvedValue(links);
    await service.notifyFbsAutoStatusChanges([change]);
    expect(service.prisma.fbsOrderRequestLink.findMany).toHaveBeenCalledWith({
      where: {
        requestId: 'request', clientId: 'client', marketplace: 'WILDBERRIES',
        syncStatus: { not: 'REMOVED' },
      },
      select: { lastSupplyId: true },
    });
    expect(service.telegram.notifyClient).toHaveBeenCalledTimes(1);
    expect(service.telegram.notifyClient).toHaveBeenCalledWith(
      'client', `LOGOFF WMS: изменён статус заявки FBS.\n${line}\nСтатус: В работе → Упаковано`, 'FBS',
    );
  });

  it('still sends the status if supply lookup fails', async () => {
    const service = makeService();
    service.prisma.fbsOrderRequestLink.findMany.mockRejectedValue(new Error('DB unavailable'));
    await service.notifyFbsAutoStatusChanges([change]);
    expect(service.telegram.notifyClient).toHaveBeenCalledWith(
      'client', expect.stringContaining('Заявка №1359: FBS'), 'FBS',
    );
    expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining('supply lookup failed'));
  });

  it('continues with the next committed transition if Telegram fails', async () => {
    const service = makeService();
    service.prisma.fbsOrderRequestLink.findMany.mockResolvedValue([]);
    service.telegram.notifyClient.mockRejectedValueOnce(new Error('Telegram unavailable'));
    await service.notifyFbsAutoStatusChanges([change, { ...change, number: 1360, requestId: 'next' }]);
    expect(service.telegram.notifyClient).toHaveBeenCalledTimes(2);
    expect(service.telegram.notifyClient).toHaveBeenLastCalledWith(
      'client', expect.stringContaining('Заявка №1360'), 'FBS',
    );
  });
});
