import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientRequestsService } from './client-requests.service';

// TEST: exercise request creation, preserving full demand and recording shortages.
describe('WB client plan with shortage', () => {
  let db: any, service: any;
  const user: any = { id: 'owner' };
  const dto: any = { clientId: 'client', type: 'OUTBOUND', title: 'WB client plan',
    destinationCity: 'Москва', fboExcel: true, fboFormationMode: 'WB_CLIENT_PLAN',
    items: [{ skuId: 'sku', barcode: '2002233639031', quantity: 6 }] };
  beforeEach(() => {
    vi.stubEnv('WMS_FBO_EXCEL_PICK_CHECK_ENABLED', 'true');
    db = { clientRequest: { create: vi.fn(async ({ data }) => ({ ...data, id: 'r', client: { name: 'client' }, items: data.items.create })) },
      clientRequestEvent: { create: vi.fn() }, auditLog: { create: vi.fn() } };
    db.$transaction = vi.fn(async (fn: any) => fn(db));
    service = new ClientRequestsService(db, { requireClientAccess: vi.fn() } as any, {} as any);
    vi.spyOn(service, 'resolveRequestWarehouse').mockResolvedValue('warehouse');
    vi.spyOn(service, 'ensureSkuItemsBelongToClient').mockResolvedValue(undefined);
    vi.spyOn(ClientRequestsService.prototype, 'previewAvailability').mockResolvedValue({ canCommit: false,
      lines: [{ skuId: 'sku', barcode: '2002233639031', requestedQuantity: 6, availableQuantity: 0,
        reservedQuantity: 0, stockQuantity: 0, canFulfill: false }] } as any);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('creates all six units with zero stock and audits the explicit choice', async () => {
    const result = await service.create(dto, user);
    expect(result.items[0].quantity).toBe(6);
    expect(result.status).toBe('SUBMITTED');
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ formationMode: 'WB_CLIENT_PLAN', lines: expect.arrayContaining([
        expect.objectContaining({ requested: 6, available: 0 })]) }) }) }));
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe('Serializable');
  });
  it('still rejects shortages in the default Excel mode', async () => {
    await expect(service.create({ ...dto, fboFormationMode: undefined }, user)).rejects.toThrow();
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it.each([{ items: [] }, { items: [{ quantity: 6 }] }, { items: [{ skuId: 'sku', quantity: -1 }] },
    { type: 'INBOUND' }, { fboExcel: false }])('rejects malformed plans: %j', async change => {
    await expect(service.create({ ...dto, ...change }, user)).rejects.toThrow();
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('cannot activate the mode on an installation without the own-WMS flag', async () => {
    vi.stubEnv('WMS_FBO_EXCEL_PICK_CHECK_ENABLED', 'false');
    await expect(service.create(dto, user)).rejects.toThrow();
  });
  it('propagates access denial before any write', async () => {
    service.clientScopes.requireClientAccess.mockImplementation(() => { throw new Error('denied'); });
    await expect(service.create(dto, user)).rejects.toThrow('denied');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
