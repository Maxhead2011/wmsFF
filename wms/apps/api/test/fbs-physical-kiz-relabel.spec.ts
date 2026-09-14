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

it.each([false,true])('sends the replacement KIZ through normal WB acceptance and makes repeated scans idempotent; audit first: %s', async auditFirst => {
  // TEST: execute the public scanner and real replacement transaction together, with WB isolated.
  const f=fixture(); const id=await f.propose();const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma=f.db;service.loadOwnedFbsTsdAssembly=async()=>copy(f.state.task);
  service.requireFbsOrderStillCollectable=async()=>{};service.assertFbsTsdLeaseVersion=async(t:any)=>t;
  service.requireCurrentFbsTsdLease=f.lease;service.findPreviousWildberriesKizUsage=async()=>null;
  service.isFbsEmergencyAssemblyRequest=async()=>false;
  service.loadWildberriesFbsKizPreflight=async()=>({alreadyAttached:false,supplierStatus:'confirm',wbStatus:'waiting',remoteKizValues:[]});
  f.db.clientMarketplaceConnection={findFirst:async()=>({apiKey:'test'})};
  service.updateFbsTsdUnderLease=async(t:any,u:any,data:any)=>f.db.fbsTsdAssembly.update({data});
  service.recordAcceptedFbsKizScan=async()=>{};
  service.formatFbsTsdAssembly=async(t:any)=>({task:t});
  const picked=new Set();service.reserveAcceptedWildberriesStock=async(t:any)=>{expect(t.kiz).toBe(NEW);if(!picked.has(t.id)){picked.add(t.id);f.state.quantity--;}};
  const fetchMock=vi.fn(async(_url:any,init:any)=>{expect(JSON.parse(init.body)).toEqual({sgtins:[NEW]});return new Response('{}',{status:200});});
  vi.stubGlobal('fetch',fetchMock);
  const payload={kiz:NEW,confirmKizRelabel:true,kizRelabelProposalId:id,registerKizRelabelOnly:auditFirst};
  await service.scanFbsTsdKiz('t',payload,f.user);await service.scanFbsTsdKiz('t',payload,f.user);
  if(auditFirst){
    expect(fetchMock).not.toHaveBeenCalled();expect(f.state.quantity).toBe(1);expect(f.state.task.wbMetaStatus).toBe('PENDING');
    await service.scanFbsTsdKiz('t',{kiz:NEW},f.user);
  }
  expect(fetchMock).toHaveBeenCalledOnce();expect(f.state.quantity).toBe(0);expect(f.state.marks[0].value).toBe(OLD);
  expect(f.state.task.wbMetaStatus).toBe('ACCEPTED');expect(f.state.audits.filter((a:any)=>a.payload.stage==='APPLIED')).toHaveLength(1);
});
