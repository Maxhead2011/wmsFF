import { describe, it, expect, vi } from 'vitest';
import { reserveFabricOrder, FabricOrderLedger } from './fabric-fbs-order';
import { confirmFabricProduction } from './fabric-fbs-confirmation';

const owner = { marketplace: 'OZON', connectionId: 'c', orderId: 'o', requestId: 'r' };
const actor = { userId: 'u', deviceCode: 'device' };
const command = { clientId: 'client', taskId: 'task', owner, lineId: 'item', confirmedUnits: 2, operationId: 'operation' };
function fixture() {
  let saved: FabricOrderLedger = reserveFabricOrder({ rolls: [{ id: 'roll', warehouseId: 'w', material: 'SATIN', color: 'white',
    remainingMm: 100000, cutMm: 0, createdAt: '2026-11-05' }] }, owner,
    [{ lineId: 'item', skuId: 'sku', warehouseId: 'w', material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 }]);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    systemSetting: { findUnique: vi.fn(async () => ({ value: saved })), update: vi.fn(async (args: any) => { saved = args.data.value; }) },
    clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'r', clientId: 'client', status: 'SUBMITTED', warehouseId: 'w' }) },
    fbsTsdAssembly: { findUnique: vi.fn().mockResolvedValue({ id: 'task', clientId: 'client', ...owner, status: 'IN_PROGRESS', workerUserId: 'u', deviceCode: 'device' }) },
    clientRequestItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item', requestId: 'r', skuId: 'sku', quantity: 2 }) },
  };
  return { tx, saved: () => saved, proof: vi.fn().mockResolvedValue(undefined) };
}
describe('fabric confirmation boundary', () => {
  // TEST: proof failure must abort before storing the material debit.
  it('requires production proof and passes the exact surrounding transaction', async () => {
    const f = fixture();
    await expect(confirmFabricProduction(f.tx, command, actor, f.proof)).resolves.toEqual({ cutUnits: 2, cutMm: 6000, replay: false });
    expect(f.proof).toHaveBeenCalledWith(f.tx, expect.objectContaining({ ...owner, units: 2, mm: 6000, userId: 'u', skuId: 'sku' }));
    expect(f.saved().rolls[0].remainingMm).toBe(94000);
    await confirmFabricProduction(f.tx, command, actor, f.proof);
    expect(f.proof).toHaveBeenCalledTimes(1);
  });
  it('does not store a debit after a failed stock proof', async () => {
    const f = fixture(); f.proof.mockRejectedValue(new Error('stock write failed'));
    await expect(confirmFabricProduction(f.tx, command, actor, f.proof)).rejects.toThrow('stock write failed');
    expect(f.tx.systemSetting.update).not.toHaveBeenCalled(); expect(f.saved().rolls[0].remainingMm).toBe(100000);
  });
  it.each([{ workerUserId: 'another' }, { deviceCode: 'another' }, { clientId: 'another' }, { status: 'COMPLETED' }, { orderId: 'another' }])('rejects changed task %j', change => {
    const f = fixture(); f.tx.fbsTsdAssembly.findUnique.mockResolvedValue({ id: 'task', clientId: 'client', ...owner,
      status: 'IN_PROGRESS', workerUserId: 'u', deviceCode: 'device', ...change });
    return expect(confirmFabricProduction(f.tx, command, actor, f.proof)).rejects.toThrow('Задание нарезки');
  });
  it.each(['DONE', 'CANCELLED', 'REJECTED'])('rejects a %s request', status => {
    const f = fixture(); f.tx.clientRequest.findUnique.mockResolvedValue({ id: 'r', clientId: 'client', status, warehouseId: 'w' });
    return expect(confirmFabricProduction(f.tx, command, actor, f.proof)).rejects.toThrow('Заявка закрыта');
  });
  it('rejects an edited request item before writing proof', async () => {
    const f = fixture(); f.tx.clientRequestItem.findUnique.mockResolvedValue({ id: 'item', requestId: 'r', skuId: 'other', quantity: 2 });
    await expect(confirmFabricProduction(f.tx, command, actor, f.proof)).rejects.toThrow('Позиция нарезки');
    expect(f.proof).not.toHaveBeenCalled();
  });
  it('locks request then fabric then task', async () => {
    const f = fixture(); await confirmFabricProduction(f.tx, command, actor, f.proof);
    const queries = f.tx.$queryRaw.mock.calls.map(call => String(call[0]));
    expect(queries[0]).toContain('ClientRequest'); expect(queries[1]).toContain('advisory'); expect(queries[2]).toContain('FbsTsdAssembly');
  });
});
