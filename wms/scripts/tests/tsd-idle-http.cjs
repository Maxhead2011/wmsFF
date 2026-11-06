// TEST: complete candidate Nest HTTP stack against an isolated, empty PostgreSQL database.
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const root=process.env.TSD_IDLE_RUNTIME||'/app/apps/api/dist';
const requireApp=createRequire(path.join(root,'main.js'));
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.equal(process.env.TSD_IDLE_ISOLATED,'1');
assert.equal(url.hostname,'tsd-idle-db');
assert.equal(url.pathname,'/tsd_idle_tests');
requireApp('reflect-metadata');
const {NestFactory}=requireApp('@nestjs/core');
const {ValidationPipe}=requireApp('@nestjs/common');
const {PrismaClient}=requireApp('@prisma/client');
const {AppModule}=requireApp(path.join(root,'app.module.js'));
const {PasswordService}=requireApp(path.join(root,'modules/auth/password.service.js'));
const {AccessTokenService}=requireApp(path.join(root,'modules/auth/access-token.service.js'));
let offset=0;
const RealDate=Date;
global.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[RealDate.now()+offset]));} static now(){return RealDate.now()+offset;} };
const db=new PrismaClient();
let app;
async function run(){
  assert.equal(await db.user.count(),0,'Never run against an existing user database');
  const permission=await db.permission.create({data:{code:'stock:write',name:'Test stock'}});
  const role=await db.role.create({data:{code:'WORKER',name:'Test worker',permissions:{create:{permissionId:permission.id}}}});
  const hash=await new PasswordService().hash('isolated-only');
  const user=await db.user.create({data:{email:'idle@example.invalid',name:'Idle test',passwordHash:hash,roles:{create:{roleId:role.id}}}});
  const device=await db.tsdDevice.create({data:{userId:user.id,code:'IDLETEST',name:'Idle test',secretHash:hash}});
  app=await NestFactory.create(AppModule,{logger:false});
  app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));
  app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');
  const base=await app.getUrl();
  async function http(route,token,body){
    const r=await fetch(base+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await r.json();return {status:r.status,value};
  }
  async function login(idleSession=true){return http('tsd/login',null,{code:device.code,secret:'isolated-only',idleSession});}
  const first=await login();assert.equal(first.status,201);assert.equal(first.value.idleTimeoutSeconds,900);
  const token=first.value.accessToken;
  const tokens=new AccessTokenService({get:key=>process.env[key]});
  const key=tokens.fingerprint(token);
  const before=await db.userSession.findUniqueOrThrow({where:{accessTokenId:key}});
  offset+=600000;
  assert.equal((await http('auth/me',token)).status,200);
  assert.equal((await db.userSession.findUniqueOrThrow({where:{accessTokenId:key}})).expiresAt.getTime(),before.expiresAt.getTime(),'Polling cannot extend login');
  assert.equal((await http('tsd/session/activity',token,{activityAgeMs:0})).status,201);
  assert.ok((await db.userSession.findUniqueOrThrow({where:{accessTokenId:key}})).expiresAt>before.expiresAt);
  assert.equal((await http('tsd/session/activity',token,{activityAgeMs:-1})).status,400);
  for(let i=0;i<50;i++){offset+=600000;assert.equal((await http('tsd/session/activity',token,{activityAgeMs:0})).status,201);}
  assert.throws(()=>tokens.verify(token));
  assert.equal((await http('auth/me',token)).status,200,'Active work passes eight-hour JWT expiry');
  offset+=900001;
  assert.equal((await http('auth/me',token)).status,401);
  assert.equal((await http('tsd/session/activity',token,{activityAgeMs:0})).status,401,'Expired input cannot revive login');
  const again=await login();assert.equal(again.status,201);assert.notEqual(again.value.accessToken,token);
  assert.equal((await http('auth/me',again.value.accessToken)).status,200);
  const legacy=await login(false);assert.equal(legacy.status,201);assert.equal(legacy.value.idleTimeoutSeconds,undefined);
  process.env.WMS_TSD_IDLE_SESSION_ENABLED='false';
  assert.equal((await http('auth/me',again.value.accessToken)).status,401);
  assert.equal((await http('auth/me',legacy.value.accessToken)).status,200);
  assert.equal((await login()).value.idleTimeoutSeconds,undefined);
  assert.equal(await db.stockMovement.count(),0);
  console.log(JSON.stringify({passed:12,login:true,pollingDoesNotExtend:true,activeBeyond8h:true,expiry:true,relogin:true,legacyAndFlagIsolation:true,stockWrites:0}));
}
run().then(async()=>{await app?.close();await db.$disconnect();process.exit(0);}).catch(async e=>{console.error(e);await app?.close();await db.$disconnect();process.exit(1);});
