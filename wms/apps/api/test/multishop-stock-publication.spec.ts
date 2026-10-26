import { describe, expect, it, vi } from 'vitest';
import { advanceShopPublication, ShopPublicationJob, ShopPublicationPorts } from '../src/modules/marketplace-connections/multishop-stock-publication';

const job: ShopPublicationJob = { id: 'job', revision: 'v1', skuId: 'physical-size', warehouseId: 'msk', destinations: ['old', 'new'], desired: { new: 10 }, status: 'PENDING', attempts: 0 };
function fixture() {
  const ports: ShopPublicationPorts = { assertLease: vi.fn(async () => {}), current: vi.fn(async () => ({ revision: 'v1', budget: 10 })),
    observe: vi.fn(async () => ({ old: 10, new: 0 })), persist: vi.fn(async () => {}), write: vi.fn(async () => {}) };
  return ports;
}
describe('multi-shop publication phases', () => {
  // TEST: a timeout after an old-shop write cannot release its stock to another shop.
  it('persists decrease intent before I/O and rechecks after failure', async () => {
    const ports = fixture();
    vi.mocked(ports.write).mockRejectedValueOnce(new Error('timeout'));
    await expect(advanceShopPublication(job, ports)).rejects.toThrow('timeout');
    expect(vi.mocked(ports.persist).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ports.write).mock.invocationCallOrder[0]);
    const saved = vi.mocked(ports.persist).mock.calls[0][0];
    vi.mocked(ports.observe).mockResolvedValue({ old: null, new: 0 });
    const next = await advanceShopPublication(saved, ports);
    expect(next.status).toBe('VERIFY');
    expect(ports.write).toHaveBeenCalledTimes(1);
  });
  it('requires observed zero before increase, then read-back before completion', async () => {
    const ports = fixture();
    let next = await advanceShopPublication(job, ports);
    expect(next.status).toBe('DECREASE');
    expect(ports.write).toHaveBeenLastCalledWith('old', 0);
    vi.mocked(ports.observe).mockResolvedValue({ old: 0, new: 0 });
    next = await advanceShopPublication(next, ports);
    expect(next.status).toBe('INCREASE');
    expect(ports.write).toHaveBeenLastCalledWith('new', 10);
    vi.mocked(ports.observe).mockResolvedValue({ old: 0, new: 10 });
    next = await advanceShopPublication(next, ports);
    expect(next.status).toBe('DONE');
    expect(ports.write).toHaveBeenCalledTimes(2);
  });
  it('retains old destinations when transport omits them', async () => {
    const ports = fixture();
    vi.mocked(ports.observe).mockResolvedValue({ new: 0 });
    expect((await advanceShopPublication(job, ports)).status).toBe('VERIFY');
    expect(ports.write).not.toHaveBeenCalled();
  });
  it('stops on concurrent configuration changes', async () => {
    const ports = fixture();
    vi.mocked(ports.current).mockResolvedValue({ revision: 'v2', budget: 10 });
    expect((await advanceShopPublication(job, ports)).status).toBe('STALE');
    expect(ports.observe).not.toHaveBeenCalled();
    expect(ports.write).not.toHaveBeenCalled();
  });
  it('revalidates stock before sending', async () => {
    const ports = fixture();
    vi.mocked(ports.current).mockResolvedValueOnce({ revision: 'v1', budget: 10 }).mockResolvedValue({ revision: 'v1', budget: 9 });
    expect((await advanceShopPublication(job, ports)).status).toBe('STALE');
    expect(ports.write).not.toHaveBeenCalled();
  });
  it('never sends after losing its lease', async () => {
    const ports = fixture();
    vi.mocked(ports.assertLease).mockRejectedValue(new Error('lost lease'));
    await expect(advanceShopPublication(job, ports)).rejects.toThrow('lost lease');
    expect(ports.write).not.toHaveBeenCalled();
  });
  // TEST: a persisted job cannot grant itself permission to mirror the physical budget.
  it('rejects a shared job when the authoritative configuration is allocated', async () => {
    const ports = fixture();
    const shared: ShopPublicationJob = { ...job, mode: 'SHARED', desired: { old: 10, new: 10 } };
    expect((await advanceShopPublication(shared, ports)).status).toBe('STALE');
    expect(ports.observe).not.toHaveBeenCalled();
    expect(ports.write).not.toHaveBeenCalled();
  });
  it('stops between shared writes if the mode changes', async () => {
    const ports = fixture();
    vi.mocked(ports.current)
      .mockResolvedValueOnce({ revision: 'v1', budget: 10, mode: 'SHARED' })
      .mockResolvedValueOnce({ revision: 'v1', budget: 10, mode: 'SHARED' })
      .mockResolvedValue({ revision: 'v1', budget: 10, mode: 'ALLOCATED' });
    vi.mocked(ports.observe).mockResolvedValue({ old: 0, new: 0 });
    const shared: ShopPublicationJob = { ...job, mode: 'SHARED', desired: { old: 10, new: 10 } };
    expect((await advanceShopPublication(shared, ports)).status).toBe('STALE');
    expect(ports.write).toHaveBeenCalledTimes(1);
  });
});
