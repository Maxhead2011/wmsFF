import { describe, expect, it } from 'vitest';
import { reserveFabricOrder, confirmFabricOrderCut, releaseFabricOrder, fabricOrderKey } from './fabric-fbs-order';
import { FabricLedger } from './fabric-fbs-ledger';

// TEST: a posting is a set of exact lines, never first SKU multiplied by total units.
const owner = { marketplace: 'OZON', connectionId: 'cabinet', orderId: 'order', requestId: 'request' };
const lines = [
  { lineId: 'one', skuId: 'white3', warehouseId: 'w', material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 },
  { lineId: 'two', skuId: 'black5', warehouseId: 'w', material: 'SATIN', color: 'black', lengthMm: 5000, units: 1 },
];
function state(): FabricLedger {
  return { rolls: ['white', 'black'].map(color => ({ id: color, warehouseId: 'w', material: 'SATIN', color,
    remainingMm: 100000, cutMm: 0, createdAt: '2026-11-05T07:00:00Z' })) };
}
describe('fabric order ledger', () => {
  it('reserves every line without creating finished goods', () => {
    const result = reserveFabricOrder(state(), owner, lines);
    expect(result.fbsReservations?.map(r => r.rollIds.length)).toEqual([2, 1]);
    expect(result.rolls.map(r => r.remainingMm)).toEqual([100000, 100000]);
    expect(reserveFabricOrder(result, owner, lines)).toEqual(result);
  });
  it('does not keep a partial reservation when a later line has insufficient material', () => {
    const input = state(); input.rolls[1].remainingMm = 4000;
    expect(() => reserveFabricOrder(input, owner, lines)).toThrow('Insufficient');
    expect(input.fbsReservations).toBeUndefined();
  });
  it('rejects a changed or removed line even when grand total is unchanged', () => {
    const reserved = reserveFabricOrder(state(), owner, lines);
    expect(() => reserveFabricOrder(reserved, owner, [lines[0]])).toThrow('composition');
    expect(() => reserveFabricOrder(reserved, owner, [{ ...lines[0], units: 1 }, { ...lines[1], units: 2 }])).toThrow();
  });
  it('isolates connection and order keys containing delimiters', () => {
    expect(fabricOrderKey({ ...owner, connectionId: 'a:b', orderId: 'c' })).not.toBe(fabricOrderKey({ ...owner, connectionId: 'a', orderId: 'b:c' }));
  });
  it('records actual production independently for each line and replays without another debit', () => {
    const reserved = reserveFabricOrder(state(), owner, lines);
    const cut = confirmFabricOrderCut(reserved, owner, 'one', 1, 'operation');
    expect(cut.cutMm).toBe(3000); expect(cut.cutUnits).toBe(1);
    expect(cut.state.rolls.map(r => r.remainingMm)).toEqual([97000, 100000]);
    expect(confirmFabricOrderCut(cut.state, owner, 'one', 1, 'operation').cutUnits).toBe(0);
    expect(() => confirmFabricOrderCut(cut.state, owner, 'two', 1, 'operation')).toThrow('Operation');
  });
  it('cancels uncut material without restoring confirmed cuts', () => {
    const cut = confirmFabricOrderCut(reserveFabricOrder(state(), owner, lines), owner, 'one', 1, 'op');
    const cancelled = releaseFabricOrder(cut.state, owner);
    expect(cancelled.rolls[0].remainingMm).toBe(97000);
    expect(cancelled.fbsReservations?.every(r => r.released)).toBe(true);
    expect(() => confirmFabricOrderCut(cancelled, owner, 'two', 1, 'new')).toThrow('changed');
  });
  it('rejects duplicate line identities before allocating', () => {
    expect(() => reserveFabricOrder(state(), owner, [lines[0], lines[0]])).toThrow('Duplicate');
  });
});
