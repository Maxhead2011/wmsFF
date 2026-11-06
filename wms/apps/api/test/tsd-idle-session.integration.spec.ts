import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../src/modules/auth/access-token.service';
import { createRequire } from 'node:module';
const runtime=process.env.TSD_IDLE_RUNTIME;
const {TsdIdleSessionService}=runtime
  ? createRequire(import.meta.url)(runtime+'/modules/auth/tsd-idle-session.service.js')
  : await import('../src/modules/auth/tsd-idle-session.service');

const url=process.env.TSD_IDLE_TEST_DATABASE_URL;
if(url){const address=new URL(url);if(!['localhost','127.0.0.1'].includes(address.hostname)||!address.pathname.endsWith('_tests'))
  throw new Error('TSD session integration requires a dedicated local *_tests database');}
const db=url?new PrismaClient({datasources:{db:{url}}}):null;
// TEST: real PostgreSQL CAS, same-token concurrency, revocation and process-independent expiry.
describe.skipIf(!db)('TSD idle PostgreSQL deadline',()=>{
  const users:string[]=[],devices:string[]=[];
  beforeEach(()=>{vi.stubEnv('WMS_TSD_IDLE_SESSION_ENABLED','true');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));});
  afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
  afterAll(async()=>{if(!db)return;await db.tsdDevice.deleteMany({where:{id:{in:devices}}});
    await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();});
  async function fixture(){
    const user=await db!.user.create({data:{email:`idle-${randomUUID()}@example.invalid`,name:'Idle test',passwordHash:'not-a-login'}});
    users.push(user.id);
    const device=await db!.tsdDevice.create({data:{code:randomUUID(),name:'Idle test',secretHash:'not-a-login',userId:user.id}});
    devices.push(device.id);
    const tokens=new AccessTokenService({get:()=> 'integration-only-secret'} as any);
    const service=new TsdIdleSessionService(db as any,tokens);
    const result=await service.start({accessToken:'legacy',user,device});
    return {tokens,service,token:result.accessToken,key:tokens.fingerprint(result.accessToken)};
  }
  it('accepts concurrent inputs without shortening the newest deadline',async()=>{
    const f=await fixture();vi.setSystemTime(new Date(Date.now()+120000));
    await Promise.all([0,5000,1000,8000].map(activityAgeMs=>f.service.activity(f.token,{activityAgeMs})));
    const stored=await db!.userSession.findUniqueOrThrow({where:{accessTokenId:f.key}});
    expect(stored.expiresAt!.getTime()).toBe(Date.now()+900000);
  });
  it('never revives an expired session and keeps the recorded deadline',async()=>{
    const f=await fixture();const expires=Date.now()+900000;vi.setSystemTime(new Date(expires));
    await expect(f.service.activity(f.token,{activityAgeMs:0})).rejects.toThrow();
    expect((await db!.userSession.findUniqueOrThrow({where:{accessTokenId:f.key}})).expiresAt!.getTime()).toBe(expires);
  });
  it('checks persistence after a new service instance and rejects manual revocation',async()=>{
    const f=await fixture();const second=new TsdIdleSessionService(db as any,f.tokens);
    await second.assertActive(f.token,f.tokens.verify(f.token,true));
    await db!.userSession.update({where:{accessTokenId:f.key},data:{expiresAt:new Date()}});
    await expect(second.activity(f.token,{activityAgeMs:0})).rejects.toThrow();
  });
  it('keeps active workers authenticated beyond eight hours',async()=>{
    const f=await fixture();
    for(let i=0;i<55;i++){vi.setSystemTime(new Date(Date.now()+600000));await f.service.activity(f.token,{activityAgeMs:0});}
    expect(()=>f.tokens.verify(f.token)).toThrow();
    await expect(f.service.assertActive(f.token,f.tokens.verify(f.token,true))).resolves.toBeTruthy();
  });
});
