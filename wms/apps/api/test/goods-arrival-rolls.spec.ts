import { expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';

function fixture() {
  const rows: any[] = [];
  const auditLog = {
    create: vi.fn(async ({ data }: any) => {
      const row = { ...data, id: String(rows.length), createdAt: new Date() };
      rows.push(row);
      return row;
    }),
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }: any) => rows.find(row => row.id === where.id)),
    update: vi.fn(async ({ where, data }: any) => Object.assign(rows.find(row => row.id === where.id), data)),
  };
  const billing = { createManualInvoice: vi.fn(async (_dto: unknown) => ({ id: 'invoice' })) };
  const db = { auditLog, billingService: { upsert: vi.fn(async () => ({ id: 'service' })) } };
  const service = new WarehouseService(db as any, { requireClientAccess: vi.fn() } as any, {} as any, {} as any, {} as any, billing as any, {} as any);
  const user: any = { id: 'u', name: 'Admin', roleCodes: [], permissionCodes: ['system:admin'], activeWarehouseId: 'w', warehouseIds: ['w'], writableWarehouseIds: ['w'] };
  return { service, user, rows, billing, auditLog };
}
const arrival = { clientId: 'c', arrivalDate: '2026-11-12' };
const period = { clientId: 'c', periodFrom: '2026-11-12', periodTo: '2026-11-12' };

// TEST: a rolls-only arrival is persisted and reloads; legacy arrivals default to zero.
it('saves and lists rolls without requiring bags or boxes', async () => {
  const f = fixture();
  await expect(f.service.createGoodsArrival({ ...arrival, rollCount: 7 }, f.user)).resolves.toMatchObject({ rollCount: 7, bagCount: 0, boxCount: 0 });
  await f.service.createGoodsArrival({ ...arrival, boxCount: 1 }, f.user);
  delete f.rows[1].payload.rollCount;
  expect(await f.service.listGoodsArrivals(period, f.user)).toMatchObject([{ rollCount: 7 }, { rollCount: 0 }]);
});

it('rejects invalid roll quantities even with a box present', async () => {
  const f = fixture();
  for (const rollCount of [-1, 1.5, 'bad']) {
    await expect(f.service.createGoodsArrival({ ...arrival, boxCount: 1, rollCount }, f.user)).rejects.toThrow('rollCount');
  }
  expect(f.auditLog.create).not.toHaveBeenCalled();
});

it('bills only bags and boxes and leaves a rolls-only arrival unlinked', async () => {
  const f = fixture();
  await f.service.createGoodsArrival({ ...arrival, rollCount: 7 }, f.user);
  await expect(f.service.billGoodsArrivals(period, f.user)).rejects.toThrow();
  await f.service.createGoodsArrival({ ...arrival, bagCount: 2, rollCount: 3 }, f.user);
  await f.service.billGoodsArrivals(period, f.user);
  expect(f.billing.createManualInvoice.mock.calls[0][0]).toMatchObject({ rows: [{ quantity: 2 }] });
  expect(f.rows[0].payload.billingInvoiceId).toBeUndefined();
  expect(f.rows[1].payload).toMatchObject({ billingInvoiceId: 'invoice', rollCount: 3 });
});
