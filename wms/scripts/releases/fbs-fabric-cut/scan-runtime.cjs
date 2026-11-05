// TEST: legacy explicit cutting never writes; scan capability remains scoped.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.argv[2];
const load = createRequire(path.resolve(root, 'modules/tsd/tsd-device.controller.js'));
load('reflect-metadata');
const { ROUTE_ARGS_METADATA, PATH_METADATA, METHOD_METADATA } = load('@nestjs/common/constants');
const { RequestMethod } = load('@nestjs/common');
const { TsdDeviceController: Controller } = load('./tsd-device.controller.js');
const { MarketplaceConnectionsService: Service } = load('../marketplace-connections/marketplace-connections.service.js');
async function main() {
  const handler = Controller.prototype.confirmFbsFabricCut;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'fbs/tasks/:id/confirm-fabric-cut');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
  const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, 'confirmFbsFabricCut'));
  const resolve = args.find(a => a.factory).factory;
  const user = { id: 'worker', activeWarehouseId: 'warehouse' };
  const context = headers => ({ switchToHttp: () => ({ getRequest: () => ({ user, headers }) }) });
  assert.deepEqual(resolve(undefined, context({})), {...user, tsdPhysicalPickConfirmation: false});
  assert.deepEqual(resolve(undefined, context({'x-tsd-fabric-capability': 'fabric-cut-v1', 'x-tsd-fbs-capability': 'physical-pick-v1'})), {...user, tsdPhysicalPickConfirmation: true, tsdFabricCutConfirmation: true});
  assert.equal(user.tsdFabricCutConfirmation, undefined);
  const service = Object.create(Service.prototype);
  service.loadOwnedFbsTsdAssembly = () => { throw Error('Forbidden database access'); };
  for (const flag of [undefined, 'false', 'true']) {
    if (flag === undefined) delete process.env.WMS_FBS_FABRIC_CUT_ENABLED;
    else process.env.WMS_FBS_FABRIC_CUT_ENABLED = flag;
    await assert.rejects(service.confirmFbsTsdFabricCut('task', {}, {...user, tsdFabricCutConfirmation: true}), /Отдельное подтверждение/);
  }
  process.env.WMS_FBS_FABRIC_CUT_ENABLED = 'true';
  await assert.rejects(service.confirmFbsTsdFabricCut('task', {}, user), /Отдельное подтверждение/);
  process.env.WMS_FBS_FABRIC_CUT_ENABLED = 'false';
  console.log('fabric scan runtime OK: module load, route, capability, isolation; no database access');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
