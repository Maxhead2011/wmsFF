import {afterEach,expect,it,vi} from 'vitest';
import {receiptDocuments} from '../src/modules/warehouse/receipt-channel-policy';
afterEach(()=>vi.unstubAllEnvs());
// TEST: one receipt retains totals across days, old years and explicit box assignments.
it('uses aggregated evidence only for reports and preserves document totals',async()=>{
  vi.stubEnv('WMS_MENU_READS_ENABLED','true');
  const m=[{boxId:'b',sourceDocument:'doc',createdAt:new Date('2026-01-03'),quantity:7},
    {boxId:'b',sourceDocument:'old',createdAt:new Date('2025-01-03'),quantity:90}];
  const db:any={
    $queryRaw:vi.fn().mockResolvedValueOnce(m).mockResolvedValueOnce([]),
    stockMovement:{findMany:vi.fn().mockResolvedValue(m)},tsdOperation:{findMany:vi.fn().mockResolvedValue([])},
    box:{findMany:vi.fn().mockResolvedValue([{id:'b',code:'BOX_1',status:'active'}])},
    systemSetting:{findMany:vi.fn().mockResolvedValue([])},
  };
  const result=await receiptDocuments(db,'c','w',undefined,undefined,true);
  expect(result).toHaveLength(1);expect(result[0].received).toBe(7);
  expect(result[0].sourceDocument).toBe('SERIES:2026:BOX');
  expect(db.stockMovement.findMany).not.toHaveBeenCalled();
  expect(db.tsdOperation.findMany).not.toHaveBeenCalled();
  expect(await receiptDocuments(db,'c','w')).toEqual(result);
  expect(db.stockMovement.findMany).toHaveBeenCalledOnce();
});
it('does not enable aggregation in sold WMS',async()=>{
  vi.stubEnv('WMS_MENU_READS_ENABLED','false');
  const db:any={$queryRaw:vi.fn(),stockMovement:{findMany:vi.fn().mockResolvedValue([])},tsdOperation:{findMany:vi.fn().mockResolvedValue([])},box:{findMany:vi.fn().mockResolvedValue([])},systemSetting:{findMany:vi.fn().mockResolvedValue([])}};
  expect(await receiptDocuments(db,'c','w',undefined,undefined,true)).toEqual([]);
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
