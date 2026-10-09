const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.RELEASE_ROOT;
// TEST: execute the deployed list method against an empty read-only stub, with both flag states.
test('runtime list exposes only the Ozon relation key when enabled',async()=>{
 const s=fs.readFileSync(path.join(root,process.env.API_OVERLAY||'api-image/overlay','modules/client-requests/client-requests.service.js'),'utf8');
 const body=s.slice(s.indexOf('async list(query, user) {'),s.indexOf('        const previousAttempts',s.indexOf('async list(query, user) {')));
 const fn=vm.runInNewContext('({'+body+'return requests;}}).list',{
  process,clientRequestInclude:{items:true},client_1:{ClientRequestStatus:{DONE:'DONE',CANCELLED:'CANCELLED',REJECTED:'REJECTED'}},
  client_request_warehouse_scope_1:{warehouseScopeWhere:()=>({})},client_request_author_1:{attachConfirmedRequestAuthors:async(_,r)=>r}});
 const old=process.env.WMS_OZON_FBO_IMPORT_ENABLED;
 try{for(const enabled of ['true','false']){process.env.WMS_OZON_FBO_IMPORT_ENABLED=enabled;let query;
  await fn.call({clientScopes:{resolveClientFilter:()=>undefined},prisma:{clientRequest:{findMany:async q=>{query=q;return[];}}}},{},{roleCodes:['ADMIN']});
  assert.equal(JSON.stringify(query.include.ozonShipment),enabled==='true'?'{"select":{"requestId":true}}':undefined);
  assert.equal(query.include.items,true);
 }}finally{if(old===undefined)delete process.env.WMS_OZON_FBO_IMPORT_ENABLED;else process.env.WMS_OZON_FBO_IMPORT_ENABLED=old;}
});
// TEST: evaluate the shipped predicate for active/archive Ozon, WB and linked FBS requests.
test('runtime WB queue and archive exclude Ozon and keep WB',()=>{
 const dir=path.join(root,process.env.WEB_DIR||'web','assets');
 const files=fs.readdirSync(dir).filter(n=>n.endsWith('.js')).map(n=>fs.readFileSync(path.join(dir,n),'utf8'));
 const panel=files.find(s=>s.includes('function xr({fboOnly:'));
 assert.ok(panel);const start=panel.indexOf('function Vt(s)'),end=panel.indexOf('function In(s)',start);
 const predicate=vm.runInNewContext('('+panel.slice(start,end)+')');
 for(const status of ['SUBMITTED','IN_WORK','DONE']){
  const r={type:'OUTBOUND',title:'Cross docking',status,_count:{fbsOrderLinks:0}};
  assert.equal(predicate({...r,ozonShipment:{requestId:'1861'}}),false);
  assert.equal(predicate({...r,ozonShipment:null}),true);assert.equal(predicate(r),true);
  assert.equal(predicate({...r,_count:{fbsOrderLinks:1}}),false);
 }
 assert.ok(panel.includes('!s&&e.jsx(__Ozon.OzonCustomerImport,'));
});
