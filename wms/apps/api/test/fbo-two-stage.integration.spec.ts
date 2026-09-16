import 'reflect-metadata';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
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
        await p.auditLog.deleteMany({ where: { entityId: request } });
        await p.tsdOperation.deleteMany({ where: { payload: { path: ['requestId'], equals: request } } });
        await p.fboAssemblyAction.deleteMany({ where: { requestId: request } });
        await p.fboAssemblyUnit.deleteMany({ where: { requestId: request } });
        await p.fboAssemblyBox.deleteMany({ where: { requestId: request } });
        await p.fboAssembly.deleteMany({ where: { requestId: request } });
        await p.billingCharge.deleteMany({ where: { requestId: request } });
        await p.clientBillingService.deleteMany({ where: { clientId: client } });
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
    async function picked() { await act('START'); await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole }); for (const m of marks.slice(2, 4))
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: m.value }); await act('FINISH_PICK'); }
    async function packed() { await picked(); await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole }); await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target }); for (const m of marks.slice(2, 4))
        await act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: m.value }); await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target }); await act('SORTED'); }
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
