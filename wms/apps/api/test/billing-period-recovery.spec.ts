import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/modules/billing/billing.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { buildPeriodPlan, classifyBillingRegistryInvoice, type PeriodInvoice, type PeriodInput } from '../src/modules/billing/billing-period-policy';

// TEST: the persisted recovery bundle must survive period consolidation without new charges.
const clientId = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
const input: PeriodInput = { clientId, periodFrom: '2026-09-01', periodTo: '2026-09-15', categories: ['FBS', 'PROCESSING'], excludeLukin: false };
function recovered(): PeriodInvoice & { sourceKey: string } {
  return {
    id: 'recovered', number: 'RECOVERY', clientId, client: { id: clientId, code: '0001', name: 'ИП Лукин Илья Ильич' },
    sourceKey: `fbs-invoice:${clientId}:completed-work:fixture`, warehouseId: 'moscow',
    periodFrom: new Date('2026-09-15T00:00:00Z'), periodTo: new Date('2026-09-15T00:00:00Z'),
    updatedAt: new Date('2026-09-15T12:00:00Z'), status: 'DRAFT', paidRub: 0, payments: [], totalRub: 52,
    items: [37.1, 10.64, 4.26].map((amount, index) => ({
      id: `item-${index}`, chargeId: `charge-${index}`, description: `Service ${index}`, unit: 'PIECE',
      quantity: 1, unitPriceRub: amount, totalRub: amount, serviceDate: new Date('2026-09-15T00:00:00Z'),
      charge: { metadata: { kind: index === 0 ? 'FBS' : 'FBS_PRIMARY_PROCESSING', billingPolicy: 'FBS_COMPLETED_WORK_V1', processingOnly: true } },
    })),
  };
}
const plan = (invoices: PeriodInvoice[]) => buildPeriodPlan(input, [], invoices, 'moscow');
describe('recovered FBS invoices in period generation', () => {
  // TEST: exercise the real writer then feed its persisted shape back to preview/reuse.
  it('copies original charge links/prices and reuses the resulting invoice without a second write', async () => {
    const source = recovered();
    const tx: any = { billingInvoice: {
      count: vi.fn().mockResolvedValue(1), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(async ({ data }) => ({ ...source, ...data, id: 'generated', items: data.items.create.map((row: any, i: number) => ({
        ...row, id: `new-item-${i}`, charge: source.items.find(item => item.chargeId === row.chargeId)!.charge,
      })) })),
    }, billingInvoiceItem: { count: vi.fn().mockResolvedValue(0) }, auditLog: { create: vi.fn() } };
    const billing = new BillingService(tx, new ClientScopeService());
    const writeInput = { clientId, warehouseId: 'moscow', category: 'FBS' as const, periodFrom: input.periodFrom, periodTo: input.periodTo,
      sourceKey: `billing-period:${'a'.repeat(64)}:FBS:${clientId}`, charges: [], invoices: [source] };
    const user: any = { id: 'test', permissionCodes: ['system:admin'], clientScopeMode: 'ALL', activeWarehouseId: 'moscow' };
    const saved = await billing.writePeriodDraft(tx, writeInput, user);
    expect(saved.totalRub).toBe(52);
    expect(saved.items.map((item: any) => item.chargeId)).toEqual(source.items.map(item => item.chargeId));
    expect(saved.items.map((item: any) => Number(item.unitPriceRub))).toEqual([37.1, 10.64, 4.26]);
    expect(plan([saved]).groups[0]).toMatchObject({ action: 'EXISTING', existingInvoiceId: 'generated', totalRub: 52 });
    expect(await billing.writePeriodDraft(tx, { ...writeInput, invoices: [saved] }, user)).toBe(saved);
    expect(tx.billingInvoice.create).toHaveBeenCalledTimes(1);
    expect(tx.billingInvoice.updateMany).toHaveBeenCalledTimes(1);
  });
  it('includes all three fixed-price services on September 15, without charging again', () => {
    const result = plan([recovered()]);
    expect(result.issues).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ category: 'FBS', invoiceIds: ['recovered'], chargeIds: [], totalRub: 52, itemCount: 3 });
    expect(result.groups[0].lines.map(line => line.unitPriceRub)).toEqual(['37.1', '10.64', '4.26']);
  });
  it('recognizes the resulting full-period invoice on the next preview as EXISTING', () => {
    const invoice = recovered();
    invoice.sourceKey = `billing-period:${'a'.repeat(64)}:FBS:${clientId}`;
    invoice.periodFrom = new Date('2026-09-01T00:00:00Z');
    const result = plan([invoice]);
    expect(classifyBillingRegistryInvoice(invoice)).toBe('FBS');
    expect(result.groups[0]).toMatchObject({ action: 'EXISTING', existingInvoiceId: 'recovered', totalRub: 52 });
  });
  it('allows ordinary FBS rows joined with a proven recovery bundle in the period result', () => {
    const invoice = recovered();
    invoice.sourceKey = `billing-period:${'b'.repeat(64)}:FBS:${clientId}`;
    invoice.items.push({ ...invoice.items[0], id: 'legacy', chargeId: 'legacy', charge: { service: { code: 'FBS_PROCESSING' } } });
    invoice.totalRub = 89.1;
    expect(plan([invoice]).groups[0]?.totalRub).toBe(89.1);
  });
  it.each(['ordinary', `billing-period:bad:FBS:${clientId}`, `billing-period:${'a'.repeat(64)}:PROCESSING:${clientId}`])('rejects unproven mixed provenance %s', sourceKey => {
    expect(plan([{ ...recovered(), sourceKey } as PeriodInvoice]).groups).toEqual([]);
  });
  it.each(['paid', 'payment', 'issued', 'wrong-branch', 'missing-branch', 'outside', 'zero-price', 'wrong-total', 'unknown-service'])('preserves the %s guard for recovered documents', reason => {
    const invoice = recovered();
    if (reason === 'paid') invoice.paidRub = 1;
    if (reason === 'payment') invoice.payments = [{}];
    if (reason === 'issued') invoice.status = 'ISSUED';
    if (reason === 'wrong-branch') invoice.warehouseId = 'noginsk';
    if (reason === 'missing-branch') invoice.warehouseId = null;
    if (reason === 'outside') invoice.items[0].serviceDate = new Date('2026-09-16T00:00:00Z');
    if (reason === 'zero-price') invoice.items[0].unitPriceRub = 0;
    if (reason === 'wrong-total') invoice.totalRub = 100;
    if (reason === 'unknown-service') invoice.items[0].charge = null;
    expect(plan([invoice]).groups).toEqual([]);
  });
  it('rejects duplicate charge sources and leaves arbitrary mixed invoices blocked', () => {
    expect(plan([recovered(), { ...recovered(), id: 'duplicate' }]).groups).toEqual([]);
    const invoice = recovered();
    invoice.items.forEach(item => { item.charge!.metadata = { kind: (item.charge!.metadata as any).kind }; });
    expect(plan([invoice]).groups).toEqual([]);
  });
});
