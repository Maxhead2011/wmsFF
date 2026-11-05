import { afterEach, describe, expect, it, vi } from 'vitest';
import { reserveFabricOrder, confirmFabricOrderCut, releaseFabricOrder } from './fabric-fbs-order';
import { fabricTaskLines, readFabricTaskLines, requireFabricCutComplete } from './fabric-fbs-task-state';

const owner = { marketplace: 'OZON', connectionId: 'shop', orderId: 'order', requestId: 'request' };
const task = { ...owner, id: 'task', clientId: 'client' };
const line = { lineId: 'item', skuId: 'sku', warehouseId: 'warehouse', material: 'fabric', color: 'white', lengthMm: 3000, units: 2 };
function ledger() { return reserveFabricOrder({ rolls: [{ id: 'roll', warehouseId: 'warehouse', material: 'fabric', color: 'white', remainingMm: 20000, cutMm: 0, createdAt: '2026-11-05T00:00:00Z' }] }, owner, [line]); }
afterEach(() => vi.unstubAllEnvs());
describe('fabric task progress', () => {
  // TEST: confirmations count physical cuts, and never imply a barcode scan.
  it('shows partial confirmed production and the exact remaining pieces', () => {
    const state = confirmFabricOrderCut(ledger(), owner, 'item', 1, 'op').state;
    expect(fabricTaskLines(state, owner)).toEqual([{lineId: 'item', skuId: 'sku', material: 'fabric', color: 'white', lengthMm: 3000, quantity: 2, confirmedUnits: 1, remainingUnits: 1}]);
  });
  it('does not expose another shop or request reserve', () => {
    expect(fabricTaskLines(ledger(), {...owner, connectionId: 'other'})).toBeNull();
    expect(fabricTaskLines(ledger(), {...owner, requestId: 'other'})).toBeNull();
  });
  it('rejects missing, inconsistent and released reservations', () => {
    const missing = ledger(); missing.fbsReservations = [];
    expect(() => fabricTaskLines(missing, owner)).toThrow('сверки');
    const wrong = ledger(); wrong.fbsReservations![0].skuId = 'other';
    expect(() => fabricTaskLines(wrong, owner)).toThrow('сверки');
    expect(() => fabricTaskLines(releaseFabricOrder(ledger(), owner), owner)).toThrow('освобождён');
  });
  it('does not read storage at all on disabled installations', async () => {
    const db = { systemSetting: { findUnique: vi.fn() } };
    expect(await readFabricTaskLines(db, task, false)).toBeNull();
    expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  // TEST: disabling new assignment must not let a previously reserved task fall through to ordinary stock.
  it('stops an existing fabric task when the feature is switched off', async () => {
    const db={systemSetting:{findUnique:vi.fn()}};
    await expect(readFabricTaskLines(db,{...task,sourceArticle:'__FABRIC_FBS__'},false)).rejects.toThrow('временно отключена');
    expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('blocks completion until all cuts are scanned', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true');
    const db = { systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: ledger() }) } };
    await expect(requireFabricCutComplete(db, task)).rejects.toThrow('Сначала отсканируйте');
    db.systemSetting.findUnique.mockResolvedValue({value: confirmFabricOrderCut(ledger(), owner, 'item', 2, 'op').state});
    await expect(requireFabricCutComplete(db, task)).resolves.toBeUndefined();
  });
});
