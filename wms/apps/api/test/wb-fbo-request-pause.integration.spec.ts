import {describe,it,expect} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {wbFboPausedFetch as source} from '../src/modules/client-requests/wb-fbo-request-pause';
import {createRequire} from 'node:module';
const wbFboPausedFetch:typeof source=process.env.WB_FBO_PAUSE_RUNTIME?createRequire(import.meta.url)(process.env.WB_FBO_PAUSE_RUNTIME).wbFboPausedFetch:source;
const url=process.env.WB_FBO_PAUSE_TEST_DATABASE_URL;
if(url&&!/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/kiz_duplicate_tests$/.test(url))throw Error('Dedicated local database required');
describe.skipIf(!url)('durable WB pause',()=>{
 it('TEST: separate DB clients cannot send concurrently; saved pause survives restart',async()=>{
 const a=new PrismaClient({datasources:{db:{url}}}),b=new PrismaClient({datasources:{db:{url}}}),id=randomUUID();let sent=0,release!:(r:Response)=>void;
 try{
  const first=wbFboPausedFetch(a,id,async()=>{sent++;return new Promise<Response>(r=>{release=r})});
  while(!release)await new Promise(r=>setTimeout(r,5));
  await expect(wbFboPausedFetch(b,id,async()=>{sent++;return new Response('')})).rejects.toThrow('уже выполняется');
  release(new Response('',{status:429,headers:{'x-ratelimit-retry':'1567'}}));await expect(first).rejects.toThrow('МСК');
  await a.$disconnect();
  await expect(wbFboPausedFetch(b,id,async()=>{sent++;return new Response('')})).rejects.toThrow('МСК');
  expect(sent).toBe(1);
 }finally{await b.systemSetting.deleteMany({where:{key:'wb-fbo-http-pause:v1:'+id}});await a.$disconnect();await b.$disconnect();}
 });
});
