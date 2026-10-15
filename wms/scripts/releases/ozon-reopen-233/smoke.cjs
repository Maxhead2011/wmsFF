const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root='/app/apps/api/dist';
const {FboTwoStageService}=require(root+'/modules/tsd/fbo-two-stage.service');
const {FboActionDto}=require(root+'/modules/tsd/dto/fbo-action.dto');
const {validateSync}=require('class-validator');
const {ozonReopenSupported}=require(root+'/modules/tsd/ozon-reopen-box');
// TEST: actual deployed dispatcher + DTO, mocked persistence; no business writes.
async function scenario({foreign=false,frozen=false,wrong=false,disabled=false}={}){
 process.env.WMS_FBO_TWO_STAGE_ENABLED='true';process.env.WMS_OZON_FBO_IMPORT_ENABLED='true';process.env.WMS_OZON_REOPEN_BOX_ENABLED=disabled?'false':'true';
 let receipt=null,writes=0,audits=0;
 const parcel={id:'b',requestId:foreign?'other':'r',direction:'Москва',closedAt:new Date(),wholeBox:false};
 const shipment={directions:[],integration:frozen?{frozenHash:'hash'}:null};
 const tx={$queryRaw:async()=>[],ozonFboShipment:{findUnique:async()=>shipment},
 fboAssemblyAction:{findUnique:async()=>receipt,create:async({data})=>{receipt=data;}},
 fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash:createHash('sha256').update('[]').digest('hex')})},
 fboAssemblyUnit:{findMany:async()=>[]},fboAssemblyBox:{findMany:async()=>[],findUnique:async()=>parcel,update:async({data})=>{assert.deepEqual(data,{closedAt:null,confirmedAt:null,confirmedByUserId:null});writes++;Object.assign(parcel,data);}},auditLog:{create:async({data})=>{assert.equal(data.action,'FBO_REOPEN_BOX');audits++;}}};
 const svc=Object.create(FboTwoStageService.prototype);svc.prisma={$transaction:async cb=>cb(tx)};svc.lock={assertStockMovementsAllowed:async()=>{}};svc.logger={log:()=>{}};
 svc.load=async()=>({id:'r',status:'IN_WORK',items:[],client:{}});svc.requireFbo=()=>{};svc.box=async()=>({id:'box'});svc.requireIdleBox=async()=>{};svc.plan=async()=>({});
 const dto=Object.assign(new FboActionDto(),{action:'REOPEN_BOX',operationId:'operation-123',targetBoxCode:'BOX',direction:wrong?'Казань':'Москва'});
 assert.deepEqual(validateSync(dto),[]);
 assert.equal(ozonReopenSupported(shipment),!frozen&&!disabled);
 if(foreign||frozen||wrong||disabled){await assert.rejects(svc.act('r',dto,{id:'u'}));assert.equal(writes,0);assert.equal(audits,0);}
 else {await svc.act('r',dto,{id:'u'});await svc.act('r',dto,{id:'u'});assert.equal(writes,1);assert.equal(audits,1);await assert.rejects(svc.act('r',{...dto,direction:'Казань'},{id:'u'}));}
}
(async()=>{for(const o of [{},{foreign:true},{frozen:true},{wrong:true},{disabled:true}])await scenario(o);console.log(JSON.stringify({passed:true,cases:5,businessWrites:0}));})().catch(e=>{console.error(e);process.exit(1);});
