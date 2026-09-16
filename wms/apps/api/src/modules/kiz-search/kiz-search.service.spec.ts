import { describe, expect, it, vi } from 'vitest';
import { KizSearchService, scanMatchesTarget, SEARCH_CREATED, SEARCH_FOUND } from './kiz-search.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

const kiz = '0104680992599933215UsV,9s0+X%0J';
const user: AuthUser = { id: 'sonya', email: '', name: 'Соня', roleCodes: [], permissionCodes: ['stock:read', 'stock:write'], clientScopeMode: 'LIMITED', clientIds: ['client'], writableClientIds: ['client'], activeWarehouseId: 'warehouse', warehouseIds: ['warehouse'], writableWarehouseIds: ['warehouse'] };
function fixture(enabled = 'true') {
  const request = { id: 'request', number: 1, type: 'OTHER', assignedToUserId: user.id, clientId: 'client', warehouseId: 'warehouse', status: 'SUBMITTED', items: [{ id: 'item', quantity: 1 }] };
  const logs: any[] = [];
  const db: any = {
    $queryRaw: vi.fn(async () => []),
    clientRequest: { findFirst: vi.fn(async ({ where }) => where.assignedToUserId === request.assignedToUserId ? request : null), update: vi.fn(async ({ data }) => Object.assign(request, data)) },
    auditLog: { findFirst: vi.fn(async () => ({ payload: { targets: [{ itemId: 'item', boxCode: 'BOX1', kiz, order: '5773759779', firstWorker: 'Шохида' }] } })), findMany: vi.fn(async () => logs), create: vi.fn(async ({ data }) => { logs.push(data); return data; }) },
    clientRequestEvent: { create: vi.fn(async () => ({})) },
  };
  db.$transaction = vi.fn(async (callback) => callback(db));
  const service = new KizSearchService(db, { get: () => enabled } as any, new ClientScopeService());
  return { service, db, logs, request };
}

// TEST: a scanner can supply the entire Data Matrix or its physical identity.
describe('KIZ search identity', () => {
  it.each([kiz, ']d2' + kiz + '\x1d91EE12\x1d92crypto', kiz + '<GS>91EE12<GS>92crypto', kiz + '91EE1292crypto', '(01)04680992599933(21)5UsV,9s0+X%0J'])('accepts scanner format %s', scan => expect(scanMatchesTarget(scan, kiz)).toBe(true));
  it.each([kiz.toLowerCase(), kiz.slice(0, -1), kiz + 'other', 'prefix' + kiz, '2051609634859', kiz.replace('UsV', 'UsW')])('rejects a different/incomplete identity %s', scan => expect(scanMatchesTarget(scan, kiz)).toBe(false));
});
describe('KIZ search persistence and isolation', () => {
  it('confirms once, completes and accepts a retry without any extra write', async () => {
    const { service, db, request } = fixture();
    expect((await service.scan('request', { boxCode: 'BOX1', kiz }, user)).result).toBe('FOUND');
    expect(request.status).toBe('DONE');
    expect((await service.scan('request', { boxCode: 'BOX1', kiz }, user)).result).toBe('ALREADY_FOUND');
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.clientRequest.update).toHaveBeenCalledTimes(1);
    expect(db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe(SEARCH_FOUND);
    expect(db.auditLog.findFirst.mock.calls[0][0].where.action).toBe(SEARCH_CREATED);
    // Only request, event and audit delegates exist: stock/order writes would fail the test.
  });
  it('does not confirm an unrelated KIZ or an unknown box', async () => {
    const { service, db } = fixture();
    expect((await service.scan('request', { boxCode: 'BOX1', kiz: kiz.toLowerCase() }, user)).result).toBe('NOT_TARGET');
    await expect(service.scan('request', { boxCode: 'BOX2', kiz }, user)).rejects.toThrow('короб');
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects a target scanned in a different listed box', async () => {
    const { service, db, request } = fixture();
    request.items.push({ id: 'item2', quantity: 1 });
    db.auditLog.findFirst.mockResolvedValue({ payload: { targets: [
      { itemId: 'item', boxCode: 'BOX1', kiz }, { itemId: 'item2', boxCode: 'BOX2', kiz: kiz.replace('UsV', 'UsW') },
    ] } });
    await expect(service.scan('request', { boxCode: 'BOX2', kiz }, user)).rejects.toThrow('другом коробе');
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['CANCELLED', 'REJECTED'])('rejects closed status %s', async status => {
    const { service, request } = fixture(); request.status = status;
    await expect(service.scan('request', { boxCode: 'BOX1', kiz }, user)).rejects.toThrow('закрыт');
  });
  it('rejects a different assignee, warehouse, client and read-only scope', async () => {
    const { service, db } = fixture();
    for (const changed of [{ id: 'other' }, { activeWarehouseId: 'other', warehouseIds: ['other'], writableWarehouseIds: ['other'] }, { clientIds: [], writableClientIds: [] }, { writableWarehouseIds: [] }]) {
      await expect(service.scan('request', { boxCode: 'BOX1', kiz }, { ...user, ...changed })).rejects.toThrow();
    }
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('is unavailable on installations where the feature is not enabled', async () => {
    const { service, db } = fixture('false');
    await expect(service.list(user)).rejects.toThrow();
    await expect(service.get('request', user)).rejects.toThrow();
    await expect(service.scan('request', { boxCode: 'BOX1', kiz }, user)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
