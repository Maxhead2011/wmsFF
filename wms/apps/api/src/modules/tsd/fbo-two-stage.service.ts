import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { closedFboItems, fboClosePickEnabled, fboTwoStageEnabled, hasLegacyFboProgress, isFboTwoStageRequest, remainingFboLines, wholeBoxDecision, prioritizeFboWholeBoxes } from './fbo-two-stage-policy';
import { FboActionDto } from './dto/fbo-action.dto';
import { FboRouteContext, fboLocalRouteEnabled, prioritizeFboLocation } from './fbo-local-route';
import type { RecoveryInput } from '../administration/fbo-problems-policy';
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
// FIX: opt-in for our WMS; reusable rack bins are never shipping cartons.
const reusablePackingEnabled = () => process.env.WMS_FBO_REUSABLE_PACKING_ENABLED === 'true';
const reusableBin = (code: string) => /^FFL_LKBBOX_/i.test(code);
const composition = (r: Request) => hash(r.items.map(i => [i.id, i.skuId, i.barcode, i.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
@Injectable()
export class FboTwoStageService {
    constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly balances: StockBalancesService, private readonly stock: StockOperationsService, private readonly lock: InventoryLockService, private readonly files: ClientRequestMarketplaceFilesService) { }
    // FIX: administrative recovery reuses exactly the same transactional packing invariants.
    // The administration service authorizes, locks, checks preview freshness and records the receipt.
    async recoverInTransaction(tx: Prisma.TransactionClient, id: string, input: RecoveryInput, user: AuthUser, key: string) {
        await this.lock.assertStockMovementsAllowed();
        const proxy = new Proxy(tx, { get: (o, k) => k === '$transaction' ? async (fn: (db: Prisma.TransactionClient) => unknown) => fn(tx) : o[k as keyof typeof o] }) as PrismaService;
        const svc = new FboTwoStageService(proxy, this.scopes, this.balances, this.stock, this.lock, this.files);
        const r = await this.load(tx, id, user, 'write'); this.requireFbo(r);
        const assembly = await tx.fboAssembly.findUniqueOrThrow({ where: { requestId: id } });
        if (!['PICKING','PACKING','CONTROL'].includes(assembly.phase) || !['SUBMITTED','APPROVED','IN_WORK'].includes(r.status)) throw new ConflictException('Заявка уже завершена или недоступна.');
        let sequence = 0;
        const act = (action: string, fields: Partial<FboActionDto> = {}) => svc.act(id, { action, operationId: `${key}:${sequence++}`, ...fields }, user);
        const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: id, state: { not: 'RETURNED' } } });
        const select = (codes: string[], supplied?: string[]) => {
            if (supplied?.some(c => !codes.includes(c))) throw new ConflictException('Выбранный короб больше не доступен для действия.');
            return supplied?.length ? supplied : codes;
        };
        const packing = async () => {
            if (!['PACKING','CONTROL'].includes(assembly.phase)) throw new ConflictException('Сначала завершите отбор.');
            if (assembly.phase === 'CONTROL') await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'PACKING' } });
        };
        if (input.action === 'CLOSE_PICK') return act('STOP_PICK');
        if (input.action === 'ADD_BOXES') {
            await packing();
            for (const code of select([...new Set(units.filter(u=>u.state==='PICKED'&&u.wholeBox).map(u=>u.sourceBoxCode))],input.boxCodes)) await act('PACK_BOX',{sourceBoxCode:code});
        } else if (input.action === 'SPLIT_BOXES') {
            await packing();
            for(const code of select([...new Set(units.filter(u=>u.state==='PICKED'&&u.wholeBox).map(u=>u.sourceBoxCode))],input.boxCodes)) {
                const source=units.find(u=>u.sourceBoxCode===code)!;
                await this.unpackPickedWholeBox(tx,r,source.sourceBoxId,user,`${key}:split:${source.sourceBoxId}`);
            }
        } else if (input.action === 'PACK_UNITS') {
            await packing();
            const chosen=units.filter(u=>input.unitIds!.includes(u.id));
            if(chosen.length!==input.unitIds!.length||chosen.some(u=>u.state!=='PICKED')) throw new ConflictException('Выбранные единицы уже изменены.');
            const parcel=await tx.fboAssemblyBox.findUnique({where:{requestId_boxCode:{requestId:id,boxCode:input.targetBoxCode!}}});
            if(!parcel||parcel.wholeBox) throw new ConflictException('Выберите сформированный короб поштучной упаковки.');
            await this.requireIdleBox(tx,parcel.boxId,id);
            await tx.fboAssemblyBox.update({where:{id:parcel.id},data:{closedAt:null,confirmedAt:null,confirmedByUserId:null}});
            const split = new Set<string>();
            for(const unit of chosen) {
                if(unit.wholeBox && !split.has(unit.sourceBoxId)) {
                    await this.unpackPickedWholeBox(tx,r,unit.sourceBoxId,user,`${key}:split:${unit.sourceBoxId}`);
                    split.add(unit.sourceBoxId);
                }
                if (unit.kiz) await act('PACK_UNIT',{targetBoxCode:parcel.boxCode,barcode:unit.barcode,kiz:unit.kiz});
                else {
                    // FIX: preserve the selected unit identity for unmarked stock too.
                    const holding = await tx.box.findUniqueOrThrow({where:{code:`FBO-PICK-${id}`}});
                    await this.move(tx,r,unit.skuId,holding.id,parcel.boxId,'PACKING','PACKING',1,`${key}:unit:${unit.id}`,user);
                    await tx.fboAssemblyUnit.update({where:{id:unit.id},data:{state:'PACKED',targetBoxId:parcel.boxId,targetBoxCode:parcel.boxCode,packedAt:new Date(),packedByUserId:user.id}});
                }
            }
            await this.validatePackedBox(tx,r,parcel.boxId,await tx.fboAssemblyUnit.findMany({where:{requestId:id}}));
            if(parcel.closedAt) await act('CLOSE_BOX',{targetBoxCode:parcel.boxCode});
        } else if(input.action==='CONFIRM_BOXES') {
            if(!['PACKING','CONTROL'].includes(assembly.phase)) throw new ConflictException('Сначала завершите отбор.');
            const parcels=await tx.fboAssemblyBox.findMany({where:{requestId:id}});
            for(const code of select(parcels.map(b=>b.boxCode),input.boxCodes)) {
                const b=parcels.find(b=>b.boxCode===code)!;
                if(!units.some(u=>u.targetBoxId===b.boxId&&u.state==='PACKED')) throw new ConflictException(`Пустой короб ${code}.`);
                try{await this.validatePackedBox(tx,r,b.boxId,units);}catch(e){throw new ConflictException(`${code}: ${(e as Error).message}`);}
                await tx.fboAssemblyBox.update({where:{id:b.id},data:{closedAt:b.closedAt??new Date(),confirmedAt:b.confirmedAt??new Date(),confirmedByUserId:b.confirmedByUserId??user.id}});
            }
        } else if(input.action==='FINISH') {
            if(assembly.phase==='PACKING') await act('SORTED');
            await act('FINISH');
            // FIX: both documents must be constructible before committing completion.
            const documents = new ClientRequestMarketplaceFilesService(proxy,this.scopes);
            await documents.getWbProductsTemplate(id,user);
            await documents.getWbPackagingTemplate(id,user);
        }
    }
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
    async plan(id: string, user: AuthUser, context: FboRouteContext = {}) {
        if (!fboTwoStageEnabled())
            throw new NotFoundException('Двухэтапная сборка ФБО выключена.');
        return this.prisma.$transaction(async (tx) => {
            const r = await this.load(tx, id, user, 'read');
            this.requireFbo(r);
            return this.snapshot(tx, r, context);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
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
    private async snapshot(tx: Prisma.TransactionClient, r: Request, context: FboRouteContext = {}) {
        const assembly = await tx.fboAssembly.findUnique({ where: { requestId: r.id }, include: { units: true, boxes: true } });
        const units = assembly?.units ?? [];
        const lines = remainingFboLines(closedFboItems(r.items, assembly?.pickClosure), units).map(i => ({ id: i.id, skuId: i.skuId!, barcode: i.barcode!,
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
        const prioritized = prioritizeFboLocation(boxes.filter(b => !busyBoxes.has(b.id)), demand,
            fboLocalRouteEnabled() ? context : {}, (candidates, needed) => prioritizeFboWholeBoxes(candidates, needed, (box, remaining) =>
            wholeBoxDecision(box.balances, remaining, box.productMarks.map(m => ({ ...m, identity: identity(m.value) })),
                box.productMarks.length > 0 || lines.some(l => l.requiresKiz && box.balances.some(b => b.quantity > 0 && b.skuId === l.skuId)))));
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
        return { localRouteEnabled: fboLocalRouteEnabled(), reusablePackingEnabled: reusablePackingEnabled(), manualPackingEnabled: process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true', requestId: r.id, title: r.title, phase: assembly?.phase ?? 'NOT_STARTED', lines, route,

            // FIX: existing terminals receive the actual packing target; WMS also retains the original plan.
            closePickSupported: fboClosePickEnabled(), pickClosed: !!assembly?.pickClosure,
            plannedNeeded: r.items.reduce((s, i) => s + i.quantity, 0),
            unpicked: assembly?.pickClosure ? r.items.reduce((s, i) => s + i.quantity, 0) - lines.reduce((s, l) => s + l.needed, 0) : 0,
            packingNeeded: lines.reduce((s, l) => s + l.needed, 0),
            needed: lines.reduce((s, l) => s + l.needed, 0), picked: lines.reduce((s, l) => s + l.picked, 0), packed: lines.reduce((s, l) => s + l.packed, 0),
            looseRemaining: units.filter(u => !u.wholeBox && u.state === 'PICKED').length,
            wholeBoxes: [...new Set(units.filter(u => u.wholeBox && u.state === 'PICKED').map(u => u.sourceBoxCode))],
            boxes: (assembly?.boxes ?? []).map(b => ({ code: b.boxCode, wholeBox: b.wholeBox, closed: !!b.closedAt, confirmed: !!b.confirmedAt,
                quantity: units.filter(u => u.targetBoxId === b.boxId && u.state === 'PACKED').length })),
            shortage: Object.values(demand).reduce((s, n) => s + n, 0), compositionChanged: !!assembly && assembly.compositionHash !== composition(r) };
    }
    async act(id: string, dto: FboActionDto, user: AuthUser) {
        if (!fboTwoStageEnabled())
            throw new NotFoundException('Двухэтапная сборка ФБО выключена.');
        // FIX: explicitly enabled only for our deployment; old clients and sold VMs retain their behavior.
        if (dto.action.startsWith('MANUAL_') && process.env.WMS_FBO_MANUAL_PACKING_ENABLED !== 'true')
            throw new BadRequestException('Ручное добавление при упаковке выключено.');
        await this.lock.assertStockMovementsAllowed();
        // FIX: one durable operation id and a request lock make retries and concurrent terminals safe.
        const execute = () => this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "ClientRequest" WHERE "id"=${id} FOR UPDATE`;
            const r = await this.load(tx, id, user, 'write');
            this.requireFbo(r);
            // FIX: persisted JSON can change property order after a terminal restart.
            const key = `${id}:${dto.operationId}`, payloadHash = hash([
                dto.action, dto.sourceBoxCode ?? null, dto.targetBoxCode ?? null, dto.barcode ?? null, dto.kiz ?? null, dto.palletCode ?? null,
                ...(dto.confirmedQuantity === undefined ? [] : [dto.confirmedQuantity]),
            ]);
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
            const lines = remainingFboLines(closedFboItems(r.items, a.pickClosure), units);
            const requirePhase = (phase: string) => { if (a!.phase !== phase)
                throw new ConflictException('Этап изменился. Обновите заявку.'); };
            if (dto.action === 'PICK_UNIT' || dto.action === 'PICK_BOX') {
                requirePhase('PICKING');
                const source = await this.box(tx, r, dto.sourceBoxCode);
                await this.requireIdleBox(tx, source.id, id, true);
                const location = await tx.box.findUniqueOrThrow({ where: { id: source.id }, include: { pallet: true, storagePlacement: { include: { pallet: true } } } });
                const palletCode = location.storagePlacement?.pallet.code ?? location.pallet?.code;
                if (palletCode && dto.palletCode !== palletCode)
                    throw new ConflictException('Сначала отсканируйте паллет, на котором сейчас находится этот короб.');
                const balances = await tx.stockBalance.findMany({ where: { boxId: source.id, clientId: r.clientId, warehouseId: r.warehouseId } });
                const marks = await tx.productMark.findMany({ where: { boxId: source.id, status: { not: 'SHIPPING' } } });
                const allContents = dto.action === 'PICK_BOX';
                const whole = allContents && !(reusablePackingEnabled() && reusableBin(source.code));
                let chosen: Array<{
                    skuId: string;
                    mark: typeof marks[number] | null;
                }> = [];
                if (allContents) {
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
                    const mark = dto.kiz ? await this.exactMark(tx, dto.kiz) : null;
                    if (mark && (mark.clientId !== r.clientId || mark.skuId !== line.skuId || mark.boxId !== source.id || mark.status !== 'AVAILABLE'))
                        throw new ConflictException('Этот КИЗ не доступен в указанном коробе для данного товара.');
                    chosen = [{ skuId: line.skuId!, mark }];
                }
                const holding = whole ? source : await tx.box.upsert({ where: { code: `FBO-PICK-${id}` }, create: { code: `FBO-PICK-${id}`, clientId: r.clientId, warehouseId: r.warehouseId, status: 'fbo-picking' }, update: {} });
                const pickedUnitIds: string[] = [];
                for (const pick of chosen) {
                    const line = lines.find(l => l.skuId === pick.skuId && l.remaining > 0)!;
                    line.remaining--;
                    if (pick.mark) {
                        const resolved = await this.exactMark(tx, pick.mark.value);
                        if (resolved.id !== pick.mark.id)
                            throw new ConflictException('Неоднозначный КИЗ.');
                    }
                    const unitId = randomUUID();
                    pickedUnitIds.push(unitId);
                    const movement = await this.move(tx, r, pick.skuId, source.id, holding.id, 'AVAILABLE', 'PACKING', 1, `${key}:${unitId}`, user);
                    if (pick.mark) {
                        const changed = await tx.productMark.updateMany({ where: { id: pick.mark.id, boxId: source.id, status: 'AVAILABLE' }, data: { boxId: holding.id, status: 'PACKING', stockMovementId: movement.id } });
                        if (changed.count !== 1)
                            throw new ConflictException('КИЗ уже отобран другим сотрудником.');
                    }
                    await tx.fboAssemblyUnit.create({ data: { id: unitId, requestId: id, requestItemId: line.id, skuId: pick.skuId, barcode: line.barcode!,
                            markId: pick.mark?.id, activeMarkId: pick.mark?.id, kiz: pick.mark?.value, sourceBoxId: source.id, sourceBoxCode: source.code, wholeBox: whole, pickedByUserId: user.id } });
                }
                if (process.env.WMS_FBO_PROBLEMS_ENABLED === 'true') {
                    const location = await tx.box.findUniqueOrThrow({where:{id:source.id},include:{storagePlacement:{include:{pallet:true}},pallet:true}});
                    await tx.auditLog.create({data:{userId:user.id,entity:'ClientRequest',entityId:id,action:'FBO_PICK_LOCATION',payload:{unitIds:pickedUnitIds,operationId:dto.operationId,whole,pallet:location.storagePlacement?.pallet.code ?? location.pallet?.code ?? null}}});
                }
                await this.releaseDisplacedRoutes(tx, source.id, source.code, [...new Set(chosen.map(p => p.skuId))]);
            }
            else if (dto.action === 'STOP_PICK') {
                // FIX: serialized with scans, frozen once, and replayed through the durable receipt above.
                if (!fboClosePickEnabled()) throw new NotFoundException('Завершение отбора с недобором выключено.');
                requirePhase('PICKING');
                if (!units.length) throw new ConflictException('Нет отобранного товара. Пустую заявку нельзя передать на упаковку.');
                const pickClosure = { version: 1, userId: user.id, closedAt: new Date().toISOString(),
                    quantities: Object.fromEntries(lines.map(l => [l.id, l.picked])),
                    requested: Object.fromEntries(r.items.map(i => [i.id, i.quantity])) };
                closedFboItems(r.items, pickClosure);
                await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'PACKING', pickClosure } });
                await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_PICK_CLOSED', entity: 'ClientRequest', entityId: id, payload: pickClosure } });
            }
            else if (dto.action === 'FINISH_PICK') {
                requirePhase('PICKING');
                if (lines.some(l => l.remaining))
                    throw new ConflictException('Сначала отберите все единицы заявки.');
                await tx.fboAssembly.update({ where: { requestId: id }, data: { phase: 'PACKING' } });
            }
            else if (dto.action === 'OPEN_BOX' || dto.action === 'MANUAL_OPEN_BOX') {
                requirePhase('PACKING');
                const target = await this.target(tx, r, dto.targetBoxCode);
                await this.requireIdleBox(tx, target.id, id);
                const previousBox = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (previousBox) {
                    // FIX: selecting a closed carton explicitly in manual mode reopens it for additions.
                    const reopen = reusablePackingEnabled() && process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true' && dto.action === 'MANUAL_OPEN_BOX';
                    // FIX: a normal repeated carton scan is not an attempt to reopen it manually.
                    if (reusablePackingEnabled() && !reopen && previousBox.requestId === id && previousBox.closedAt)
                        throw new ConflictException('Данный короб уже упакован в поставку');
                    if (previousBox.requestId !== id || (!reopen && (previousBox.closedAt || previousBox.wholeBox)))
                        throw new ConflictException('Короб уже закрыт или принадлежит другой сборке.');
                    if (reopen && (previousBox.closedAt || previousBox.wholeBox || previousBox.confirmedAt)) {
                        await tx.fboAssemblyBox.update({ where: { id: previousBox.id }, data: { closedAt: null, confirmedAt: null, confirmedByUserId: null, wholeBox: false } });
                        await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_PACKING_BOX_REOPENED', entity: 'ClientRequest', entityId: id,
                            payload: { operationId: dto.operationId, boxCode: target.code, previousClosedAt: previousBox.closedAt?.toISOString(),
                                previousConfirmedAt: previousBox.confirmedAt?.toISOString(), previousWholeBox: previousBox.wholeBox, quantity: units.filter(u => u.targetBoxId === target.id && u.state === 'PACKED').length } } });
                    }
                }
                else {
                    if (await tx.stockBalance.count({ where: { boxId: target.id, quantity: { not: 0 } } }) || await tx.productMark.count({ where: { boxId: target.id } }))
                        throw new ConflictException('Для упаковки нужен пустой короб.');
                    if (dto.action !== 'MANUAL_OPEN_BOX' && !units.some(u => u.state === 'PICKED' && (!u.wholeBox || process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true' && !!u.markId)))
                        throw new ConflictException('Все отдельные единицы уже вложены.');
                    await tx.fboAssemblyBox.create({ data: { requestId: id, boxId: target.id, activeBoxId: target.id, boxCode: target.code } });
                }
            }
            else if (dto.action === 'MANUAL_PACK_UNIT') {
                requirePhase('PACKING');
                await this.manualPack(tx, r, dto, user, key);
            }
            else if (dto.action === 'PACK_UNIT') {
                requirePhase('PACKING');
                const target = await this.box(tx, r, dto.targetBoxCode);
                const parcel = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (!parcel || parcel.requestId !== id || parcel.closedAt || parcel.wholeBox)
                    throw new ConflictException('Сначала откройте короб для упаковки.');
                const mark = dto.kiz ? await this.exactMark(tx, dto.kiz) : null;
                // FIX: a whole-picked box may be poured into the packing pile; never debit AVAILABLE twice.
                if (process.env.WMS_FBO_MANUAL_PACKING_ENABLED === 'true' && mark && units.some(u => u.wholeBox && u.state === 'PICKED' && u.markId === mark.id)) {
                    await this.manualPack(tx, r, dto, user, key);
                } else {
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
            }
            else if (dto.action === 'PACK_BOX') {
                requirePhase('PACKING');
                const box = await this.box(tx, r, dto.sourceBoxCode);
                if (reusablePackingEnabled() && reusableBin(box.code))
                    throw new ConflictException('Бокс — ячейка стеллажа. Упакуйте отобранный товар поштучно в отгрузочные короба.');
                // FIX: distinguish a duplicate physical scan from an unrelated source carton.
                if (reusablePackingEnabled() && units.some(u => u.targetBoxId === box.id && u.state === 'PACKED'))
                    throw new ConflictException('Данный короб уже упакован в поставку');
                const picked = units.filter(u => u.wholeBox && u.sourceBoxId === box.id && u.state === 'PICKED');
                if (!picked.length)
                    throw new ConflictException('Этот короб не отобран целиком или уже добавлен.');
                await tx.fboAssemblyBox.create({ data: { requestId: id, boxId: box.id, activeBoxId: box.id, boxCode: box.code, wholeBox: true, closedAt: new Date() } });
                await tx.fboAssemblyUnit.updateMany({ where: { id: { in: picked.map(u => u.id) } }, data: { state: 'PACKED', targetBoxId: box.id, targetBoxCode: box.code, packedAt: new Date(), packedByUserId: user.id } });
            }
            else if (dto.action === 'CANCEL_EMPTY_BOX') {
                requirePhase('PACKING');
                const target = await this.box(tx, r, dto.targetBoxCode);
                const b = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
                if (!b || b.requestId !== id || b.closedAt || units.some(u => u.targetBoxId === target.id) || await tx.stockBalance.count({ where: { boxId: target.id, quantity: { not: 0 } } }) || await tx.productMark.count({ where: { boxId: target.id } }))
                    throw new ConflictException('Отложить можно только пустой открытый короб этой заявки.');
                await tx.fboAssemblyBox.delete({ where: { id: b.id } });
            }
            else if (dto.action === 'CLOSE_BOX') {
                requirePhase('PACKING');
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
        // FIX: retry only rolled-back serialization conflicts, retaining the durable operation id.
        for (let attempt = 0; ; attempt++) {
            try { await execute(); break; }
            catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2)
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
            }
        }
        return this.plan(id, user, dto);
    }
    // FIX: recover a missed physical pick and pack atomically using the exact scanned mark.
    private async manualPack(tx: Prisma.TransactionClient, r: Request, dto: FboActionDto, user: AuthUser, key: string) {
        if (!dto.kiz || !dto.barcode) throw new BadRequestException('Отсканируйте ШК и КИЗ товара.');
        let mark = await this.manualPackingMark(tx, r, dto, user);
        const sku = await tx.sku.findUnique({ where: { id: mark.skuId }, include: { barcodes: true } });
        if (mark.clientId !== r.clientId || !sku || sku.clientId !== r.clientId ||
            !sku.barcodes.some(b => b.value === dto.barcode) && !r.items.some(i => i.skuId === sku.id && i.barcode === dto.barcode))
            throw new ConflictException('КИЗ не относится к этому товару или клиенту заявки.');
        const target = await this.box(tx, r, dto.targetBoxCode);
        await this.requireIdleBox(tx, target.id, r.id);
        const parcel = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
        if (!parcel || parcel.requestId !== r.id || parcel.closedAt || parcel.wholeBox)
            throw new ConflictException('Сначала откройте короб для ручного добавления.');
        const existing = await tx.fboAssemblyUnit.findUnique({ where: { activeMarkId: mark.id } });
        if (existing && (existing.requestId !== r.id || existing.state !== 'PICKED'))
            throw new ConflictException(existing.requestId === r.id && existing.state === 'PACKED'
                ? `Товар уже упакован в короб ${existing.targetBoxCode}.`
                : 'КИЗ уже отобран в другой короб или другую сборку.');
        if (existing?.wholeBox) {
            await this.unpackPickedWholeBox(tx, r, existing.sourceBoxId, user, key);
            mark = await tx.productMark.findUniqueOrThrow({ where: { id: mark.id } });
        }
        let source;
        if (existing) {
            source = await tx.box.findUniqueOrThrow({ where: { code: `FBO-PICK-${r.id}` } });
            if (mark.status !== 'PACKING' || mark.boxId !== source.id)
                throw new ConflictException('КИЗ перемещён после отбора. Нужна сверка.');
        } else {
            if (mark.status !== 'AVAILABLE' || !mark.boxId)
                throw new ConflictException('КИЗ не имеет доступного складского остатка.');
            const recordedSource = await tx.box.findUniqueOrThrow({ where: { id: mark.boxId } });
            source = await this.box(tx, r, recordedSource.code);
            await this.requireIdleBox(tx, source.id, r.id, true);
        }
        if (source.id === target.id) throw new ConflictException('Исходный короб совпадает с коробом упаковки. Нужна сверка.');
        const movement = await this.move(tx, r, sku.id, source.id, target.id, existing ? 'PACKING' : 'AVAILABLE', 'PACKING', 1, key, user);
        const changed = await tx.productMark.updateMany({ where: { id: mark.id, boxId: source.id, status: existing ? 'PACKING' : 'AVAILABLE' },
            data: { boxId: target.id, status: 'PACKING', stockMovementId: movement.id } });
        if (changed.count !== 1) throw new ConflictException('КИЗ уже перемещён другим сотрудником.');
        const packed = { state: 'PACKED' as const, targetBoxId: target.id, targetBoxCode: target.code, packedAt: new Date(), packedByUserId: user.id };
        if (existing) {
            await tx.fboAssemblyUnit.update({ where: { id: existing.id }, data: packed });
        } else {
            const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: r.id, state: { not: 'RETURNED' } } });
            const lines = remainingFboLines(r.items, units);
            let line = r.items.find(i => i.skuId === sku.id && lines.some(l => l.id === i.id && l.remaining > 0)) ?? r.items.find(i => i.skuId === sku.id);
            let addedQuantity = 0;
            if (line) {
                if (!lines.some(l => l.id === line!.id && l.remaining > 0)) {
                    await tx.clientRequestItem.update({ where: { id: line.id }, data: { quantity: { increment: 1 } } });
                    addedQuantity = 1;
                }
            } else {
                line = await tx.clientRequestItem.create({ data: { requestId: r.id, skuId: sku.id, barcode: dto.barcode, name: sku.name, quantity: 1,
                    comment: 'Добавлено вручную при упаковке FBO' }, include: { sku: { include: { barcodes: true } } } });
                addedQuantity = 1;
            }
            await tx.fboAssemblyUnit.create({ data: { requestId: r.id, requestItemId: line.id, skuId: sku.id, barcode: line.barcode!,
                markId: mark.id, activeMarkId: mark.id, kiz: mark.value, sourceBoxId: source.id, sourceBoxCode: source.code,
                wholeBox: false, pickedByUserId: user.id, ...packed } });
            const refreshed = await this.load(tx, r.id, user, 'write');
            // FIX: a recovered manual unit must join the closed packing target as well.
            const assembly = await tx.fboAssembly.findUniqueOrThrow({where:{requestId:r.id}});
            let pickClosure: Prisma.InputJsonObject | undefined;
            if (assembly.pickClosure) {
                const quantities = Object.fromEntries(closedFboItems(r.items, assembly.pickClosure).map(i=>[i.id,i.quantity]));
                quantities[line.id] = Math.max(quantities[line.id] ?? 0, units.filter(u=>u.requestItemId===line!.id).length + 1);
                pickClosure = {...(assembly.pickClosure as Prisma.JsonObject),quantities};
                closedFboItems(refreshed.items,pickClosure as Prisma.JsonObject);
            }
            await tx.fboAssembly.update({ where: { requestId: r.id }, data: { compositionHash: composition(refreshed),...(pickClosure?{pickClosure}:{}) } });
            await this.releaseDisplacedRoutes(tx, source.id, source.code, [sku.id]);
            await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_MANUAL_PICK_RECOVERED', entity: 'ClientRequest', entityId: r.id,
                payload: { operationId: dto.operationId, sourceBoxCode: source.code, targetBoxCode: target.code, markId: mark.id, barcode: dto.barcode, addedQuantity } } });
        }
    }
    // FIX: change packing representation of already picked stock, atomically with the first unit scan.
    private async unpackPickedWholeBox(tx: Prisma.TransactionClient, r: Request, sourceId: string, user: AuthUser, key: string) {
        const source = await tx.box.findUniqueOrThrow({ where: { id: sourceId } });
        await this.box(tx, r, source.code);
        await this.requireIdleBox(tx, source.id, r.id);
        if (await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: source.id } }))
            throw new ConflictException('Короб уже включён в упаковку. Сначала требуется разбор его упаковки.');
        const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: r.id, sourceBoxId: source.id, wholeBox: true, state: 'PICKED' } });
        if (!units.length) throw new ConflictException('Короб уже изменён. Обновите упаковку.');
        const holding = await tx.box.upsert({ where: { code: `FBO-PICK-${r.id}` },
            create: { code: `FBO-PICK-${r.id}`, clientId: r.clientId, warehouseId: r.warehouseId, status: 'fbo-picking' }, update: {} });
        for (const skuId of [...new Set(units.map(u => u.skuId))]) {
            const group = units.filter(u => u.skuId === skuId);
            const markIds = group.map(u => u.markId).filter((id): id is string => !!id);
            const movement = await this.move(tx, r, skuId, source.id, holding.id, 'PACKING', 'PACKING', group.length, `${key}:unpack:${skuId}`, user);
            if (markIds.length) {
                const moved = await tx.productMark.updateMany({ where: { id: { in: markIds }, clientId: r.clientId, skuId, boxId: source.id, status: 'PACKING' },
                    data: { boxId: holding.id, stockMovementId: movement.id } });
                if (moved.count !== markIds.length) throw new ConflictException('Состав КИЗ исходного короба изменился. Товар не перенесён.');
            }
        }
        await tx.fboAssemblyUnit.updateMany({ where: { id: { in: units.map(u => u.id) } }, data: { wholeBox: false } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_WHOLE_BOX_OPENED', entity: 'ClientRequest', entityId: r.id,
            payload: { sourceBoxCode: source.code, holdingBoxCode: holding.code, quantity: units.length, packingOperation: key, repeatedWarehouseDebit: false } } });
    }
    // FIX: an unknown scanned mark can claim only unmarked stock from evidenced sources of this assembly.
    private async manualPackingMark(tx: Prisma.TransactionClient, r: Request, dto: FboActionDto, user: AuthUser) {
        const key = identity(dto.kiz!);
        const rows = await tx.productMark.findMany({ where: { OR: [key, ']d2' + key, ']D2' + key]
            .map(prefix => ({ value: { startsWith: prefix.replace(/[\\%_]/g, '\\$&') } })) } });
        const matches = rows.filter(m => identity(m.value) === key);
        if (matches.length > 1) throw new ConflictException('Несколько записей этого КИЗ. Отмените скан и передайте товар администратору.');
        if (matches.length === 1) return matches[0];
        if (!physicalKizIdentity(dto.kiz!)) throw new BadRequestException('Не распознан КИЗ. Отсканируйте маркировку товара.');
        const skus = await tx.sku.findMany({ where: { clientId: r.clientId, barcodes: { some: { value: dto.barcode! } } } });
        if (skus.length !== 1) throw new ConflictException('ШК не определяет единственный товар клиента. Отмените скан.');
        const sku = skus[0];
        // A prior pick or explicit selection proves association with this request; never guess across all warehouse boxes.
        const [picked, selected] = await Promise.all([
            tx.fboAssemblyUnit.findMany({ where: { requestId: r.id, skuId: sku.id, state: { not: 'RETURNED' } }, select: { sourceBoxId: true } }),
            tx.clientRequestBoxSelection.findMany({ where: { requestItem: { requestId: r.id, skuId: sku.id } }, select: { boxId: true } }),
        ]);
        const ids = [...new Set([...picked.map(x => x.sourceBoxId), ...selected.map(x => x.boxId)].filter((x): x is string => !!x))];
        const candidates = await tx.box.findMany({ where: { id: { in: ids }, clientId: r.clientId, warehouseId: r.warehouseId,
            status: 'active', code: { not: dto.targetBoxCode! } }, orderBy: { code: 'asc' } });
        for (const candidate of candidates) {
            const source = await this.box(tx, r, candidate.code);
            if ((await this.busyBoxes(tx, [source.id], r.id, true)).has(source.id)) continue;
            const [balance, linked] = await Promise.all([
                tx.stockBalance.aggregate({ where: { boxId: source.id, skuId: sku.id, clientId: r.clientId, warehouseId: r.warehouseId,
                    status: 'AVAILABLE' }, _sum: { quantity: true } }),
                tx.productMark.count({ where: { boxId: source.id, skuId: sku.id, status: { not: 'SHIPPING' } } }),
            ]);
            if ((balance._sum.quantity ?? 0) <= linked) continue;
            const mark = await tx.productMark.create({ data: { clientId: r.clientId, skuId: sku.id, boxId: source.id,
                value: dto.kiz!, status: 'AVAILABLE', sourceDocument: r.id } });
            await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_MANUAL_UNLINKED_STOCK_CLAIM', entity: 'ClientRequest', entityId: r.id,
                payload: { operationId: dto.operationId, sourceBoxCode: source.code, barcode: dto.barcode, markId: mark.id,
                    sourceInferred: true, availableBefore: balance._sum.quantity, linkedMarksBefore: linked } } });
            return mark;
        }
        // FIX: explicit business rule: recover unknown physical goods as a backdated receipt, atomically with packing.
        const recordedAt = new Date();
        const moscow = new Date(recordedAt.getTime() + 3 * 60 * 60 * 1000);
        const receivedAt = new Date(Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
        const code = `FBO-RECOVER-${r.id}`;
        await tx.box.upsert({ where: { code }, create: { code, clientId: r.clientId, warehouseId: r.warehouseId }, update: {} });
        const source = await this.box(tx, r, code);
        const dimensions = { clientId: r.clientId, warehouseId: r.warehouseId, skuId: sku.id, boxId: source.id, palletId: source.palletId, status: 'AVAILABLE' as const };
        const balanceKey = this.balances.balanceKey(dimensions);
        await tx.stockBalance.upsert({ where: { balanceKey }, create: { ...dimensions, balanceKey, quantity: 1 }, update: { quantity: { increment: 1 } } });
        const receipt = await tx.stockMovement.create({ data: { ...dimensions, type: 'RECEIPT', quantity: 1,
            sourceDocument: r.id, idempotencyKey: `fbo-recovery:${r.id}:${dto.operationId}`, createdAt: receivedAt,
            comment: `Восстановительное поступление при упаковке FBO. Источник не установлен. Фактически записано ${recordedAt.toISOString()}; ${user.name || user.id}` } });
        const mark = await tx.productMark.create({ data: { clientId: r.clientId, skuId: sku.id, boxId: source.id,
            value: dto.kiz!, status: 'AVAILABLE', sourceDocument: r.id, stockMovementId: receipt.id } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_MANUAL_BACKDATED_RECEIPT', entity: 'ClientRequest', entityId: r.id,
            payload: { operationId: dto.operationId, barcode: dto.barcode, markId: mark.id, receiptMovementId: receipt.id,
                receivedAt: receivedAt.toISOString(), recordedAt: recordedAt.toISOString(), sourceUnknown: true, quantity: 1 } } });
        return mark;
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
        // FIX: an empty reusable rack bin must not become an outbound carton either.
        if (reusablePackingEnabled() && reusableBin(code))
            throw new ConflictException('Бокс остаётся на стеллаже. Отсканируйте отгрузочный короб.');
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
    async wbFile(id: string, user: AuthUser, kind: 'products' | 'packages' = 'packages') {
        const plan = await this.plan(id, user);
        if (plan.phase !== 'COMPLETED')
            throw new ConflictException('Сначала подтвердите все короба поставки.');
        return kind === 'products' ? this.files.getWbProductsTemplate(id, user) : this.files.getWbPackagingTemplate(id, user);
    }
}
