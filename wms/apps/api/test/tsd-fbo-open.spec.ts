import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
import { TsdDeviceController } from '../src/modules/tsd/tsd-device.controller';

// TEST: opening the dedicated FBO screen must not build the obsolete, expensive picking document.
describe('TSD FBO opening', () => {
  afterEach(() => vi.unstubAllEnvs());
  const user = { id: 'worker', deviceId: 'terminal' } as never;
  function setup() {
    vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', 'true');
    const fbo = { eligible: vi.fn().mockResolvedValue(true), plan: vi.fn().mockResolvedValue({
      requestId: 'request', title: 'FBO request', phase: 'PICKING', picked: 485,
    }) };
    const service = new TsdAssemblyService({} as never, {} as never, {} as never,
      {} as never, {} as never, fbo as never);
    const legacy = vi.spyOn(service, 'getRequestPlan').mockImplementation(async () => {
      throw new Error('Legacy instruction exceeded terminal timeout');
    });
    return { service, fbo, legacy };
  }
  it('opens FBO without the legacy instruction and preserves the authoritative progress', async () => {
    const { service, fbo, legacy } = setup();
    const result = await service.getDeviceRequestPlan('request', user);
    expect(result).toMatchObject({ id: 'request', title: 'FBO request',
      assemblyMode: 'FBO_TWO_STAGE', storesWithoutBoxes: false, fbo: { picked: 485 } });
    expect(fbo.eligible).toHaveBeenCalledWith('request', user);
    expect(fbo.plan).toHaveBeenCalledWith('request', user);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(['web', 'disabled', 'not-fbo'])('preserves the previous response for %s', async mode => {
    const { service, fbo, legacy } = setup();
    legacy.mockResolvedValue({ id: 'legacy', searchBoxes: ['unchanged'] } as never);
    if (mode === 'disabled') vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', 'false');
    if (mode === 'not-fbo') fbo.eligible.mockResolvedValue(false);
    const actor = mode === 'web' ? { id: 'owner' } as never : user;
    expect(await service.getDeviceRequestPlan('request', actor)).toEqual({ id: 'legacy', searchBoxes: ['unchanged'] });
    expect(legacy).toHaveBeenCalledWith('request', actor);
    expect(fbo.plan).not.toHaveBeenCalled();
    if (mode !== 'not-fbo') expect(fbo.eligible).not.toHaveBeenCalled();
  });
  it.each(['eligible', 'plan'] as const)('preserves access and inventory safeguards from %s', async step => {
    const { service, fbo, legacy } = setup();
    fbo[step].mockRejectedValue(new Error('Access or balance review denied'));
    await expect(service.getDeviceRequestPlan('request', user)).rejects.toThrow('Access or balance review denied');
    expect(legacy).not.toHaveBeenCalled();
  });
  it('preserves installations without the FBO service', async () => {
    const { service, legacy } = setup();
    (service as any).fbo = undefined;
    legacy.mockResolvedValue({ id: 'legacy' } as never);
    expect(await service.getDeviceRequestPlan('request', user)).toEqual({ id: 'legacy' });
  });
  it('uses the optimized path through the existing terminal endpoint', async () => {
    const { service, legacy } = setup();
    const result = await TsdDeviceController.prototype.getAssemblyRequest.call({ assembly: service }, 'request', user);
    expect(result.assemblyMode).toBe('FBO_TWO_STAGE');
    expect(legacy).not.toHaveBeenCalled();
  });
});
