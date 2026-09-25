import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA, PARAMTYPES_METADATA } from '@nestjs/common/constants';

const load = createRequire(import.meta.url);
const runtime = process.env.FBS_RUNTIME_CONTROLLER;
const { TsdDeviceController } = runtime ? load(runtime) : await import('../src/modules/tsd/tsd-device.controller');
const { TsdModule } = runtime ? load(join(dirname(runtime), 'tsd.module.js')) : await import('../src/modules/tsd/tsd.module');
const { TsdRelabelPrintService } = runtime ? load(join(dirname(runtime), 'tsd-relabel-print.service.js')) : await import('../src/modules/tsd/tsd-relabel-print.service');

// TEST: a later release kept helper files but dropped the endpoints and DI registration.
it('registers the relabel provider and injects it into the live controller', () => {
  expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TsdModule)).toContain(TsdRelabelPrintService);
  // Vitest's TS transform does not emit constructor metadata; check it in the actual compiled artifact.
  if (runtime) expect(Reflect.getMetadata(PARAMTYPES_METADATA, TsdDeviceController)).toContain(TsdRelabelPrintService);
});

it.each([
  ['fbsRelabelPrintStations', 'fbs/tasks/:id/relabel/print-stations', 'fbsStations', ['task', { id: 'worker' }]],
  ['fbsRelabelPrint', 'fbs/tasks/:id/relabel/print', 'fbsCreate', ['task', { printId: 'print' }, { id: 'worker' }]],
  ['fbsRelabelPrintStatus', 'fbs/tasks/:id/relabel/print/:printId', 'fbsStatus', ['task', 'print', { id: 'worker' }]],
  ['listRelabelPrintStations', 'requests/:id/relabel/print-stations', 'stations', ['request', { id: 'worker' }]],
  ['printRelabelTarget', 'requests/:id/relabel/print', 'create', ['request', { printId: 'print' }, { id: 'worker' }]],
  ['relabelPrintStatus', 'requests/:id/relabel/print/:printId', 'status', ['request', 'print', { id: 'worker' }]],
])('preserves route %s and forwards authenticated task arguments', async (method, path, action, args) => {
  expect(typeof TsdDeviceController.prototype[method as string]).toBe('function');
  expect(Reflect.getMetadata(PATH_METADATA, TsdDeviceController.prototype[method as string])).toBe(path);
  const print = { [action as string]: vi.fn().mockResolvedValue({ status: 'QUEUED' }) };
  const instance = Object.create(TsdDeviceController.prototype);
  instance.relabelPrint = print;
  expect(await instance[method as string](...(args as unknown[]))).toEqual({ status: 'QUEUED' });
  expect(print[action as string]).toHaveBeenCalledWith(...(args as unknown[]));
});
