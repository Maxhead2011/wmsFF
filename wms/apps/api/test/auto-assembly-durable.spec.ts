import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginSupply, completeSupply, discoverSupply, finishOperation, recoverInterrupted, requestCreated, setRunKey, stage, validateRoute, withRun } from '../src/modules/marketplace-connections/auto-assembly-durable';

// TEST: execution failures must not become new WB supply creation or stock writes.
const original = process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED;
afterEach(() => { if (original === undefined) delete process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED; else process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED = original; });
function fixture() {
  process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED = 'true';
  const values = new Map<string, any>();
  const db: any = { systemSetting: {
    upsert: vi.fn(async (q: any) => values.set(q.where.key, structuredClone(q.update.value))),
    findUnique: vi.fn(async (q: any) => values.has(q.where.key) ? { value: values.get(q.where.key) } : null),
    findMany: vi.fn(async (q: any) => [...values].filter(([key]) => key.startsWith(q.where.key.startsWith)).map(([key, value]) => ({ key, value }))),
    update: vi.fn(async (q: any) => values.set(q.where.key, q.data.value)),
  }, $queryRaw: vi.fn(async () => [{ locked: true }]),
  fbsOrderRequestLink: { updateMany: vi.fn(async () => ({ count: 2 })) }, fbsTsdAssembly: { updateMany: vi.fn(async () => ({ count: 2 })) } };
  db.$transaction = async (cb: any) => cb(db);
  return { db, values };
}
const orders = [{ id: '1', connectionId: 'conn', marketplace: 'WILDBERRIES' }, { id: '2', connectionId: 'conn', marketplace: 'WILDBERRIES' }];
const req = { id: 'req', number: 2082 };
describe('durable auto assembly', () => {
  it('persists request ownership in the caller transaction before any WB intent', async () => {
    const { db, values } = fixture();
    await withRun(db, 'conn', async () => {
      setRunKey('run'); await requestCreated(db, req, 'client', orders, 'actor');
      expect(values.get('fbs.autoAssembly.operation.conn.req')).toMatchObject({ requestNumber: 2082, runKey: 'run', stage: 'REQUEST_CREATED', orderIds: ['1','2'] });
    });
  });
  it('records unknown create intent before network and rejects a second attempt', async () => {
    const { db, values } = fixture();
    await withRun(db, 'conn', async () => {
      await requestCreated(db, req, 'client', orders, 'actor');
      const handle = await beginSupply(db, 'conn', orders, 'name');
      expect(values.get(handle!.key).stage).toBe('CREATE_PENDING');
      await expect(beginSupply(db, 'conn', orders, 'name')).rejects.toThrow('уже начат');
    });
  });
  it('preserves ID immediately and binds only the verified group', async () => {
    const { db, values } = fixture();
    await withRun(db, 'conn', async () => {
      await requestCreated(db, req, 'client', orders, 'actor');
      const handle = await beginSupply(db, 'conn', [orders[0]], 'name');
      await stage(db, handle, { stage: 'SUPPLY_CREATED', supplyId: 'WB-GI-1' });
      expect(values.get(handle!.key).supplyId).toBe('WB-GI-1');
      await completeSupply(db, handle, 'WB-GI-1');
      expect(db.fbsTsdAssembly.updateMany.mock.calls[0][0]).toMatchObject({ where: { requestId: 'req', connectionId: 'conn', clientId: 'client', orderId: { in: ['1'] } }, data: { supplyId: 'WB-GI-1' } });
      await expect(finishOperation(db, async () => ({ orderIds: ['1'] }))).rejects.toThrow('Не все');
      expect(values.get('fbs.autoAssembly.operation.conn.req').stage).not.toBe('VERIFIED');
    });
  });
  it('completes multiple supply groups only after full remote verification', async () => {
    const { db, values } = fixture();
    await withRun(db, 'conn', async () => {
      await requestCreated(db, req, 'client', orders, 'actor');
      for (const order of orders) { const h = await beginSupply(db,'conn',[order],'name'); await stage(db,h,{stage:'SUPPLY_CREATED',supplyId:'WB-GI-'+order.id}); }
      await finishOperation(db, async url => ({ orderIds: [url.includes('WB-GI-1/') ? '1' : '2'] }));
      expect(values.get('fbs.autoAssembly.operation.conn.req').stage).toBe('VERIFIED');
    });
  });
  it('does not run or create journals without ownership lock', async () => {
    const { db, values } = fixture(); db.$queryRaw.mockResolvedValue([{locked:false}]); const work = vi.fn();
    await withRun(db,'conn',work); expect(work).not.toHaveBeenCalled(); expect(values.size).toBe(0);
  });
  it('does not change flag-off or manual assembly', async () => {
    const { db, values } = fixture(); await requestCreated(db,req,'client',orders,'actor'); expect(values.size).toBe(0);
    process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED='false';
    await withRun(db,'conn',async()=>requestCreated(db,req,'client',orders,'actor'));
    expect(values.size).toBe(0); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('recovers a lost POST response by unique intent without a POST', async () => {
    const http=vi.fn(async()=>({supplies:[{id:'WB-GI-1',name:'unique'},{id:'WB-GI-2',name:'other'}],next:0}));
    expect(await discoverSupply(http,['1'],'unique')).toBe('WB-GI-1'); expect(http).toHaveBeenCalledTimes(1);
  });
  it('finds manual supply only by exact composition', async () => {
    const http=vi.fn(async(url:string)=>url.includes('?')?{supplies:[{id:'WB-GI-1'},{id:'WB-GI-2'}],next:0}:{orderIds:url.includes('WB-GI-1/')?['1','2','3']:['2','1']});
    expect(await discoverSupply(http,['1','2'])).toBe('WB-GI-2');
  });
  it('rejects duplicate names and incomplete pagination', async () => {
    await expect(discoverSupply(async()=>({supplies:[{id:'a',name:'n'},{id:'b',name:'n'}],next:0}),['1'],'n')).rejects.toThrow('несколько');
    await expect(discoverSupply(async()=>({supplies:[],next:1}),['1'],'n')).rejects.toThrow('не завершил');
  });
  it('rechecks execution routing and selected warehouses', async () => {
    const db:any={fbsWarehouseRoutingRule:{findFirst:async()=>({mode:'EXCLUDED'})}};
    const connection={id:'c',clientId:'client',isActive:true,marketplace:'WILDBERRIES',fbsExecutionWarehouseId:'w'};
    await expect(validateRoute(db,connection,{clientId:'client',warehouseId:'w'},[{sellerWarehouseId:'1'}],{allWarehouses:true})).rejects.toThrow('Маршрутизация');
    await expect(validateRoute(db,connection,{clientId:'client',warehouseId:'w'},[{sellerWarehouseId:'1'}],{allWarehouses:false,warehouseIds:['2']})).rejects.toThrow('исключён');
  });
  it('does not classify a recent RUNNING as interrupted', async () => {
    const { db, values }=fixture(); values.set('fbs.autoAssembly.run.conn.now',{status:'RUNNING',startedAt:new Date().toISOString()});
    const recover=vi.fn();
    expect(await recoverInterrupted(db,{id:'conn',marketplace:'WILDBERRIES',isActive:true},'actor',{},recover,vi.fn())).toEqual([]);
    expect(recover).not.toHaveBeenCalled(); expect(db.systemSetting.update).not.toHaveBeenCalled();
  });
});
