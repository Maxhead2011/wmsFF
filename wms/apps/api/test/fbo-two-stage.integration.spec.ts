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
const url = process.env.FBO_TEST_DATABASE_URL ?? process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
// TEST: Windows may reserve 55469 after reboot; both ports still require the isolated local database.
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:554(?:69|85)\/kiz_duplicate_tests(?:\?|$)/.test(url))
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
    const act = (action: string, extra: Record<string, string | number> = {}) => svc.act(request, { action, operationId: randomUUID(), ...(action === 'PICK_BOX' ? { confirmedQuantity: 2 } : {}), ...extra }, user);
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
    // TEST: manual additions after STOP_PICK extend the physical target once and retain actor/KIZ evidence.
    it.each(['within-plan', 'above-plan', 'new-sku'])('records manual packing after closing: %s', async mode => {
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        vi.stubEnv('WMS_FBO_MANUAL_PACKING_ENABLED', 'true');
        if (mode === 'above-plan') await p.clientRequestItem.update({ where: { id: line }, data: { quantity: 2 } });
        await act('START');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await act('STOP_PICK');
        const originalClosure = (await p.fboAssembly.findUniqueOrThrow({ where: { requestId: request } })).pickClosure as any;
        await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await act('MANUAL_OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        const scannedMark = mode === 'new-sku' ? await p.productMark.create({ data: { clientId: client, skuId: other, boxId: partial, value: `010468099259845521MANUALADD0001\u001d91EE12\u001d92${client}`, status: 'AVAILABLE' } }) : marks[2];
        const barcode = mode === 'new-sku' ? '2051234567883' : '2051234567890';
        const dto = { action: 'MANUAL_PACK_UNIT', operationId: randomUUID(), targetBoxCode: 'FFL_' + target, barcode, kiz: scannedMark.value };
        expect(await svc.act(request, dto, user)).toMatchObject({ phase: 'PACKING', needed: 3, picked: 3, packed: 3 });
        await svc.act(request, dto, user);
        const closure = (await p.fboAssembly.findUniqueOrThrow({ where: { requestId: request } })).pickClosure as any;
        expect(closure.closedAt).toBe(originalClosure.closedAt);
        expect(closure.requested).toEqual(originalClosure.requested);
        expect(Object.values(closure.quantities).reduce((a: number, b: any) => a + b, 0)).toBe(3);
        const events = await p.auditLog.findMany({ where: { entityId: request, action: 'FBO_MANUAL_PACK_RECORDED' } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ userId: uid, payload: { operationId: dto.operationId, barcode, kiz: scannedMark.value, sourceBoxCode: 'FFL_' + partial, targetBoxCode: 'FFL_' + target, afterPickClosed: true, packingTargetBefore: 2, packingTargetAfter: 3, recoveredPick: true } });
        const history = await p.clientRequestEvent.findMany({ where: { requestId: request, title: 'Ручное добавление при упаковке ФБО' } });
        expect(history).toHaveLength(1);
        expect(history[0].createdByUserId).toBe(uid);
        expect(history[0].body).toContain(barcode);
        expect(history[0].body).toContain(scannedMark.value.split('\u001d')[0]);
        expect(history[0].body).toContain('FFL_' + partial);
        expect(history[0].body).toContain('FFL_' + target);
        await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target });
        await act('SORTED');
        for (const id of [whole, target]) await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + id });
        await act('FINISH');
        const workbook = XLSX.read((await svc.wbFile(request, user)).content, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }) as any[][];
        expect(rows.slice(1).reduce((sum, row) => sum + row[1], 0)).toBe(3);
        expect(rows.slice(1).map(row => row[2]).sort()).toEqual(['FFL_' + whole, 'FFL_' + target].sort());
        await stock.shipClientRequest({ requestId: request, idempotencyKey: randomUUID() }, user);
    });
    // TEST: manually packing an existing pick records the scan without increasing demand or debiting twice.
    it('audits an already picked manual unit once and rejects a second physical packing', async () => {
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        vi.stubEnv('WMS_FBO_MANUAL_PACKING_ENABLED', 'true');
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value });
        await act('STOP_PICK');
        await act('MANUAL_OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        const dto = { action: 'MANUAL_PACK_UNIT', operationId: randomUUID(), targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: marks[2].value };
        expect(await svc.act(request, dto, user)).toMatchObject({ needed: 1, picked: 1, packed: 1 });
        await svc.act(request, dto, user);
        await expect(svc.act(request, { ...dto, operationId: randomUUID() }, user)).rejects.toThrow();
        const events = await p.auditLog.findMany({ where: { entityId: request, action: 'FBO_MANUAL_PACK_RECORDED' } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ userId: uid, payload: { recoveredPick: false, packingTargetBefore: 1, packingTargetAfter: 1, kiz: marks[2].value, afterPickClosed: true } });
        expect((await p.stockMovement.aggregate({ where: { clientId: client, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(-1);
    });
    // TEST: closing a short pick preserves the order, prevents late picks, and ships only physical units.
    it('closes a partial pick and completes actual packing without reducing the original order', async () => {
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        await act('START');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        const stop = { action: 'STOP_PICK', operationId: randomUUID() };
        const closed = await svc.act(request, stop, user);
        expect(closed).toMatchObject({ phase: 'PACKING', needed: 2, plannedNeeded: 4, picked: 2, packingNeeded: 2, unpicked: 2 });
        expect(await svc.act(request, stop, user)).toMatchObject({ phase: 'PACKING', packingNeeded: 2 });
        expect((await p.clientRequestItem.findUniqueOrThrow({ where: { id: line } })).quantity).toBe(4);
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value })).rejects.toThrow();
        await expect(act('SORTED')).rejects.toThrow();
        await expect(svc.wbFile(request, user)).rejects.toThrow();
        await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await act('SORTED');
        await expect(act('FINISH')).rejects.toThrow();
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole });
        const finish = { action: 'FINISH', operationId: randomUUID() };
        expect(await svc.act(request, finish, user)).toMatchObject({ phase: 'COMPLETED', packed: 2 });
        await svc.act(request, finish, user);
        const files = new ClientRequestMarketplaceFilesService(p as never, scopes as never);
        for (const file of [await files.getWbProductsTemplate(request, user), await svc.wbFile(request, user)]) {
            const workbook = XLSX.read(file.content, { type: 'buffer' });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }) as unknown[][];
            expect(rows.slice(1).map(row => [row[0], row[1]])).toEqual([['2051234567890', 2]]);
        }
        await stock.shipClientRequest({ requestId: request, idempotencyKey: randomUUID() }, user);
        expect((await p.clientRequest.findUniqueOrThrow({ where: { id: request } })).status).toBe('DONE');
        expect((await p.stockBalance.aggregate({ where: { boxId: partial, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(3);
        expect((await p.clientRequestItem.findUniqueOrThrow({ where: { id: line } })).quantity).toBe(4);
    });
    // TEST: concurrent retries and a competing physical scan cannot leave an unaccounted picked unit.
    it('serializes closing with a concurrent scan and keeps the closure valid after rollout disablement', async () => {
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        await act('START');
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        const stop = { action: 'STOP_PICK', operationId: randomUUID() };
        const result = await Promise.allSettled([
            svc.act(request, stop, user), svc.act(request, stop, user),
            act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value }),
        ]);
        expect(result[0].status).toBe('fulfilled');
        expect(result[1].status).toBe('fulfilled');
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'false');
        const plan = await svc.plan(request, user);
        expect(plan.phase).toBe('PACKING');
        expect(plan.needed).toBe(plan.picked);
        expect(plan.plannedNeeded).toBe(4);
        expect(plan.picked).toBe(result[2].status === 'fulfilled' ? 3 : 2);
        expect(await p.auditLog.count({ where: { entityId: request, action: 'FBO_PICK_CLOSED' } })).toBe(1);
    });
    // TEST: neither disabled installations nor empty picks can silently close an order.
    it('rejects premature and disabled short-pick completion', async () => {
        await act('START');
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        await expect(act('STOP_PICK')).rejects.toThrow();
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'false');
        await expect(act('STOP_PICK')).rejects.toThrow();
        await expect(act('FINISH_PICK')).rejects.toThrow();
        expect(await svc.plan(request, user)).toMatchObject({ phase: 'PICKING', needed: 4 });
    });
    // TEST: mixed-box picks retain each SKU, request line and KIZ through retry and whole-box packing.
    it.each([true, false])('picks and packs a mixed box with second SKU marked=%s', async secondMarked => {
        vi.stubEnv('WMS_FBO_MIXED_WHOLE_BOX_ENABLED', 'true');
        await p.clientRequestItem.update({ where: { id: line }, data: { quantity: 2 } });
        const secondLine = await p.clientRequestItem.create({ data: { requestId: request, skuId: other, barcode: '2051234567883', quantity: 1 } });
        await p.stockBalance.create({ data: { balanceKey: randomUUID(), clientId: client, warehouseId: wh, boxId: whole, skuId: other, status: 'AVAILABLE', quantity: 1 } });
        let secondMark: { id: string; value: string } | undefined;
        if (secondMarked) {
            await p.sku.update({ where: { id: other }, data: { needsChestnyZnak: true } });
            secondMark = await p.productMark.create({ data: { clientId: client, skuId: other, boxId: whole, status: 'AVAILABLE', value: `010468099259845521CCCCCCCCCCCC1\u001d91EE12\u001d92${client}` } });
        }
        const plan = await act('START');
        expect(plan.route.find(b => b.boxCode === 'FFL_' + whole)).toMatchObject({ wholeBox: true, wholeBoxQuantity: 3 });
        const dto = { action: 'PICK_BOX', operationId: randomUUID(), sourceBoxCode: 'FFL_' + whole, confirmedQuantity: 3 };
        await svc.act(request, dto, user);
        await svc.act(request, dto, user);
        const units = await p.fboAssemblyUnit.findMany({ where: { requestId: request } });
        expect(units).toHaveLength(3);
        expect(units.filter(u => u.skuId === sku).map(u => u.markId).sort()).toEqual(marks.slice(0, 2).map(m => m.id).sort());
        expect(units.find(u => u.skuId === other)).toMatchObject({ requestItemId: secondLine.id, markId: secondMark?.id ?? null, wholeBox: true });
        expect(units.every(u => u.sourceBoxId === whole)).toBe(true);
        await act('FINISH_PICK');
        const packed = await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        expect(packed.packed).toBe(3);
        const quantities = await p.stockBalance.findMany({ where: { boxId: whole, status: 'PACKING', quantity: { gt: 0 } } });
        expect(quantities.map(b => [b.skuId, b.quantity]).sort()).toEqual([[sku, 2], [other, 1]].sort());
        await act('SORTED');
        await act('CONFIRM_BOX', { targetBoxCode: 'FFL_' + whole });
        expect((await act('FINISH')).phase).toBe('COMPLETED');
        const shipped = await p.stockBalance.findMany({ where: { boxId: whole, status: 'SHIPPING', quantity: { gt: 0 } } });
        expect(shipped.map(b => [b.skuId, b.quantity]).sort()).toEqual([[sku, 2], [other, 1]].sort());
        expect((await p.stockMovement.aggregate({ where: { clientId: client, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(-3);
        const file = await svc.wbFile(request, user);
        const workbook = XLSX.read(file.content, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets.TDSheet, { header: 1 }) as unknown[][];
        expect(rows.slice(1).map(row => [row[0], row[1], row[2]]).sort()).toEqual([
            ['2051234567890', 2, 'FFL_' + whole], ['2051234567883', 1, 'FFL_' + whole],
        ].sort());
    });
    // TEST: committed picks must be acknowledged even when rebuilding the route fails.
    it('acknowledges a pick and its retry without rebuilding the route or debiting twice', async () => {
        vi.stubEnv('WMS_FBO_FAST_ACK_ENABLED', 'true');
        await act('START');
        const dto = { action: 'PICK_UNIT', operationId: randomUUID(), sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        const plan = vi.spyOn(svc, 'plan').mockRejectedValue(new Error('Route is slow'));
        const ack = await (svc as any).actAcknowledged(request, dto, user);
        expect(ack).toMatchObject({ accepted: true, requestId: request, operationId: dto.operationId, action: 'PICK_UNIT' });
        expect(await (svc as any).operationStatus(request, dto, user)).toMatchObject(ack);
        const transaction = vi.fn().mockRejectedValue(new Error('No transaction slot'));
        (svc as any).prisma = new Proxy(p, { get: (target, key) => key === '$transaction' ? transaction : Reflect.get(target, key) });
        expect(await (svc as any).actAcknowledged(request, dto, user)).toMatchObject(ack);
        expect(transaction).not.toHaveBeenCalled();
        expect(plan).not.toHaveBeenCalled();
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request, markId: marks[2].id } })).toBe(1);
        expect((await p.stockBalance.aggregate({ where: { clientId: client, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(4);
    });
    // TEST: checking an unknown operation is read-only; an acknowledgement is bound to actor and payload.
    it('checks operation status without mutation and rejects mismatched replay data', async () => {
        vi.stubEnv('WMS_FBO_FAST_ACK_ENABLED', 'true');
        await act('START');
        const dto = { action: 'PICK_UNIT', operationId: randomUUID(), sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        expect(await (svc as any).operationStatus(request, dto, user)).toMatchObject({ accepted: false, operationId: dto.operationId });
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(0);
        await (svc as any).actAcknowledged(request, dto, user);
        await expect((svc as any).operationStatus(request, { ...dto, kiz: marks[3].value }, user)).rejects.toThrow('другими данными');
        await expect((svc as any).operationStatus(request, dto, { ...user, id: randomUUID() })).rejects.toThrow('Client access denied');
        await p.fboAssemblyAction.update({ where: { id: `${request}:${dto.operationId}` }, data: { actorId: randomUUID() } });
        await expect((svc as any).operationStatus(request, dto, user)).rejects.toThrow('другими данными');
    });
    // TEST: sold/default configuration retains the existing full-plan API and does not expose fast writes.
    it('requires explicit enablement for fast acknowledgements', async () => {
        vi.stubEnv('WMS_FBO_FAST_ACK_ENABLED', 'false');
        expect(await svc.plan(request, user)).toMatchObject({ fastAcknowledgementSupported: false });
        await expect((svc as any).actAcknowledged(request, { action: 'START', operationId: randomUUID() }, user)).rejects.toThrow();
        expect(await p.fboAssemblyAction.count({ where: { requestId: request } })).toBe(0);
        expect(await act('START')).toMatchObject({ phase: 'PICKING' });
    });
    // TEST: simultaneous retries share one transaction result, including after request edits.
    it('acknowledges concurrent retries once and retains receipts after composition changes', async () => {
        vi.stubEnv('WMS_FBO_FAST_ACK_ENABLED', 'true');
        await act('START');
        const dto = { action: 'PICK_UNIT', operationId: randomUUID(), sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        const responses = await Promise.all([svc.actAcknowledged(request, dto, user), svc.actAcknowledged(request, dto, user)]);
        expect(responses.every(r => r.accepted)).toBe(true);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
        await p.clientRequestItem.update({ where: { id: line }, data: { quantity: 0 } });
        expect(await svc.operationStatus(request, dto, user)).toMatchObject({ accepted: true });
        await expect(svc.actAcknowledged(request, { ...dto, operationId: randomUUID() }, user)).rejects.toThrow();
    });
    // TEST: unknown physical KIZ is registered and consumed atomically, without a recount.
    it('binds a new unit scan once and retries without another stock debit', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await p.productMark.delete({ where: { id: marks[2].id } });
        await act('START');
        const dto = { action: 'PICK_UNIT', operationId: randomUUID(), sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        await svc.act(request, dto, user); await svc.act(request, dto, user);
        const mark = await p.productMark.findFirstOrThrow({ where: { clientId: client, value: dto.kiz } });
        expect(mark).toMatchObject({ skuId: sku, status: 'PACKING', sourceDocument: `FBO-PICK:${request}` });
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request, markId: mark.id } })).toBe(1);
        expect((await p.stockBalance.aggregate({ where: { clientId: client, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(4);
        expect(await p.auditLog.count({ where: { entityId: request, action: 'FBO_PICK_KIZ_BOUND' } })).toBe(1);
    });
    // TEST: physical correction moves the recorded balance first; the warehouse loses only one available unit.
    it('corrects an available KIZ from another box without debiting two units', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[0].value });
        expect(await p.productMark.findUnique({ where: { id: marks[0].id } })).toMatchObject({ status: 'PACKING' });
        expect((await p.stockBalance.aggregate({ where: { boxId: whole, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(1);
        expect((await p.stockBalance.aggregate({ where: { boxId: partial, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(3);
        expect(await p.fboAssemblyUnit.findFirst({ where: { requestId: request } })).toMatchObject({ sourceBoxId: partial, markId: marks[0].id });
    });
    // TEST: a failed pick rolls the new identity back instead of receiving extra stock.
    it('does not register a new KIZ when no available stock exists', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await p.productMark.delete({ where: { id: marks[2].id } });
        await p.stockBalance.updateMany({ where: { boxId: partial, skuId: sku }, data: { quantity: 0 } });
        await act('START');
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value })).rejects.toThrow('остатка');
        expect(await p.productMark.count({ where: { clientId: client, value: marks[2].value } })).toBe(0);
        expect(await p.stockMovement.count({ where: { clientId: client } })).toBe(0);
        expect(await p.auditLog.count({ where: { entityId: request, action: 'FBO_PICK_KIZ_BOUND' } })).toBe(0);
    });
    // TEST: an explicit physical scan restores shipped identity, but cannot change SKU ownership.
    it('restores a shipped KIZ and rejects a KIZ belonging to another SKU', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true'); await act('START');
        await p.productMark.update({ where: { id: marks[0].id }, data: { status: 'SHIPPING' } });
        await p.productMark.update({ where: { id: marks[1].id }, data: { skuId: other } });
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[0].value });
        expect(await p.productMark.findUnique({ where: { id: marks[0].id } })).toMatchObject({ status: 'PACKING' });
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[1].value })).rejects.toThrow('не доступен');
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
    });
    // TEST: unknown scanner garbage is not converted into a product mark.
    it('recovers a historical shipped unit without inventing a second available unit', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await p.productMark.update({ where: { id: marks[2].id }, data: { status: 'SHIPPING' } });
        await p.stockBalance.updateMany({ where: { boxId: partial, skuId: sku }, data: { quantity: 0 } });
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value });
        expect((await p.stockBalance.aggregate({ where: { clientId: client, skuId: sku, status: 'PACKING' }, _sum: { quantity: true } }))._sum.quantity).toBe(1);
        expect((await p.stockBalance.aggregate({ where: { boxId: partial, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } }))._sum.quantity).toBe(0);
        const audit = await p.auditLog.findFirstOrThrow({ where: { entityId: request, action: 'FBO_PICK_KIZ_BOUND' } });
        expect(audit.payload).toMatchObject({ recovered: true, previousMark: { status: 'SHIPPING' } });
    });
    // TEST: a physical return releases an old active FBS claim and retains its KIZ/order evidence.
    it('reclaims a KIZ from another active order in the scanned box', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        const task = await p.fbsTsdAssembly.create({ data: { clientId: client, connectionId: randomUUID(), orderId: 'old-order',
            requestId: randomUUID(), requestItemId: randomUUID(), skuId: sku, productName: 'Previous order', barcodes: [], storageBoxes: [],
            deviceCode: 'test', status: 'IN_PROGRESS', boxId: partial, kiz: marks[2].value } });
        await act('START');
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value });
        expect(await p.fbsTsdAssembly.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'RELEASED', kiz: marks[2].value, orderId: 'old-order' });
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
    });
    // TEST: the old unfinished FBO loses this physical unit and is reopened for picking.
    it('reclaims an unfinished FBO unit without counting it in both requests', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        const prior = randomUUID();
        await p.clientRequest.create({ data: { id: prior, clientId: client, warehouseId: wh, type: 'OUTBOUND', title: 'Prior FBO' } });
        await p.fboAssembly.create({ data: { requestId: prior, compositionHash: 'test', phase: 'PACKING' } });
        const unit = await p.fboAssemblyUnit.create({ data: { requestId: prior, requestItemId: randomUUID(), skuId: sku, barcode: '2051234567890',
            markId: marks[0].id, activeMarkId: marks[0].id, kiz: marks[0].value, sourceBoxId: whole, sourceBoxCode: 'FFL_' + whole, pickedByUserId: uid } });
        await p.productMark.update({ where: { id: marks[0].id }, data: { status: 'PACKING' } });
        await p.stockBalance.updateMany({ where: { boxId: whole, skuId: sku }, data: { status: 'PACKING' } });
        try {
            await act('START');
            await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[0].value });
            expect(await p.fboAssemblyUnit.findUnique({ where: { id: unit.id } })).toMatchObject({ state: 'RETURNED', activeMarkId: null });
            expect(await p.fboAssembly.findUnique({ where: { requestId: prior } })).toMatchObject({ phase: 'PICKING' });
            expect(await p.fboAssemblyUnit.count({ where: { activeMarkId: marks[0].id } })).toBe(1);
        } finally {
            await p.fboAssemblyUnit.deleteMany({ where: { requestId: prior } });
            await p.fboAssembly.delete({ where: { requestId: prior } });
            await p.clientRequest.delete({ where: { id: prior } });
        }
    });
    // TEST: two concurrent attempts cannot create/consume the same previously unknown KIZ twice.
    it('serializes simultaneous scans of an unknown KIZ', async () => {
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await p.productMark.delete({ where: { id: marks[2].id } }); await act('START');
        const dto = { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value };
        const results = await Promise.allSettled([act('PICK_UNIT', dto), act('PICK_UNIT', dto)]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(await p.productMark.count({ where: { clientId: client, value: marks[2].value } })).toBe(1);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(1);
    });
    // TEST: unknown scanner garbage is not converted into a product mark.
    it('validates new KIZs and preserves the old behavior with the flag disabled', async () => {
        await p.productMark.delete({ where: { id: marks[2].id } }); await act('START');
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value })).rejects.toThrow('актуализация');
        vi.stubEnv('WMS_FBO_PICK_BIND_KIZ', 'true');
        await expect(act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: 'invalid' })).rejects.toThrow('КИЗ');
    });
    // TEST: 1509_27 must not consume one unit of demand before an exact whole 1509_31.
    it('prefers the complete matching box over an earlier mixed box', async () => {
        await p.clientRequestItem.update({ where: { id: line }, data: { quantity: 2 } });
        await p.box.update({ where: { id: partial }, data: { code: 'A_MIXED_' + partial } });
        await p.box.update({ where: { id: whole }, data: { code: 'B_WHOLE_' + whole } });
        const plan = await act('START');
        expect(plan.route.map(b => b.boxCode)).toEqual(['B_WHOLE_' + whole]);
        expect(plan.route[0]).toMatchObject({ wholeBox: true, wholeBoxQuantity: 2 });
    });
    // TEST: quantity confirmation must not silently take a different number of physical units.
    it.each([undefined, 1])('rejects absent or mismatching whole-box confirmation %s before stock changes', async quantity => {
        await act('START');
        await expect(svc.act(request, { action: 'PICK_BOX', operationId: randomUUID(), sourceBoxCode: 'FFL_' + whole,
            confirmedQuantity: quantity } as any, user)).rejects.toThrow(/количество/i);
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request } })).toBe(0);
        expect((await p.stockBalance.aggregate({ where: { boxId: whole }, _sum: { quantity: true } }))._sum.quantity).toBe(2);
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
        const dto = { action: 'PICK_BOX', confirmedQuantity: 2, operationId: randomUUID(), sourceBoxCode: 'FFL_' + whole };
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
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: randomUUID(), requestItemId: randomUUID(),
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
    // TEST: automatic and box-only routes yield to physical picking without clearing another SKU's route.
    it.each(['RESERVED', 'IN_PROGRESS'])('releases an untouched %s route when FBO physically takes its stock', async (status) => {
        const reservation = await p.fbsTsdAssembly.create({ data: {
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: randomUUID(), requestItemId: randomUUID(),
            skuId: sku, productName: 'FBS reserved', barcodes: [], storageBoxes: [], deviceCode: status === 'RESERVED' ? 'AUTO:FBS:PALLET_SORT' : 'TSD',
            status, reservedBoxId: whole, boxId: status === 'IN_PROGRESS' ? whole : null,
        } });
        const plan = await act('START');
        expect(plan.route.some(b => b.boxCode === 'FFL_' + whole)).toBe(true);
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: reservation.id } })).reservedBoxId).toBe(whole);
        const dto = { action: 'PICK_BOX', confirmedQuantity: 2, operationId: randomUUID(), sourceBoxCode: 'FFL_' + whole };
        const result = await svc.act(request, dto, user);
        expect(result.picked).toBe(2);
        expect(result.route.some(b => b.boxCode === 'FFL_' + whole)).toBe(false);
        expect(await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({
            status: status === 'RESERVED' ? 'WAITING_STOCK' : 'IN_PROGRESS', boxId: null, reservedBoxId: null,
        });
        expect((await svc.act(request, dto, user)).picked).toBe(2);
    });
    // TEST: partial picking keeps reservations covered by remaining stock and never releases another SKU.
    it('releases only reservations displaced by the accepted quantity', async () => {
        const reserve = async (skuId: string, itemCount: number) => p.fbsTsdAssembly.create({ data: {
            clientId: client, connectionId: randomUUID(), orderId: randomUUID(), requestId: randomUUID(), requestItemId: randomUUID(),
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
        await pick(marks[3].value);
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: same.id } })).reservedBoxId).toBeNull();
        expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: different.id } })).reservedBoxId).toBe(partial);
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
    // TEST: partial packing overlaps picking, retries once and cannot finish the request early.
    it('packs picked units while collection continues without a second debit', async () => {
        vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED', 'true');
        const assembly = new TsdAssemblyService(p as never,
            { ...scopes, resolveClientFilter: () => client } as never, {} as never, stock, {} as never, svc);
        const ids = async (workflow: string) => (await assembly.listActiveRequests(user, workflow)).map(r => r.id);
        await act('START');
        expect(await ids('fbo-pack')).not.toContain(request);
        await act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[2].value });
        expect(await ids('fbo-pick')).toContain(request);
        expect(await ids('fbo-pack')).toContain(request);
        await act('OPEN_BOX', { targetBoxCode: 'FFL_' + target });
        await expect(act('PACK_UNIT', { targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: marks[3].value })).rejects.toThrow();
        const pack = { action: 'PACK_UNIT', operationId: randomUUID(), targetBoxCode: 'FFL_' + target, barcode: '2051234567890', kiz: marks[2].value };
        await Promise.all([svc.act(request, pack, user), act('PICK_UNIT', { sourceBoxCode: 'FFL_' + partial, barcode: '2051234567890', kiz: marks[3].value })]);
        await svc.act(request, pack, user);
        await act('CLOSE_BOX', { targetBoxCode: 'FFL_' + target });
        await expect(act('SORTED')).rejects.toThrow();
        await expect(act('FINISH_PICK')).rejects.toThrow();
        const plan = await svc.plan(request, user);
        expect(plan).toMatchObject({ phase: 'PICKING', picked: 2, packed: 1, parallelPackingSupported: true });
        expect(await p.stockMovement.aggregate({ where: { clientId: client, skuId: sku, status: 'AVAILABLE' }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: -2 } });
        await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await expect(act('SORTED')).rejects.toThrow();
        await act('FINISH_PICK');
        expect((await svc.plan(request, user)).phase).toBe('PACKING');
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
