import { describe, it, expect, vi } from 'vitest';
import { assignFabricOrder, FabricAssignmentCommand } from './fabric-fbs-assignment';

const command: FabricAssignmentCommand = {
  clientId: 'client', capability: true,
  owner: { marketplace: 'OZON', connectionId: 'connection', orderId: 'order', requestId: 'request' },
  lines: [{ lineId: 'line', skuId: 'sku', warehouseId: 'warehouse', material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 }],
};
function fixture() {
  let ledger: any = { rolls: [{ id: 'roll', warehouseId: 'warehouse', material: 'SATIN', color: 'white', remainingMm: 10000, cutMm: 0, createdAt: '2026-11-05' }] };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request', clientId: 'client', warehouseId: 'warehouse', status: 'SUBMITTED' }) },
    clientRequestItem: { findMany: vi.fn().mockResolvedValue([{ id: 'line', skuId: 'sku', quantity: 2,
      sku: { id: 'sku', clientId: 'client', name: 'Ткань', internalSku: 'white_3' } }]) },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: any) => ({ value: where.key === 'fabric.rolls.v1:client' ? ledger : { enabled: true } })),
      update: vi.fn(async ({ data }: any) => { ledger = data.value; }),
    },
  };
  return { tx, ledger: () => ledger, claim: vi.fn().mockResolvedValue('task') };
}
describe('fabric task assignment', () => {
  // TEST: raw reservation is created without manufacturing an AVAILABLE balance.
  it('reserves all cuts and claims within the same transaction', async () => {
    const f = fixture();
    expect(await assignFabricOrder(f.tx, command, f.claim, true)).toBe('task');
    expect(f.claim).toHaveBeenCalledWith(f.tx, expect.any(Object));
    expect(f.ledger().rolls[0].remainingMm).toBe(10000);
    expect(f.ledger().fbsReservations[0].rollIds).toEqual(['roll', 'roll']);
  });
  it('does not save reservations if task claim fails', async () => {
    const f = fixture(); f.claim.mockRejectedValue(new Error('Claim lost'));
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow('Claim lost');
    expect(f.tx.systemSetting.update).not.toHaveBeenCalled();
  });
  it('does not allocate the same request quantity to two different orders', async () => {
    const f = fixture();
    await assignFabricOrder(f.tx, command, f.claim, true);
    await expect(assignFabricOrder(f.tx, { ...command, owner: { ...command.owner, orderId: 'another' } }, f.claim, true)).rejects.toThrow('других заказов');
    expect(f.claim).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('requires both deployment switch and TSD capability (%s)', async enabled => {
    const f = fixture();
    await expect(assignFabricOrder(f.tx, { ...command, capability: !enabled }, f.claim, enabled)).rejects.toThrow('не включена');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it.each(['fabric.rolls.enabled.v1:', 'fabric.fbs.enabled.v1:'])('requires client setting %s', async prefix => {
    const f = fixture(), original = f.tx.systemSetting.findUnique.getMockImplementation();
    f.tx.systemSetting.findUnique.mockImplementation((args: any) => args.where.key.startsWith(prefix) ? { value: { enabled: false } } : original(args));
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow('у клиента');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it.each([{ lengthMm: 1000 }, { color: 'red' }, { warehouseId: 'other' }, { units: 3 }])('rejects mismatched line %j', async change => {
    const f = fixture();
    await expect(assignFabricOrder(f.tx, { ...command, lines: [{ ...command.lines[0], ...change }] }, f.claim, true)).rejects.toThrow();
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('does not partially reserve when a later line has insufficient fabric', async () => {
    const f = fixture();
    f.tx.clientRequestItem.findMany.mockResolvedValue([
      { id: 'line', skuId: 'sku', quantity: 2, sku: { id: 'sku', clientId: 'client', name: 'Ткань', internalSku: 'white_3' } },
      { id: 'line2', skuId: 'sku2', quantity: 2, sku: { id: 'sku2', clientId: 'client', name: 'Ткань', internalSku: 'white_5' } },
    ]);
    await expect(assignFabricOrder(f.tx, { ...command, lines: [...command.lines, { ...command.lines[0], lineId: 'line2', skuId: 'sku2', lengthMm: 5000 }] }, f.claim, true)).rejects.toThrow('Insufficient');
    expect(f.claim).not.toHaveBeenCalled(); expect(f.tx.systemSetting.update).not.toHaveBeenCalled();
  });
});
