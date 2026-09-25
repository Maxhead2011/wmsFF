import { describe, expect, it } from 'vitest';
import { ClientRequestStatus, MarketplaceType } from '@prisma/client';
import { LUKIN_FBS_BATCH_CLIENT_ID, lukinBatchApplies, selectLukinFbsBatch, savedLukinFbsBatchIds } from '../src/modules/marketplace-connections/fbs-lukin-batch';
import { createRequire } from 'node:module';
// TEST: exercise the published candidate, where the batch call was lost.
const { MarketplaceConnectionsService } = process.env.FBS_RUNTIME_ENTRY
  ? createRequire(import.meta.url)(process.env.FBS_RUNTIME_ENTRY)
  : await import('../src/modules/marketplace-connections/marketplace-connections.service');

const requests = [8, 4, 7, 2, 6, 3, 1].map((number) => ({ requestId: `request-${number}`, requestNumber: number }));

describe('Lukin FBS TSD batch', () => {
  it('shows the full queue to administrator and owner', () => {
    // TEST: supervisors must bypass both list filtering and direct-selection blocking.
    expect(lukinBatchApplies(['ADMIN'])).toBe(false);
    expect(lukinBatchApplies(['OWNER'])).toBe(false);
    expect(lukinBatchApplies(['PICKER'])).toBe(true);
  });
  it('keeps the five oldest requests until every one is picked', () => {
    // TEST: finishing one request cannot reveal request #6 on refresh.
    const first = selectLukinFbsBatch(requests, []);
    expect(first.requestIds).toEqual(['request-1', 'request-2', 'request-3', 'request-4', 'request-6']);
    const afterOne = selectLukinFbsBatch(requests.filter((row) => row.requestId !== 'request-1'), first.requestIds);
    expect(afterOne.visible.map((row) => row.requestId)).toEqual(['request-2', 'request-3', 'request-4', 'request-6']);
    expect(afterOne.rotated).toBe(false);
    const next = selectLukinFbsBatch(requests.filter((row) => !first.requestIds.includes(row.requestId)), first.requestIds);
    expect(next.requestIds).toEqual(['request-7', 'request-8']);
    expect(next.rotated).toBe(true);
  });

  it('ignores malformed saved setting', () => {
    expect(savedLukinFbsBatchIds({ requestIds: ['a', null, 12, 'b'] })).toEqual(['a', 'b']);
    expect(savedLukinFbsBatchIds({ requestIds: 'a' })).toEqual([]);
  });

  it('keeps a shared five-request Lukin window while other clients remain unrestricted', async () => {
    // TEST: refresh after one picked request must not expose a sixth Lukin request.
    const client = { id: LUKIN_FBS_BATCH_CLIENT_ID, code: 'CL-000001', name: 'ИП Лукин Илья Ильич' };
    const other = { id: 'other-client', code: 'CL-OTHER', name: 'Другой клиент' };
    const makeLink = (number: number, owner = client) => ({
      requestId: `${owner.id}-${number}`, marketplace: MarketplaceType.WILDBERRIES,
      connectionId: `connection-${owner.id}`, orderId: `order-${number}`,
      lastCategory: 'active', lastSupplierStatus: 'confirm', lastSupplyId: null,
      lastSkuId: `sku-${owner.id}-${number}`, lastWbStatus: null,
      request: { id: `${owner.id}-${number}`, number, title: `FBS ${number}`,
        status: ClientRequestStatus.IN_WORK, fbsEmergencyAssemblyAt: null,
        fbsEmergencyAssemblyByName: null, client: owner },
    });
    let links = [...Array.from({ length: 7 }, (_, index) => makeLink(index + 1)),
      makeLink(50, other), makeLink(51, other)];
    let setting: { value: { requestIds: string[] } } | null = null;
    const prisma = {
      fbsTsdAssembly: { findFirst: async () => null, findMany: async () => [] },
      fbsOrderRequestLink: { findMany: async () => links },
      fbsSupplyPlan: { findMany: async () => [] },
      stockBalance: { findMany: async () => links.map((link) => ({
        skuId: link.lastSkuId, clientId: link.request.client.id, boxId: 'box-1',
      })) },
      client: { findMany: async () => [] },
      sku: { findMany: async () => [] },
      systemSetting: {
        findUnique: async () => setting,
        upsert: async (args: { create: { value: { requestIds: string[] } }; update: { value: { requestIds: string[] } } }) => {
          setting = { value: setting ? args.update.value : args.create.value };
          return setting;
        },
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => 1,
        systemSetting: prisma.systemSetting,
      }),
    };
    const service = new MarketplaceConnectionsService(prisma as never, {
      resolveClientFilter: () => ({ in: [client.id, other.id] }), requireClientAccess: () => undefined,
    } as never);
    const user = { id: 'worker-1', name: 'Сборщик' } as never;
    const first = await service.listFbsTsdRequests('TSD-1', user);
    expect(first.requests.filter((row) => row.client.id === client.id).map((row) => row.requestNumber))
      .toEqual([5, 4, 3, 2, 1]);
    expect(first.requests.filter((row) => row.client.id === other.id)).toHaveLength(2);
    const admin = await service.listFbsTsdRequests('TSD-ADMIN', {
      id: 'admin-1', name: 'Администратор', roleCodes: ['ADMIN'],
    } as never);
    const owner = await service.listFbsTsdRequests('TSD-OWNER', {
      id: 'owner-1', name: 'Владелец', roleCodes: ['OWNER'],
    } as never);
    // TEST: supervisor views all seven Lukin requests even while the picker window is fixed.
    expect(admin.requests.filter((row) => row.client.id === client.id)).toHaveLength(7);
    expect(owner.requests.filter((row) => row.client.id === client.id)).toHaveLength(7);

    links = links.filter((link) => link.requestId !== `${client.id}-1`);
    const afterOne = await service.listFbsTsdRequests('TSD-2', user);
    expect(afterOne.requests.filter((row) => row.client.id === client.id).map((row) => row.requestNumber))
      .toEqual([5, 4, 3, 2]);
    links = links.filter((link) => link.request.client.id !== client.id || link.request.number > 5);
    const next = await service.listFbsTsdRequests('TSD-1', user);
    expect(next.requests.filter((row) => row.client.id === client.id).map((row) => row.requestNumber))
      .toEqual([7, 6]);
  });
});
