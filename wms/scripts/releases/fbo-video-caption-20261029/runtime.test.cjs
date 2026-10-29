// TEST: execute the actual captured production service, never a recompiled legacy service.
const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../../..');
process.env.NODE_PATH = path.join(root, 'apps/api/node_modules'); Module._initPaths();
const runtime = path.resolve(process.env.WMS_CAPTION_RUNTIME_DIR || path.join(root, 'work/contour-caption-candidate/dist'));
const {FboTwoStageService} = require(path.join(runtime, 'modules/tsd/fbo-two-stage.service.js'));
const originalEnv = {...process.env};
afterEach(() => {for (const key of Object.keys(process.env)) if (key.startsWith('WMS_')) delete process.env[key]; Object.assign(process.env, originalEnv);});

function fixture(action = 'PACK_UNIT', {enabled = true, newManual = false, wholeManual = false, auditFailure = false} = {}) {
  for (const key of Object.keys(process.env)) if (key.startsWith('WMS_')) delete process.env[key];
  Object.assign(process.env, {WMS_FBO_TWO_STAGE_ENABLED: 'true', WMS_FBO_FAST_ACK_ENABLED: 'true', WMS_FBO_MANUAL_PACKING_ENABLED: 'true'});
  if (enabled) process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
  if (action === 'PACK_PRODUCT') Object.assign(process.env, {WMS_OZON_FBO_IMPORT_ENABLED:'true', WMS_OZON_PACK_BY_PRODUCT_ENABLED:'true'});
  const calls = [], audits = [], actions = new Map(), units = [];
  const user = {id:'employee-1',name:'Анна',deviceId:'device-1',deviceCode:'TSD-5',roleCodes:[]};
  const sku = {id:'sku-1',clientId:'client-1',name:'Товар на момент скана',article:'ARTICLE-42',barcodes:[{value:'4610000000001'}]};
  const request = {id:'request-1',number:2537,status:'IN_WORK',clientId:'client-1',warehouseId:'warehouse-1',client:{},_count:{packages:0},
    items:[{id:'line-1',skuId:sku.id,barcode:'4610000000001',name:'Товар на момент скана',quantity:newManual ? 1 : 3,sku}]};
  const composition = () => createHash('sha256').update(JSON.stringify(request.items.map(i=>[i.id,i.skuId,i.barcode,i.quantity]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
  const assembly = {requestId:request.id,phase:'PACKING',compositionHash:composition(),pickClosure:newManual?{version:1,quantities:{'line-1':1}}:null};
  const target = {id:'target-1',code:'FFL-TARGET'};
  const source = {id:'source-1',code:'FFL-SOURCE'};
  const holding = {id:'holding-1',code:'FBO-PICK-request-1'};
  const parcel = {requestId:request.id,boxId:target.id,boxCode:target.code,direction:'Москва',wholeBox:false,closedAt:null};
  const mark = {id:'mark-1',value:'010461000000000121ABC\x1d91TAIL\x1d',skuId:sku.id,clientId:request.clientId,
    boxId:newManual?source.id:holding.id,status:newManual?'AVAILABLE':'PACKING'};
  if (!newManual) units.push({id:'unit-1',requestId:request.id,requestItemId:'line-1',skuId:sku.id,barcode:request.items[0].barcode,
    markId:mark.id,activeMarkId:mark.id,kiz:mark.value,state:'PICKED',wholeBox:action==='PACK_BOX'||wholeManual,sourceBoxId:source.id,sourceBoxCode:source.code});
  else units.push({id:'earlier-unit',requestId:request.id,requestItemId:'line-1',skuId:sku.id,state:'PACKED',wholeBox:false,targetBoxId:target.id});
  const dto = {action,operationId:'op-1',barcode:request.items[0].barcode,kiz:mark.value,targetBoxCode:target.code,sourceBoxCode:source.code,
    ...(action==='PACK_PRODUCT'?{direction:'Москва'}:{})};
  const tx = {
    $queryRaw: async (strings) => {const sql = strings.join(''); if(sql.includes('pickClosure')){calls.push('caption-closure');return [{pickClosure:structuredClone(assembly.pickClosure)}];} calls.push('lock');return [{id:request.id}];},
    clientRequest:{findUnique:async()=>{calls.push('caption-request');return structuredClone(request);},findMany:async()=>[{id:request.id}]},
    clientRequestItem:{update:async({where,data})=>{const line=request.items.find(i=>i.id===where.id);line.quantity+=data.quantity.increment;return line;}},
    clientRequestEvent:{create:async()=>({})},
    fboAssembly:{findUnique:async()=>assembly,findUniqueOrThrow:async()=>assembly,update:async({data})=>Object.assign(assembly,data)},
    fboAssemblyUnit:{
      findMany:async()=>units.map(u=>({...u})),findUnique:async({where})=>units.find(u=>u.activeMarkId===where.activeMarkId)||null,
      update:async({where,data})=>{calls.push('unit-update');const unit=units.find(u=>u.id===where.id);Object.assign(unit,data);return {...unit};},
      create:async({data})=>{calls.push('unit-create');const unit={id:'recovered-unit',...data};units.push(unit);return {...unit};},
      updateMany:async({where,data})=>{calls.push('units-update');for(const u of units) if(where.id.in.includes(u.id))Object.assign(u,data);return {count:where.id.in.length};},
      count:async()=>{calls.push('caption-count');return units.filter(u=>u.state==='PACKED').length;}},
    fboAssemblyAction:{findUnique:async({where})=>actions.get(where.id)||null,create:async({data})=>{actions.set(data.id,data);return data;}},
    fboAssemblyBox:{findUnique:async()=>parcel,findMany:async()=>[parcel],create:async({data})=>data},
    box:{findUniqueOrThrow:async({where})=>where.code===holding.code?holding:source},
    productMark:{updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>mark},
    sku:{findUnique:async()=>sku},stockBalance:{findMany:async()=>[{boxId:source.id,skuId:sku.id,quantity:5}]},
    fbsTsdAssembly:{findMany:async()=>[]},
    ozonFboShipment:{findUnique:async()=>({directions:[{name:'Москва',items:[{skuId:sku.id,quantity:3}]}]})},
    auditLog:{create:async({data})=>{if(auditFailure&&data.payload?.contourScan)throw new Error('audit unavailable');calls.push('audit:'+data.action);audits.push(structuredClone(data));return data;}}};
  const prisma = {...tx,$transaction:async(fn,options)=>{
    assert.equal(options.isolationLevel,'Serializable');calls.push('transaction');
    const before={units:structuredClone(units),actions:new Map(actions),auditLength:audits.length};
    try {const result=await fn(tx);calls.push('commit');return result;}
    catch(error){units.splice(0,units.length,...before.units);actions.clear();for(const pair of before.actions)actions.set(...pair);audits.splice(before.auditLength);calls.push('rollback');throw error;}
  }};
  const service = new FboTwoStageService(prisma,{}, {}, {}, {assertStockMovementsAllowed:async()=>{}},{});
  service.load=async()=>request;service.requireFbo=()=>{};
  service.box=async(_tx,_request,code)=>code===source.code?source:target;
  service.target=async()=>target;service.requireIdleBox=async()=>{};
  service.exactMark=async()=>mark;service.manualPackingMark=async()=>mark;
  service.move=async()=>{calls.push('stock-move');return {id:'movement-1'};};
  service.logger={log(){}};service.plan=async()=>{throw new Error('Caption cannot require an HTTP plan');};
  service.unpackPickedWholeBox=async()=>{for(const u of units)u.wholeBox=false;};
  return {service,tx,request,assembly,dto,user,units,audits,actions,calls,caption:()=>audits.find(a=>a.action==='FBO_'+action)?.payload.contourScan};
}

for (const action of ['PACK_UNIT','PACK_PRODUCT','MANUAL_PACK_UNIT','PACK_BOX']) {
  test(`${action}: the actual ACK service commits a complete same-transaction caption`, async()=>{
    const f=fixture(action);const ack=await f.service.actAcknowledged(f.request.id,f.dto,f.user);
    assert.equal(ack.accepted,true);assert.equal(ack.packing,undefined);
    const caption=f.caption();assert.ok(caption,'accepted ACK needs its atomic audit caption');
    assert.equal(caption.source_id,'fbo:request-1:op-1');assert.equal(caption.actor_name,'Анна');assert.equal(caption.device_code,'TSD-5');
    assert.equal(caption.packed_count,1);assert.equal(caption.total_count,3);assert.equal(caption.status,'accepted');
    assert.equal(caption.box_number,action==='PACK_BOX'?'FFL-SOURCE':'FFL-TARGET');
    assert.equal(caption.product_name,action==='PACK_BOX'?'Упаковка короба':'Товар на момент скана');
    assert.equal(caption.product_sku,action==='PACK_BOX'?'':'ARTICLE-42');assert.equal(caption.kiz,action==='PACK_BOX'?'':f.dto.kiz);
    assert.equal(caption.evidence.unit_id,action==='PACK_BOX'?null:'unit-1');
    assert.ok(f.calls.indexOf('caption-request')>f.calls.indexOf(action==='PACK_BOX'?'units-update':'unit-update'));
    assert.ok(f.calls.indexOf('audit:FBO_'+action)>f.calls.indexOf('caption-count'));
    assert.ok(f.calls.indexOf('commit')>f.calls.indexOf('audit:FBO_'+action));
  });
}

test('default-off retains legacy ACK, performs no caption reads, and adds no audit field',async()=>{
  const f=fixture('PACK_UNIT',{enabled:false});await f.service.actAcknowledged(f.request.id,f.dto,f.user);
  assert.equal(f.caption(),undefined);assert.equal(f.calls.some(c=>c.startsWith('caption-')),false);assert.equal(f.units[0].state,'PACKED');
});
test('rejected packing commits neither a caption nor an operation receipt',async()=>{
  const f=fixture();f.dto.barcode='WRONG';await assert.rejects(f.service.actAcknowledged(f.request.id,f.dto,f.user));
  assert.equal(f.audits.length,0);assert.equal(f.actions.size,0);assert.equal(f.units[0].state,'PICKED');assert.equal(f.calls.includes('caption-request'),false);
});
test('replay returns the existing receipt without re-reading, repacking, or re-captioning',async()=>{
  const f=fixture();await f.service.actAcknowledged(f.request.id,f.dto,f.user);const previous=JSON.stringify(f.audits),length=f.calls.length;
  await f.service.actAcknowledged(f.request.id,f.dto,f.user);assert.equal(JSON.stringify(f.audits),previous);assert.equal(f.calls.length,length);
  await f.service.executeAction(f.request.id,f.dto,f.user);assert.equal(JSON.stringify(f.audits),previous);
  assert.equal(f.calls.filter(c=>c==='caption-request').length,1);
});
test('manual recovery captures its newly created unit and refreshed partial-pick target',async()=>{
  const f=fixture('MANUAL_PACK_UNIT',{newManual:true});await f.service.actAcknowledged(f.request.id,f.dto,f.user);
  assert.equal(f.caption().evidence.unit_id,'recovered-unit');assert.equal(f.caption().packed_count,2);assert.equal(f.caption().total_count,2);
  assert.equal(f.request.items[0].quantity,2);assert.equal(f.assembly.pickClosure.quantities['line-1'],2);
});
test('PACK_UNIT manual whole-picked fallback captures the unit returned by actual manualPack',async()=>{
  const f=fixture('PACK_UNIT',{wholeManual:true});await f.service.actAcknowledged(f.request.id,f.dto,f.user);
  assert.equal(f.caption().evidence.unit_id,'unit-1');assert.equal(f.caption().evidence.action,'PACK_UNIT');
  assert.ok(f.audits.some(a=>a.action==='FBO_MANUAL_PACK_RECORDED'));
});
test('failed atomic caption audit rolls back the stock unit and operation receipt',async()=>{
  const f=fixture('PACK_UNIT',{auditFailure:true});await assert.rejects(f.service.actAcknowledged(f.request.id,f.dto,f.user),/audit unavailable/);
  assert.equal(f.units[0].state,'PICKED');assert.equal(f.actions.size,0);assert.equal(f.audits.length,0);assert.equal(f.calls.includes('commit'),false);
});
