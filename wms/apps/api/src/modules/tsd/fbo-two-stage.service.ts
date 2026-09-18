import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { FbsTsdAssembly, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { physicalKizIdentity } from '../../common/kiz-physical-identity';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { assertWarehouseAccess } from '../client-requests/client-request-warehouse-scope';
import { ClientRequestMarketplaceFilesService } from '../client-requests/client-request-marketplace-files.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { fboTwoStageEnabled, hasLegacyFboProgress, isFboTwoStageRequest, remainingFboLines, wholeBoxDecision, prioritizeFboWholeBoxes } from './fbo-two-stage-policy';
import { FboActionDto } from './dto/fbo-action.dto';
const include = { items: { include: { sku: { include: { barcodes: true } } } }, client: true,
    _count: { select: { fbsOrderLinks: true, packages: true } }, pickWaveRequests: { include: { wave: true } } } satisfies Prisma.ClientRequestInclude;
type Request = Prisma.ClientRequestGetPayload<{
    include: typeof include;
}>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// FIX: use the FBS physical-claim rule: an untouched route is not physical stock ownership.
const untouchedFbsRoute = (task: FbsTsdAssembly) =>
    !task.sourceBarcode && !task.barcode && !task.kiz && !task.relabelConfirmedAt &&
    ((task.status === 'RESERVED' && task.deviceCode === 'AUTO:FBS:PALLET_SORT' && !task.boxId) || task.status === 'IN_PROGRESS');
const identity = (value: string) => physicalKizIdentity(value) || value.trim();
const composition = (r: Request) => hash(r.items.map(i => [i.id, i.skuId, i.barcode, i.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
@Injectable()
export class FboTwoStageService {
    private readonly logger = new Logger(FboTwoStageService.name);
    private fastAcknowledgementEnabled() { return process.env.WMS_FBO_FAST_ACK_ENABLED === 'true'; }
    // FIX: the original payload and actor identify the same durable operation on every retry.
    private actionHash(dto: FboActionDto) {
        return hash([dto.action, dto.sourceBoxCode ?? null, dto.targetBoxCode ?? null, dto.barcode ?? null,
            dto.kiz ?? null, dto.palletCode ?? null, ...(dto.confirmedQuantity === undefined ? [] : [dto.confirmedQuantity])]);
    }
    private requireFastAcknowledgement() {
        if (!fboTwoStageEnabled() || !this.fastAcknowledgementEnabled())
            throw new NotFoundException('Быстрое подтверждение ФБО выключено.');
    }
    async operationStatus(id: string, dto: FboActionDto, user: AuthUser) {
        this.requireFastAcknowledgement();
        // A committed receipt remains valid if the request's composition changed afterwards.
        await this.load(this.prisma, id, user, 'write');
        const previous = await this.prisma.fboAssemblyAction.findUnique({ where: { id: `${id}:${dto.operationId}` } });
        if (previous && (previous.payloadHash !== this.actionHash(dto) || previous.actorId !== user.id))
            throw new ConflictException('Номер операции уже использован с другими данными.');
        return { requestId: id, operationId: dto.operationId, action: dto.action, accepted: !!previous };
    }
    async actAcknowledged(id: string, dto: FboActionDto, user: AuthUser) {
        this.requireFastAcknowledgement();
        const started = Date.now();
        // FIX: committed retries need neither a stock transaction nor a new route snapshot.
        const previous = await this.operationStatus(id, dto, user);
        if (previous.accepted) return previous;
        try {
            await this.executeAction(id, dto, user);
            return { ...previous, accepted: true };
        } finally {
            this.logger.log(JSON.stringify({ event: 'fbo_action_ack', requestId: id, operationId: dto.operationId,
                action: dto.action, durationMs: Date.now() - started }));
        }
    }
    constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly balances: StockBalancesService, private readonly stock: StockOperationsService, private readonly lock: InventoryLockService, private readonly files: ClientRequestMarketplaceFilesService) { }
    async eligible(requestId: string, user: AuthUser) {
        if (!fboTwoStageEnabled())
            return false;
        await this.load(this.prisma, requestId, user, 'read');
        return isFboTwoStageRequest(this.prisma, requestId);
    }
    private async load(db: Prisma.TransactionClient, id: string, user: AuthUser, mode: 'read' | 'write') {
        const r = await db.clientRequest.findUnique({ where: { id }, include });
        if (!r)
            throw new NotFoundException('Заявка не найдена.');
        this.scopes.requireClientAccess(user, r.clientId, mode);
        assertWarehouseAccess(user, r, mode);
        return r;
    }
    async plan(id: string, user: AuthUser) {
        if (!fboTwoStageEnabled())
            throw new NotFoundException('Двухэтапная сборка ФБО выключена.');
        const started = Date.now();
        try { return await this.prisma.$transaction(async (tx) => {
            const r = await this.load(tx, id, user, 'read');
            this.requireFbo(r);
            return this.snapshot(tx, r);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
        } finally {
            if (this.fastAcknowledgementEnabled()) this.logger.log(JSON.stringify({ event: 'fbo_plan', requestId: id, durationMs: Date.now() - started }));
        }
    }
    private requireFbo(r: Request) {
        if (r.type !== 'OUTBOUND' || r._count.fbsOrderLinks || r.client.storesWithoutBoxes)
            throw new BadRequestException('Этот режим предназначен для ФБО с учётом по коробам.');
        if (!r.warehouseId)
            throw new BadRequestException('Укажите филиал заявки.');
        if (!r.items.length || r.items.some(i => !i.skuId || !i.sku || i.sku.clientId !== r.clientId || i.quantity < 1 || !i.barcode))
            throw new BadRequestException('У каждой строки ФБО должны быть товар, ШК и положительное количество.');
        if (r.pickWaveRequests.some(w => ['PENDING', 'SUBMITTED'].includes(w.wave.balanceReviewStatus)))
            throw new ConflictException('Сначала завершите проверку балансов волны.');
    }
    private async snapshot(tx: Prisma.TransactionClient, r: Request) {
        const assembly = await tx.fboAssembly.findUnique({ where: { requestId: r.id }, include: { units: true, boxes: true } });
        const units = assembly?.units ?? [];
        const lines = remainingFboLines(r.items, units).map(i => ({ id: i.id, skuId: i.skuId!, barcode: i.barcode!,
            name: i.name || i.sku!.name, article: i.sku!.article, size: i.sku!.size, requiresKiz: (i.sku!.needsChestnyZnak && !i.sku!.isUnmarked) || units.some(u => u.skuId === i.skuId && !!u.markId),
            needed: i.needed, picked: i.picked, packed: i.packed, remaining: i.remaining }));
        const demand: Record<string, number> = {};
        for (const l of lines)
            demand[l.skuId] = (demand[l.skuId] ?? 0) + l.remaining;
        const boxes = assembly?.phase && assembly.phase !== 'PICKING' ? [] : await tx.box.findMany({
            where: { clientId: r.clientId, warehouseId: r.warehouseId, status: 'active', balances: { some: {
                        skuId: { in: Object.keys(demand).filter(k => demand[k] > 0) }, status: 'AVAILABLE', quantity: { gt: 0 }
                    } } },
            include: { balances: true, productMarks: { where: { status: { not: 'SHIPPING' } } },
                storagePlacement: { include: { pallet: { include: { zone: true } } } }, pallet: true, zone: true }, orderBy: { code: 'asc' },
        });
        const route = [];
        const busyBoxes = await this.busyBoxes(tx, boxes.map(b => b.id), r.id, true);
        // FIX: historical stock may have real marks even when the SKU flag was never filled.
        for (const l of lines)
            if (boxes.some(b => b.productMarks.some(m => m.skuId === l.skuId && m.status === 'AVAILABLE')))
                l.requiresKiz = true;
        boxes.sort((a, b) => (a.storagePlacement?.pallet.code ?? a.pallet?.code ?? '').localeCompare(b.storagePlacement?.pallet.code ?? b.pallet?.code ?? '', 'ru', { numeric: true }) || a.code.localeCompare(b.code, 'ru', { numeric: true }));
        // FIX: an exact whole box wins over loose stock in an earlier mixed box.
        const prioritized = prioritizeFboWholeBoxes(boxes.filter(b => !busyBoxes.has(b.id)), demand, (box, remaining) =>
            wholeBoxDecision(box.balances, remaining, box.productMarks.map(m => ({ ...m, identity: identity(m.value) })),
                box.productMarks.length > 0 || lines.some(l => l.requiresKiz && box.balances.some(b => b.quantity > 0 && b.skuId === l.skuId))));
        for (const box of prioritized) {
            if (busyBoxes.has(box.id)) continue;
            const tasks: Array<{
                skuId: string;
                barcode: string;
                name: string;
                quantity: number;
                requiresKiz: boolean;
            }> = [];
            for (const balance of box.balances) {
                if (balance.status !== 'AVAILABLE' || balance.quantity <= 0 || (demand[balance.skuId] ?? 0) <= 0)
                    continue;
                const l = lines.find(i => i.skuId === balance.skuId)!;
                const quantity = Math.min(demand[l.skuId], balance.quantity);
                tasks.push({ skuId: l.skuId, barcode: l.barcode, name: `${l.name} · ${l.article || ''} · ${l.size || ''}`, quantity, requiresKiz: l.requiresKiz });
                demand[l.skuId] -= quantity;
            }
            if (!tasks.length)
                continue;
            const decision = wholeBoxDecision(box.balances, tasks.reduce<Record<string, number>>((sum, t) => { sum[t.skuId] = (sum[t.skuId] ?? 0) + t.quantity; return sum; }, {}), box.productMarks.map(m => ({ ...m, identity: identity(m.value) })), tasks.some(t => t.requiresKiz));
            route.push({ boxCode: box.code, pallet: box.storagePlacement?.pallet.code ?? box.pallet?.code ?? '',
                zone: box.storagePlacement?.pallet.zone?.name ?? box.zone?.name ?? '', tasks, wholeBox: decision.allowed, recount: decision.recount,
                wholeBoxQuantity: decision.allowed ? decision.quantity : 0,
                remainderQuantity: Math.max(0, box.balances.filter(b => b.status === 'AVAILABLE').reduce((sum, b) => sum + Math.max(0, b.quantity), 0) - tasks.reduce((sum, t) => sum + t.quantity, 0)) });
        }
        return { requestId: r.id, title: r.title, phase: assembly?.phase ?? 'NOT_STARTED', lines, route,
            fastAcknowledgementSupported: this.fastAcknowledgementEnabled(),
            parallelPackingSupported: process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true',
            needed: lines.reduce((s, l) => s + l.needed, 0), picked: lines.reduce((s, l) => s + l.picked, 0), packed: lines.reduce((s, l) => s + l.packed, 0),
            looseRemaining: units.filter(u => !u.wholeBox && u.state === 'PICKED').length,
            wholeBoxes: [...new Set(units.filter(u => u.wholeBox && u.state === 'PICKED').map(u => u.sourceBoxCode))],
            boxes: (assembly?.boxes ?? []).map(b => ({ code: b.boxCode, wholeBox: b.wholeBox, closed: !!b.closedAt, confirmed: !!b.confirmedAt,
                quantity: units.filter(u => u.targetBoxId === b.boxId && u.state === 'PACKED').length })),
            shortage: Object.values(demand).reduce((s, n) => s + n, 0), compositionChanged: !!assembly && assembly.compositionHash !== composition(r) };
    }
    async act(id: string, dto: FboActionDto, user: AuthUser) {
        await this.executeAction(id, dto, user);
        return this.plan(id, user);
    }
    private async executeAction(id: string, dto: FboActionDto, user: AuthUser) {
        if (!fboTwoStageEnabled())
            throw new NotFoundException('Двухэтапная сборка ФБО выключена.');
        await this.lock.assertStockMovementsAllowed();
        // FIX: one durable operation id and a request lock make retries and concurrent terminals safe.
        const execute = () => {
            const queuedAt = Date.now();
            return this.prisma.$transaction(async (tx) => {
            const openedAt = Date.now();
            await tx.$queryRaw `SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
            if (this.fastAcknowledgementEnabled()) this.logger.log(JSON.stringify({ event: 'fbo_transaction_wait', requestId: id,
                operationId: dto.operationId, poolWaitMs: openedAt - queuedAt, requestLockWaitMs: Date.now() - openedAt }));
            const r = await this.load(tx, id, user, 'write');
            this.requireFbo(r);
            // FIX: persisted JSON can change property order after a terminal restart.
            const key = `${id}:${dto.operationId}`, payloadHash = this.actionHash(dto);
            const previous = await tx.fboAssemblyAction.findUnique({ where: { id: key } });
            if (previous) {
                if (previous.payloadHash !== payloadHash || previous.actorId !== user.id)
                    throw new ConflictException('Номер операции уже использован с другими данными.');
                return;
            }
            if (!['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(r.status))
                throw new ConflictException('Заявка недоступна для сборки.');
            let a = await tx.fboAssembly.findUnique({ where: { requestId: id } });
            if (!a) {
                if (dto.action !== 'START')
                    throw new ConflictException('Сначала начните отбор.');
                // FIX: never reinterpret a partially executed legacy assembly as a fresh two-stage one.
                const legacy = await hasLegacyFboProgress(tx, id);
                if (legacy || r._count.packages)
                    throw new ConflictException('Заявка уже обрабатывалась старым способом. Требуется отдельный перенос её состояния.');
                a = await tx.fboAssembly.create({ data: { requestId: id, compositionHash: composition(r) } });
                await tx.clientRequest.update({ where: { id }, data: { status: 'IN_WORK' } });
            }
            if (a.compositionHash !== composition(r))
                throw new ConflictException('Состав заявки изменён после начала отбора. Нужна сверка собранных единиц.');
            const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: id, state: { not: 'RETURNED' } } });
            const lines = remainingFboLines(r.items, units);
            const requirePhase = (phase: string) => { if (a!.phase !== phase)
                throw new ConflictException('Этап изменился. Обновите заявку.'); };
            // FIX: only packing mutations may overlap picking; final control still requires FINISH_PICK.
            const requirePacking = () => {
                if (a!.phase === 'PICKING' && process.env.WMS_FBO_PARALLEL_PACKING_ENABLED === 'true' && units.length > 0) return;
                requirePhase('PACKING');
            };
            if (dto.action === 'PICK_UNIT' || dto.action === 'PICK_BOX') {
                requirePhase('PICKING');
                const source = await this.box(tx, r, dto.sourceBoxCode);
                const reconcileUnit = dto.action === 'PICK_UNIT' && process.env.WMS_FBO_PICK_BIND_KIZ === 'true';
                if (!reconcileUnit) await this.requireIdleBox(tx, source.id, id, true);
                const location = await tx.box.findUniqueOrThrow({ where: { id: source.id }, include: { pallet: true, storagePlacement: { include: { pallet: true } } } });
                const palletCode = location.storagePlacement?.pallet.code ?? location.pallet?.code;
                if (palletCode && dto.palletCode !== palletCode)
                    throw new ConflictException('Сначала отсканируйте паллет, на котором сейчас находится этот короб.');
                const balances = await tx.stockBalance.findMany({ where: { boxId: source.id, clientId: r.clientId, warehouseId: r.warehouseId } });
                const marks = await tx.productMark.findMany({ where: { boxId: source.id, status: { not: 'SHIPPING' } } });
                const whole = dto.action === 'PICK_BOX';
                let chosen: Array<{
                    skuId: string;
                    mark: typeof marks[number] | null;
                }> = [];
                if (whole) {
                    // FIX: never infer a physical confirmation from the displayed planned amount.
                    if (!Number.isSafeInteger(dto.confirmedQuantity) || dto.confirmedQuantity! < 1)
                        throw new ConflictException('Введите фактическое количество единиц в коробе. Обновите ТСД, если поля ввода нет.');
                    const demand: Record<string, number> = {};
                    for (const l of lines)
                        demand[l.skuId!] = (demand[l.skuId!] ?? 0) + l.remaining;
                    const marked = marks.length > 0 || lines.some(l => balances.some(b => b.skuId === l.skuId && b.quantity > 0) && l.sku!.needsChestnyZnak && !l.sku!.isUnmarked);
                    const decision = wholeBoxDecision(balances, demand, marks.map(m => ({ ...m, identity: identity(m.value) })), marked);
                    if (decision.recount)
                        throw new ConflictException({ code: 'FBO_BOX_RECOUNT_REQUIRED', boxCode: source.code, message: 'Состав КИЗ не совпадает с остатком. Выполните актуализацию короба.' });
                    if (!decision.allowed)
                        throw new ConflictException('Короб нельзя забрать целиком. Отбирайте нужное количество через ШК и КИЗ.');
                    if (dto.confirmedQuantity !== decision.quantity)
                        throw new ConflictException(`Количество не совпадает: введено ${dto.confirmedQuantity}, в учёте ${decision.quantity}. Проверьте короб и актуализируйте остаток.`);
                    const skuId = balances.find(b => b.quantity > 0)!.skuId;
                    chosen = Array.from({ length: decision.quantity }, (_, i) => ({ skuId, mark: marked ? marks[i] : null }));
                }
                else {
                    const line = lines.find(l => l.remaining > 0 && (l.barcode === dto.barcode || l.sku!.barcodes.some(b => b.value === dto.barcode)));
                    if (!line)
                        throw new BadRequestException('Этот товар не требуется или уже полностью отобран.');
                    const marked = (line.sku!.needsChestnyZnak && !line.sku!.isUnmarked) || marks.some(m => m.skuId === line.skuId && m.status === 'AVAILABLE');
                    if (marked && !dto.kiz)
                        throw new BadRequestException('После ШК отсканируйте КИЗ.');
                    // FIX: a physical unit scan can reconcile its KIZ in the same stock transaction.
                    const mark = dto.kiz ? (process.env.WMS_FBO_PICK_BIND_KIZ === 'true'
                        ? await this.bindPickedMark(tx, r, line.skuId!, source.id, dto.kiz, key, user)
                        : await this.exactMark(tx, dto.kiz)) : null;
                    if (mark && (mark.clientId !== r.clientId || mark.skuId !== line.skuId || mark.boxId !== source.id || mark.status !== 'AVAILABLE'))
                        throw new ConflictException('Этот КИЗ не доступен в указанном коробе для данного товара.');
                    if (reconcileUnit) await this.requireIdleBox(tx, source.id, id, true);
                    chosen = [{ skuId: line.skuId!, mark }];
                }
                const holding = whole ? source : await tx.box.upsert({ where: { code: `FBO-PICK-${id}` }, create: { code: `FBO-PICK-${id}`, clientId: r.clientId, warehouseId: r.warehouseId, status: 'fbo-picking' }, update: {} });
                for (const pick of chosen) {
                    const line = lines.find(l => l.skuId === pick.skuId && l.remaining > 0)!;
                    line.remaining--;
                    if (pick.mark) {
                        const resolved = await this.exactMark(tx, pick.mark.value);
                        if (resolved.id !== pick.mark.id)
                            throw new ConflictException('Неоднозначный КИЗ.');
                    }
                    const unitId = randomUUID();
                    const movement = await this.move(tx, r, pick.skuId, source.id, holding.id, 'AVAILABLE', 'PACKING', 1, `${key}:${unitId}`, user);
                    if (pick.mark) {
                        const changed = await tx.productMark.updateMany({ where: { id: pick.mark.id, boxId: source.id, status: 'AVAILABLE' }, data: { boxId: holding.id, status: 'PACKING', stockMovementId: movement.id } });
                        if (changed.count !== 1)
                            throw new ConflictException('КИЗ уже отобран другим сотрудником.');
                    }
                    await tx.fboAssemblyUnit.create({ data: { id: unitId, requestId: id, requestItemId: line.id, skuId: pick.skuId, barcode: line.barcode!,
                            markId: pick.mark?.id, activeMarkId: pick.mark?.id, kiz: pick.mark?.value, sourceBoxId: source.id, sourceBoxCode: source.code, wholeBox: whole, pickedByUserId: user.id } });
                }
                await this.releaseDisplacedRoutes(tx, source.id, source.code, [...new Set(chosen.map(p => p.skuId))]);
            }
            else if (dto.action === 'FINISH_PICK') {
                requirePhase('PICKING');
                if (lines.some(l => l.remaining))
                    throw new ConflictException('Сначала отберите все единицы заявки.');
                await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'PACKING' } });
            }
            else if (dto.action === 'OPEN_BOX') {
                requirePacking();
                const target = await this.target(tx, r, dto.targetBoxCode);
                await this.requireIdleBox(tx, target.id, id);
                const previousBox = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (previousBox) {
                    if (previousBox.requestId !== id || previousBox.closedAt || previousBox.wholeBox)
                        throw new ConflictException('Короб уже закрыт или принадлежит другой сборке.');
                }
                else {
                    if (await tx.stockBalance.count({ where: { boxId: target.id, quantity: { not: 0 } } }) || await tx.productMark.count({ where: { boxId: target.id } }))
                        throw new ConflictException('Для упаковки нужен пустой короб.');
                    if (!units.some(u => !u.wholeBox && u.state === 'PICKED'))
                        throw new ConflictException('Все отдельные единицы уже вложены.');
                    await tx.fboAssemblyBox.create({ data: { requestId: id, boxId: target.id, activeBoxId: target.id, boxCode: target.code } });
                }
            }
            else if (dto.action === 'PACK_UNIT') {
                requirePacking();
                const target = await this.box(tx, r, dto.targetBoxCode);
                const parcel = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (!parcel || parcel.requestId !== id || parcel.closedAt || parcel.wholeBox)
                    throw new ConflictException('Сначала откройте короб для упаковки.');
                const mark = dto.kiz ? await this.exactMark(tx, dto.kiz) : null;
                const unit = units.find(u => !u.wholeBox && u.state === 'PICKED' && u.barcode === dto.barcode && (mark ? u.markId === mark.id : !u.markId));
                if (!unit)
                    throw new ConflictException('Единица не отобрана для этой заявки или уже вложена. Проверьте ШК и КИЗ.');
                const holding = await tx.box.findUniqueOrThrow({ where: { code: `FBO-PICK-${id}` } });
                const movement = await this.move(tx, r, unit.skuId, holding.id, target.id, 'PACKING', 'PACKING', 1, key, user);
                if (mark) {
                    const moved = await tx.productMark.updateMany({ where: { id: mark.id, boxId: holding.id, status: 'PACKING' }, data: { boxId: target.id, stockMovementId: movement.id } });
                    if (moved.count !== 1)
                        throw new ConflictException('КИЗ перемещён после отбора. Нужна сверка.');
                }
                await tx.fboAssemblyUnit.update({ where: { id: unit.id }, data: { state: 'PACKED', targetBoxId: target.id, targetBoxCode: target.code, packedAt: new Date(), packedByUserId: user.id } });
            }
            else if (dto.action === 'PACK_BOX') {
                requirePacking();
                const box = await this.box(tx, r, dto.sourceBoxCode);
                const picked = units.filter(u => u.wholeBox && u.sourceBoxId === box.id && u.state === 'PICKED');
                if (!picked.length)
                    throw new ConflictException('Этот короб не отобран целиком или уже добавлен.');
                await tx.fboAssemblyBox.create({ data: { requestId: id, boxId: box.id, activeBoxId: box.id, boxCode: box.code, wholeBox: true, closedAt: new Date() } });
                await tx.fboAssemblyUnit.updateMany({ where: { id: { in: picked.map(u => u.id) } }, data: { state: 'PACKED', targetBoxId: box.id, targetBoxCode: box.code, packedAt: new Date(), packedByUserId: user.id } });
            }
            else if (dto.action === 'CANCEL_EMPTY_BOX') {
                requirePacking();
                const target = await this.box(tx, r, dto.targetBoxCode);
                const b = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (!b || b.requestId !== id || b.closedAt || units.some(u => u.targetBoxId === target.id) || await tx.stockBalance.count({ where: { boxId: target.id, quantity: { not: 0 } } }) || await tx.productMark.count({ where: { boxId: target.id } }))
                    throw new ConflictException('Отложить можно только пустой открытый короб этой заявки.');
                await tx.fboAssemblyBox.delete({ where: { id: b.id } });
            }
            else if (dto.action === 'CLOSE_BOX') {
                requirePacking();
                const b = await tx.fboAssemblyBox.findUnique({ where: { requestId_boxCode: { requestId: id, boxCode: dto.targetBoxCode ?? '' } } });
                if (!b || b.closedAt)
                    throw new ConflictException('Короб не открыт или уже закрыт.');
                if (!units.some(u => u.targetBoxId === b.boxId && u.state === 'PACKED'))
                    throw new ConflictException('Нельзя закрыть пустой короб.');
                await tx.fboAssemblyBox.update({ where: { id: b.id }, data: { closedAt: new Date() } });
            }
            else if (dto.action === 'SORTED') {
                requirePhase('PACKING');
                if (lines.some(l => l.packed !== l.needed))
                    throw new ConflictException('Не все отобранные единицы разложены по коробам.');
                const boxes = await tx.fboAssemblyBox.findMany({ where: { requestId: id } });
                if (!boxes.length || boxes.some(b => !b.closedAt))
                    throw new ConflictException('Закройте все короба.');
                await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'CONTROL' } });
            }
            else if (dto.action === 'CONFIRM_BOX') {
                requirePhase('CONTROL');
                const b = await tx.fboAssemblyBox.findUnique({ where: { requestId_boxCode: { requestId: id, boxCode: dto.targetBoxCode ?? '' } } });
                if (!b || !b.closedAt)
                    throw new ConflictException('Короб не входит в поставку.');
                if (b.confirmedAt)
                    throw new ConflictException('Этот короб уже подтверждён.');
                await this.validatePackedBox(tx, r, b.boxId, units);
                await tx.fboAssemblyBox.update({ where: { id: b.id }, data: { confirmedAt: new Date(), confirmedByUserId: user.id } });
            }
            else if (dto.action === 'FINISH') {
                requirePhase('CONTROL');
                const boxes = await tx.fboAssemblyBox.findMany({ where: { requestId: id } });
                if (!boxes.length || boxes.some(b => !b.confirmedAt) || lines.some(l => l.packed !== l.needed))
                    throw new ConflictException('Отсканируйте все короба поставки.');
                for (const b of boxes)
                    await this.validatePackedBox(tx, r, b.boxId, units);
                await tx.clientRequestBoxSelection.deleteMany({ where: { requestItem: { requestId: id } } });
                const packages = boxes.map(b => ({ packageCode: b.boxCode, packageType: 'BOX', items: r.items.map(i => ({ requestItemId: i.id, quantity: units.filter(u => u.targetBoxId === b.boxId && u.requestItemId === i.id && u.state === 'PACKED').length })).filter(i => i.quantity) }));
                for (const b of boxes)
                    for (const i of packages.find(p => p.packageCode === b.boxCode)!.items)
                        await tx.clientRequestBoxSelection.create({ data: { requestItemId: i.requestItemId, skuId: r.items.find(l => l.id === i.requestItemId)!.skuId!, boxId: b.boxId, quantity: i.quantity } });
                await this.stock.packageClientRequest({ requestId: id, idempotencyKey: `fbo-pack:${id}`, boxes: boxes.length, packedUnits: units.length, packages }, user, tx);
                await tx.productMark.updateMany({ where: { id: { in: units.filter(u => u.markId).map(u => u.markId!) }, status: 'PACKING' }, data: { status: 'SHIPPING' } });
                // FIX: preserve history, but a later documented return may use the same physical KIZ again.
                await tx.fboAssemblyUnit.updateMany({ where: { requestId: id }, data: { activeMarkId: null } });
                await tx.fboAssemblyBox.updateMany({ where: { requestId: id }, data: { activeBoxId: null } });
                await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'COMPLETED' } });
            }
            else if (dto.action !== 'START')
                throw new BadRequestException('Неизвестное действие.');
            await tx.fboAssemblyAction.create({ data: { id: key, requestId: id, payloadHash, actorId: user.id } });
            await tx.auditLog.create({ data: { userId: user.id, action: `FBO_${dto.action}`, entity: 'ClientRequest', entityId: id, payload: { operationId: dto.operationId, palletCode: dto.palletCode, sourceBoxCode: dto.sourceBoxCode, targetBoxCode: dto.targetBoxCode, barcode: dto.barcode } } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
        };
        // FIX: retry only rolled-back serialization conflicts, retaining the durable operation id.
        for (let attempt = 0; ; attempt++) {
            try { await execute(); break; }
            catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2)
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
            }
        }
    }
    private async box(tx: Prisma.TransactionClient, r: Request, code?: string) {
        if (!code)
            throw new BadRequestException('Сканируйте ШК короба.');
        await tx.$queryRaw `SELECT "id" FROM "Box" WHERE "code"=${code} FOR UPDATE`;
        const box = await tx.box.findUnique({ where: { code } });
        if (!box || box.clientId !== r.clientId || box.warehouseId !== r.warehouseId || box.status !== 'active')
            throw new NotFoundException('Короб недоступен в филиале и у клиента заявки.');
        return box;
    }
    private async target(tx: Prisma.TransactionClient, r: Request, code?: string) {
        if (!code || !/^FFL[\w-]{1,96}$/i.test(code))
            throw new BadRequestException('Сканируйте ШК короба FFL.');
        await tx.box.upsert({ where: { code }, create: { code, clientId: r.clientId, warehouseId: r.warehouseId }, update: {} });
        return this.box(tx, r, code);
    }
    private async busyBoxes(tx: Prisma.TransactionClient, ids: string[], requestId: string, allowUntouchedRoutes = false) {
        if (!ids.length) return new Set<string>();
        const boxId = { in: ids };
        const [counts, tasks, selections, parcels] = await Promise.all([
            tx.inventoryAuditBox.findMany({ where: { boxId, status: { in: ['COUNTING', 'MISMATCH'] }, session: { status: { in: ['ACTIVE', 'REVIEW'] } } }, select: { boxId: true } }),
            tx.fbsTsdAssembly.findMany({ where: { OR: [{ boxId }, { reservedBoxId: boxId }], status: { in: ['RESERVED', 'IN_PROGRESS'] } } }),
            tx.clientRequestBoxSelection.findMany({ where: { boxId, requestItem: { request: { id: { not: requestId }, status: { in: ['APPROVED', 'IN_WORK'] } } } }, select: { boxId: true } }),
            tx.fboAssemblyBox.findMany({ where: { activeBoxId: boxId, requestId: { not: requestId } }, select: { activeBoxId: true } }),
        ]);
        return new Set([...counts.map(b => b.boxId), ...selections.map(b => b.boxId), ...parcels.map(b => b.activeBoxId),
            ...tasks.filter(t => !allowUntouchedRoutes || !untouchedFbsRoute(t)).flatMap(t => [t.boxId, t.reservedBoxId])].filter((id): id is string => !!id));
    }
    private async requireIdleBox(tx: Prisma.TransactionClient, boxId: string, requestId: string, allowUntouchedRoutes = false) {
        if ((await this.busyBoxes(tx, [boxId], requestId, allowUntouchedRoutes)).has(boxId))
            throw new ConflictException('Короб участвует в актуализации или другой активной сборке.');
    }
    private async releaseDisplacedRoutes(tx: Prisma.TransactionClient, boxId: string, boxCode: string, skuIds: string[]) {
        // FIX: release only excess untouched reservations, atomically with the successful physical pick.
        const tasks = await tx.fbsTsdAssembly.findMany({ where: { OR: [{ boxId }, { boxId: null, reservedBoxId: boxId }], status: { in: ['RESERVED', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' } });
        for (const skuId of skuIds) {
            const rows = tasks.filter(t => (t.sourceSkuId && !t.relabelConfirmedAt ? t.sourceSkuId : t.skuId) === skuId);
            const available = await tx.stockBalance.aggregate({ where: { boxId, skuId, status: 'AVAILABLE' }, _sum: { quantity: true } });
            let excess = rows.reduce((s, t) => s + Math.max(1, t.itemCount), 0) - (available._sum.quantity ?? 0);
            for (const task of [...rows].reverse()) {
                if (excess <= 0) break;
                if (!untouchedFbsRoute(task)) continue;
                const changed = await tx.fbsTsdAssembly.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, status: task.status,
                    sourceBarcode: null, barcode: null, kiz: null, relabelConfirmedAt: null }, data: {
                    ...(task.status === 'RESERVED' ? { status: 'WAITING_STOCK' } : {}),
                    boxId: null, boxCode: null, reservedBoxId: null, reservedBoxCode: null, reservedAt: null,
                    errorMessage: `Маршрут изменён: товар из короба ${boxCode} отобран в FBO. Используйте новый маршрут на экране.`,
                } });
                if (changed.count !== 1) throw new ConflictException('Маршрут изменился. Повторите сканирование.');
                excess -= Math.max(1, task.itemCount);
            }
        }
    }
    private async bindPickedMark(tx: Prisma.TransactionClient, r: Request, skuId: string, boxId: string, kiz: string, key: string, user: AuthUser) {
        const physical = physicalKizIdentity(kiz);
        if (!physical) throw new BadRequestException('Сканируйте корректный КИЗ товара.');
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`sorting-kiz:${physical}`}))`);
        const prefixes = [physical, ']d2' + physical, ']D2' + physical].map(p => p.replace(/[\\%_]/g, '\\$&'));
        const filter = { OR: prefixes.map(p => ({ kiz: { startsWith: p } })) };
        const matches = (await tx.productMark.findMany({ where: { OR: prefixes.map(p => ({ value: { startsWith: p } })) } }))
            .filter(m => identity(m.value) === physical);
        if (matches.length > 1) throw new ConflictException('КИЗ имеет несколько записей. Нужен разбор дублей.');
        const previous = matches[0];
        if (previous && (previous.clientId !== r.clientId || previous.skuId !== skuId))
            throw new ConflictException('Этот КИЗ не доступен для данного клиента и товара.');
        const oldUnits = (await tx.fboAssemblyUnit.findMany({ where: { ...filter, state: { not: 'RETURNED' } }, include: { assembly: true } }))
            .filter(u => u.kiz && identity(u.kiz) === physical);
        if (oldUnits.some(u => u.requestId === r.id)) throw new ConflictException('Этот КИЗ уже отобран в данной заявке и не доступен повторно.');
        const oldTasks = (await tx.fbsTsdAssembly.findMany({ where: filter })).filter(t => t.kiz && identity(t.kiz) === physical);
        if (oldTasks.some(t => t.clientId !== r.clientId || t.skuId !== skuId) || oldUnits.some(u => u.skuId !== skuId))
            throw new ConflictException('КИЗ связан с другим клиентом или товаром.');
        const oldBox = previous?.boxId ? await tx.box.findUnique({ where: { id: previous.boxId } }) : null;
        if (oldBox && (oldBox.clientId !== r.clientId || oldBox.warehouseId !== r.warehouseId))
            throw new ConflictException('КИЗ числится в другом филиале или у другого клиента.');
        if (oldBox && await tx.inventoryAuditBox.count({ where: { boxId: oldBox.id, status: { in: ['COUNTING', 'MISMATCH'] }, session: { status: { in: ['ACTIVE', 'REVIEW'] } } } }))
            throw new ConflictException('Прежний короб участвует в актуализации. Завершите её перед восстановлением КИЗ.');
        // FIX: retain completed shipment evidence, but invalidate unfinished physical ownership.
        for (const unit of oldUnits.filter(u => u.assembly.phase !== 'COMPLETED')) {
            await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${unit.requestId} FOR UPDATE`;
            await tx.fboAssemblyUnit.update({ where: { id: unit.id }, data: { state: 'RETURNED', activeMarkId: null } });
            await tx.fboAssembly.update({ where: { requestId: unit.requestId }, data: { phase: 'PICKING' } });
            if (unit.targetBoxId) await tx.fboAssemblyBox.updateMany({ where: { requestId: unit.requestId, boxId: unit.targetBoxId },
                data: { closedAt: null, confirmedAt: null, confirmedByUserId: null } });
        }
        for (const task of oldTasks.filter(t => !['COMPLETED', 'RELEASED', 'CANCELLED'].includes(t.status))) {
            await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: { status: 'RELEASED',
                errorMessage: `Единица физически найдена и отобрана в ФБО №${r.number}. Прежняя привязка сохранена в истории.` } });
        }
        const source = previous ? await tx.stockBalance.findFirst({ where: { clientId: r.clientId, warehouseId: r.warehouseId, skuId,
            boxId: previous.boxId, status: previous.status, quantity: { gt: 0 } }, orderBy: { id: 'asc' } }) : null;
        const physicalBalance = await tx.stockBalance.findFirst({ where: { clientId: r.clientId, warehouseId: r.warehouseId, skuId,
            boxId, status: 'AVAILABLE', quantity: { gt: 0 } } });
        // Reconcile the recorded ledger when it exists; otherwise consume the physical box's stock.
        // A historical picked/shipped identity without stock is an explicit physical recovery.
        const recover = !source && !physicalBalance && ((!!previous && previous.status !== 'AVAILABLE') || oldUnits.length > 0 || oldTasks.length > 0);
        let movementId = previous?.stockMovementId ?? null;
        if ((source && (source.boxId !== boxId || source.status !== 'AVAILABLE')) || recover) {
            if (source) {
                const changed = await tx.stockBalance.updateMany({ where: { id: source.id, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
                if (changed.count !== 1) throw new ConflictException('Остаток изменился. Повторите сканирование.');
                await tx.stockMovement.create({ data: { clientId: r.clientId, warehouseId: r.warehouseId, skuId, boxId: source.boxId,
                    palletId: source.palletId, status: source.status, type: 'INVENTORY_ADJUSTMENT', quantity: -1,
                    sourceDocument: r.id, idempotencyKey: `${key}:kiz-rebind:out`, comment: 'ФБО: исправление привязки по физическому скану КИЗ' } });
            }
            const target = await tx.box.findUniqueOrThrow({ where: { id: boxId } });
            const dimensions = { clientId: r.clientId, warehouseId: r.warehouseId, skuId, boxId, palletId: target.palletId, status: StockStatus.AVAILABLE };
            const balanceKey = this.balances.balanceKey(dimensions);
            await tx.stockBalance.upsert({ where: { balanceKey }, create: { ...dimensions, balanceKey, quantity: 1 }, update: { quantity: { increment: 1 } } });
            movementId = (await tx.stockMovement.create({ data: { ...dimensions, type: 'INVENTORY_ADJUSTMENT', quantity: 1,
                sourceDocument: r.id, idempotencyKey: `${key}:kiz-rebind:in`, comment: 'ФБО: единица физически подтверждена сканированием КИЗ' } })).id;
            if (source?.status === 'AVAILABLE' && oldBox && oldBox.id !== boxId)
                await this.releaseDisplacedRoutes(tx, oldBox.id, oldBox.code, [skuId]);
        }
        const mark = previous
            ? await tx.productMark.update({ where: { id: previous.id }, data: { boxId, status: 'AVAILABLE', stockMovementId: movementId } })
            : await tx.productMark.create({ data: { clientId: r.clientId, skuId, boxId, value: kiz.trim(), status: 'AVAILABLE', sourceDocument: `FBO-PICK:${r.id}` } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_PICK_KIZ_BOUND', entity: 'ClientRequest', entityId: r.id,
            payload: { operationId: key, identity: physical, markId: mark.id, sourceBoxId: boxId, recovered: recover,
                previousMark: previous ? { id: previous.id, boxId: previous.boxId, status: previous.status, stockMovementId: previous.stockMovementId } : null,
                previousFbsTasks: oldTasks.map(t => ({ id: t.id, requestId: t.requestId, orderId: t.orderId, status: t.status })),
                previousFboUnits: oldUnits.map(u => ({ id: u.id, requestId: u.requestId, state: u.state, phase: u.assembly.phase, targetBoxId: u.targetBoxId })) } } });
        return mark;
    }
    private async exactMark(tx: Prisma.TransactionClient, kiz: string) {
        const key = identity(kiz);
        const rows = await tx.productMark.findMany({ where: { OR: [key, ']d2' + key, ']D2' + key].map(p => ({ value: { startsWith: p.replace(/[\\%_]/g, '\\$&') } })) } });
        const matches = rows.filter(m => identity(m.value) === key);
        if (matches.length !== 1)
            throw new ConflictException('КИЗ отсутствует или имеет несколько записей. Нужна актуализация.');
        return matches[0];
    }
    private async move(tx: Prisma.TransactionClient, r: Request, skuId: string, from: string, to: string, sourceStatus: StockStatus, targetStatus: StockStatus, quantity: number, key: string, user: AuthUser) {
        const rows = await tx.stockBalance.findMany({ where: { clientId: r.clientId, warehouseId: r.warehouseId, skuId, boxId: from, status: sourceStatus, quantity: { gt: 0 } }, orderBy: { id: 'asc' } });
        let left = quantity;
        for (const b of rows) {
            const take = Math.min(left, b.quantity);
            if (!take)
                continue;
            const changed = await tx.stockBalance.updateMany({ where: { id: b.id, quantity: { gte: take } }, data: { quantity: { decrement: take } } });
            if (changed.count !== 1)
                throw new ConflictException('Остаток изменился. Обновите задание.');
            await tx.stockMovement.create({ data: { clientId: r.clientId, warehouseId: r.warehouseId, skuId, boxId: from, palletId: b.palletId, status: sourceStatus, type: 'MOVE', quantity: -take, sourceDocument: r.id, idempotencyKey: `${key}:${b.id}:out`, comment: `ФБО: ${user.name || user.id}` } });
            left -= take;
        }
        if (left)
            throw new ConflictException('Нет доступного остатка. Выполните актуализацию исходного короба.');
        const target = await tx.box.findUniqueOrThrow({ where: { id: to } });
        const dimensions = { clientId: r.clientId, warehouseId: r.warehouseId, skuId, boxId: to, palletId: target.palletId, status: targetStatus };
        const balanceKey = this.balances.balanceKey(dimensions);
        await tx.stockBalance.upsert({ where: { balanceKey }, create: { ...dimensions, balanceKey, quantity }, update: { quantity: { increment: quantity } } });
        return tx.stockMovement.create({ data: { ...dimensions, type: 'MOVE', quantity, sourceDocument: r.id, idempotencyKey: `${key}:in`, comment: `ФБО: ${user.name || user.id}` } });
    }
    private async validatePackedBox(tx: Prisma.TransactionClient, r: Request, boxId: string, units: Array<{
        targetBoxId: string | null;
        skuId: string;
        markId: string | null;
        state: string;
    }>) {
        await this.box(tx, r, (await tx.box.findUniqueOrThrow({ where: { id: boxId } })).code);
        const expected = units.filter(u => u.targetBoxId === boxId && u.state === 'PACKED');
        const balances = await tx.stockBalance.findMany({ where: { boxId, quantity: { not: 0 } } });
        const actual: Record<string, number> = {};
        for (const b of balances) {
            if (b.status !== 'PACKING' || b.clientId !== r.clientId || b.warehouseId !== r.warehouseId)
                throw new ConflictException('В коробе появился посторонний остаток.');
            actual[b.skuId] = (actual[b.skuId] ?? 0) + b.quantity;
        }
        const wanted: Record<string, number> = {};
        for (const u of expected)
            wanted[u.skuId] = (wanted[u.skuId] ?? 0) + 1;
        if (Object.keys(actual).length !== Object.keys(wanted).length || Object.entries(wanted).some(([s, n]) => actual[s] !== n))
            throw new ConflictException('Состав короба изменился после упаковки.');
        const marks = await tx.productMark.findMany({ where: { boxId, status: { not: 'SHIPPING' } } });
        if (marks.length !== expected.filter(u => u.markId).length || marks.some(m => m.status !== 'PACKING' || !expected.some(u => u.markId === m.id && u.skuId === m.skuId)))
            throw new ConflictException('КИЗ короба изменились после упаковки.');
    }
    async wbFile(id: string, user: AuthUser) {
        const plan = await this.plan(id, user);
        if (plan.phase !== 'COMPLETED')
            throw new ConflictException('Сначала подтвердите все короба поставки.');
        return this.files.getWbPackagingTemplate(id, user);
    }
}
