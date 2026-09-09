import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
import { ArchivedEmptyBoxPalletDetachService } from '../src/common/boxes/archived-empty-box-pallet-detach.service';

afterEach(() => vi.unstubAllEnvs());

function fixture(action = 'COMPLETE') {
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
  const boxes = ['SBOX_QA', 'QA_BIN_2', 'BOX_QA'].map((code, i) => ({ id: `box-${i}`, code,
    clientId: 'client', warehouseId: 'wh', status: 'active',
    storagePlacement: { id: `placement-${i}`, palletId: 'pallet', boxCode: code }, productMarks: [],
    balances: [{ id: `balance-${i}`, skuId: 'sku', clientId: 'client', warehouseId: 'wh', quantity: i === 1 ? 0 : 2,
      status: 'AVAILABLE', palletId: null, updatedAt: new Date('2026-09-07T10:00:00Z'), sku: { clientId: 'client', article: 'QA', name: 'QA', size: 'M', color: 'blue' } }],
  }));
  const db: any = {
    box: {
      findMany: vi.fn(async ({ where }) => structuredClone(boxes.filter(b => where.id.in.includes(b.id)))),
      findUnique: vi.fn(async ({ where }) => structuredClone(boxes.find(b => b.id === where.id))),
      update: vi.fn(async ({ where, data }) => Object.assign(boxes.find(b => b.id === where.id)!, data)),
    },
    stockBalance: {
      updateMany: vi.fn(async ({ where, data }) => { Object.assign(boxes.flatMap(b => b.balances).find(b => b.id === where.id)!, data); return { count: 1 }; }),
      aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { quantity: null } })),
    },
    storagePalletBox: { deleteMany: vi.fn(async ({ where }) => { (boxes.find(b => b.id === where.boxId)! as any).storagePlacement = null; return { count: 1 }; }) },
    stockMovement: { create: vi.fn() }, productMark: { updateMany: vi.fn() },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { create: vi.fn() },
  };
  const policy: any = { getPolicy: vi.fn().mockResolvedValue({ storageBoxPrefix: 'SBOX_', storageBoxAliases: ['QA_BIN_'] }), normalize: vi.fn(async code => code.toUpperCase()) };
  const service = new PalletSortingService(db, {} as any, policy, {} as any, new ArchivedEmptyBoxPalletDetachService(db, policy), {} as any) as any;
  const state: any = { id: 'sorting', clientId: 'client', warehouseId: 'wh', version: 1,
    stage: action === 'COMPLETE' ? 'FORMING' : 'CHECKING', activeTargetId: null, targets: [], moves: [], pendingRoutes: [],
    sources: boxes.map(b => ({ id: b.id, code: b.code, scanned: action === 'COMPLETE', archived: false, placementId: 'pallet' })),
  };
  return { service, db, boxes, policy, state, user: { id: 'admin' }, kind: action === 'COMPLETE' ? 'remaining' : 'missing' };
}

it('archives a physically empty PACKING source after explicit administrator shortage consent',async()=>{
  // TEST: FFL_LKB2107_246: a confirmed empty ordinary box must not remain on the pallet.
  const f=fixture();f.boxes[2].balances[0].status='PACKING';
  const preview=await f.service.previewInTx(f.db,f.state,'remaining');
  expect(preview.quantity).toBe(4);
  expect(preview.boxes[2].retainedReason).toBeNull();
  await f.service.runAction(f.db,f.state,{action:'COMPLETE',fingerprint:preview.fingerprint,confirmWriteOff:true},f.user);
  expect(f.state.stage).toBe('COMPLETED');expect(f.boxes[2].balances[0].quantity).toBe(0);
  expect(f.boxes[2].status).toBe('archived');expect(f.boxes[2].storagePlacement).toBeNull();
  expect(f.state.sources[2].archived).toBe(true);
  expect(f.db.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({boxId:'box-2',status:'PACKING',quantity:-2,type:'INVENTORY_ADJUSTMENT'})}));
  // Shipment/return history is retained, never fabricated or deleted to archive the source.
  expect(f.db.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({boxId:'box-2',status:{in:['AVAILABLE','PACKING','RESERVED']}}),data:{status:'BLOCKED'}}));
});

it('requires fresh consent for reserved quantities and retains invalid negative balances',async()=>{
  // TEST: no silent cancellation of stock; preview covers every quantity being corrected.
  const f=fixture(); f.boxes[2].balances[0].status='RESERVED';
  let preview=await f.service.previewInTx(f.db,f.state,'remaining');
  await expect(f.service.runAction(f.db,f.state,{action:'COMPLETE',fingerprint:preview.fingerprint,confirmWriteOff:false},f.user)).rejects.toThrow('подтверждение');
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  f.boxes[2].balances[0].quantity=-1;
  preview=await f.service.previewInTx(f.db,f.state,'remaining');
  expect(preview.boxes[2].retainedReason).toBeTruthy();
});
it('rechecks legacy retained discrepancies instead of treating them as permanent empty storage',async()=>{
  // TEST: an unfinished old sorting must not silently carry the same retained PACKING box forward.
  const f=fixture(); f.boxes[2].balances[0].status='PACKING';
  Object.assign(f.state.sources[2],{preservedOnPallet:true,retainedReason:'legacy reservation'});
  const preview=await f.service.previewInTx(f.db,f.state,'remaining');
  expect(preview.quantity).toBe(4);
  await f.service.runAction(f.db,f.state,{action:'COMPLETE',fingerprint:preview.fingerprint,confirmWriteOff:true},f.user);
  expect(f.state.sources[2]).toMatchObject({archived:true});
  expect(f.state.sources[2].retainedReason).toBeUndefined();
  expect(f.state.sources[2].preservedOnPallet).toBeUndefined();
});

it.each(['COMPLETE', 'ARCHIVE_MISSING'])('preserves permanent boxes and archives only ordinary sources during %s', async action => {
  // TEST: use the real sorting + empty-box detach services together, not a mocked detach.
  const f = fixture(action);
  const preview = await f.service.previewInTx(f.db, f.state, f.kind);
  await f.service.runAction(f.db, f.state, { action, fingerprint: preview.fingerprint, confirmWriteOff: true }, f.user);
  expect(f.boxes.map(b => b.status)).toEqual(['active', 'active', 'archived']);
  expect(f.boxes.map(b => Boolean(b.storagePlacement))).toEqual([true, true, false]);
  expect(f.boxes.flatMap(b => b.balances).every(b => b.quantity === 0)).toBe(true);
  expect(f.db.stockMovement.create).toHaveBeenCalledTimes(2);
  expect(f.db.storagePalletBox.deleteMany).toHaveBeenCalledTimes(1);
  expect(f.state.sources.map((b: any) => b.archived)).toEqual([false, false, true]);
  expect(f.state.sources.slice(0, 2).every((b: any) => b.preservedOnPallet)).toBe(true);
  f.boxes[0].balances[0].quantity = 7; // a later receipt is outside this already settled source
  const after = await f.service.previewInTx(f.db, f.state, 'remaining');
  expect(after.boxes).toEqual([]); // processed permanent sources cannot be written off again
  if (action === 'ARCHIVE_MISSING') {
    await f.service.runAction(f.db, f.state, { action: 'BEGIN_FORMING' }, f.user);
    expect(f.state.stage).toBe('FORMING');
  }
});

it('includes the permanent-box decision in the confirmation fingerprint', async () => {
  // TEST: changing the lifecycle policy after preview invalidates the old consent.
  const f = fixture();
  const preview = await f.service.previewInTx(f.db, f.state, 'remaining');
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'false');
  await expect(f.service.runAction(f.db, f.state, { action: 'COMPLETE', fingerprint: preview.fingerprint, confirmWriteOff: true }, f.user)).rejects.toThrow('свежие');
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  expect(f.db.box.update).not.toHaveBeenCalled();
});

it('preserves the old lifecycle when the permanent-box feature is disabled', async () => {
  // TEST: sold/default installations keep their existing classification.
  const f = fixture(); vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'false');
  const preview = await f.service.previewInTx(f.db, f.state, 'remaining');
  await f.service.runAction(f.db, f.state, { action: 'COMPLETE', fingerprint: preview.fingerprint, confirmWriteOff: true }, f.user);
  expect(f.boxes.every(b => b.status === 'archived' && !b.storagePlacement)).toBe(true);
});

it('fails before writing if permanent-box policy cannot be read', async () => {
  // TEST: an unavailable classification is never permission to archive every box.
  const f = fixture(); f.policy.getPolicy.mockRejectedValue(new Error('policy unavailable'));
  await expect(f.service.previewInTx(f.db, f.state, 'remaining')).rejects.toThrow('policy unavailable');
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
});

it('rejects the owning transaction if ordinary-source detachment is refused', async () => {
  // TEST: even a policy refresh during finalization must not commit archived-but-placed storage.
  const f = fixture();
  const preview = await f.service.previewInTx(f.db, f.state, 'remaining');
  f.policy.getPolicy.mockResolvedValue({ storageBoxPrefix: 'BOX_', storageBoxAliases: [] });
  await expect(f.service.archiveSources(f.db, f.state, preview, f.user)).rejects.toThrow('снять с паллет');
});
