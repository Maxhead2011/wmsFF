import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as protection from '../src/modules/warehouse/fabric-fbs-protection';
import { reserveFabric } from '../src/modules/warehouse/fabric-fbs-ledger';

const root = process.env.FABRIC_FBS_RUNTIME_DIST;
function load(name: string) {
  const filename = join(root!, 'modules/warehouse', name);
  const module = { exports: {} as any };
  const require = createRequire(import.meta.url);
  runInNewContext(readFileSync(filename, 'utf8'), {
    module, exports: module.exports, structuredClone,
    require: (id: string) => id === './fabric-fbs-protection' ? protection : require(id),
  }, { filename });
  return module.exports;
}
const roll = { id: 'roll', warehouseId: 'w', material: 'SATIN', color: 'white', remainingMm: 10000, cutMm: 0, createdAt: '2026-11-01' };
const event = { key: 'shipment', requestId: 'request', taskId: 'task', marketplace: 'WILDBERRIES', connectionId: 'c', orderId: 'o',
  warehouseId: 'w', skuId: 'sku', material: 'SATIN', color: 'white', mm: 6000, at: '2026-11-05' };

describe.skipIf(!root)('actual material writer candidate', () => {
  // TEST: execute the patched runtime planner, not a reimplementation of it.
  it('preserves unreserved legacy shipment calculation', () => {
    const { planShipments } = load('fabric-shipment-accounting.js');
    const result = planShipments({ rolls: [roll] }, [event], []);
    expect(result.state.rolls[0].remainingMm).toBe(4000);
    expect(result.changes[0].rawMm).toBe(6000);
  });
  it('cannot spend raw material reserved by another FBS order', () => {
    const { planShipments } = load('fabric-shipment-accounting.js');
    const state = reserveFabric({ rolls: [roll] }, { key: 'another', warehouseId: 'w', material: 'SATIN', color: 'white', skuId: 'sku', lengthMm: 3000, units: 2 });
    const result = planShipments(state, [event], []);
    expect(result.state.rolls[0].remainingMm).toBe(6000);
    expect(result.pending[0].meters).toBe(2);
  });
  it('uses this task production credit without another raw debit, including retry', () => {
    const { planShipments } = load('fabric-shipment-accounting.js');
    const credit = { ...event, key: 'cut', at: '2026-11-04' };
    const result = planShipments({ rolls: [{ ...roll, remainingMm: 4000, cutMm: 6000 }] }, [event], [credit]);
    expect(result.state.rolls[0].remainingMm).toBe(4000);
    expect(result.changes[0]).toMatchObject({ rawMm: 0, coveredMm: 6000 });
    expect(planShipments(result.state, [event], [credit]).changes).toHaveLength(0);
  });
  it('does not consume a new attempt credit for an older task of the same order', () => {
    const { planShipments } = load('fabric-shipment-accounting.js');
    const result = planShipments({ rolls: [{ ...roll, remainingMm: 0 }] }, [event], [{ ...event, key: 'cut', taskId: 'new-attempt', at: '2026-11-04' }]);
    expect(result.state.shipmentAccounting.creditsUsed).toEqual({});
    expect(result.pending[0].meters).toBe(6);
  });
  it('prefers bound production before consuming generic old cut credit', () => {
    const { planShipments } = load('fabric-shipment-accounting.js');
    const result = planShipments({ rolls: [roll] }, [event], [
      { key: 'generic', skuId: 'sku', warehouseId: 'w', at: '2026-11-04', mm: 6000 },
      { ...event, key: 'own', at: '2026-11-04' },
    ]);
    expect(result.state.shipmentAccounting.creditsUsed).toEqual({ own: 6000 });
  });
  it('includes manufacturing volume history in storage calculation', async () => {
    const { fabricRollStorageSources } = load('fabric-roll-storage.js');
    const db = { systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { rolls: [roll] } }) },
      auditLog: { findMany: vi.fn().mockResolvedValue([{ id: 'cut', createdAt: new Date(), payload: {
        warehouseId: 'w', material: 'SATIN', color: 'white', storageRollEquivalentDelta: -0.06, volumeLiters: 24.740,
      } }]) } };
    const result = await fabricRollStorageSources(db, 'client', new Date());
    expect(db.auditLog.findMany.mock.calls[0][0].where.action.in).toContain('FABRIC_FBS_CUT');
    expect(result.movements[0].quantity).toBe(-0.06);
  });
});
