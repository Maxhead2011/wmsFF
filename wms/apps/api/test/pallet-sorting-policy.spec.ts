import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSortingAdmin, confirmSortingSnapshot, sortingKizIdentity, sortingTaskCanReroute, missingSortingBoxes } from '../src/modules/inventory/pallet-sorting-policy';

afterEach(() => vi.unstubAllEnvs());
describe('administrator pallet sorting', () => {
  it('is off by default, including for ADMIN', () => {
    // TEST: sold installations do not acquire a new stock mutation path.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
    expect(() => assertSortingAdmin({ roleCodes: ['ADMIN'], activeWarehouseId: 'wh' } as any)).toThrow();
  });
  it.each(['OWNER', 'MANAGER', 'OPERATOR', 'CLIENT'])('does not grant %s access even with system:admin', role => {
    // TEST: the requested restriction is the ADMIN role, not just a permission.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    expect(() => assertSortingAdmin({ roleCodes: [role], permissionCodes: ['system:admin'], activeWarehouseId: 'wh' } as any)).toThrow();
  });
  it('requires a selected warehouse', () => {
    // TEST: no cross-branch sorting under an unscoped administrator.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    expect(() => assertSortingAdmin({ roleCodes: ['ADMIN'] } as any)).toThrow();
    expect(() => assertSortingAdmin({ roleCodes: ['ADMIN'], activeWarehouseId: 'wh' } as any)).not.toThrow();
  });
  it('compares scanned boxes without treating a repeated scan as another box', () => {
    // TEST: missing boxes are the original manifest minus unique physical scans.
    expect(missingSortingBoxes(['a', 'b', 'c'], ['a', 'a', 'c'])).toEqual(['b']);
    expect(() => missingSortingBoxes(['a'], ['foreign'])).toThrow();
  });
  it('requires an exact fresh snapshot and explicit write-off consent', () => {
    // TEST: a stale confirmation cannot write off a changed quantity.
    expect(() => confirmSortingSnapshot('new', 'old', true, 2)).toThrow();
    expect(() => confirmSortingSnapshot('new', 'new', false, 2)).toThrow();
    expect(() => confirmSortingSnapshot('new', 'new', true, 2)).not.toThrow();
    expect(() => confirmSortingSnapshot('new', 'new', false, 0)).not.toThrow();
  });
  it('normalizes separator representations but preserves KIZ case', () => {
    // TEST: transport variants are the same unit; upper/lower case are different units.
    const id = '0104600000000000215a00000000001';
    expect(sortingKizIdentity(`${id}<GS>91EE12`)).toBe(id);
    expect(sortingKizIdentity(`${id}\u001d91EE12`)).toBe(id);
    expect(sortingKizIdentity(id.replace('5a', '5A'))).not.toBe(id);
    expect(() => sortingKizIdentity('123')).toThrow();
  });
  it('reroutes a scanned source box, but never picked, completed or foreign work', () => {
    // TEST: scanning a box alone is not physical removal of a garment.
    const task = { status: 'IN_PROGRESS', boxId: 'missing', reservedBoxId: 'missing', barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null };
    expect(sortingTaskCanReroute(task, ['missing'])).toBe(true);
    expect(sortingTaskCanReroute(task, ['other'])).toBe(false);
    for (const field of ['barcode', 'kiz', 'sourceBarcode', 'relabelConfirmedAt']) {
      expect(sortingTaskCanReroute({ ...task, [field]: 'physical-evidence' }, ['missing'])).toBe(false);
    }
    expect(sortingTaskCanReroute({ ...task, status: 'COMPLETED' }, ['missing'])).toBe(false);
    expect(sortingTaskCanReroute({ ...task, status: 'RETURN_REQUIRED' }, ['missing'])).toBe(false);
  });
});
