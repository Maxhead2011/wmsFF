import { describe, expect, it, vi } from 'vitest';
import { assertSortingInventorySnapshot } from '../src/modules/inventory/inventory.service';

describe('sorting actualization snapshot safety', () => {
  it('does not turn another order reservation into new AVAILABLE stock', async () => {
    // TEST: physical count includes reserved units, but sorting must not clone them.
    const db: any = { stockBalance: { findFirst: vi.fn().mockResolvedValue({ id: 'reserved' }) }, stockMovement: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(assertSortingInventorySnapshot(db, 'box', 'sku', new Date())).rejects.toThrow('резерв');
  });
  it('rejects a count when stock changed since counting began', async () => {
    // TEST: a parallel FBS pick/transfer is never restored by a stale count.
    const db: any = { stockBalance: { findFirst: vi.fn().mockResolvedValue(null) }, stockMovement: { findFirst: vi.fn().mockResolvedValue({ id: 'new-pick' }) } };
    await expect(assertSortingInventorySnapshot(db, 'box', 'sku', new Date())).rejects.toThrow('измен');
  });
  it('allows unchanged AVAILABLE-only stock', async () => {
    // TEST: normal actualization is still possible with no long-lived movement lock.
    const db: any = { stockBalance: { findFirst: vi.fn().mockResolvedValue(null) }, stockMovement: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(assertSortingInventorySnapshot(db, 'box', 'sku', new Date())).resolves.toBeUndefined();
  });
});
