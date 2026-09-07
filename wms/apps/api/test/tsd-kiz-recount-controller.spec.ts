import { describe, expect, it, vi } from 'vitest';
import { TsdDeviceController } from '../src/modules/tsd/tsd-device.controller';

// TEST: the actual TSD routes reach admin orchestration, not the manager queue or a global reset.
describe('TSD KIZ recount controller', () => {
  function fixture() {
    const stock = { previewTsdKizRecount: vi.fn(async () => ({ state: 'ADMIN_REVIEW_REQUIRED' })),
      confirmTsdKizRecount: vi.fn(async () => ({ state: 'RECOUNT_APPLIED', affectedRequestIds: ['r1'] })),
      loadAdminKizRecountInput: vi.fn(), applyAdminKizRecount: vi.fn() };
    const marketplace = { adminTsdKizRecount: vi.fn(async (_body, _user, _confirm, load, apply) => {
      await load('transaction'); await apply('transaction', ['server-task']); return { state: 'RECOUNT_APPLIED' };
    }), repairFbsRequestSelection: vi.fn(async () => {}) };
    const controller: any = Object.create(TsdDeviceController.prototype);
    Object.assign(controller, { stockOperations: stock, marketplace });
    return { controller, stock, marketplace };
  }
  it('loads admin scopes and passes only server-authorized release IDs into the same transaction', async () => {
    const f = fixture(), body = { adminRelease: true, releasedIds: ['forged'] }, user = { id: 'admin' };
    await f.controller.confirmKizRecount(body, user);
    expect(f.stock.applyAdminKizRecount).toHaveBeenCalledWith('transaction', body, user, ['server-task']);
    expect(f.stock.confirmTsdKizRecount).not.toHaveBeenCalled();
  });
  it('routes an admin conflict to on-device orchestration', async () => {
    const f = fixture(); await f.controller.previewKizRecount({}, {});
    expect(f.marketplace.adminTsdKizRecount.mock.calls[0][2]).toBe(false);
  });
  it('awaits only affected route repairs and surfaces failures instead of false success', async () => {
    const f = fixture(); f.marketplace.repairFbsRequestSelection.mockRejectedValueOnce(new Error('route unavailable'));
    await expect(f.controller.confirmKizRecount({}, {})).rejects.toMatchObject({ status: 503 });
    await f.controller.confirmKizRecount({}, {});
    expect(f.marketplace.repairFbsRequestSelection.mock.calls.map(call => call[0])).toEqual(['r1', 'r1']);
  });
});
