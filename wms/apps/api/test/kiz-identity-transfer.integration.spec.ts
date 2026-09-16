import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { confirmInventoryKizComposition } from '../src/modules/inventory/confirmed-kiz-composition';
import { findPhysicalKizId } from '../src/common/kiz-physical-identity';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { InventoryResolutionAction } from '../src/modules/inventory/dto/inventory.dto';
import { StockBalancesService } from '../src/modules/stock/stock-balances.service';

const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/kiz_duplicate_tests/.test(url)) throw Error('Dedicated local test database only');
describe.skipIf(!url).sequential('physical KIZ transfer on PostgreSQL', () => {
  const p = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const ids = Object.fromEntries(['client','warehouse','user','sku','source','target','mark','session','audit','line','sourceBalance','targetBalance'].map(key => [key, randomUUID()]));
  const raw = '0104680992598455215rYJoe1STv"l%\u001d91EE12\u001d92proof';
  const since = new Date();
  const user: any = { id: ids.user, name: 'Test admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', activeWarehouseId: ids.warehouse, writableWarehouseIds: [ids.warehouse], warehouseIds: [ids.warehouse] };
  beforeAll(async () => {
    vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT','true'); vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED','true');
    await p.warehouse.create({data:{id:ids.warehouse,code:ids.warehouse,name:'test'}});
    await p.client.create({data:{id:ids.client,code:ids.client,name:'test'}});
    await p.user.create({data:{id:ids.user,email:ids.user+'@test.invalid',name:'test',passwordHash:'not-a-password'}});
    await p.sku.create({data:{id:ids.sku,clientId:ids.client,internalSku:ids.sku,name:'test',needsChestnyZnak:true}});
    for (const id of [ids.source,ids.target]) await p.box.create({data:{id,code:id,clientId:ids.client,warehouseId:ids.warehouse}});
    for (const [id,boxId,quantity] of [[ids.sourceBalance,ids.source,1],[ids.targetBalance,ids.target,0]] as const)
      await p.stockBalance.create({data:{id,balanceKey:id,boxId,quantity,clientId:ids.client,warehouseId:ids.warehouse,skuId:ids.sku,status:'AVAILABLE'}});
    await p.productMark.create({data:{id:ids.mark,clientId:ids.client,skuId:ids.sku,boxId:ids.source,status:'AVAILABLE',value:raw.replaceAll('\u001d','')}});
    await p.inventorySession.create({data:{id:ids.session,type:'BOX_CHECK',clientId:ids.client,warehouseId:ids.warehouse,title:'test',createdByUserId:ids.user,createdByName:'test'}});
    await p.inventoryAuditBox.create({data:{id:ids.audit,sessionId:ids.session,boxId:ids.target,boxCode:ids.target,clientId:ids.client,clientName:'test',status:'MISMATCH',startedAt:since}});
    await p.inventoryAuditLine.create({data:{id:ids.line,auditBoxId:ids.audit,skuId:ids.sku,skuName:'test',internalSku:ids.sku,expectedQuantity:0,countedQuantity:1,difference:1,decision:'PENDING'}});
    await p.auditLog.create({data:{userId:ids.user,action:'INVENTORY_KIZ_SCAN',entity:'InventoryAuditBox',entityId:ids.audit,payload:{sessionId:ids.session,roundStartedAt:since.toISOString(),boxId:ids.target,clientId:ids.client,lineId:ids.line,skuId:ids.sku,kiz:raw}}});
  });
  afterAll(async () => {
    await p.auditLog.deleteMany({where:{entityId:ids.audit}});
    await p.inventorySession.deleteMany({where:{id:ids.session}});
    await p.productMark.deleteMany({where:{clientId:ids.client}});
    await p.stockMovement.deleteMany({where:{clientId:ids.client}});
    await p.stockBalance.deleteMany({where:{clientId:ids.client}});
    await p.box.deleteMany({where:{clientId:ids.client}});
    await p.sku.deleteMany({where:{clientId:ids.client}});
    await p.client.deleteMany({where:{id:ids.client}});
    await p.user.deleteMany({where:{id:ids.user}}); await p.warehouse.deleteMany({where:{id:ids.warehouse}});
    await p.$disconnect(); vi.unstubAllEnvs();
  });
  const confirm = async (tx: Prisma.TransactionClient) => {
    await tx.inventoryAuditLine.update({where:{id:ids.line},data:{decision:'APPLY_ACTUAL'}});
    await tx.stockBalance.update({where:{id:ids.targetBalance},data:{quantity:1}});
    await confirmInventoryKizComposition(tx,ids.audit,user);
  };
  it('finds the legacy stored identity through the real SQL query', async () => {
    // TEST: actual database matching with separators, preserving raw code bytes.
    expect(await findPhysicalKizId(p,raw)).toBe(ids.mark);
    expect((await p.productMark.findUniqueOrThrow({where:{id:ids.mark}})).value).toBe(raw.replaceAll('\u001d',''));
  });
  it('rolls back both balances, mark and proof if confirmation fails after transfer', async () => {
    // TEST: exercise the same scoped transaction boundary used by resolveBox/decideLine.
    const service:any = new InventoryService(p as never,{} as never,{} as never);
    await expect(service.atomicKizDecision(async (scoped:any) => {
      await scoped.runSerializableInventoryDecision(confirm);
      throw Error('failure after transfer');
    })).rejects.toThrow('failure after transfer');
    expect((await p.stockBalance.findUniqueOrThrow({where:{id:ids.sourceBalance}})).quantity).toBe(1);
    expect((await p.stockBalance.findUniqueOrThrow({where:{id:ids.targetBalance}})).quantity).toBe(0);
    expect((await p.productMark.findUniqueOrThrow({where:{id:ids.mark}})).boxId).toBe(ids.source);
    expect(await p.stockMovement.count({where:{clientId:ids.client}})).toBe(0);
  });
  it('rolls back the real resolveBox quantity decision when the source has reserved stock', async () => {
    // TEST: real public inventory endpoint boundary, not just a helper transaction.
    const reserve=await p.stockBalance.create({data:{balanceKey:randomUUID(),boxId:ids.source,clientId:ids.client,warehouseId:ids.warehouse,skuId:ids.sku,status:'RESERVED',quantity:1}});
    const service=new InventoryService(p as never,{requireClientAccess:()=>{}} as never,Object.create(StockBalancesService.prototype));
    try {
      await expect(service.resolveBox(ids.audit,{action:InventoryResolutionAction.APPLY_ACTUAL},user)).rejects.toThrow('резерв');
      expect((await p.inventoryAuditLine.findUniqueOrThrow({where:{id:ids.line}})).decision).toBe('PENDING');
      expect((await p.stockBalance.findUniqueOrThrow({where:{id:ids.targetBalance}})).quantity).toBe(0);
      expect(await p.stockMovement.count({where:{clientId:ids.client}})).toBe(0);
    } finally { await p.stockBalance.delete({where:{id:reserve.id}}); }
  });
  it('moves one physical unit, retains its original record, and makes retry a no-op', async () => {
    // TEST: regression of phantom source quantity in box 177 after counting box 181.
    const service=new InventoryService(p as never,{requireClientAccess:()=>{}} as never,Object.create(StockBalancesService.prototype));
    await service.resolveBox(ids.audit,{action:InventoryResolutionAction.APPLY_ACTUAL},user);
    await service.resolveBox(ids.audit,{action:InventoryResolutionAction.APPLY_ACTUAL},user);
    await p.$transaction(tx=>confirmInventoryKizComposition(tx,ids.audit,user),{isolationLevel:'Serializable'});
    expect((await p.stockBalance.findUniqueOrThrow({where:{id:ids.sourceBalance}})).quantity).toBe(0);
    expect((await p.stockBalance.findUniqueOrThrow({where:{id:ids.targetBalance}})).quantity).toBe(1);
    expect((await p.productMark.findUniqueOrThrow({where:{id:ids.mark}})).boxId).toBe(ids.target);
    expect(await p.productMark.count({where:{clientId:ids.client}})).toBe(1);
    expect(await p.stockMovement.count({where:{clientId:ids.client,type:'MOVE'}})).toBe(1);
    expect(await p.stockMovement.count({where:{clientId:ids.client,type:'INVENTORY_ADJUSTMENT'}})).toBe(1);
  });
  it('picks the same legacy mark with the full scanned code and never debits it twice', async () => {
    // TEST: real FBS pick uses identity lookup as well as the initial scan, including retry.
    vi.stubEnv('WMS_FBS_PRESERVE_STOCK_KIZ','true'); vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED','false');
    const service:any = new MarketplaceConnectionsService(p as never,{} as never);
    const task={id:randomUUID(),clientId:ids.client,skuId:ids.sku,boxId:ids.target,boxCode:ids.target,requestId:ids.session,
      orderId:'test-only',marketplace:'WILDBERRIES',completedAt:null,itemCount:1,kiz:raw};
    for(let i=0;i<2;i++)await p.$transaction(tx=>service.reserveCompletedWildberriesStock(tx,task,ids.warehouse),{isolationLevel:'Serializable'});
    expect((await p.productMark.findUniqueOrThrow({where:{id:ids.mark}})).status).toBe('PACKING');
    const rows=await p.stockBalance.findMany({where:{clientId:ids.client}});
    expect(rows.filter(r=>r.status==='AVAILABLE').reduce((n,r)=>n+r.quantity,0)).toBe(0);
    expect(rows.filter(r=>r.status==='PACKING').reduce((n,r)=>n+r.quantity,0)).toBe(1);
    expect(await p.stockMovement.count({where:{clientId:ids.client,type:'PICK',status:'AVAILABLE'}})).toBe(1);
  });
});
