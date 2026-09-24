import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { FboTwoStageService } from '../tsd/fbo-two-stage.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import { ClientRequestMarketplaceFilesService } from '../client-requests/client-request-marketplace-files.service';
import type { AuthUser } from '../auth/auth.types';
import { RecoveryInput, recoveryInput, recoveryWarehouse } from './fbo-problems-policy';
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
type DB = Prisma.TransactionClient;
export type ReportFilter = {
    worker?: string;
    pallet?: string;
    from?: string;
    to?: string;
    state?: string;
};
@Injectable()
export class FboProblemsService {
    constructor(private readonly prisma: PrismaService, private readonly fbo: FboTwoStageService, private readonly balances: StockBalancesService, private readonly lock: InventoryLockService, private readonly files: ClientRequestMarketplaceFilesService) { }
    async capabilities(user: AuthUser) {
        const actor = await this.prisma.user.findUnique({ where: { id: user.id }, include: { roles: { include: { role: true } }, warehouseScopes: true } });
        recoveryWarehouse(actor);
        return { enabled: process.env.WMS_FBO_PROBLEMS_ENABLED === 'true' && process.env.WMS_FBO_TWO_STAGE_ENABLED === 'true' };
    }
    private async access(db: DB, user: AuthUser, id?: string) {
        if (process.env.WMS_FBO_PROBLEMS_ENABLED !== 'true' || process.env.WMS_FBO_TWO_STAGE_ENABLED !== 'true')
            throw new NotFoundException('Проблемы FBO выключены.');
        const actor = await db.user.findUnique({ where: { id: user.id }, include: { roles: { include: { role: true } }, warehouseScopes: true } });
        const branch = recoveryWarehouse(actor);
        if (id) {
            const r = await db.clientRequest.findUnique({ where: { id }, include: { _count: { select: { fbsOrderLinks: true } }, fboAssembly: true } });
            if (!r || r.type !== 'OUTBOUND' || r._count.fbsOrderLinks || !r.fboAssembly)
                throw new NotFoundException('Двухэтапная заявка FBO не найдена.');
            if (branch && r.warehouseId !== branch)
                throw new ForbiddenException('Заявка другого филиала.');
        }
        return branch;
    }
    async list(user: AuthUser, search = '') {
        const branch = await this.access(this.prisma, user);
        const q = search.trim().replace(/^№\s*/, '').slice(0, 100), number = Number(q.replace(/^0+/, ''));
        const variants=[...new Set([q,q.replaceAll('-','_'),q.replaceAll('_','-')])];
        return this.prisma.clientRequest.findMany({ where: { type: 'OUTBOUND', fbsOrderLinks: { none: {} }, fboAssembly: { isNot: null }, ...(branch ? { warehouseId: branch } : {}), ...(q ? { OR: [...variants.map(contains=>({title:{contains,mode:'insensitive' as const}})), ...(Number.isSafeInteger(number) ? [{ number }] : [])] } : {}) }, select: { id: true, number: true, title: true, status: true, warehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    }
    private async state(db: DB, id: string) {
        const request = await db.clientRequest.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
        const assembly = await db.fboAssembly.findUniqueOrThrow({ where: { requestId: id }, include: { units: { orderBy: { id: 'asc' } }, boxes: { orderBy: { id: 'asc' } } } });
        const boxIds = [...new Set([...assembly.units.flatMap(u => [u.sourceBoxId, u.targetBoxId]), ...assembly.boxes.map(b => b.boxId)].filter((s): s is string => !!s))];
        const balances = await db.stockBalance.findMany({ where: { boxId: { in: boxIds } }, orderBy: { id: 'asc' } });
        const marks = await db.productMark.findMany({ where: { id: { in: assembly.units.map(u => u.markId).filter((s): s is string => !!s) } }, orderBy: { id: 'asc' } });
        return { request, assembly, balances, marks };
    }
    async details(id: string, user: AuthUser) {
        return this.prisma.$transaction(async (db) => {
            await this.access(db, user, id);
            const s = await this.state(db, id);
            const users = await db.user.findMany({ where: { id: { in: [...new Set(s.assembly.units.map(u => u.pickedByUserId))] } }, select: { id: true, name: true } });
            const movements = await db.stockMovement.findMany({ where: { boxId: { in: s.assembly.boxes.map(b => b.boxId) }, clientId: s.request.clientId, type: 'INVENTORY_ADJUSTMENT', quantity: -1, status: 'PACKING' }, orderBy: { createdAt: 'desc' }, take: 200 });
            const boxes = s.assembly.boxes.map(b => {
                const units = s.assembly.units.filter(u => u.targetBoxId === b.boxId && u.state === 'PACKED');
                const actual = s.balances.filter(x => x.boxId === b.boxId && x.quantity !== 0);
                const mismatches: string[] = [];
                for (const sku of new Set([...units.map(u => u.skuId), ...actual.map(x => x.skuId)])) {
                    const expected = units.filter(u => u.skuId === sku).length, quantity = actual.filter(x => x.skuId === sku).reduce((n, x) => n + x.quantity, 0);
                    if (expected !== quantity)
                        mismatches.push(`${sku}: упаковка ${expected}, остаток ${quantity}`);
                }
                if (s.assembly.phase !== 'COMPLETED' && units.some(u => u.markId && !s.marks.some(m => m.id === u.markId && m.boxId === b.boxId && m.status === 'PACKING')))
                    mismatches.push('Не совпадают привязки КИЗ');
                return { ...b, quantity: units.length, mismatches };
            });
            return { request: { id, number: s.request.number, title: s.request.title, status: s.request.status }, phase: s.assembly.phase, units: s.assembly.units, boxes, movements, users, pendingWhole: [...new Set(s.assembly.units.filter(u => u.state === 'PICKED' && u.wholeBox).map(u => u.sourceBoxCode))] };
        }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    }
    // FIX: preview uses the same state fingerprint as apply; no inventory mutation occurs here.
    async preview(id: string, body: RecoveryInput, user: AuthUser) {
        const input = recoveryInput(body);
        return this.prisma.$transaction(async (db) => {
            await this.access(db, user, id);
            const s = await this.state(db, id);
            if (s.assembly.phase === 'COMPLETED')
                throw new ConflictException('Упаковка завершена; доступны отчёт и документы.');
            if (!['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(s.request.status))
                throw new ConflictException('Заявка недоступна для исправления.');
            if (input.action === 'CLOSE_PICK') {
                if (s.assembly.phase !== 'PICKING' || process.env.WMS_FBO_CLOSE_PICK_ENABLED !== 'true')
                    throw new ConflictException('Завершение отбора недоступно на этом этапе.');
            }
            else if (!['PACKING', 'CONTROL'].includes(s.assembly.phase))
                throw new ConflictException('Сначала завершите отбор.');
            const token = randomUUID(), revision = digest(s), units = s.assembly.units.filter(u => input.unitIds?.includes(u.id));
            if (input.unitIds && units.length !== input.unitIds.length)
                throw new BadRequestException('Единица не входит в заявку.');
            const whole = [...new Set(s.assembly.units.filter(u => u.state === 'PICKED' && u.wholeBox).map(u => u.sourceBoxCode))];
            const affectedBoxes = input.boxCodes?.length ? input.boxCodes : input.action === 'ADD_BOXES' ? whole : input.action === 'CONFIRM_BOXES' ? s.assembly.boxes.map(b => b.boxCode) : [];
            if (['ADD_BOXES', 'SPLIT_BOXES'].includes(input.action) && affectedBoxes.some(c => !whole.includes(c)))
                throw new ConflictException('Короб уже упакован или не отобран целиком.');
            if (input.action === 'CONFIRM_BOXES' && affectedBoxes.some(c => !s.assembly.boxes.some(b => b.boxCode === c)))
                throw new ConflictException('Короб не входит в поставку.');
            if (input.action === 'PACK_UNITS' && (units.some(u => u.state !== 'PICKED') || !s.assembly.boxes.some(b => b.boxCode === input.targetBoxCode && !b.wholeBox)))
                throw new ConflictException('Выберите отобранный товар и короб поштучной упаковки.');
            if (input.action === 'FINISH' && (!s.assembly.boxes.length || s.assembly.boxes.some(b => !b.confirmedAt) || s.assembly.units.some(u => u.state === 'PICKED')))
                throw new ConflictException('Упакуйте все отобранные товары и подтвердите короба.');
            if (input.action === 'REVERSE_WRITEOFF')
                await this.reverse(db, id, input, user, token, true);
            const picked = s.assembly.units.filter(u => u.state !== 'RETURNED').length, packed = s.assembly.units.filter(u => u.state === 'PACKED').length;
            const affectedUnits = input.unitIds ? units : s.assembly.units.filter(u => input.action === 'CLOSE_PICK' || input.action === 'FINISH' ? u.state !== 'RETURNED' : affectedBoxes.includes(input.action === 'CONFIRM_BOXES' ? u.targetBoxCode ?? '' : u.sourceBoxCode) && u.state !== 'RETURNED');
            const summary = { phase: s.assembly.phase, action: input.action, affectedBoxes, units: affectedUnits.map(u => ({ id: u.id, barcode: u.barcode, kiz: u.kiz, source: u.sourceBoxCode, target: input.targetBoxCode ?? u.targetBoxCode })), picked, packed, requested: s.request.items.reduce((n, i) => n + i.quantity, 0), availableStockChange: 0, packingStockChange: input.action === 'REVERSE_WRITEOFF' ? 1 : input.action === 'FINISH' ? -packed : 0, shippingStockChange: input.action === 'FINISH' ? packed : 0, warning: input.action === 'REVERSE_WRITEOFF' ? 'Восстановление отменяет одно списание. История прежних отгрузок КИЗ сохраняется.' : input.action === 'SPLIT_BOXES' ? 'Товар всех выбранных коробов перейдёт в поштучную упаковку. Отбор сохранится.' : input.action === 'CLOSE_PICK' ? 'К упаковке останется фактически отобранный товар. Исходное количество заказа сохраняется.' : null };
            await db.auditLog.create({ data: { id: token, userId: user.id, entity: 'ClientRequest', entityId: id, action: 'FBO_RECOVERY_PREVIEW', payload: { input: input as unknown as Prisma.InputJsonValue, revision, summary } } });
            return { token, summary };
        }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    }
    async apply(id: string, token: string, user: AuthUser) {
        if (typeof token !== 'string' || token.length > 100)
            throw new BadRequestException('Нужен предпросмотр.');
        const execute = () => this.prisma.$transaction(async (db) => {
            await db.$queryRaw `SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
            await this.access(db, user, id);
            const preview = await db.auditLog.findUnique({ where: { id: token } });
            if (!preview || preview.action !== 'FBO_RECOVERY_PREVIEW' || preview.entityId !== id || preview.userId !== user.id)
                throw new ForbiddenException('Предпросмотр недоступен.');
            const receipt = await db.auditLog.findUnique({ where: { id: `fbo-recovery:${token}` } });
            if (receipt)
                return { applied: true, repeated: true, result: receipt.payload };
            const payload = preview.payload as unknown as {
                input: RecoveryInput;
                revision: string;
            };
            if (Date.now() - preview.createdAt.getTime() > 600000)
                throw new ConflictException('Предпросмотр устарел. Повторите проверку.');
            const before = await this.state(db, id);
            if (digest(before) !== payload.revision)
                throw new ConflictException('Состав или остатки изменились. Повторите предпросмотр.');
            await this.lock.assertStockMovementsAllowed();
            if (payload.input.action === 'REVERSE_WRITEOFF')
                await this.reverse(db, id, payload.input, user, token);
            else
                await this.fbo.recoverInTransaction(db, id, payload.input, user, token);
            const after = await this.state(db, id);
            const result = { action: payload.input.action, reason: payload.input.reason, before: { phase: before.assembly.phase, boxes: before.assembly.boxes, units: before.assembly.units, balances: before.balances, marks: before.marks }, after: { phase: after.assembly.phase, boxes: after.assembly.boxes, units: after.assembly.units, balances: after.balances, marks: after.marks } };
            await db.auditLog.create({ data: { id: `fbo-recovery:${token}`, userId: user.id, entity: 'ClientRequest', entityId: id, action: 'FBO_RECOVERY_APPLIED', payload: JSON.parse(JSON.stringify(result)) } });
            await db.clientRequestEvent.create({ data: { requestId: id, clientId: after.request.clientId, createdByUserId: user.id, eventType: 'COMMENT', title: 'Исправление FBO администратором', body: `${payload.input.action}: ${payload.input.reason}` } });
            return { applied: true, repeated: false, result: { phase: after.assembly.phase } };
        }, { isolationLevel: 'Serializable', timeout: 120000 });
        // FIX: retry only a rolled-back serialization conflict, retaining the same preview receipt.
        for (let attempt = 0;; attempt++)
            try {
                return await execute();
            }
            catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2)
                    throw error;
            }
    }
    private async reverse(db: DB, id: string, input: RecoveryInput, user: AuthUser, token: string, dryRun = false) {
        const s = await this.state(db, id);
        if (!['PACKING', 'CONTROL'].includes(s.assembly.phase))
            throw new ConflictException('Восстановление доступно до завершения упаковки.');
        const unit = s.assembly.units.find(u => u.id === input.unitIds![0]);
        const move = await db.stockMovement.findUnique({ where: { id: input.movementId! } });
        if (!unit || unit.state !== 'PACKED' || !unit.markId || !move || move.quantity !== -1 || move.type !== 'INVENTORY_ADJUSTMENT' || move.status !== 'PACKING' || move.boxId !== unit.targetBoxId || move.skuId !== unit.skuId || move.clientId !== s.request.clientId || (move.warehouseId && move.warehouseId !== s.request.warehouseId) || move.createdAt < unit.packedAt! || !move.idempotencyKey?.startsWith('admin-phantom-stock:'))
            throw new ConflictException('Допустима отмена одного списания фантомного остатка из короба этой заявки.');
        const reverseKey = `fbo-reverse:${move.id}`;
        if (await db.stockMovement.findUnique({ where: { idempotencyKey: reverseKey } }))
            throw new ConflictException('Списание уже отменено.');
        const mark = s.marks.find(m => m.id === unit.markId);
        if (!mark || mark.status !== 'BLOCKED' || mark.boxId !== null)
            throw new ConflictException('КИЗ уже изменён или находится в другом коробе.');
        const prior = mark.stockMovementId ? await db.stockMovement.findUnique({ where: { id: mark.stockMovementId } }) : null;
        const box = await db.box.findUnique({ where: { id: unit.targetBoxId! } });
        if (mark.clientId !== s.request.clientId || mark.skuId !== unit.skuId || mark.sourceDocument !== 'Снят с остатка автоматическим контролем: КИЗ уже отгружен' || !prior || prior.sourceDocument !== id || prior.boxId !== unit.targetBoxId || prior.status !== 'PACKING' || prior.quantity < 1 || !box || box.clientId !== s.request.clientId || box.warehouseId !== s.request.warehouseId)
            throw new ConflictException('Нет однозначной связи КИЗ с ошибочным списанием и упаковкой этой заявки.');
        const blocked = s.assembly.units.filter(u => u.targetBoxId === unit.targetBoxId && u.skuId === unit.skuId && u.state === 'PACKED' && s.marks.some(m => m.id === u.markId && m.status === 'BLOCKED'));
        if (blocked.length !== 1)
            throw new ConflictException('Несколько заблокированных КИЗ: требуется индивидуальная сверка.');
        const expected = s.assembly.units.filter(u => u.targetBoxId === unit.targetBoxId && u.skuId === unit.skuId && u.state === 'PACKED').length;
        const actual = s.balances.filter(b => b.boxId === unit.targetBoxId && b.skuId === unit.skuId).reduce((n, b) => n + b.quantity, 0);
        if (expected - actual !== 1)
            throw new ConflictException('Расхождение не равно одной единице. Нужна сверка.');
        if (await db.stockMovement.findFirst({ where: { boxId: move.boxId, skuId: move.skuId, createdAt: { gt: move.createdAt } } }))
            throw new ConflictException('После списания были другие движения. Нужна сверка.');
        if (dryRun)
            return;
        const dims = { clientId: move.clientId, warehouseId: s.request.warehouseId, skuId: move.skuId, boxId: move.boxId, palletId: move.palletId, status: 'PACKING' as const };
        const balanceKey = this.balances.balanceKey(dims);
        await db.stockBalance.upsert({ where: { balanceKey }, create: { ...dims, balanceKey, quantity: 1 }, update: { quantity: { increment: 1 } } });
        const restored = await db.stockMovement.create({ data: { ...dims, type: 'INVENTORY_ADJUSTMENT', quantity: 1, sourceDocument: id, idempotencyKey: reverseKey, comment: `Отмена ${move.id}: ${input.reason}` } });
        await db.productMark.update({ where: { id: mark.id }, data: { boxId: move.boxId, status: 'PACKING', stockMovementId: restored.id, sourceDocument: id } });
        await db.fboAssemblyBox.updateMany({ where: { requestId: id, boxId: move.boxId! }, data: { confirmedAt: null, confirmedByUserId: null } });
    }
    async report(id: string, user: AuthUser, filter: ReportFilter = {}) {
        return this.prisma.$transaction(async (db) => {
            for (const value of Object.values(filter))
                if (typeof value !== 'string' || value.length > 150)
                    throw new BadRequestException('Некорректный фильтр отчёта.');
            for (const value of [filter.from, filter.to])
                if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
                    throw new BadRequestException('Укажите дату в формате ГГГГ-ММ-ДД.');
            await this.access(db, user, id);
            const units = await db.fboAssemblyUnit.findMany({ where: { requestId: id }, orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }] });
            const users = await db.user.findMany({ where: { id: { in: [...new Set(units.map(u => u.pickedByUserId))] } }, select: { id: true, name: true } });
            const audits = await db.auditLog.findMany({ where: { entityId: id, action: { in: ['FBO_PICK_LOCATION', 'FBO_PICK_BOX', 'FBO_PICK_UNIT'] } }, orderBy: { createdAt: 'asc' } });
            const evidence = new Map<string, {
                pallet: string;
                operation: string;
                whole: boolean;
            }>();
            for (const a of audits.filter(a => a.action === 'FBO_PICK_LOCATION')) {
                const p = a.payload as {
                    unitIds?: string[];
                    pallet?: string;
                    operationId?: string;
                    whole?: boolean;
                };
                for (const uid of p.unitIds ?? [])
                    evidence.set(uid, { pallet: p.pallet || 'Не зафиксирован', operation: p.operationId ?? a.id, whole: !!p.whole });
            }
            // FIX: old pick events are usable only with an unambiguous source, actor and transaction timestamp.
            for (const unit of units)
                if (!evidence.has(unit.id)) {
                    const matches = audits.filter(a => ['FBO_PICK_BOX', 'FBO_PICK_UNIT'].includes(a.action) && a.userId === unit.pickedByUserId && a.createdAt.getTime() === unit.pickedAt.getTime() && (a.payload as {
                        sourceBoxCode?: string;
                    }).sourceBoxCode === unit.sourceBoxCode);
                    if (matches.length === 1) {
                        const a = matches[0], p = a.payload as {
                            palletCode?: string;
                            operationId?: string;
                        };
                        evidence.set(unit.id, { pallet: p.palletCode || 'Не зафиксирован', operation: p.operationId ?? a.id, whole: a.action === 'FBO_PICK_BOX' });
                    }
                }
            const rows = new Map<string, {
                box: string;
                pallet: string;
                worker: string;
                at: string;
                mode: string;
                quantity: number;
                state: string;
                target: string;
            }>();
            for (const u of units) {
                const ev = evidence.get(u.id);
                const row = { box: u.sourceBoxCode, pallet: ev?.pallet ?? 'Не зафиксирован', worker: users.find(w => w.id === u.pickedByUserId)?.name ?? u.pickedByUserId, at: u.pickedAt.toISOString(), mode: (ev ? ev.whole : u.wholeBox) ? 'Целиком' : 'Поштучно', quantity: 1, state: u.state === 'PACKED' ? 'Упакован' : u.state === 'RETURNED' ? 'Возвращён' : 'Ожидает упаковки', target: u.targetBoxCode ?? '' };
                const date = new Date(u.pickedAt.getTime() + 10800000).toISOString().slice(0, 10);
                if (filter.worker && !row.worker.toLocaleLowerCase().includes(filter.worker.toLocaleLowerCase()) || filter.pallet && !row.pallet.toLocaleLowerCase().includes(filter.pallet.toLocaleLowerCase()) || filter.from && date < filter.from || filter.to && date > filter.to || filter.state && u.state !== filter.state)
                    continue;
                const key = JSON.stringify([row.box, ev?.operation ?? u.id, u.pickedByUserId, row.state, row.target]);
                const old = rows.get(key);
                if (old)
                    old.quantity++;
                else
                    rows.set(key, row);
            }
            return [...rows.values()];
        }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    }
    async excel(id: string, user: AuthUser, filter: ReportFilter) { const rows = await this.report(id, user, filter); const wb = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['Короб', 'Паллет при отборе', 'Сотрудник', 'Дата и время МСК', 'Способ отбора', 'Количество', 'Упаковка', 'Короб упаковки'], ...rows.map(r => [r.box, r.pallet, r.worker, new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(r.at)), r.mode, r.quantity, r.state, r.target])]); sheet['!cols'] = [26, 24, 24, 23, 18, 12, 24, 26].map(wch => ({ wch })); XLSX.utils.book_append_sheet(wb, sheet, 'Отбор коробов'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; }
    async document(id: string, user: AuthUser, kind: string) { if (!['products', 'packages'].includes(kind))
        throw new BadRequestException('Неизвестный документ.'); await this.access(this.prisma, user, id); return kind === 'products' ? this.files.getWbProductsTemplate(id, user) : this.files.getWbPackagingTemplate(id, user); }
}
