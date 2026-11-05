import { describe, it, expect, vi } from 'vitest';
import { withLockedFabricLedger } from './fabric-fbs-store';
import { FabricStoreTransaction } from './fabric-fbs-store';

// TEST: transaction adapter must not overwrite raw fabric after a failed lock or proof.
function fixture(locked = true, value: unknown = { rolls: [], shipmentAccounting: { events: { old: true } } }) {
  const query = vi.fn().mockResolvedValue([{ locked }]);
  const read = vi.fn().mockResolvedValue({ value });
  const update = vi.fn().mockResolvedValue({});
  return { query, read, update, tx: { $queryRaw: query, systemSetting: { findUnique: read, update } } as FabricStoreTransaction };
}
describe('locked fabric store', () => {
  it('locks the existing client key before reading and preserves old accounting', async () => {
    const f = fixture();
    await withLockedFabricLedger(f.tx, 'client', async ledger => ({ ledger, result: 42 }));
    expect(f.query.mock.calls[0][1]).toBe('fabric.rolls.v1:client');
    expect(f.query.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0]);
    expect(f.update.mock.calls[0][0].data.value.shipmentAccounting.events.old).toBe(true);
  });
  it('rejects a competing writer without reading or writing', async () => {
    const f = fixture(false); const action = vi.fn();
    await expect(withLockedFabricLedger(f.tx, 'client', action)).rejects.toThrow('другим сотрудником');
    expect(action).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { rolls: null }])('rejects a malformed ledger', async value => {
    const f = fixture(true, value);
    await expect(withLockedFabricLedger(f.tx, 'client', vi.fn())).rejects.toThrow('требует проверки');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('does not persist a cut when its proof fails', async () => {
    const f = fixture();
    await expect(withLockedFabricLedger(f.tx, 'client', async () => { throw new Error('PACKING failed'); })).rejects.toThrow('PACKING');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('propagates persistence failure to roll back the surrounding transaction', async () => {
    const f = fixture(); f.update.mockRejectedValue(new Error('database failed'));
    await expect(withLockedFabricLedger(f.tx, 'client', async ledger => ({ ledger, result: true }))).rejects.toThrow('database failed');
  });
});
