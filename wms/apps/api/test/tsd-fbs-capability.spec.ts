import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';

const { TsdDeviceController } = process.env.FBS_RUNTIME_CONTROLLER
  ? createRequire(import.meta.url)(process.env.FBS_RUNTIME_CONTROLLER)
  : await import('../src/modules/tsd/tsd-device.controller');

const methods = ['getNextFbsAssembly', 'scanFbsBox', 'scanFbsCode', 'scanFbsBarcode',
  'scanFbsKiz', 'validateFbsStockAudit', 'undoFbsKiz', 'completeFbsAssembly', 'releaseFbsAssembly'];
afterEach(() => vi.unstubAllEnvs());

// TEST: exercise Nest's actual parameter factory, not a direct service call that bypasses the header.
describe('FBS terminal capability reaches every assembly action', () => {
  for (const method of methods) {
    it(`${method} preserves identity and passes the updated terminal capability`, () => {
      const user = { id: 'picker', role: 'WORKER', warehouseId: 'our-warehouse' };
      const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, TsdDeviceController, method)) as any[];
      const parameter = args.find(arg => typeof arg.factory === 'function');
      expect(parameter).toBeDefined();
      const resolve = (header?: unknown) => parameter.factory(undefined, {
        switchToHttp: () => ({ getRequest: () => ({ user, headers: { 'x-tsd-fbs-capability': header } }) }),
      });
      expect(resolve('physical-pick-v1')).toEqual({ ...user, tsdPhysicalPickConfirmation: true });
      expect(resolve()).toEqual({ ...user, tsdPhysicalPickConfirmation: false });
      expect(resolve('unknown')).toEqual({ ...user, tsdPhysicalPickConfirmation: false });
      expect(user).not.toHaveProperty('tsdPhysicalPickConfirmation');
    });
  }
});

// TEST: validate deployment-only helpers against the actual artifact, including disabled flags.
describe.runIf(Boolean(process.env.FBS_RUNTIME_CONTROLLER))('published picking safeguards', () => {
  it('keeps the Ozon counter and refuses completion before every unit is scanned', () => {
    const load = createRequire(import.meta.url);
    const base = join(dirname(process.env.FBS_RUNTIME_CONTROLLER!), '../marketplace-connections');
    const ozon = load(join(base, 'ozon-tsd-picking.js'));
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const task = { marketplace: 'OZON', status: 'IN_PROGRESS', itemCount: 3, barcode: 'sku', scannedItemCount: 2 };
    expect(ozon.ozonScannedItemCount(task)).toBe(2);
    expect(() => ozon.requireOzonItemsScanned(task)).toThrow('2 из 3');
    expect(() => ozon.requireOzonItemsScanned({ ...task, scannedItemCount: 3 })).not.toThrow();
    expect(ozon.ozonScannedItemCount({ ...task, barcode: null })).toBe(0);
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'false');
    expect(ozon.ozonTsdPickingEnabled(task)).toBe(false);
  });
  it('keeps sequential WB picking and cannot continue from an insufficient box', () => {
    const load = createRequire(import.meta.url);
    const base = join(dirname(process.env.FBS_RUNTIME_CONTROLLER!), '../marketplace-connections');
    const route = load(join(base, 'fbs-sequential-route.js'));
    vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'true');
    const boxes = [{ code: 'A', quantity: 2 }, { code: 'B', quantity: 5 }];
    expect(route.fbsContinuationBox(boxes, 'A', 2)).toEqual(boxes[0]);
    expect(route.fbsContinuationBox(boxes, 'A', 3)).toBeUndefined();
    vi.stubEnv('WMS_FBS_SEQUENTIAL_PICK_ENABLED', 'false');
    expect(route.fbsContinuationBox(boxes, 'A', 1)).toBeUndefined();
    const ui = load(join(base, 'fbs-physical-pick.js'));
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'false');
    expect(ui.physicalPickConfirmationEnabled({ marketplace: 'WILDBERRIES' }, { tsdPhysicalPickConfirmation: true })).toBe(false);
  });
});
