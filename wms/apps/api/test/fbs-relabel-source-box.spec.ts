import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const flag = 'WMS_FBS_RELABEL_SOURCE_BOX_GUARD';
const kiz = '0104680992596147215yroiP*ILYliJ\u001d91EE12';
afterEach(() => vi.unstubAllEnvs());
function fixture(boxId: string | null = 'box-26') {
  const task: any = { id: 'task', clientId: 'client', skuId: 'new', sourceSkuId: 'old',
    boxId: 'box-24', boxCode: 'FFL_LKBS1009_24', barcode: '2053651729774', barcodes: ['2053651729774'],
    requiresKiz: true, relabelRequired: true, relabelConfirmedAt: new Date(), updatedAt: new Date(),
    wbMetaStatus: 'PENDING', kiz: null };
  const mark: any = { id: 'mark', clientId: 'client', skuId: 'old', boxId,
    box: boxId ? { code: 'FFL_LKBS1009_26' } : null, status: 'AVAILABLE' };
  const prisma: any = { productMark: { findFirst: vi.fn(async () => ({ ...mark })),
    update: vi.fn(async ({ data }: any) => Object.assign(mark, data)) } };
  const service: any = new MarketplaceConnectionsService(prisma, {} as never);
  service.loadOwnedFbsTsdAssembly = vi.fn(async () => task);
  service.requireFbsOrderStillCollectable = vi.fn();
  service.assertFbsTsdLeaseVersion = vi.fn(async () => task);
  return { service, prisma, task, mark };
}
describe('FBS relabel source box', () => {
  // TEST: foreign KIZ must not be reclassified before checking its source box.
  it.each([false, true])('rejects foreign box before mutations, confirmBoxMove=%s', async confirmBoxMove => {
    vi.stubEnv(flag, 'true'); const f = fixture();
    await expect(f.service.scanFbsTsdKiz('task', { kiz, confirmBoxMove }, {})).rejects.toThrow('КИЗ относится к другому исходному коробу');
    expect(f.prisma.productMark.update).not.toHaveBeenCalled();
    expect(f.mark.skuId).toBe('old'); expect(f.mark.boxId).toBe('box-26');
  });
  // TEST: unplaced marks must not silently acquire a box during relabeling.
  it('rejects an unplaced mark', async () => {
    vi.stubEnv(flag, 'true'); const f = fixture(null);
    await expect(f.service.scanFbsTsdKiz('task', { kiz }, {})).rejects.toThrow('КИЗ относится к другому исходному коробу');
    expect(f.prisma.productMark.update).not.toHaveBeenCalled();
  });
  // TEST: matching boxes and non-relabel scans keep the existing path.
  it.each(['same-box', 'ordinary-pick', 'flag-off'])('preserves %s', mode => {
    vi.stubEnv(flag, mode === 'flag-off' ? 'false' : 'true');
    const f = fixture(mode === 'same-box' ? 'box-24' : 'box-26');
    if (mode === 'ordinary-pick') f.task.relabelRequired = false;
    expect(() => f.service.requireFbsRelabelSourceBox(f.task, f.mark)).not.toThrow();
  });
  // TEST: direct/retried movement cannot bypass the guard inside its transaction.
  it('rejects the foreign source in the movement transaction', async () => {
    vi.stubEnv(flag, 'true'); const f = fixture();
    f.mark.skuId = 'new';
    f.prisma.fbsTsdAssembly = { findUnique: vi.fn(async () => f.task) };
    f.prisma.productMark.findUnique = vi.fn(async () => f.mark);
    f.prisma.$transaction = vi.fn(async (run: any) => run(f.prisma));
    f.service.requireCurrentFbsTsdLease = vi.fn();
    await expect(f.service.moveExistingFbsKizToOpenedBox(f.task, 'mark', 'box-26', kiz, {}))
      .rejects.toThrow('КИЗ относится к другому исходному коробу');
    expect(f.prisma.productMark.update).not.toHaveBeenCalled();
  });
});
