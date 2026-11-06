import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthGuard } from './guards/auth.guard';
import { AccessTokenService } from './access-token.service';

// TEST: bypass of the eight-hour JWT deadline always requires a live durable session.
let tokens: AccessTokenService, db: any, guard: AuthGuard;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T07:00:00Z'));
  vi.stubEnv('WMS_TSD_IDLE_SESSION_ENABLED','true');
  tokens=new AccessTokenService({get:()=> 'unit-test-secret'} as any);
  db={userSession:{findUnique:vi.fn()},tsdDevice:{findUnique:vi.fn(async()=>({code:'D',userId:'u',status:'ACTIVE'}))},
    user:{findUnique:vi.fn(async()=>({id:'u',status:'ACTIVE',roles:[],isDemo:false,clientScopes:[],printerScopes:[],warehouseScopes:[]}))}};
  guard=new AuthGuard({getAllAndOverride:()=>false} as any,tokens,db,
    {get:async (_key:string,fallback:any)=>fallback} as any,{assertActive:vi.fn()} as any,
    {resolve:async()=>({clientScopeMode:'SCOPED',clientIds:[],writableClientIds:[]})} as any);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function context(token:string):any{return {getHandler:()=>null,getClass:()=>null,
  switchToHttp:()=>({getRequest:()=>({headers:{authorization:`Bearer ${token}`}})})};}
it('accepts active idle sessions past eight hours, but rejects the same token once idle',async()=>{
  const token=tokens.sign('u',{deviceId:'device',deviceCode:'D',tsdIdleSessionId:'session'});
  vi.advanceTimersByTime(9*3600000);
  db.userSession.findUnique.mockResolvedValue({userId:'u',expiresAt:new Date(Date.now()+1)});
  await expect(guard.canActivate(context(token))).resolves.toBe(true);
  vi.advanceTimersByTime(1);
  await expect(guard.canActivate(context(token))).rejects.toThrow();
});
it('rejects missing idle sessions before loading any user permissions',async()=>{
  const token=tokens.sign('u',{deviceId:'device',deviceCode:'D',tsdIdleSessionId:'session'});
  await expect(guard.canActivate(context(token))).rejects.toThrow();
  expect(db.user.findUnique).not.toHaveBeenCalled();
});
it('retains the eight-hour deadline for legacy devices',async()=>{
  const token=tokens.sign('u',{deviceId:'device',deviceCode:'D'});
  vi.advanceTimersByTime(8*3600000+1000);
  await expect(guard.canActivate(context(token))).rejects.toThrow();
  expect(db.userSession.findUnique).not.toHaveBeenCalled();
});
it('rejects an idle token when the user is blocked',async()=>{
  const token=tokens.sign('u',{deviceId:'device',deviceCode:'D',tsdIdleSessionId:'session'});
  db.userSession.findUnique.mockResolvedValue({userId:'u',expiresAt:new Date(Date.now()+900000)});
  db.user.findUnique.mockResolvedValue({status:'BLOCKED'});
  await expect(guard.canActivate(context(token))).rejects.toThrow('Пользователь заблокирован');
});
