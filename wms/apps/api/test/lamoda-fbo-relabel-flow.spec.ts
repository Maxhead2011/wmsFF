import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {FboTwoStageService} from '../src/modules/tsd/fbo-two-stage.service';
vi.mock('../src/modules/tsd/tsd-relabel-label',()=>({buildTsdRelabelLabel:async()=> 'png'}));
afterEach(()=>vi.unstubAllEnvs());
function fixture(confirmed=false) {
 for(const f of ['WMS_FBO_TWO_STAGE_ENABLED','WMS_LAMODA_ENABLED','WMS_LAMODA_FBO_ASSEMBLY_ENABLED','WMS_LAMODA_FBO_RELABEL_ENABLED'])vi.stubEnv(f,'true');
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');
 const label={skuId:'sku',barcode:'4640684266611',article:'MP52',name:'Coat',size:'52'};
 const item={id:'item',skuId:'sku',barcode:'warehouse',quantity:1,sku:{name:'Coat',barcodes:[{value:'warehouse'}]}};
 const unit={id:'unit',requestId:'r',requestItemId:'item',skuId:'sku',barcode:'warehouse',state:'PICKED',wholeBox:false,markId:null,lamodaRelabelConfirmedAt:confirmed?new Date():null,lamodaRelabelPrintId:'print'};
 const request={id:'r',number:2506,status:'IN_WORK',items:[item],client:{name:'Client',relabelingEnabled:true}};
 const tx:any={$queryRaw:vi.fn(),lamodaFboAssembly:{findUnique:async()=>({relabelLabels:[label],directions:[]})},fboAssemblyAction:{findUnique:async()=>null,create:vi.fn()},
  fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash:createHash('sha256').update(JSON.stringify([['item','sku','warehouse',1]])).digest('hex')})},
  fboAssemblyUnit:{findMany:async()=>[unit],update:vi.fn()},fboAssemblyBox:{findMany:async()=>[],findUnique:async()=>({requestId:'r',closedAt:null,wholeBox:false,direction:'Main'})},
  box:{findUniqueOrThrow:async()=>({id:'holding'})},auditLog:{create:vi.fn()},fbsPrintJob:{findUnique:async()=>({requestId:'r',assemblyId:'unit',source:'TSD_RELABEL',stickerCode:label.barcode,status:'PRINTED'})}};
 tx.lamodaFboAssembly.findUnique=async()=>({relabelLabels:[label],directions:[{name:'Main',items:[{skuId:'sku',barcode:'warehouse',quantity:1}]}]});
 const svc:any=new FboTwoStageService({$transaction:async(fn:any)=>fn(tx)} as never,null as never,null as never,null as never,{assertStockMovementsAllowed:async()=>{}} as never,null as never);
 svc.load=async()=>request;svc.requireFbo=()=>{};svc.box=async()=>({id:'target'});svc.plan=async()=>({});
 svc.move=vi.fn(async()=>{throw Error('STOCK_BOUNDARY');});
 return {svc,tx,unit,label};
}
// TEST: exercise the actual handler; old APKs cannot bypass replacement-label evidence.
it.each([false,true])('packing requires unit evidence: %s',async confirmed=>{
 const {svc}=fixture(confirmed);
 const result=svc.act('r',{action:'PACK_UNIT',operationId:'pack-unit-1',barcode:'4640684266611',targetBoxCode:'target'},{id:'worker'});
 if(confirmed)await expect(result).rejects.toThrow('STOCK_BOUNDARY');
 else {await expect(result).rejects.not.toThrow('STOCK_BOUNDARY');expect(svc.move).not.toHaveBeenCalled();}
});
it('rejects warehouse barcode after relabeling',async()=>{
 const {svc}=fixture(true);
 await expect(svc.act('r',{action:'PACK_UNIT',operationId:'pack-unit-2',barcode:'warehouse',targetBoxCode:'target'},{id:'worker'})).rejects.not.toThrow('STOCK_BOUNDARY');
 expect(svc.move).not.toHaveBeenCalled();
});
it('confirms exact printed unit without moving stock',async()=>{
 const {svc,tx}=fixture();
 await svc.act('r',{action:'RELABEL_UNIT',operationId:'relabel-1',relabelUnitId:'unit',barcode:'4640684266611'},{id:'worker'});
 expect(tx.fboAssemblyUnit.update).toHaveBeenCalledWith({where:{id:'unit'},data:{lamodaRelabelConfirmedAt:expect.any(Date),lamodaRelabelConfirmedBy:'worker'}});
 expect(svc.move).not.toHaveBeenCalled();
});
it('rejects another unit and pending print',async()=>{
 const {svc,tx}=fixture();
 await expect(svc.act('r',{action:'RELABEL_UNIT',operationId:'relabel-2',relabelUnitId:'other',barcode:'4640684266611'},{id:'worker'})).rejects.toThrow();
 tx.fbsPrintJob.findUnique=async()=>({requestId:'r',assemblyId:'unit',source:'TSD_RELABEL',stickerCode:'4640684266611',status:'QUEUED'});
 await expect(svc.act('r',{action:'RELABEL_UNIT',operationId:'relabel-3',relabelUnitId:'unit',barcode:'4640684266611'},{id:'worker'})).rejects.toThrow('печати');
 expect(tx.fboAssemblyUnit.update).not.toHaveBeenCalled();
});
it('preserves KIZ verification after printing',async()=>{
 const {svc,unit,tx}=fixture();Object.assign(unit,{markId:'mark',kiz:'physical-mark'});
 await expect(svc.act('r',{action:'RELABEL_UNIT',operationId:'relabel-4',relabelUnitId:'unit',barcode:'4640684266611',kiz:'wrong-mark'},{id:'worker'})).rejects.toThrow('КИЗ');
 expect(tx.fboAssemblyUnit.update).not.toHaveBeenCalled();
});
// TEST: a second tap/new HTTP UUID must return the first unit's durable print job.
it('does not enqueue duplicates after a lost response',async()=>{
 const {svc,tx,unit,label}=fixture();Object.assign(unit,{lamodaRelabelPrintId:null});
 const jobs:any[]=[];
 const binding={planId:'plan',relabelLabels:[label]};
 tx.lamodaFboAssembly.findUniqueOrThrow=async()=>binding;
 tx.fboAssemblyUnit.findFirst=async()=>unit;
 tx.fboAssemblyUnit.update=async({data}:any)=>Object.assign(unit,data);
 tx.fbsPrintStation={findMany:async()=>[{id:'station'}],findFirst:async()=>({id:'station'})};
 tx.fbsPrintJob={findUnique:async({where}:any)=>jobs.find(j=>j.historyId===where.historyId)??null,create:vi.fn(async({data}:any)=>{const j={...data,status:'QUEUED',errorMessage:null};jobs.push(j);return j;})};
 svc.prisma={...tx,$transaction:async(fn:any)=>fn(tx)};svc.relabelStations=async()=>[{id:'station'}];
 const first=await svc.printLamodaRelabel('r',{unitId:'unit',stationId:'station',printId:'12345678-1234-4123-8123-123456789012'},{id:'worker'});
 const repeat=await svc.printLamodaRelabel('r',{unitId:'unit',stationId:'station',printId:'22345678-1234-4123-8123-123456789012'},{id:'worker'});
 expect(repeat).toEqual(first);expect(tx.fbsPrintJob.create).toHaveBeenCalledTimes(1);
 expect(jobs[0].stickerCode).toBe(label.barcode);expect(jobs[0].assemblyId).toBe('unit');
});
