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

// TEST: historical debt cannot consume or block independently received later rolls.
describe('fabric receipts after disputed shipments', () => {
  function pendingFixture() {
    const f = fixture();
    f.ledger().shipmentPending = [{ key: 'wb:shipment', warehouseId: 'warehouse', material: 'SATIN', color: 'white', meters: 264 }];
    f.ledger().rolls.unshift({ ...f.ledger().rolls[0], id: 'old', createdAt: '2026-10-20', remainingMm: 500000 });
    f.tx.wbOrderShipment = { findMany: vi.fn().mockResolvedValue([{ id: 'shipment', shippedAt: new Date('2026-10-21T09:05:28Z') }]) };
    return f;
  }
  it('reserves later receipts and preserves old rolls and pending debt', async () => {
    const f = pendingFixture(), before = structuredClone(f.ledger());
    await assignFabricOrder(f.tx, command, f.claim, true);
    expect(f.ledger().fbsReservations[0].rollIds).toEqual(['roll', 'roll']);
    expect(f.ledger().rolls).toEqual(before.rolls);
    expect(f.ledger().shipmentPending).toEqual(before.shipmentPending);
    expect(f.tx.wbOrderShipment.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'client', warehouseId: 'warehouse', id: { in: ['shipment'] } });
  });
  it('keeps repeated assignment idempotent and respects other reservations', async () => {
    const f = pendingFixture();
    f.ledger().fbsReservations = [{ ...command.lines[0], key: 'other', units: 1, lengthMm: 3000, rollIds: ['roll'], confirmedUnits: 0, released: false, operations: [] }];
    await assignFabricOrder(f.tx, command, f.claim, true);
    const once = structuredClone(f.ledger());
    await assignFabricOrder(f.tx, command, f.claim, true);
    expect(f.ledger()).toEqual(once);
    expect(f.ledger().fbsReservations).toHaveLength(2);
  });
  it('uses the latest of all unresolved shipment dates', async () => {
    const f = pendingFixture();
    f.ledger().shipmentPending.push({ ...f.ledger().shipmentPending[0], key: 'wb:later' });
    f.tx.wbOrderShipment.findMany.mockResolvedValue([{ id: 'shipment', shippedAt: new Date('2026-10-21') }, { id: 'later', shippedAt: new Date('2026-11-06') }]);
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow('Недостаточно');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('never falls back to old stock when later receipts are insufficient', async () => {
    const f = pendingFixture(); f.ledger().rolls[1].remainingMm = 3000;
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow();
    expect(f.claim).not.toHaveBeenCalled(); expect(f.tx.systemSetting.update).not.toHaveBeenCalled();
  });
  it('excludes receipts at the exact shipment timestamp', async () => {
    const f = pendingFixture(); f.ledger().rolls[1].createdAt = '2026-10-21T09:05:28Z';
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow();
    expect(f.claim).not.toHaveBeenCalled();
  });
  it.each([{ proof: [] }, { proof: [{ id: 'shipment', shippedAt: new Date('invalid') }] }])('blocks missing or invalid shipment proof', async ({ proof }) => {
    const f = pendingFixture(); f.tx.wbOrderShipment.findMany.mockResolvedValue(proof);
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow('сверка');
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('blocks unsupported pending keys', async () => {
    const f = pendingFixture(); f.ledger().shipmentPending[0].key = 'unknown';
    await expect(assignFabricOrder(f.tx, command, f.claim, true)).rejects.toThrow('сверка');
    expect(f.claim).not.toHaveBeenCalled();
  });
});
