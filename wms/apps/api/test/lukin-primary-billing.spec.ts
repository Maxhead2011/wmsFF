import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const clients = ['c76b78f9-1b83-4e9b-bee3-bc28336ee1c9', '68cbb87b-5f53-4123-8b08-62ef372059b5'];
function setup(clientId = clients[0]) {
  const line = (key: string, serviceCode: string, price: number, quantity = 12) => ({ key, serviceCode,
    serviceId: key.startsWith('SERVICE') ? key : null, description: key, quantity, unitPriceRub: price,
    priceBeforeTaxRub: price, taxMode: 'INCLUDED' });
  const input = { clientId, shipmentKey: 'supply', shipmentOrders: [{ id: '1', supplyId: 'WB-1' }],
    shipmentItems: 12, warehouseId: 'warehouse', requestId: null, serviceDate: new Date('2026-09-14'), lines: [
      line('WHITE', 'FBS_PRIMARY_WHITE', 10),
      line('SERVICE:extra', 'NOM_ДОПОЛНИТЕЛЬНЫЕ_УСЛУГИ_ПО_УПАКОВКЕ', 4.26),
      line('SERVICE:processing', 'ITEM_PROCESSING', 10.64),
      { ...line('RELABEL', 'NOM_ПЕРЕМАРКИРОВКА', 10, 8), unitPriceRub: 10.64, taxMode: 'ADD_6_PERCENT' },
    ] };
  const db: any = {
    billingInvoice: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }) => ({ id: 'invoice', number: data.number, status: data.status })) },
    billingCharge: { findMany: vi.fn(async () => []), create: vi.fn(async ({ data }) => ({ id: data.sourceKey, ...data })), updateMany: vi.fn() },
  };
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  return { input, db, run: () => service.ensureFbsPrimaryProcessingInvoiceLocked(input) };
}
afterEach(() => vi.unstubAllEnvs());
describe('Lukin primary processing composition', () => {
  // TEST: exact screenshot reproduction, both Lukin client cards; no second 12 x 10 line.
  it.each(clients)('writes only extras, one primary service and actual relabeling for %s', async clientId => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, db } = setup(clientId); await run();
    const data = db.billingInvoice.create.mock.calls[0][0].data;
    expect(data.totalRub).toBe(263.91);
    expect(data.items.create).toHaveLength(3);
    expect(data.items.create.map((i: any) => i.description)).toEqual(['Дополнительные услуги', 'Первичная обработка', 'RELABEL']);
    expect(db.billingCharge.create.mock.calls[1][0].data.metadata.billingPolicy).toBe('LUKIN_PRIMARY_V1');
  });
  it('does not invent relabeling and applies the agreed tax-inclusive unit prices', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { input, run, db } = setup();
    input.lines.pop(); input.lines[1].priceBeforeTaxRub = 4; input.lines[1].taxMode = 'ADD_6_PERCENT';
    input.lines[2].priceBeforeTaxRub = 20;
    await run();
    expect(db.billingInvoice.create.mock.calls[0][0].data).toMatchObject({ totalRub: 178.8, items: { create: [
      { quantity: 12, unitPriceRub: 4.26, totalRub: 51.12 }, { quantity: 12, unitPriceRub: 10.64, totalRub: 127.68 },
    ] } });
  });
  it.each(['false', 'true'])('leaves unrelated clients unchanged with flag %s', async flag => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', flag);
    const { run, db } = setup('other-client'); await run();
    expect(db.billingInvoice.create.mock.calls[0][0].data.totalRub).toBe(383.91);
  });
  it('leaves legacy behavior unchanged when disabled', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'false');
    const { run, db } = setup(); await run();
    expect(db.billingInvoice.create.mock.calls[0][0].data.items.create).toHaveLength(4);
  });
  it('refuses incomplete configuration instead of silently charging only extras', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup(); input.lines.splice(2, 1);
    await expect(run()).rejects.toThrow(/первичн/i);
    expect(db.billingCharge.create).not.toHaveBeenCalled();
  });
  // TEST: do not silently accept duplicate catalogue links or unrelated primary services.
  it('rejects duplicate primary services before writes', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup(); input.lines.push({ ...input.lines[2], key: 'SERVICE:duplicate' });
    await expect(run()).rejects.toThrow(/одна услуга/i);
    expect(db.billingCharge.create).not.toHaveBeenCalled();
  });
  it('excludes gray, returns and unrelated additional services from this composition', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup();
    for (const code of ['FBS_PRIMARY_GRAY', 'FBS_PRIMARY_RETURN', 'CLOTHING_PROCESSING', 'BOX']) {
      input.lines.push({ ...input.lines[2], key: `SERVICE:${code}`, serviceCode: code });
    }
    await run();
    expect(db.billingInvoice.create.mock.calls[0][0].data.totalRub).toBe(263.91);
  });
  it.each([
    { status: 'ISSUED' }, { status: 'PAID' }, { status: 'DRAFT', paidRub: 1 },
    { status: 'DRAFT', _count: { payments: 1 } }, { status: 'CANCELLED', comment: 'Объединено в счёт 123' },
  ])('preserves protected invoices %j', async state => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, db } = setup();
    db.billingInvoice.findUnique.mockResolvedValue({ id: 'protected', number: '1', ...state });
    await run();
    expect(db.billingCharge.create).not.toHaveBeenCalled();
    expect(db.billingCharge.updateMany).not.toHaveBeenCalled();
    expect(db.billingInvoice.create).not.toHaveBeenCalled();
  });
  it('recalculates an owned unpaid draft and cancels its obsolete white charge', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup();
    db.billingInvoice.findUnique.mockResolvedValue({ id: 'draft', number: '1', status: 'DRAFT' });
    db.billingCharge.findMany.mockResolvedValue([{ id: 'old-white', status: 'DRAFT', invoiceItems: [],
      sourceKey: `fbs-primary:${input.clientId}:supply:WHITE` }]);
    const tx = { billingInvoiceItem: { deleteMany: vi.fn(), createMany: vi.fn() }, billingInvoice: { update: vi.fn() } };
    db.$transaction = (fn: any) => fn(tx);
    await run();
    expect(db.billingCharge.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['old-white'] } }, data: { status: 'CANCELLED' } });
    expect(tx.billingInvoiceItem.createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(tx.billingInvoice.update.mock.calls[0][0].data.totalRub).toBe(263.91);
  });
  it('does not rewrite charges already included in another invoice', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, db } = setup();
    db.billingCharge.findMany.mockResolvedValue([{ invoiceItems: [{ id: 'other-invoice-item' }] }]);
    await run();
    expect(db.billingCharge.create).not.toHaveBeenCalled();
    expect(db.billingCharge.updateMany).not.toHaveBeenCalled();
  });
  it('does not create charges for an empty shipment', async () => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup(); input.shipmentItems = 0; await run();
    expect(db.billingCharge.create).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, NaN])('rejects invalid shipment quantity %s', async quantity => {
    vi.stubEnv('WMS_LUKIN_PRIMARY_SERVICE_POLICY_ENABLED', 'true');
    const { run, input, db } = setup(); input.shipmentItems = quantity;
    await expect(run()).rejects.toThrow(/количество/i);
    expect(db.billingCharge.create).not.toHaveBeenCalled();
  });
});
