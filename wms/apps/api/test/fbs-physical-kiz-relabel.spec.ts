import {afterEach, expect, it, vi} from 'vitest';
import {applyPhysicalKizRelabel, proposePhysicalKizRelabel, readPhysicalKizRelabel, cancelPhysicalKizRelabel} from '../src/modules/marketplace-connections/fbs-physical-kiz-relabel';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});
const OLD = '0104680992590022215MywwfMmgS<1E\u001d91EE12\u001d92OLD';
const NEW = '01046809925976562154wMCRGtr"7PG\u001d91EE12\u001d92NEW';
const copy = <T>(v: T): T => structuredClone(v);
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('equals' in v) return String(row[k]).toLowerCase() === String(v.equals).toLowerCase();
      if ('in' in v) return v.in.includes(row[k]);
      if ('notIn' in v) return !v.notIn.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      throw Error('Unmodelled predicate: ' + k);
    }
    return v instanceof Date ? +row[k] === +v : row[k] === v;
  });
}
function fixture() {
  vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'true');
  const user: any = {id: 'worker', roleCodes: ['TSD'], deviceCode: 'device', activeWarehouseId: 'w'};
  const state: any = {task: {id: 't', clientId: 'c', requestId: 'r', connectionId: 'conn', orderId: '123', skuId: 'sku',
    boxId: 'box', boxCode: 'FFL_BOX', barcode: '2042312098151', barcodes: ['2042312098151'], itemCount: 1, requiresKiz: true,
    workerUserId: 'worker', deviceCode: 'device', status: 'IN_PROGRESS', marketplace: 'WILDBERRIES', completedAt: null,
    kiz: null, wbMetaStatus: 'PENDING', startedAt: new Date(1000), updatedAt: new Date(2000)},
    marks: [{id: 'old', value: OLD, clientId: 'c', skuId: 'sku', boxId: 'box', status: 'AVAILABLE', sourceDocument: 'Physical receipt'}],
    audits: [], quantity: 1, history: [{orderId: 'old-order', kiz: OLD}], oldTask: {orderId: 'old-order', kiz: OLD, status: 'COMPLETED'},
    linked: [], picked: null, box: {id: 'box', clientId: 'c', warehouseId: 'w', status: 'active'},
    request: {id: 'r', clientId: 'c', warehouseId: 'w', status: 'IN_WORK'}, openRequests: 0};
  let time = 3000;
  const db: any = {
    $queryRaw: vi.fn(async () => []),
    fbsTsdAssembly: {findUnique: vi.fn(async () => copy(state.task)),
      findMany: vi.fn(async () => copy(state.linked)),
      findFirst: vi.fn(async ({where}: any) => state.task.kiz && matches(state.task, where) ? copy(state.task) : null),
      update: vi.fn(async ({data}: any) => {Object.assign(state.task, data, {updatedAt: new Date(++time)}); return copy(state.task);})},
    box: {findUnique: vi.fn(async () => copy(state.box))},
    clientRequest: {findUnique: vi.fn(async () => copy(state.request)), count: vi.fn(async () => state.openRequests), findMany: vi.fn(async () => [])},
    stockBalance: {aggregate: vi.fn(async () => ({_sum: {quantity: state.quantity}}))},
    stockMovement: {findFirst: vi.fn(async () => state.picked)},
    shippedKizHistory: {findFirst: vi.fn(async ({where}: any) => copy(state.history.find((h: any) => matches(h, where)) ?? null))},
    productMark: {findFirst: vi.fn(async ({where}: any) => copy(state.marks.find((m: any) => matches(m, where)) ?? null)),
      count: vi.fn(async ({where}: any) => state.marks.filter((m: any) => matches(m, where)).length),
      updateMany: vi.fn(async ({where,data}: any) => {const rows = state.marks.filter((m: any) => matches(m, where)); rows.forEach((m: any) => Object.assign(m, data)); return {count: rows.length};}),
      create: vi.fn(async ({data}: any) => {const row = {id: 'new', ...copy(data)}; state.marks.push(row); return copy(row);})},
    auditLog: {findFirst: vi.fn(async ({where}: any) => copy([...state.audits].reverse().find((a: any) => matches(a, where)) ?? null)),
      create: vi.fn(async ({data}: any) => {const row = {id: 'audit-'+(++time), ...copy(data)}; state.audits.push(row); return copy(row);})},
  };
  db.$transaction = async (run: any) => {const before = copy(state); try {return await run(db);} catch(e) {Object.assign(state, before); throw e;}};
  const lease = (fresh: any) => {if (fresh?.workerUserId !== user.id || fresh?.deviceCode !== user.deviceCode) throw Error('lease lost');};
  const propose = async () => {await db.$transaction((tx: any) => proposePhysicalKizRelabel(tx, copy(state.task), OLD, user, lease)); return (await readPhysicalKizRelabel(db, state.task, user))!.id;};
  const apply = (id: string, value = NEW) => db.$transaction((tx: any) => applyPhysicalKizRelabel(tx, copy(state.task), user, id, value, lease));
  return {db,state,user,lease,propose,apply};
}

it('requires the old source-size KIZ and converts stock only with the new KIZ', async () => {
  // TEST: scanning the new barcode alone must not orphan the original size's KIZ.
  const f=fixture(); Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',relabelRequired:true,relabelConfirmedAt:null});
  f.db.box.findUniqueOrThrow=f.db.box.findUnique;
  f.state.marks[0].skuId='source-size';
  f.db.stockBalance.findFirst=vi.fn(async()=>({id:'balance',clientId:'c',warehouseId:'w',skuId:'source-size',boxId:'box',palletId:null,quantity:1}));
  f.db.stockBalance.updateMany=vi.fn(async()=>({count:1}));f.db.stockBalance.upsert=vi.fn();f.db.stockMovement.createMany=vi.fn();
  const id=await f.propose();
  expect(f.db.stockBalance.updateMany).not.toHaveBeenCalled();
  await f.apply(id); await f.apply(id);
  expect(f.db.stockBalance.updateMany).toHaveBeenCalledTimes(1);
  expect(f.db.stockMovement.createMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.arrayContaining([
    expect.objectContaining({skuId:'source-size',quantity:-1}),expect.objectContaining({skuId:'sku',quantity:1})])}));
  expect(f.state.marks[0]).toMatchObject({status:'BLOCKED',boxId:null,skuId:'source-size'});
  expect(f.state.marks[1]).toMatchObject({status:'AVAILABLE',skuId:'sku',value:NEW});
  expect(f.state.task.relabelConfirmedAt).toBeInstanceOf(Date);
});

it('stores a new barcode without changing stock before the source/new KIZ pair', async()=>{
  // TEST: exercise the actual barcode entrypoint, preserving the sold-VM path when disabled.
  const f=fixture();Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',barcode:null,relabelRequired:true,relabelConfirmedAt:null});
  const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma={sku:{findMany:vi.fn(async()=>[{id:'source-size',size:'S / 44'},{id:'sku',size:'M / 46'}])}};
  service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);service.requireFbsOrderStillCollectable=async()=>{};
  service.assertFbsTsdLeaseVersion=async(t:any)=>t;service.updateFbsTsdUnderLease=vi.fn(async(t:any,u:any,data:any)=>({...t,...data}));
  service.completeFbsTsdRelabeling=vi.fn(async()=>f.state.task);service.formatFbsTsdAssembly=async(t:any)=>t;
  const result=await service.scanFbsTsdBarcode('t',{barcode:'2042312098151'},f.user);
  expect(result.barcode).toBe('2042312098151');expect(result.relabelConfirmedAt).toBeNull();
  expect(service.completeFbsTsdRelabeling).not.toHaveBeenCalled();
  vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED','false');await service.scanFbsTsdBarcode('t',{barcode:'2042312098151'},f.user);
  expect(service.completeFbsTsdRelabeling).toHaveBeenCalledTimes(1);
});

it('keeps the existing KIZ for a same-size duplicate article after the new barcode', async()=>{
  // TEST: a second sales article for the same physical size must not demand a new KIZ or a whole-box audit.
  const f=fixture();Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',barcode:null,relabelRequired:true,relabelConfirmedAt:null});
  const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma={sku:{findMany:vi.fn(async()=>[{id:'source-size',size:'M / 46'},{id:'sku',size:'M / 46'}])}};
  service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);service.requireFbsOrderStillCollectable=async()=>{};
  service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.completeFbsTsdRelabeling=vi.fn(async()=>({...f.state.task,barcode:'2042312098151',relabelConfirmedAt:new Date()}));
  service.updateFbsTsdUnderLease=vi.fn();service.formatFbsTsdAssembly=async(t:any,u:any,message:string)=>({task:t,message});
  const result=await service.scanFbsTsdBarcode('t',{barcode:'2042312098151'},f.user);
  expect(service.completeFbsTsdRelabeling).toHaveBeenCalledOnce();
  expect(service.updateFbsTsdUnderLease).not.toHaveBeenCalled();
  expect(result.message).toContain('прежний КИЗ');
  expect(result.task.relabelConfirmedAt).toBeInstanceOf(Date);
});

it('recovers an already scanned same-size task before requesting a replacement KIZ', async()=>{
  // TEST: existing request 1315 reached SCAN_NEW_KIZ before this fix; its old KIZ is still valid.
  const f=fixture();Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',relabelRequired:true,relabelConfirmedAt:null});
  const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma={sku:{findMany:vi.fn(async()=>[{id:'source-size',size:'M / 46'},{id:'sku',size:'M/46'}])},
    auditLog:{findFirst:vi.fn(async()=>null)}};
  service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);service.requireFbsOrderStillCollectable=async()=>{};
  service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.completeFbsTsdRelabeling=vi.fn(async()=>{throw new Error('SOURCE_BOX_REQUIRED');});
  service.proposeFbsPhysicalKizRelabel=vi.fn();
  await expect(service.scanFbsTsdKiz('t',{kiz:OLD,confirmKizRelabel:true,kizRelabelProposalId:'old-proposal'},f.user))
    .rejects.toThrow('SOURCE_BOX_REQUIRED');
  expect(service.completeFbsTsdRelabeling).toHaveBeenCalledWith(expect.objectContaining({id:'t'}),'2042312098151',f.user);
  expect(service.proposeFbsPhysicalKizRelabel).not.toHaveBeenCalled();
});

it.each(['TSD', 'OPERATOR', 'ADMIN', 'OWNER'])('registers the exact old/new pair for task owner role %s without changing quantity or history', async role => {
  // TEST: Sonya's explicit repair is now available to every authorized task owner.
  const f=fixture(); f.user.roleCodes=[role]; const history=copy(f.state.history), oldTask=copy(f.state.oldTask);
  const proposal=await f.propose(); await f.apply(proposal);
  expect(f.state.marks[0]).toMatchObject({id:'old',value:OLD,boxId:null,status:'BLOCKED',sourceDocument:'Physical receipt'});
  expect(f.state.marks[1]).toMatchObject({id:'new',value:NEW,boxId:'box',status:'AVAILABLE',skuId:'sku'});
  expect(f.state.quantity).toBe(1);expect(f.state.history).toEqual(history);expect(f.state.oldTask).toEqual(oldTask);
  expect(f.state.task).toMatchObject({kiz:NEW,wbMetaStatus:'PENDING'});
  expect(f.state.audits.at(-1).payload).toMatchObject({stage:'APPLIED',proposalId:proposal,oldMarkId:'old',newMarkId:'new',oldKiz:OLD,newKiz:NEW});
});
it('restores the proposal after restart and retries a committed replacement without duplicate writes', async () => {
  const f=fixture();const id=await f.propose();expect(await readPhysicalKizRelabel(f.db,copy(f.state.task),f.user)).toMatchObject({id,oldKiz:OLD});
  await f.apply(id);const before=copy(f.state);await f.apply(id);expect(f.state).toEqual(before);
  expect(await readPhysicalKizRelabel(f.db,f.state.task,f.user)).toBeNull();
});
it('cancels only the current proposal without changing marks or quantity', async () => {
  const f=fixture();const id=await f.propose();const marks=copy(f.state.marks);
  await f.db.$transaction((tx:any)=>cancelPhysicalKizRelabel(tx,f.state.task,f.user,id,f.lease));
  expect(await readPhysicalKizRelabel(f.db,f.state.task,f.user)).toBeNull();expect(f.state.marks).toEqual(marks);expect(f.state.quantity).toBe(1);
  await expect(f.apply(id)).rejects.toThrow();
});
it.each(['wrong-box','wrong-sku','wrong-client','wrong-warehouse','closed','missing-stock','extra-mark','picked','held-mark','other-worker','other-device','another-active-task','same-code','registered-new','used-new','stale-proposal','disabled','audit-failure','create-failure'])('does not partially replace or invent stock for %s', async kind => {
  // TEST: the transaction rolls back both mark changes and task state when any validation/write fails.
  const f=fixture();const id=await f.propose();
  if(kind==='wrong-box')f.state.marks[0].boxId='other';
  if(kind==='wrong-sku')f.state.marks[0].skuId='other';
  if(kind==='wrong-client')f.state.marks[0].clientId='other';
  if(kind==='wrong-warehouse')f.state.request.warehouseId='other';
  if(kind==='closed')f.state.request.status='DONE';
  if(kind==='missing-stock')f.state.quantity=0;
  if(kind==='extra-mark')f.state.marks.push({...f.state.marks[0],id:'extra',value:'other'});
  if(kind==='picked')f.state.picked={quantity:-1};
  if(kind==='held-mark')f.state.marks[0].status='QUARANTINE';
  if(kind==='other-worker')f.state.task.workerUserId='other';
  if(kind==='other-device')f.state.task.deviceCode='other';
  if(kind==='another-active-task')f.state.linked=[{requestId:'active',status:'IN_PROGRESS'}];
  if(kind==='registered-new')f.state.marks.push({id:'foreign',value:NEW,clientId:'foreign'});
  if(kind==='used-new')f.state.history.push({orderId:'foreign',kiz:NEW});
  if(kind==='disabled')vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED','false');
  if(kind==='audit-failure')f.db.auditLog.create.mockRejectedValue(new Error('audit failure'));
  if(kind==='create-failure')f.db.productMark.create.mockRejectedValue(new Error('unique race'));
  const before=copy(f.state);
  await expect(f.apply(kind==='stale-proposal'?'stale':id,kind==='same-code'?OLD:NEW)).rejects.toThrow();
  expect(f.state).toEqual(before);
});
it('refuses a changed lease version before any inventory mutation', async () => {
  const f=fixture();const id=await f.propose(), stale=copy(f.state.task); f.state.task.updatedAt=new Date(9999);
  await expect(f.db.$transaction((tx:any)=>applyPhysicalKizRelabel(tx,stale,f.user,id,NEW,f.lease))).rejects.toThrow('изменилось');
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
});

it.each([[false,false],[true,false],[false,true],[true,true]])('sends the replacement KIZ through normal WB acceptance; audit first: %s, universal scanner: %s', async (auditFirst, universal) => {
  // TEST: execute the public scanner and real replacement transaction together, with WB isolated.
  const f=fixture(); const id=await f.propose();const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma=f.db;service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);
  service.requireFbsOrderStillCollectable=async()=>{};service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.requireCurrentFbsTsdLease=f.lease;service.findPreviousWildberriesKizUsage=async()=>null;
  service.isFbsEmergencyAssemblyRequest=async()=>false;
  service.loadWildberriesFbsKizPreflight=async()=>({alreadyAttached:false,supplierStatus:'confirm',wbStatus:'waiting',remoteKizValues:[]});
  f.db.clientMarketplaceConnection={findFirst:async()=>({apiKey:'test'})};
  f.db.storagePallet={findFirst:async()=>null};
  service.updateFbsTsdUnderLease=async(t:any,u:any,data:any)=>f.db.fbsTsdAssembly.update({data});
  service.recordAcceptedFbsKizScan=async()=>{};
  service.formatFbsTsdAssembly=async(t:any)=>({task:t});
  const picked=new Set();service.reserveAcceptedWildberriesStock=async(t:any)=>{expect(t.kiz).toBe(NEW);if(!picked.has(t.id)){picked.add(t.id);f.state.quantity--;}};
  const fetchMock=vi.fn(async(_url:any,init:any)=>{expect(JSON.parse(init.body)).toEqual({sgtins:[NEW]});return new Response('{}',{status:200});});
  vi.stubGlobal('fetch',fetchMock);
  const payload={kiz:NEW,confirmKizRelabel:true,kizRelabelProposalId:id,registerKizRelabelOnly:auditFirst};
  // TEST: hardware scanner must forward the explicit replacement confirmation and audit-only mode.
  const scan = () => universal ? service.scanFbsTsdCode('t',{...payload,code:NEW},f.user)
    : service.scanFbsTsdKiz('t',payload,f.user);
  await scan();await scan();
  if(auditFirst){
    expect(fetchMock).not.toHaveBeenCalled();expect(f.state.quantity).toBe(1);expect(f.state.task.wbMetaStatus).toBe('PENDING');
    await service.scanFbsTsdKiz('t',{kiz:NEW},f.user);
  }
  expect(fetchMock).toHaveBeenCalledOnce();expect(f.state.quantity).toBe(0);expect(f.state.marks[0].value).toBe(OLD);
  expect(f.state.task.wbMetaStatus).toBe('ACCEPTED');expect(f.state.audits.filter((a:any)=>a.payload.stage==='APPLIED')).toHaveLength(1);
});

it('forwards relabel support from the universal scanner for the old KIZ', async () => {
  // TEST: APK168 sent supportsKizRelabel=true, but /scan silently dropped it.
  const f=fixture(); const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma={storagePallet:{findFirst:async()=>null}};
  service.loadOwnedFbsTsdAssembly=async()=>f.state.task;
  service.requireFbsOrderStillCollectable=async()=>{};
  service.scanFbsTsdKiz=vi.fn(async()=>({state:'SCAN_NEW_KIZ'}));
  await service.scanFbsTsdCode('t',{code:OLD,supportsKizRelabel:true},f.user);
  expect(service.scanFbsTsdKiz).toHaveBeenCalledWith('t',expect.objectContaining({kiz:OLD,supportsKizRelabel:true}),f.user);
});

it('retries the unchanged KIZ of an existing same-size duplicate without replacing the mark twice',async()=>{
  // TEST: recover an old proposal, retain the original Data Matrix, and accept it through the public scanner.
  const f=fixture();Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',relabelRequired:true,relabelConfirmedAt:null});
  f.state.marks[0].skuId='source-size';const proposal=await f.propose();
  f.db.sku={findMany:async()=>[{id:'source-size',size:'M / 46'},{id:'sku',size:'M / 46'}]};
  f.db.productMark.update=vi.fn(async({where,data}:any)=>{const mark=f.state.marks.find((m:any)=>m.id===where.id);Object.assign(mark,data);return copy(mark);});
  f.db.clientMarketplaceConnection={findFirst:async()=>({apiKey:'test'})};
  const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma=f.db;service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);
  service.requireFbsOrderStillCollectable=async()=>{};service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.requireCurrentFbsTsdLease=f.lease;service.findPreviousWildberriesKizUsage=async()=>null;
  service.isFbsEmergencyAssemblyRequest=async()=>false;
  service.completeFbsTsdRelabeling=vi.fn(async()=>f.db.fbsTsdAssembly.update({data:{relabelConfirmedAt:new Date()}}));
  service.loadWildberriesFbsKizPreflight=vi.fn().mockRejectedValueOnce(new Error('WB connection interrupted'))
    .mockResolvedValue({alreadyAttached:false,supplierStatus:'confirm',wbStatus:'waiting',remoteKizValues:[]});
  service.updateFbsTsdUnderLease=async(t:any,u:any,data:any)=>f.db.fbsTsdAssembly.update({data});
  service.recordAcceptedFbsKizScan=async()=>{};service.formatFbsTsdAssembly=async(t:any)=>({task:t});
  service.reserveAcceptedWildberriesStock=vi.fn();
  const fetchMock=vi.fn(async(_url:any,init:any)=>{expect(JSON.parse(init.body)).toEqual({sgtins:[OLD]});return new Response('{}',{status:200});});
  vi.stubGlobal('fetch',fetchMock);
  const scan=()=>service.scanFbsTsdKiz('t',{kiz:OLD,confirmKizRelabel:true,kizRelabelProposalId:proposal},f.user);
  await expect(scan()).rejects.toThrow('WB connection interrupted');
  await scan();
  expect(service.completeFbsTsdRelabeling).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(f.state.task).toMatchObject({kiz:OLD,wbMetaStatus:'ACCEPTED'});
  expect(f.state.marks).toHaveLength(1);expect(f.state.marks[0]).toMatchObject({value:OLD,skuId:'sku',status:'AVAILABLE'});
  expect(f.db.productMark.create).not.toHaveBeenCalled();
  expect(f.db.productMark.updateMany).not.toHaveBeenCalled();
  expect(await readPhysicalKizRelabel(f.db,f.state.task,f.user)).toBeNull();
});

it.each([false,true])('restores a pending scan with the correct KIZ step; same-size duplicate: %s', async (sameSizeDuplicate) => {
  // TEST: no extra confirmation screen between old and new physical scans, including after reload.
  const f=fixture();
  if(sameSizeDuplicate){Object.assign(f.state.task,{sourceSkuId:'source-size',sourceBarcode:'111',relabelRequired:true,relabelConfirmedAt:null});f.state.marks[0].skuId='source-size';}
  const id=await f.propose();
  Object.assign(f.db, {
    client:{findUnique:async()=>({id:'c',code:'CL',name:'Client'})},
    sku:{findUnique:async()=>({color:null,size:'M'}),findMany:async()=>[{id:'source-size',size:'M'},{id:'sku',size:'M'}]},
    clientRequestItem:{aggregate:async()=>({_sum:{quantity:1}})},
    clientMarketplaceConnection:{findUnique:async()=>null},
  });
  f.db.fbsTsdAssembly.aggregate=async()=>({_sum:{itemCount:0}});
  const service:any=new MarketplaceConnectionsService(f.db,{} as never);
  service.fbsTsdCompletedToday=async()=>0;service.fbsTsdStickerHistory=async()=>[];
  service.fbsTsdNextRequestSources=async()=>[];
  await expect(service.formatFbsTsdAssembly(f.state.task,f.user,'')).resolves.toMatchObject({
    state:sameSizeDuplicate?'SCAN_KIZ':'SCAN_NEW_KIZ',kizRelabelProposal:sameSizeDuplicate?null:{id,oldKiz:OLD},
  });
});

// TEST: RETURN_REQUIRED from a closed request must permit a proven physical return to be relabelled.
function sortedReturnFixture() {
  const f = fixture();
  f.state.linked = [{id:'historic',requestId:'closed',clientId:'c',skuId:'sku',status:'RETURN_REQUIRED',updatedAt:new Date(500)}];
  f.state.openRequests = 1; // count of closed linked requests in the existing fixture
  f.state.marks[0].stockMovementId = 'sorted-in';
  const movement:any = {id:'sorted-in',clientId:'c',warehouseId:'w',skuId:'sku',boxId:'box',status:'AVAILABLE',quantity:1,
    type:'INVENTORY_ADJUSTMENT',sourceDocument:'PALLET_SORTING:sorting',createdAt:new Date(1500)};
  const session:any = {id:'sorting',clientId:'c',warehouseId:'w',completedAt:new Date(1700)};
  f.db.stockMovement.findUnique = vi.fn(async()=>copy(movement));
  f.db.palletSortingSession = {findUnique:vi.fn(async()=>copy(session))};
  return {...f,movement,session};
}
it('relabels an available sorted unit blocked by a closed RETURN_REQUIRED task without rewriting its history', async()=>{
  const f=sortedReturnFixture(), linked=copy(f.state.linked);
  const id=await f.propose(); await f.apply(id);
  expect(f.state.linked).toEqual(linked);expect(f.state.quantity).toBe(1);
  expect(f.state.marks[0]).toMatchObject({value:OLD,status:'BLOCKED',boxId:null});
  expect(f.state.task).toMatchObject({kiz:NEW,wbMetaStatus:'PENDING'});
});
it.each(['open-request','active-task','missing-proof','old-proof','wrong-client','wrong-sku','wrong-box','wrong-warehouse','wrong-status','wrong-quantity','wrong-type','unfinished-sorting','foreign-session'])('refuses an unproven old return: %s',async kind=>{
  const f=sortedReturnFixture();
  if(kind==='open-request')f.state.openRequests=0;
  if(kind==='active-task')f.state.linked[0].status='IN_PROGRESS';
  if(kind==='missing-proof')f.state.marks[0].stockMovementId=null;
  if(kind==='old-proof')f.movement.createdAt=new Date(100);
  if(kind==='wrong-client')f.movement.clientId='other';
  if(kind==='wrong-sku')f.movement.skuId='other';
  if(kind==='wrong-box')f.movement.boxId='other';
  if(kind==='wrong-warehouse')f.movement.warehouseId='other';
  if(kind==='wrong-status')f.movement.status='PACKING';
  if(kind==='wrong-quantity')f.movement.quantity=-1;
  if(kind==='wrong-type')f.movement.type='PICK';
  if(kind==='unfinished-sorting')f.session.completedAt=null;
  if(kind==='foreign-session')f.session.clientId='other';
  const before=copy(f.state);await expect(f.propose()).rejects.toThrow();expect(f.state).toEqual(before);
});
it('rechecks the sorting proof when applying an already proposed replacement',async()=>{
  const f=sortedReturnFixture();const id=await f.propose();f.movement.boxId='other';
  const before=copy(f.state);await expect(f.apply(id)).rejects.toThrow();expect(f.state).toEqual(before);
});
it('the real KIZ scanner sends a returned historical conflict to the transactional relabel checks',async()=>{
  const f=sortedReturnFixture();const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma=f.db;service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);
  service.requireFbsOrderStillCollectable=async()=>{};service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.requireCurrentFbsTsdLease=f.lease;
  service.withFbsTsdLeaseTransaction=async(_t:any,_u:any,run:any)=>f.db.$transaction(run);
  service.formatFbsTsdAssembly=async()=>({state:'SCAN_NEW_KIZ'});
  service.recordDuplicateFbsKizScan=vi.fn();
  await expect(service.scanFbsTsdKiz('t',{kiz:OLD,supportsKizRelabel:true},f.user)).resolves.toEqual({state:'SCAN_NEW_KIZ'});
  expect(f.state.audits.at(-1).payload.stage).toBe('PROPOSED');
  expect(f.state.task.kiz).toBeNull();expect(f.state.quantity).toBe(1);
});
it.each(['disabled','foreign-client','active-task','old-apk'])('the scanner keeps existing protections for %s',async kind=>{
  // TEST: the new route cannot bypass a live lease, tenant boundary or disabled feature.
  const f=sortedReturnFixture();const service:any=Object.create(MarketplaceConnectionsService.prototype);
  if(kind==='disabled')vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED','false');
  if(kind==='foreign-client')f.state.linked[0].clientId='other';
  if(kind==='active-task')f.state.linked[0].status='IN_PROGRESS';
  service.prisma=f.db;service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);
  service.requireFbsOrderStillCollectable=async()=>{};service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.recordDuplicateFbsKizScan=vi.fn();service.proposeFbsPhysicalKizRelabel=vi.fn();
  await expect(service.scanFbsTsdKiz('t',{kiz:OLD,supportsKizRelabel:kind!=='old-apk'},f.user)).rejects.toThrow();
  expect(service.proposeFbsPhysicalKizRelabel).not.toHaveBeenCalled();expect(f.state.task.kiz).toBeNull();
});
