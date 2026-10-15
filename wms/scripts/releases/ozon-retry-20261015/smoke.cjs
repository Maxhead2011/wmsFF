
const assert=require('assert/strict');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
async function run(mode){
 const link={connectionId:'c',orderId:'123',orderNumber:'123',place:'M',date:'',state:'DATA_FILLING',checkedAt:'',mapping:{M:'42'},operations:{'42':{state:'FAILED',operationId:'old'},'99':{state:'SUCCESS'}},supplies:[{id:'42',name:'M',items:[{barcode:'123',offerId:'a',quantity:1,quant:1}]}]};
 const shipment={requestId:'r',directions:[{name:'M',items:[{skuId:'sku',barcode:'123',quantity:1}]}],integration:link,request:{clientId:'c',fboAssembly:{phase:'CONTROL',boxes:[{id:'b',boxId:'box',direction:'M',closedAt:'now',confirmedAt:'now'}],units:[{skuId:'sku',state:'PACKED',targetBoxId:'box'}]}}};
 const svc=new OzonAssemblySupplyService({},{}),calls=[],audit=[];
 svc.load=async()=>shipment;svc.connection=async()=>({});svc.refresh=async()=>{};svc.view=async()=>shipment;
 svc.locked=async(id,u,fn)=>fn(shipment,{});svc.save=async(tx,id,l,u,action)=>audit.push(action);
 svc.call=async(c,path,body)=>{calls.push(path);if(path.endsWith('/create/info'))return body.operation_id==='old'?{status:mode==='changed'?'SUCCESS':'FAILED',errors:{error_reasons:['OPERATION_FAILED']}}:{status:'SUCCESS',result:{cargoes:[{key:'b',value:{cargo_id:'123'}}]}};
 if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42,transport_cargoes:[],...(mode==='incomplete'?{}:{cargoes_without_transport_cargoes:mode==='occupied'?[{cargo_id:'1'}]:[]})}]};
 if(path==='/v1/cargoes/create')return {operation_id:'new'};throw Error(path);};
 if(mode==='ok'){await svc.upload('r',true,{});await svc.upload('r',true,{});assert.equal(calls.filter(x=>x==='/v1/cargoes/create').length,1);assert(audit.includes('OZON_CARGO_RETRY_PREVIOUS'));assert.equal(link.operations['99'].state,'SUCCESS');}
 else{await assert.rejects(()=>svc.upload('r',true,{}));assert(!calls.includes('/v1/cargoes/create'));}
}
(async()=>{for(const m of ['ok','occupied','incomplete','changed'])await run(m);console.log(JSON.stringify({passed:true,cases:4,noBusinessWrites:true}))})().catch(e=>{console.error(e);process.exit(1)});
