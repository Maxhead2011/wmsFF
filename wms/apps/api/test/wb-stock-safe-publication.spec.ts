import { describe, expect, it, vi } from 'vitest';
import { publishWbStockPlan } from '../src/modules/marketplace-connections/wb-stock-safe-publication';

const targets = [{ warehouseId: 'a', chrtId: 1, amount: 5 }, { warehouseId: 'b', chrtId: 1, amount: 5 }];
function fixture() {
  const amounts = new Map([['a', 0], ['b', 10]]);
  const events: string[] = [], proofs: any[] = [];
  return { amounts, events, proofs, io: {
    read: vi.fn(async (warehouse: string) => { events.push(`read:${warehouse}`); return new Map([[1, amounts.get(warehouse)!]]); }),
    send: vi.fn(async (warehouse: string, rows: any[]) => { events.push(`send:${warehouse}`); amounts.set(warehouse, rows[0].amount); }),
    record: vi.fn(async (row: any) => { proofs.push(row); }),
  } };
}
describe('WB decrease / verify / increase protocol', () => {
  // TEST: input order must not publish an increase before the decrease on another warehouse.
  it('verifies all decreases before increasing another warehouse', async () => {
    const { io, events } = fixture();
    await publishWbStockPlan(targets, io);
    expect(events.indexOf('send:b')).toBeLessThan(events.indexOf('send:a'));
    expect(events.slice(events.indexOf('send:b') + 1, events.indexOf('send:a'))).toContain('read:b');
  });
  it('does not treat HTTP success as a confirmed decrease', async () => {
    const { io, proofs } = fixture(); io.send.mockImplementation(async () => {});
    await expect(publishWbStockPlan(targets, io)).rejects.toThrow('не подтвердил');
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(proofs).toContainEqual(expect.objectContaining({ warehouseId: 'b', status: 'MISMATCH', observedAmount: 10, sentAmount: 5 }));
  });
  it('stops on missing observations without treating them as zero', async () => {
    const { io } = fixture(); io.read.mockResolvedValue(new Map());
    await expect(publishWbStockPlan(targets, io)).rejects.toThrow('достоверный остаток');
    expect(io.send).not.toHaveBeenCalled();
  });
  it('marks ambiguous network failures and never increases or blindly retries', async () => {
    const { io, proofs } = fixture(); io.send.mockRejectedValue(new Error('timeout'));
    await expect(publishWbStockPlan(targets, io)).rejects.toThrow('timeout');
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(proofs.filter(p => p.status === 'UNCONFIRMED')).toHaveLength(2);
  });
  it('rechecks before retry and does not resend an already applied decrease', async () => {
    const { io, amounts } = fixture(); amounts.set('b', 5);
    await publishWbStockPlan(targets, io);
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.send.mock.calls[0][0]).toBe('a');
  });
  it('rejects duplicate product targets before writing', async () => {
    const { io } = fixture();
    await expect(publishWbStockPlan([targets[0], targets[0]], io)).rejects.toThrow('Неоднозначный');
    expect(io.send).not.toHaveBeenCalled();
  });
});
