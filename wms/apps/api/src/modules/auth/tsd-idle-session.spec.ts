import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from './access-token.service';
import { TsdIdleSessionService } from './tsd-idle-session.service';

// TEST: physical activity extends only the opted-in terminal session, never background polling.
describe('TSD idle session', () => {
  let tokens: AccessTokenService, db: any, service: TsdIdleSessionService;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T07:00:00Z'));
    vi.stubEnv('WMS_TSD_IDLE_SESSION_ENABLED', 'true');
    tokens = new AccessTokenService({ get: () => 'test-secret' } as any);
    db = { userSession: { create: vi.fn(async ({data}) => data), findUnique: vi.fn(), updateMany: vi.fn(async () => ({count: 1})) },
      tsdDevice: { findUnique: vi.fn(async () => ({userId:'user', code:'device-code', status:'ACTIVE'})) } };
    service = new TsdIdleSessionService(db, tokens);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  const login = {accessToken:'old', tokenType:'Bearer', user:{id:'user'}, device:{id:'device',code:'device-code'}};
  async function start() {
    const result = await service.start(login);
    db.userSession.findUnique.mockResolvedValue(db.userSession.create.mock.calls[0][0].data);
    return result.accessToken;
  }
  it('leaves the existing login untouched with the flag disabled', async () => {
    vi.stubEnv('WMS_TSD_IDLE_SESSION_ENABLED','false');
    expect(await service.start(login)).toBe(login); expect(db.userSession.create).not.toHaveBeenCalled();
  });
  it('persists a unique session with exactly fifteen minutes lifetime', async () => {
    const token = await start();
    expect(tokens.verify(token).tsdIdleSessionId).toBeTruthy();
    expect(db.userSession.create.mock.calls[0][0].data.expiresAt.getTime()-Date.now()).toBe(900000);
    expect((await service.start(login)).accessToken).not.toBe(token);
  });
  it('does not extend the deadline on ordinary requests / monitoring', async () => {
    const token = await start(); vi.advanceTimersByTime(899999);
    await service.assertActive(token, tokens.verify(token));
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await expect(service.assertActive(token, tokens.verify(token))).rejects.toThrow();
  });
  it('never recreates a missing / revoked session', async () => {
    const token = await start(); db.userSession.findUnique.mockResolvedValue(null);
    await expect(service.assertActive(token,tokens.verify(token))).rejects.toThrow();
    expect(db.userSession.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a blocked or rebound physical device', async () => {
    const token = await start(); db.tsdDevice.findUnique.mockResolvedValue({userId:'other',code:'device-code',status:'ACTIVE'});
    await expect(service.assertActive(token,tokens.verify(token))).rejects.toThrow();
    db.tsdDevice.findUnique.mockResolvedValue({userId:'user',code:'device-code',status:'BLOCKED'});
    await expect(service.assertActive(token,tokens.verify(token))).rejects.toThrow();
  });
  it('extends from the actual input time rather than a delayed delivery time', async () => {
    const token = await start(); vi.advanceTimersByTime(120000);
    await service.activity(token,{activityAgeMs:2000});
    const update = db.userSession.updateMany.mock.calls[0][0];
    expect(update.data.expiresAt.getTime()).toBe(Date.now()+898000);
    expect(update.where.expiresAt.gt.getTime()).toBe(Date.now());
  });
  it('does not revive a session revoked between check and update', async () => {
    const token = await start(); db.userSession.updateMany.mockResolvedValue({count:0});
    db.userSession.findUnique.mockResolvedValueOnce(db.userSession.create.mock.calls[0][0].data).mockResolvedValue(null);
    await expect(service.activity(token,{activityAgeMs:0})).rejects.toThrow();
  });
  it.each([-1,900000,NaN,'0',null])('rejects invalid or stale activity age %s', async age => {
    const token = await start(); await expect(service.activity(token,{activityAgeMs:age})).rejects.toThrow();
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('allows an active shift past eight hours only through the guarded idle-session path', async () => {
    const token=await start(); vi.advanceTimersByTime(9*3600000);
    db.userSession.findUnique.mockResolvedValue({userId:'user',expiresAt:new Date(Date.now()+300000)});
    expect(()=>tokens.verify(token)).toThrow();
    await service.assertActive(token,tokens.verify(token,true));
    const legacy=tokens.sign('user',{deviceId:'device',deviceCode:'device-code'});
    vi.advanceTimersByTime(9*3600000); expect(()=>tokens.verify(legacy,true)).toThrow();
  });
  it('fails closed when the feature is turned off after login', async () => {
    const token=await start(); vi.stubEnv('WMS_TSD_IDLE_SESSION_ENABLED','false');
    await expect(service.assertActive(token,tokens.verify(token,true))).rejects.toThrow();
  });
});
