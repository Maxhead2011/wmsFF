import { receiptDocuments, receiptChannelChange, assertReceiptFbsBox, receiptRules, assignReceiptBox } from '../src/modules/warehouse/receipt-channel-policy';
import 'reflect-metadata';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { FboTwoStageService } from '../src/modules/tsd/fbo-two-stage.service';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
import { StockBalancesService } from '../src/modules/stock/stock-balances.service';
import { StockOperationsService } from '../src/modules/stock/stock-operations.service';
import { ClientRequestMarketplaceFilesService } from '../src/modules/client-requests/client-request-marketplace-files.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
const url = process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/kiz_duplicate_tests/.test(url))
    throw Error('Dedicated local test DB only');
describe.skipIf(!url).sequential('FBO physical pick, pack and final box control', () => {
    const p = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
    let client: string, wh: string, uid: string, sku: string, other: string, request: string, whole: string, partial: string, target: string, line: string;
    let user: AuthUser, svc: FboTwoStageService, stock: StockOperationsService;
    let marks: Array<{
        id: string;
        value: string;
    }>;
    const scopes = { requireClientAccess: (u: AuthUser, c: string) => { if (c !== client || u.id !== uid)
            throw Error('Client access denied'); } };
    const act = (action: string, extra: Record<string, string> = {}) => svc.act(request, { action, operationId: randomUUID(), ...extra }, user);
    beforeEach(async () => {
        vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', 'true');
        [client, wh, uid, sku, other, request, whole, partial, target, line] = Array.from({ length: 10 }, () => randomUUID());
        user = { id: uid, name: 'Picker', email: 'test@invalid', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] } as AuthUser;
        await p.warehouse.create({ data: { id: wh, code: wh, name: 'FBO test' } });
        await p.client.create({ data: { id: client, code: client, name: 'FBO test' } });
        await p.user.create({ data: { id: uid, name: 'Picker', email: uid + '@invalid', passwordHash: 'test' } });
        for (const id of [sku, other])
            await p.sku.create({ data: { id, clientId: client, internalSku: id, name: 'Test suit', needsChestnyZnak: id === sku, barcodes: { create: { value: id === sku ? '2051234567890' : '2051234567883' } } } });
        for (const [id, quantity] of [[whole, 2], [partial, 3]] as const) {
            await p.box.create({ data: { id, code: 'FFL_' + id, clientId: client, warehouseId: wh } });
            await p.stockBalance.create({ data: { balanceKey: randomUUID(), clientId: client, warehouseId: wh, skuId: sku, boxId: id, status: 'AVAILABLE', quantity } });
        }
        await p.stockBalance.create({ data: { balanceKey: randomUUID(), clientId: client, warehouseId: wh, skuId: other, boxId: partial, status: 'AVAILABLE', quantity: 1 } });
        marks = [];
        for (let i = 0; i < 5; i++)
            marks.push(await p.productMark.create({ data: { clientId: client, skuId: sku, boxId: i < 2 ? whole : partial, value: `010468099259845521${String(i).padStart(13, 'A')}\u001d91EE12\u001d92${client}`, status: 'AVAILABLE' } }));
        await p.clientRequest.create({ data: { id: request, clientId: client, warehouseId: wh, type: 'OUTBOUND', title: 'FBO regression', items: { create: { id: line, skuId: sku, barcode: '2051234567890', quantity: 4 } } } });
        const balances = new StockBalancesService(p as never, scopes as never);
        stock = new StockOperationsService(p as never, scopes as never, balances);
        svc = new FboTwoStageService(p as never, scopes as never, balances, stock, { assertStockMovementsAllowed: async () => { } } as never, new ClientRequestMarketplaceFilesService(p as never, scopes as never));
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        await p.fbsTsdAssembly.deleteMany({ where: { clientId: client } });
        await p.auditLog.deleteMany({ where: { OR:[{entityId:request},{userId:uid}] } });
        await p.systemSetting.deleteMany({where:{updatedByUserId:uid}});
        await p.tsdOperation.deleteMany({ where: { payload: { path: ['requestId'], equals: request } } });
        await p.fboAssemblyAction.deleteMany({ where: { requestId: request } });
        await p.fboAssemblyUnit.deleteMany({ where: { requestId: request } });
        await p.fboAssemblyBox.deleteMany({ where: { requestId: request } });
        await p.fboAssembly.deleteMany({ where: { requestId: request } });
        await p.billingCharge.deleteMany({ where: { requestId: request } });
        await p.clientBillingService.deleteMany({ where: { clientId: client } });
        await p.ozonFboShipment.deleteMany({ where: { requestId: request } });
        await p.clientRequest.deleteMany({ where: { id: request } });
        await p.productMark.deleteMany({ where: { clientId: client } });
        await p.stockMovement.deleteMany({ where: { clientId: client } });
        await p.stockBalance.deleteMany({ where: { clientId: client } });
        await p.box.deleteMany({ where: { clientId: client } });
        await p.storagePallet.deleteMany({ where: { clientId: client } });
        await p.barcode.deleteMany({ where: { sku: { clientId: client } } });
        await p.sku.deleteMany({ where: { clientId: client } });
        await p.client.deleteMany({ where: { id: client } });
        await p.user.deleteMany({ where: { id: uid } });
        await p.warehouse.deleteMany({ where: { id: wh } });
        vi.unstubAllEnvs();
    });
    afterAll(() => p.$disconnect());
    // TEST: one Ozon pick pool feeds separate destination quotas; surplus stays available.
    it('packs one Ozon assembly into two destinations without consuming surplus', async () => {
        vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED', 'true');
        await p.ozonFboShipment.create({data:{requestId:request,importKey:randomUUID(),directions:
            ['Москва','Казань'].map(name=>({name,items:[{skuId:sku,barcode:'2051234567890',quantity:2}]}))}});
        await act('START');
        for (let i=0;i<4;i++) await act('PICK_UNIT',{sourceBoxCode:'FFL_'+(i<2?whole:partial),barcode:'2051234567890',kiz:marks[i].value});
        await act('FINISH_PICK');
        const codes=['FFL_'+target,'FFL_'+randomUUID()];
        for (let d=0;d<2;d++) {
            await act('OPEN_BOX',{targetBoxCode:codes[d],direction:['Москва','Казань'][d]});
            for (let i=d*2;i<d*2+2;i++) await act('PACK_UNIT',{targetBoxCode:codes[d],barcode:'2051234567890',kiz:marks[i].value});
            if(d===0) await expect(act('PACK_UNIT',{targetBoxCode:codes[d],barcode:'2051234567890',kiz:marks[2].value})).rejects.toThrow();
            await act('CLOSE_BOX',{targetBoxCode:codes[d]});
        }
        await act('SORTED');
        for(const targetBoxCode of codes) await act('CONFIRM_BOX',{targetBoxCode});
        // TEST: a persisted Ozon send freezes packing but allows final completion.
        await p.ozonFboShipment.update({where:{requestId:request},data:{integration:{frozenHash:'external-send'}}});
        await expect(act('OPEN_BOX',{targetBoxCode:codes[0],direction:'Москва'})).rejects.toThrow('зафиксирован');
        const result=await act('FINISH');
        expect(result.directions.map(d=>d.packed)).toEqual([2,2]);
        expect(await p.fboAssembly.count({where:{requestId:request}})).toBe(1);
        expect((await p.stockBalance.aggregate({where:{clientId:client,skuId:sku,status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity).toBe(1);
        expect((await p.stockBalance.aggregate({where:{clientId:client,skuId:other,status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity).toBe(1);
    });
    async function receiptFixture(){
      vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');
      await p.stockMovement.create({data:{clientId:client,warehouseId:wh,boxId:whole,skuId:sku,type:'RECEIPT',status:'AVAILABLE',quantity:2,sourceDocument:'receipt-session'}});
      return (await receiptDocuments(p,client,wh)).find(r=>r.boxes.some(b=>b.id===whole))!;
    }
    // TEST: full database queries, policy save/version and physical FBO write guard.
    it('saves FBS-only receipt and rejects FBO picking without stock writes',async()=>{
      const receipt=await receiptFixture();
      await p.$transaction(tx=>receiptChannelChange(tx,client,wh,receipt.id,true,false,0,true,uid),{isolationLevel:'Serializable'});
      expect((await receiptRules(p,client,wh)).get(whole)?.fbo).toBe(false);
      await act('START');
      await expect(act('PICK_UNIT',{sourceBoxCode:'FFL_'+whole,barcode:'2051234567890',kiz:marks[0].value})).rejects.toThrow();
      expect(await p.fboAssemblyUnit.count({where:{requestId:request}})).toBe(0);
      await expect(receiptChannelChange(p,client,wh,receipt.id,true,true,0,true,uid)).rejects.toThrow('уже изменены');
    });
    it('preserves existing FBS order while blocking a later order',async()=>{
      const receipt=await receiptFixture();
      const old=await p.fbsTsdAssembly.create({data:{clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:request,requestItemId:line,skuId:sku,productName:'reserved',barcodes:[],storageBoxes:[],deviceCode:'AUTO:FBS:PALLET_SORT',status:'RESERVED',reservedBoxId:whole,stockWarehouseId:wh}});
      const preview=await receiptChannelChange(p,client,wh,receipt.id,false,true,0,false,uid);
      expect(preview.protectedQuantity).toBe(1);expect(await p.systemSetting.count({where:{updatedByUserId:uid}})).toBe(0);
      await p.$transaction(tx=>receiptChannelChange(tx,client,wh,receipt.id,false,true,0,true,uid),{isolationLevel:'Serializable'});
      await expect(assertReceiptFbsBox(p,old,whole)).resolves.toBeUndefined();
      await expect(assertReceiptFbsBox(p,{...old,orderId:'later'},whole)).rejects.toThrow('только для ФБО');
      await act('START');await act('PICK_UNIT',{sourceBoxCode:'FFL_'+whole,barcode:'2051234567890',kiz:marks[0].value});
      await expect(act('PICK_UNIT',{sourceBoxCode:'FFL_'+whole,barcode:'2051234567890',kiz:marks[1].value})).rejects.toThrow();
      expect((await p.stockBalance.aggregate({where:{boxId:whole,status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity).toBe(1);
    });
    it('binds a wrong box name without changing barcode or physical stock',async()=>{
      const receipt=await receiptFixture();await receiptChannelChange(p,client,wh,receipt.id,false,true,0,true,uid);
      const before=await p.stockBalance.findMany({where:{boxId:partial},orderBy:{id:'asc'}});
      await assignReceiptBox(p,client,wh,receipt.id,'FFL_'+partial,uid,true);
      expect((await receiptRules(p,client,wh)).get(partial)?.fbs).toBe(false);
      expect((await p.box.findUniqueOrThrow({where:{id:partial}})).code).toBe('FFL_'+partial);
      expect(await p.stockBalance.findMany({where:{boxId:partial},orderBy:{id:'asc'}})).toEqual(before);
    });
    // TEST: live employee/KIZ details remain inside the existing feature flag and client access scope.
    it('does not expose online details without access or when FBO is disabled', async () => {
        await expect(svc.plan(request,{...user,id:randomUUID()})).rejects.toThrow('Client access denied');
        vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','false');
        await expect(svc.plan(request,user)).rejects.toThrow('выключена');
    });
    // TEST: a fresh monitor snapshot includes committed scans and employee names without writing stock.
    it('reports live progress and the employee for each physical unit', async () => {
        await act('START');
        expect((await svc.plan(request,user)).pickedUnits).toEqual([]);
        await act('PICK_UNIT',{sourceBoxCode:'FFL_'+partial,barcode:'2051234567890',kiz:marks[2].value});
        const movements=await p.stockMovement.count({where:{clientId:client}});
        const current=await svc.plan(request,user);
        expect(current.picked).toBe(1);expect(current.lines[0].remaining).toBe(3);
        expect(current.pickedUnits).toHaveLength(1);
        expect(current.pickedUnits[0]).toMatchObject({pickedBy:'Picker',kiz:marks[2].value,sourceBoxCode:'FFL_'+partial,state:'PICKED'});
        expect(await p.stockMovement.count({where:{clientId:client}})).toBe(movements);
    });
    // TEST: a failed serializable attempt rolls back its writes before the identical operation retries.
    it('retries a write conflict after stock writes without double picking', async () => {
        await act('START');
        const transaction = p.$transaction.bind(p);
        let attempts = 0;
        const conflictedTransaction = (callback: any, options: any) => transaction(async (tx: any) => {
            const result = await callback(tx);
            if (options?.isolationLevel === 'Serializable' && ++attempts === 1)
                throw new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: Prisma.prismaVersion.client });
            return result;
        }, options);
        (svc as any).prisma = new Proxy(p, { get: (target, key) => key === '$transaction' ? conflictedTransaction : Reflect.get(target, key) });
        const dto = { action: 'PICK_BOX', operationId: randomUUID(), sourceBoxCode: 'FFL_' + whole };
        const result = await svc.act(request, dto, user);
        expect(attempts).toBe(2);
        expect(result.picked).toBe(2);
        expect(result.route.some(b => b.boxCode === dto.sourceBoxCode)).toBe(false);
        expect((await svc.act(request, dto, user)).picked).toBe(2);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(2);
        expect(await p.fboAssemblyAction.count({ where: { id: `${request}:${dto.operationId}` } })).toBe(1);
        expect((await p.stockBalance.aggregate({ where: { boxId: whole, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(0);
    });
    // TEST: the route must apply the same live box reservations as the pick endpoint.
    it('routes around an FBS reservation and includes the box again once released', async () => {
        const reservation = await p.fbsTsdAssembly.create({ data: {
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: request, requestItemId: randomUUID(),
            skuId: sku, productName: 'FBS reserved', barcodes: [], storageBoxes: [], deviceCode: 'AUTO:FBS:PALLET_SORT',
            status: 'IN_PROGRESS', reservedBoxId: whole, barcode: '2051234567890',
        } });
        const result = await act('START');
        expect(result.route.some(b => b.boxCode === 'FFL_' + whole)).toBe(false);
        expect(result.route.find(b => b.boxCode === 'FFL_' + partial)?.tasks[0].quantity).toBe(3);
        expect(result.shortage).toBe(1);
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole })).rejects.toThrow('активной сборке');
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe('IN_PROGRESS');
        await p.fbsTsdAssembly.update({ where: { id: reservation.id }, data: { status: 'COMPLETED' } });
        expect((await svc.plan(request, user)).route.some(b => b.boxCode === 'FFL_' + whole)).toBe(true);
    });
    // TEST: an untouched FBS reservation protects its quantity before physical picking starts.
    it.each(['RESERVED', 'IN_PROGRESS'])('protects an untouched %s route from FBO picking', async (status) => {
        const reservation = await p.fbsTsdAssembly.create({ data: {
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: request, requestItemId: randomUUID(),
            skuId: sku, productName: 'FBS reserved', barcodes: [], storageBoxes: [], deviceCode: status === 'RESERVED' ? 'AUTO:FBS:PALLET_SORT' : 'TSD',
            status, reservedBoxId: whole, boxId: status === 'IN_PROGRESS' ? whole : null,
        } });
        const plan = await act('START');
        expect(plan.route.some(b => b.boxCode === 'FFL_' + whole)).toBe(true);
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: reservation.id } })).reservedBoxId).toBe(whole);
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole })).rejects.toThrow();
        expect(await p.stockMovement.count({where:{clientId:client}})).toBe(0);
        const result = await act('PICK_UNIT', {sourceBoxCode:'FFL_'+whole,barcode:'2051234567890',kiz:marks[0].value});
        expect(result.picked).toBe(1);
        expect(result.route.some(b => b.boxCode === 'FFL_' + whole)).toBe(false);
        await expect(act('PICK_UNIT', {sourceBoxCode:'FFL_'+whole,barcode:'2051234567890',kiz:marks[1].value})).rejects.toThrow('зарезервирован');
        expect(await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({
            status, boxId: status === 'IN_PROGRESS' ? whole : null, reservedBoxId: whole,
        });
        expect((await p.stockBalance.aggregate({where:{boxId:whole,status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity).toBe(1);
    });
    // TEST: partial picking keeps reservations covered by remaining stock and never releases another SKU.
    it('keeps all FBS reservations when the free quantity is exhausted', async () => {
        const reserve = async (skuId: string, itemCount: number) => p.fbsTsdAssembly.create({ data: {
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: request, requestItemId: randomUUID(),
            skuId, itemCount, productName: 'FBS reserved', barcodes: [], storageBoxes: [], deviceCode: 'AUTO:FBS:PALLET_SORT',
            status: 'RESERVED', reservedBoxId: partial,
        } });
        const same = await reserve(sku, 2), different = await reserve(other, 1);
        await act('START');
        const pick = (kiz: string) => act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz });
        await expect(pick(marks[0].value)).rejects.toThrow('не доступен');
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: same.id } })).reservedBoxId).toBe(partial);
        await pick(marks[2].value);
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: same.id } })).reservedBoxId).toBe(partial);
        await expect(pick(marks[3].value)).rejects.toThrow('зарезервирован');
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: same.id } })).reservedBoxId).toBe(partial);
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: different.id } })).reservedBoxId).toBe(partial);
    });
    // TEST: simultaneous scans cannot both consume the single free unit.
    it('serializes simultaneous picks while retaining two units for FBS', async () => {
        const reservation = await p.fbsTsdAssembly.create({data:{
            clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:request,requestItemId:randomUUID(),
            skuId:sku,itemCount:2,productName:'Reserved',barcodes:[],storageBoxes:[],deviceCode:'AUTO:FBS:PALLET_SORT',
            status:'RESERVED',reservedBoxId:partial,
        }});
        await act('START');
        const results = await Promise.allSettled(marks.slice(2,4).map(m=>act('PICK_UNIT',{
            sourceBoxCode:'FFL_'+partial,barcode:'2051234567890',kiz:m.value,
        })));
        expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
        expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
        expect(await p.fboAssemblyUnit.count({where:{requestId:request}})).toBe(1);
        expect((await p.stockBalance.aggregate({where:{boxId:partial,skuId:sku,status:'AVAILABLE'},_sum:{quantity:true}}))._sum.quantity).toBe(2);
        expect(await p.fbsTsdAssembly.findUniqueOrThrow({where:{id:reservation.id}})).toMatchObject({status:'RESERVED',reservedBoxId:partial});
    });
    // TEST: unbound demand protects stock in its own warehouse only.
    it.each([true,false])('scopes an unbound FBS order to its warehouse: %s', async sameWarehouse => {
        await p.fbsTsdAssembly.create({data:{
            clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:request,requestItemId:randomUUID(),
            skuId:sku,itemCount:3,productName:'Waiting',barcodes:[],storageBoxes:[],deviceCode:'AUTO:FBS:PALLET_SORT',
            status:'WAITING_STOCK',stockWarehouseId:sameWarehouse?wh:randomUUID(),
        }});
        const plan = await act('START');
        expect(plan.route.flatMap(b=>b.tasks).reduce((sum,t)=>sum+t.quantity,0)).toBe(sameWarehouse?2:4);
        expect(plan.shortage).toBe(sameWarehouse?2:0);
    });
    // TEST: a physical FBS debit is not subtracted again as a virtual reservation.
    it.each([1,3])('subtracts only the unpicked part of a three-unit FBS order: picked %s', async pickedQuantity => {
        const task = await p.fbsTsdAssembly.create({data:{
            clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:request,requestItemId:randomUUID(),
            skuId:sku,itemCount:3,productName:'Picked',barcodes:[],storageBoxes:[],deviceCode:'TSD',
            status:'RESCAN_REQUIRED',stockWarehouseId:wh,reservedBoxId:partial,
        }});
        await p.stockMovement.create({data:{clientId:client,warehouseId:wh,skuId:sku,boxId:partial,
            type:'MOVE',status:'PACKING',quantity:pickedQuantity,sourceDocument:request,idempotencyKey:`fbs-sticker-pick:${task.id}:in`}});
        const plan = await act('START');
        expect(plan.shortage).toBe(pickedQuantity===1?1:0);
        expect(plan.route.flatMap(b=>b.tasks).reduce((sum,t)=>sum+t.quantity,0)).toBe(pickedQuantity===1?3:4);
    });
    // TEST: an abandoned virtual route without a live request must not become phantom demand.
    it.each(['RESERVED','IN_PROGRESS','COMPLETED'])('ignores an orphaned untouched %s assignment', async status => {
        await p.fbsTsdAssembly.create({data:{
            clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:randomUUID(),requestItemId:randomUUID(),
            skuId:sku,itemCount:5,productName:'Old route',barcodes:[],storageBoxes:[],deviceCode:'AUTO:FBS:PALLET_SORT',
            status,stockWarehouseId:wh,reservedBoxId:partial,
        }});
        expect((await act('START')).shortage).toBe(0);
    });
    // TEST: a relabel reservation is applied to its source SKU through the real database query.
    it('protects the source stock of a relabel order', async () => {
        await p.fbsTsdAssembly.create({data:{
            clientId:client,connectionId:randomUUID(),orderId:randomUUID(),requestId:request,requestItemId:randomUUID(),
            skuId:other,sourceSkuId:sku,itemCount:2,productName:'Relabel',barcodes:[],storageBoxes:[],deviceCode:'AUTO:FBS:PALLET_SORT',
            status:'RESERVED',stockWarehouseId:wh,reservedBoxId:partial,
        }});
        const plan = await act('START');
        expect(plan.shortage).toBe(1);
        expect(plan.route.find(b=>b.boxCode==='FFL_'+partial)?.tasks[0].quantity).toBe(1);
    });
    // TEST: permanent failures and exhausted conflicts do not commit a partial debit or retry indefinitely.
    it.each(['P2034', 'P2028'])('rolls back and bounds retries for %s', async (code) => {
        await act('START');
        const transaction = p.$transaction.bind(p);
        let attempts = 0;
        (svc as any).prisma = new Proxy(p, { get: (target, key) => key !== '$transaction' ? Reflect.get(target, key) :
            (callback: any, options: any) => transaction(async (tx: any) => {
                await callback(tx);attempts++;
                throw new Prisma.PrismaClientKnownRequestError('injected failure', { code, clientVersion: Prisma.prismaVersion.client });
            }, options) });
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole })).rejects.toMatchObject({ code });
        expect(attempts).toBe(code === 'P2034' ? 3 : 1);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(0);
        expect(await p.stockMovement.count({ where: { clientId: client } })).toBe(0);
    });
    async function picked() { await act('START'); await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole }); for (const m of marks.slice(2, 4))
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: m.value }); await act('FINISH_PICK'); }
    async function packed() { await picked(); await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole }); await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target }); for (const m of marks.slice(2, 4))
        await act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: m.value }); await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target }); await act('SORTED'); }
    // TEST: real database relation filters move a request between queues without a second stock operation.
    it('moves a picked request from picking to packing queue', async () => {
        const assembly = new TsdAssemblyService(p as never,
            { ...scopes, resolveClientFilter: () => client } as never, {} as never, stock, {} as never, svc);
        const ids = async (workflow: string) => (await assembly.listActiveRequests(user, workflow)).map(r => r.id);
        expect(await ids('fbo-pick')).toContain(request);
        expect(await ids('fbo-pack')).not.toContain(request);
        await picked();
        expect(await ids('fbo-pick')).not.toContain(request);
        expect(await ids('fbo-pack')).toContain(request);
    });
    it('completes the real mixed workflow with no second AVAILABLE debit, then exports the existing WB template', async () => {
        // TEST: packing and final box scans must never decrement source stock again.
        await packed();
        await expect(svc.wbFile(request, user)).rejects.toThrow('подтвердите');
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole });
        await expect(act('FINISH')).rejects.toThrow('все короба');
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + target });
        const done = await act('FINISH');
        expect(done.phase).toBe('COMPLETED');
        const balances = await p.stockBalance.findMany({ where: { clientId: client, skuId: sku } });
        expect(balances.filter(b => b.status === 'AVAILABLE').reduce((s, b) => s + b.quantity, 0)).toBe(1);
        expect(balances.filter(b => b.status === 'SHIPPING').reduce((s, b) => s + b.quantity, 0)).toBe(4);
        expect(balances.filter(b => b.status === 'PACKING').reduce((s, b) => s + b.quantity, 0)).toBe(0);
        expect(await p.productMark.count({ where: { clientId: client, status: 'SHIPPING' } })).toBe(4);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request, activeMarkId: { not: null } } })).toBe(0);
        expect(await p.fboAssemblyBox.count({ where: { requestId: request, activeBoxId: { not: null } } })).toBe(0);
        const file = await svc.wbFile(request, user);
        const workbook = XLSX.read(file.content, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets.TDSheet, { header: 1 }) as unknown[][];
        expect(rows[0]).toEqual(['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности']);
        expect(rows.slice(1).map(r => r[1]).sort()).toEqual([2, 2]);
        expect(await p.stockMovement.aggregate({ where: { clientId: client, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: -4 } });
    });
    it('retries an unanswered unit scan with the same operation id and refuses changed payloads', async () => {
        await act('START');
        const dto = { action: 'PICK_UNIT', operationId: randomUUID(), sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        await svc.act(request, dto, user);
        await svc.act(request, Object.fromEntries(Object.entries(dto).reverse()) as typeof dto, user);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
        await expect(svc.act(request, { ...dto, kiz: marks[3].value }, user)).rejects.toThrow('другими данными');
        await expect(act('PICK_UNIT', { ...dto, operationId: randomUUID() })).rejects.toThrow('не доступен');
    });
    it('rejects a whole box whose marks are incomplete and leaves both ledger and stock intact', async () => {
        await act('START');
        await p.productMark.update({ where: { id: marks[0].id }, data: { boxId: null } });
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole })).rejects.toThrow('актуализацию');
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(0);
        expect(await p.stockMovement.count({ where: { clientId: client } })).toBe(0);
    });
    it('rejects a mixed whole box, a foreign KIZ and an excessive pick', async () => {
        await act('START');
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + partial })).rejects.toThrow('нельзя');
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[0].value })).rejects.toThrow('не доступен');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        for (const m of marks.slice(2, 4))
            await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: m.value });
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[4].value })).rejects.toThrow('полностью отобран');
    });
    it('serializes competing terminals so one KIZ is picked once', async () => {
        await act('START');
        const payload = { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        const result = await Promise.allSettled([act('PICK_UNIT', payload), act('PICK_UNIT', payload)]);
        expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
    });
    it('blocks empty or unclosed parcels, early packing, duplicate final scans and an unrelated box', async () => {
        await act('START');
        await expect(act('OPEN_BOX', { targetBoxCode: 'FFL_' + target })).rejects.toThrow('Этап');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        for (const m of marks.slice(2, 4))
            await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: m.value });
        await act('FINISH_PICK');
        await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        await expect(act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target })).rejects.toThrow('пустой');
        await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        for (const m of marks.slice(2, 4))
            await act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: m.value });
        await expect(act('SORTED')).rejects.toThrow('Закройте');
        await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target });
        await act('SORTED');
        await expect(act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + partial })).rejects.toThrow('не входит');
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole });
        await expect(act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole })).rejects.toThrow('уже подтверждён');
    });
    it('rolls back final confirmation and package/balance writes if billing fails', async () => {
        await packed();
        for (const b of [whole, target])
            await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + b });
        vi.spyOn(stock as any, 'createFulfillmentBillingCharges').mockRejectedValueOnce(Error('billing failure'));
        await expect(act('FINISH')).rejects.toThrow('billing failure');
        expect((await p.fboAssembly.findUniqueOrThrow({ where: { requestId: request } })).phase).toBe('CONTROL');
        expect(await p.clientRequestPackage.count({ where: { requestId: request } })).toBe(0);
        expect(await p.stockBalance.aggregate({ where: { clientId: client, status: 'SHIPPING' }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: null } });
        expect((await act('FINISH')).phase).toBe('COMPLETED');
    });
    it('rejects changed contents at final control and request composition changes', async () => {
        await packed();
        await p.productMark.update({ where: { id: marks[0].id }, data: { boxId: null } });
        await expect(act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole })).rejects.toThrow('КИЗ');
        await p.clientRequestItem.update({ where: { id: line }, data: { quantity: 5 } });
        await expect(act('FINISH')).rejects.toThrow('Состав заявки изменён');
    });
    it('isolates disabled installations and cross-client or branch users', async () => {
        await expect(svc.plan(request, { ...user, id: randomUUID() })).rejects.toThrow('Client access');
        await expect(svc.plan(request, { ...user, roleCodes: ['EMPLOYEE'], permissionCodes: ['stock:read'], activeWarehouseId: 'other', warehouseIds: ['other'] })).rejects.toThrow('филиале');
        vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED', 'false');
        expect(await svc.eligible(request, user)).toBe(false);
        await expect(act('START')).rejects.toThrow('выключена');
        expect(await p.fboAssembly.count({ where: { requestId: request } })).toBe(0);
    });
    it('requires the current pallet scan before a box pick and catches a changed placement', async () => {
        // TEST: a box code alone cannot bypass the pallet step.
        const pallet = await p.storagePallet.create({ data: { clientId: client, warehouseId: wh, code: 'PALET_SORT_' + client } });
        await p.storagePalletBox.create({ data: { palletId: pallet.id, boxId: whole, boxCode: 'FFL_' + whole } });
        const plan = await act('START');
        expect(plan.route.find(r => r.boxCode === 'FFL_' + whole)?.pallet).toBe(pallet.code);
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole })).rejects.toThrow('Сначала отсканируйте паллет');
        await expect(act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole, palletCode: 'PALET_SORT_OTHER' })).rejects.toThrow('Сначала отсканируйте паллет');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole, palletCode: pallet.code });
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(2);
    });
    it('releases an accidentally opened empty box but never removes a packed one', async () => {
        await picked();
        await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        await act('CANCEL_EMPTY_BOX', { targetBoxCode: 'FFL_' + target });
        expect(await p.fboAssemblyBox.count({ where: { requestId: request } })).toBe(0);
        await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        await act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: marks[2].value });
        await expect(act('CANCEL_EMPTY_BOX', { targetBoxCode: 'FFL_' + target })).rejects.toThrow('пустой');
        const mark = await p.productMark.findUniqueOrThrow({ where: { id: marks[2].id }, include: { stockMovement: true } });
        expect(mark.stockMovement).toMatchObject({ boxId: mark.boxId, quantity: 1, status: 'PACKING', sourceDocument: request });
    });
    it('supports an explicitly unmarked SKU without inventing KIZs', async () => {
        await p.clientRequestItem.update({ where: { id: line }, data: { skuId: other, barcode: '2051234567883', quantity: 1 } });
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567883' });
        await act('FINISH_PICK');
        await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        await act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567883' });
        await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target });
        await act('SORTED');
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + target });
        expect((await act('FINISH')).phase).toBe('COMPLETED');
        expect((await p.fboAssemblyUnit.findFirstOrThrow({ where: { requestId: request } })).markId).toBeNull();
    });
    it('requires the physical KIZ even if a historical SKU was missing its marking flag', async () => {
        await p.sku.update({ where: { id: sku }, data: { needsChestnyZnak: false } });
        const plan = await act('START');
        expect(plan.lines[0].requiresKiz).toBe(true);
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890' })).rejects.toThrow('отсканируйте КИЗ');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value });
    });
    it('preserves legacy assemblies and blocks legacy bulk pick/pack once the new flow starts', async () => {
        await expect(stock.pickClientRequest({ requestId: request }, user)).rejects.toThrow('поштучный отбор');
        await p.stockMovement.create({ data: { clientId: client, warehouseId: wh, skuId: sku, status: 'PACKING', quantity: 1, type: 'PICK', sourceDocument: request } });
        expect(await svc.eligible(request, user)).toBe(false);
        await expect(act('START')).rejects.toThrow('старым способом');
        await p.stockMovement.deleteMany({ where: { sourceDocument: request } });
        await act('START');
        await expect(stock.pickClientRequest({ requestId: request }, user)).rejects.toThrow('поштучный отбор');
        await expect(stock.packageClientRequest({ requestId: request }, user)).rejects.toThrow('проверку всех коробов');
        await expect(stock.shipClientRequest({ requestId: request }, user)).rejects.toThrow('подтвердите');
    });
    it('keeps an existing TSD movement workflow in legacy mode even before bulk picking', async () => {
        await p.tsdOperation.create({ data: { deviceId: 'test', operationKey: randomUUID(), operationType: 'move_scan', payload: { requestId: request }, status: 'ACCEPTED' } });
        expect(await svc.eligible(request, user)).toBe(false);
        await expect(act('START')).rejects.toThrow('старым способом');
    });
    it('keeps punctuation and physical identity across scanner formats without replacing the stored KIZ', async () => {
        // TEST: percent and underscore are data, not SQL LIKE wildcards.
        const key = '010468099259845521AB%_CDEF12345';
        const value = `${key}\u001d91EE12\u001d92${client}`;
        await p.productMark.update({ where: { id: marks[2].id }, data: { value } });
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: `]d2${key}91EE1292${client}` });
        expect(await p.productMark.findUnique({ where: { id: marks[2].id } })).toMatchObject({ value, status: 'PACKING' });
        await p.productMark.create({ data: { clientId: client, skuId: sku, boxId: partial, value: value + 'duplicate', status: 'AVAILABLE' } });
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: key })).rejects.toThrow('несколько записей');
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
    });
    it('blocks old TSD movement and outgoing actions for the new workflow', async () => {
        const legacy = new TsdAssemblyService(p as never, scopes as never, {} as never, stock, {} as never, svc);
        vi.spyOn(legacy, 'getRequestPlan').mockResolvedValue({ assemblyMode: 'FBO_TWO_STAGE' } as never);
        await expect(legacy.assertMovementProgressAvailable(request, {}, user)).rejects.toThrow('двухэтапную');
        await expect(legacy.assertOutgoingBoxAvailable(request, {}, user)).rejects.toThrow('двухэтапную');
        await expect(legacy.assertRelabelProgressAvailable(request, {}, user)).rejects.toThrow('двухэтапную');
        await expect(legacy.handleStageAction(request, 'box-search', 'scan', 'FFL_' + whole, user)).rejects.toThrow('двухэтапную');
    });
});
