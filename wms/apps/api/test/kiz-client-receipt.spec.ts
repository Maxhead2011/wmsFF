import { afterEach, expect, it, vi } from 'vitest';
import { TsdReceiptService } from '../src/modules/tsd/tsd-receipt.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { TsdReviewService } from '../src/modules/tsd/tsd-review.service';
import { ImportsService } from '../src/modules/imports/imports.service';

const serial = '010460000000000121AbCdEfGhIjKlM';
afterEach(() => vi.unstubAllEnvs());

it('blocks a prior same-client receipt when the scanned KIZ omits its crypto tail', async () => {
  // TEST: the previous full-string lookup missed this physical duplicate.
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ clientId: 'client', identity: serial,
      firstReceivedAt: new Date('2026-10-01T09:00:00Z'), firstBoxCode: 'ORIGINAL_BOX',
      firstWarehouseId: 'wh', productName: 'Костюм', barcode: '4600000000001', source: 'RECEIPT' }]),
    productMark: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    shippedKizHistory: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new TsdReceiptService(db, { requireClientAccess: vi.fn() } as any,
    { touchActiveDevice: vi.fn() } as any);
  const result = await service.checkKiz('client', serial, { id: 'user', activeWarehouseId: 'wh',
    permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } as any);
  expect(result).toMatchObject({ duplicate: true, code: 'KIZ_DUPLICATE',
    duplicateInfo: { firstBoxCode: 'ORIGINAL_BOX', identity: serial } });
  expect(result.message).toContain('ОТЛОЖИТЕ ТОВАР');
  expect(db.productMark.findFirst).not.toHaveBeenCalled();
});

function receiptFixture() {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const tx: any = { $queryRaw: vi.fn(async(q:any) => q.strings.join('').includes('FROM "KizClientRegistry"')
    ? [{identity:serial,source:'LEGACY_UNKNOWN'}] : []),
    $executeRaw:vi.fn(), productMark:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn()},
    shippedKizHistory:{findMany:vi.fn().mockResolvedValue([])},
    stockMovement:{findUnique:vi.fn().mockResolvedValue(null),create:vi.fn()} };
  const service:any=Object.create(StockOperationsService.prototype);
  Object.assign(service,{ clientScopes:{requireClientAccess:vi.fn()},resolveWritableWarehouseId:()=> 'wh',
    resolveOrCreateSkuForReceipt:vi.fn().mockResolvedValue({sku:{id:'sku',name:'Suit',needsChestnyZnak:true},createdDraft:false}),
    ensureTargetBox:vi.fn().mockResolvedValue({id:'box',code:'BOX',warehouseId:'wh'}),
    incrementTargetBalance:vi.fn(), prisma:{$transaction:(fn:any)=>fn(tx)} });
  const input={clientId:'client',boxCode:'BOX',barcode:'4600000000001',kiz:serial,quantity:1,idempotencyKey:'scan'};
  return {tx,service,input};
}
it('rejects a duplicate before increasing quantity or writing a movement',async()=>{
  // TEST: the actual final receipt path must protect a scanner whose preflight was stale.
  const {tx,service,input}=receiptFixture();
  await expect(service.receiveIntoBox(input,{id:'u'})).rejects.toThrow('ДУБЛЬ КИЗ');
  expect(service.incrementTargetBalance).not.toHaveBeenCalled();expect(tx.stockMovement.create).not.toHaveBeenCalled();
});
it('returns ALREADY_APPLIED for a retry that committed while waiting for the identity lock',async()=>{
  const {tx,service,input}=receiptFixture();
  tx.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'already',clientId:'client'});
  await expect(service.receiveIntoBox(input,{id:'u'})).resolves.toMatchObject({status:'ALREADY_APPLIED'});
  expect(service.incrementTargetBalance).not.toHaveBeenCalled();expect(tx.productMark.create).not.toHaveBeenCalled();
});
it('does not permit accept-with-error to bypass a confirmed duplicate',async()=>{
  const {tx}=receiptFixture();const service:any=Object.create(TsdReviewService.prototype);
  tx.$transaction=(action:any)=>action(tx);
  Object.assign(service,{prisma:tx,clientScopes:{requireGlobalClientAccess:vi.fn(),requireClientAccess:vi.fn()},
    payloadParser:{parseReceiptPayload:()=>({clientId:'client',kiz:serial})},stockOperations:{receiveIntoBox:vi.fn()}});
  await expect(service.acceptReceiptWithError({operationType:'receipt_scan',payload:{}},{},{id:'admin',activeWarehouseId:'wh'})).rejects.toThrow('ДУБЛЬ КИЗ');
  expect(service.stockOperations.receiveIntoBox).not.toHaveBeenCalled();
});
it('catches equivalent codes repeated within an Excel file before committing any row',async()=>{
  const {tx}=receiptFixture();tx.$queryRaw.mockResolvedValue([]);
  const service:any=Object.create(ImportsService.prototype);service.prisma=tx;
  const result=await service.duplicateKizIssues([{clientId:'client',kiz:serial,sourceRow:2},
    {clientId:'client',kiz:serial+'\u001d91EE12\u001d92proof',sourceRow:3}]);
  expect(result).toEqual([{row:3,message:expect.stringContaining('внутри файла'),severity:'error'}]);
});
