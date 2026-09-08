import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BoxCodePolicyService, preserveEmptyStorageBox } from '../../common/boxes/box-code-policy.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { assertSortingAdmin, confirmSortingSnapshot, sortingKizIdentity, sortingTaskCanReroute } from './pallet-sorting-policy';
import type { PalletSortingActionDto, StartPalletSortingDto } from './dto/pallet-sorting.dto';

type Source = { id: string; code: string; scanned: boolean; archived: boolean; placementId: string | null; preservedOnPallet?: boolean };
type Target = { id: string; code: string; closed: boolean; palletCode: string; quantity: number };
// FIX: missing database boxes are evidence, not invented Box IDs or zero balances.
type ProblemSource = { code: string; scanned: boolean; reason: 'BOX_NOT_FOUND' };
export type PalletSortingState = {
  id: string; clientId: string; warehouseId: string; sourceCode: string; sourcePalletId: string | null;
  stage: 'CHECKING' | 'FORMING' | 'COMPLETED'; version: number;
  sources: Source[]; targets: Target[]; activeTargetId?: string | null;
  problemSources?: ProblemSource[];
  moves: Array<{ identity: string; barcode: string; sourceBoxId: string | null; targetBoxId: string; sourceBoxCode?: string; recovered?: boolean; recoveryReason?: 'BOX_NOT_FOUND' | 'SKU_STOCK_MISSING' }>;
  pendingRoutes: Array<{ requestId: string; taskIds: string[]; revision: number; error?: string }>;
};
type Row = { state: PalletSortingState; version: number; createdByUserId: string; warehouseId: string; clientId: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class PalletSortingService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly boxCodes: BoxCodePolicyService, private readonly stock: StockOperationsService,
    private readonly emptyBoxes: ArchivedEmptyBoxPalletDetachService,
    private readonly marketplace: MarketplaceConnectionsService) {}

  capabilities(user: AuthUser) {
    return { enabled: process.env.WMS_PALLET_SORTING_ENABLED === 'true' && user.roleCodes.includes('ADMIN') };
  }

  async list(user: AuthUser) {
    assertSortingAdmin(user);
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession"
      WHERE "warehouseId" = ${user.activeWarehouseId!} AND "completedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 100`);
    return rows.filter(row => {
      try { this.scopes.requireClientAccess(user, row.clientId, 'write'); return true; } catch { return false; }
    }).map(row => row.state);
  }

  private async load(tx: Prisma.TransactionClient, id: string, user: AuthUser, lock = false) {
    assertSortingAdmin(user);
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession" WHERE "id" = ${id} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    const row = rows[0];
    if (!row) throw new NotFoundException('Сессия сортировки не найдена.');
    this.scopes.requireClientAccess(user, row.clientId, 'write');
    if (row.warehouseId !== user.activeWarehouseId) throw new ForbiddenException('Сортировка относится к другому филиалу.');
    return row.state;
  }

  get(id: string, user: AuthUser) { return this.load(this.prisma, id, user); }

  async start(dto: StartPalletSortingDto, user: AuthUser) {
    assertSortingAdmin(user);
    const code = await this.boxCodes.normalize(dto.code);
    if (!code) throw new BadRequestException('Отсканируйте паллет-сорт или короб.');
    return this.prisma.$transaction(async tx => {
      // ADDED: deterministic start replay and competing sessions serialize before source selection.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pallet-sorting:${user.activeWarehouseId}`}))`);
      const prior = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession" WHERE "id" = ${dto.id}`);
      if (prior.length) {
        const saved = await this.load(tx, dto.id, user);
        if (saved.sourceCode !== code || prior[0].createdByUserId !== user.id) throw new ConflictException('Номер сессии уже использован.');
        return saved;
      }
      const pallet = await tx.storagePallet.findFirst({ where: { warehouseId: user.activeWarehouseId!, code: { equals: code, mode: 'insensitive' } }, include: { boxes: true } });
      const box = pallet ? null : await tx.box.findUnique({ where: { code }, include: { storagePlacement: true } });
      if (!pallet && (!box || box.warehouseId !== user.activeWarehouseId || box.status !== 'active')) throw new BadRequestException('Действующий короб или паллет-сорт в выбранном филиале не найден.');
      const clientId = pallet?.clientId ?? box!.clientId;
      this.scopes.requireClientAccess(user, clientId, 'write');
      const ids = pallet ? pallet.boxes.map(b => b.boxId).filter((id): id is string => Boolean(id)) : [box!.id];
      // FIX: an orphan pallet placement is shown as problematic and may be physically scanned.
      const problemSources: ProblemSource[] = [];
      for (const placement of pallet?.boxes.filter(b => !b.boxId) ?? []) {
        const problemCode = await this.boxCodes.normalize(placement.boxCode);
        if (!problemCode || await tx.box.findUnique({ where: { code: problemCode } })) {
          throw new ConflictException('Код короба найден, но его привязка к паллет-сорту не подтверждена. Проверьте состав.');
        }
        problemSources.push({ code: problemCode, scanned: false, reason: 'BOX_NOT_FOUND' });
      }
      const sources = await tx.box.findMany({ where: { id: { in: ids as string[] } }, include: { storagePlacement: true } });
      if (sources.length !== ids.length || sources.some(b => b.status !== 'active' || b.clientId !== clientId || b.warehouseId !== user.activeWarehouseId)) throw new ConflictException('Состав паллет-сорта содержит неактивный короб или короб другого клиента/филиала.');
      await this.assertUnclaimed(tx, sources.map(b => b.id), dto.id, user.activeWarehouseId!);
      const state: PalletSortingState = { id: dto.id, clientId, warehouseId: user.activeWarehouseId!, sourceCode: code,
        sourcePalletId: pallet?.id ?? null, stage: 'CHECKING', version: 1, targets: [], moves: [], pendingRoutes: [], problemSources,
        sources: sources.map(b => ({ id: b.id, code: b.code, scanned: !pallet, archived: false, placementId: b.storagePlacement?.palletId ?? null })) };
      // FIX: a directly scanned box has already been physically confirmed.
      if (!pallet) {
        await this.assertMovementAllowed(tx, [box!.id]);
        await this.resetAffectedRoutes(tx, state, [box!.id], user);
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO "PalletSortingSession" ("id", "warehouseId", "clientId", "createdByUserId", "state")
        VALUES (${dto.id}, ${state.warehouseId}, ${clientId}, ${user.id}, ${JSON.stringify(state)}::jsonb)`);
      await this.audit(tx, state, user, 'STARTED', { code });
      return state;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  private async assertUnclaimed(tx: Prisma.TransactionClient, ids: string[], sessionId: string, warehouseId: string) {
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession" WHERE "warehouseId" = ${warehouseId} AND "completedAt" IS NULL AND "id" <> ${sessionId}`);
    if (rows.some(row => [...row.state.sources, ...row.state.targets].some(box => ids.includes(box.id)))) {
      throw new ConflictException('Короб уже участвует в другой незавершённой сортировке. Продолжите существующую сессию.');
    }
  }

  private async save(tx: Prisma.TransactionClient, state: PalletSortingState) {
    await tx.$executeRaw(Prisma.sql`UPDATE "PalletSortingSession" SET "state" = ${JSON.stringify(state)}::jsonb,
      "version" = ${state.version}, "updatedAt" = NOW(), "completedAt" = ${state.stage === 'COMPLETED' && !state.pendingRoutes.length ? new Date() : null}
      WHERE "id" = ${state.id}`);
  }

  async action(id: string, dto: PalletSortingActionDto, user: AuthUser) {
    assertSortingAdmin(user);
    return this.prisma.$transaction(async tx => {
      const state = await this.load(tx, id, user, true);
      const logId = hash(['PALLET_SORTING_COMMAND', id, dto.operationId]);
      const inputHash = hash([user.id, dto]);
      const prior = await tx.auditLog.findUnique({ where: { id: logId } });
      if (prior) {
        if ((prior.payload as { inputHash?: string })?.inputHash !== inputHash) throw new ConflictException('Номер операции уже использован с другими данными.');
        return state;
      }
      if (state.version !== dto.version) throw new ConflictException('Сессия изменилась. Обновите её перед следующим действием.');
      if (state.stage === 'COMPLETED') throw new ConflictException('Сортировка уже завершена.');
      await this.assertMovementAllowed(tx, [...state.sources.filter(b => !b.archived && !b.preservedOnPallet).map(b => b.id), ...state.targets.map(b => b.id)]);
      await this.runAction(tx, state, dto, user);
      state.version++;
      await this.save(tx, state);
      await tx.auditLog.create({ data: { id: logId, userId: user.id, action: 'PALLET_SORTING_COMMAND', entity: 'PalletSortingSession', entityId: id,
        payload: { inputHash, command: dto.action, version: state.version } } });
      return state;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  private async runAction(tx: Prisma.TransactionClient, state: PalletSortingState, dto: PalletSortingActionDto, user: AuthUser) {
    if (dto.action === 'SCAN_SOURCE') {
      if (state.stage !== 'CHECKING') throw new ConflictException('Сверка исходных коробов уже завершена.');
      const code = await this.boxCodes.normalize(dto.code ?? '');
      const box = state.sources.find(b => b.code === code && !b.archived && !b.preservedOnPallet);
      if (box) {
        box.scanned = true;
        // FIX: release logical routes before the first unit scan.
        await this.resetAffectedRoutes(tx, state, [box.id], user);
      }
      else await this.includeScannedSource(tx, state, code, user);
    } else if (dto.action === 'BEGIN_FORMING') {
      if (state.stage !== 'CHECKING' || state.sources.some(b => !b.archived && !b.preservedOnPallet && !b.scanned)) throw new ConflictException('Сначала отсканируйте все исходные короба или подтвердите обработку отсутствующих.');
      state.stage = 'FORMING';
    } else if (dto.action === 'ARCHIVE_MISSING' || dto.action === 'COMPLETE') {
      const completing = dto.action === 'COMPLETE';
      if (completing ? state.stage !== 'FORMING' || state.activeTargetId : state.stage !== 'CHECKING') throw new ConflictException('Сначала завершите текущий этап и закройте целевой короб.');
      const preview = await this.previewInTx(tx, state, completing ? 'remaining' : 'missing');
      confirmSortingSnapshot(preview.fingerprint, dto.fingerprint ?? '', dto.confirmWriteOff === true, preview.quantity);
      await this.archiveSources(tx, state, preview, user);
      if (completing) state.stage = 'COMPLETED';
    } else if (dto.action === 'CLOSE_TARGET') {
      if (state.stage !== 'FORMING') throw new ConflictException('Формирование коробов не начато.');
      const target = state.targets.find(b => b.id === state.activeTargetId);
      if (!target) throw new ConflictException('Нет открытого целевого короба.');
      target.closed = true;
      state.activeTargetId = null;
    } else if (dto.action === 'OPEN_TARGET') {
      if (state.stage !== 'FORMING' || state.activeTargetId) throw new ConflictException('Сначала закройте текущий целевой короб.');
      await this.openTarget(tx, state, dto, user);
    } else if (dto.action === 'MOVE') {
      await this.move(tx, state, dto, user);
    } else throw new BadRequestException('Неизвестное действие сортировки.');
  }

  // FIX: an old session snapshot may miss a box physically scanned on the same pallet.
  // Never auto-import the entire live pallet or turn an existing balance into a surplus.
  private async includeScannedSource(tx: Prisma.TransactionClient, state: PalletSortingState, value: string, user: AuthUser) {
    const code = await this.boxCodes.requireAllowed(value);
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pallet-sorting:${state.warehouseId}`}))`);
    const box = await tx.box.findUnique({ where: { code }, include: { storagePlacement: true } });
    if (!box) { await this.recordProblemSource(tx, state, code, user); return; }
    if (!state.sourcePalletId || box.status !== 'active' || box.clientId !== state.clientId || box.warehouseId !== state.warehouseId ||
        box.storagePlacement?.palletId !== state.sourcePalletId || state.targets.some(b => b.id === box.id) || state.sources.some(b => b.id === box.id)) {
      throw new ConflictException('Исходный короб должен быть действующим коробом того же клиента и филиала на исходном паллет-сорте; целевые и уже обработанные короба использовать нельзя.');
    }
    await this.assertUnclaimed(tx, [box.id], state.id, state.warehouseId);
    await this.assertMovementAllowed(tx, [box.id]);
    state.sources.push({ id: box.id, code: box.code, scanned: true, archived: false, placementId: state.sourcePalletId });
    await this.resetAffectedRoutes(tx, state, [box.id], user);
    state.problemSources = (state.problemSources ?? []).filter(b => b.code !== code);
    await this.audit(tx, state, user, 'LATE_SOURCE_SCANNED', { boxId: box.id, code, palletId: state.sourcePalletId });
  }

  // FIX: no receipt and no reassignment of an existing/foreign box at source scanning.
  private async recordProblemSource(tx: Prisma.TransactionClient, state: PalletSortingState, value: string, user: AuthUser) {
    const code = await this.boxCodes.requireAllowed(value);
    if (await tx.box.findUnique({ where: { code } })) throw new ConflictException('Этот короб существует в WMS, но не входит в исходный состав сортировки.');
    const problems = state.problemSources ??= [];
    const prior = problems.find(b => b.code === code);
    if (prior?.scanned) return prior;
    const problem: ProblemSource = prior ?? { code, reason: 'BOX_NOT_FOUND', scanned: false };
    problem.scanned = true;
    if (!prior) problems.push(problem);
    await this.audit(tx, state, user, 'PROBLEM_SOURCE_SCANNED', problem);
    return problem;
  }

  private async openTarget(tx: Prisma.TransactionClient, state: PalletSortingState, dto: PalletSortingActionDto, user: AuthUser) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pallet-sorting:${state.warehouseId}`}))`);
    const code = await this.boxCodes.requireAllowed(dto.code ?? '');
    if (state.sources.some(b => b.code === code) || state.problemSources?.some(b => b.code === code) || state.targets.some(b => b.code === code)) throw new ConflictException('Нужен новый целевой короб, который не является исходным или уже закрытым.');
    // ADDED: never invent a physical storage location for a newly formed box.
    const pallet = await tx.storagePallet.findFirst({ where: { clientId: state.clientId, warehouseId: state.warehouseId,
      code: { equals: (dto.palletCode ?? '').trim(), mode: 'insensitive' }, status: { notIn: ['DELETED', 'ARCHIVED'] } } });
    if (!pallet) throw new BadRequestException('Отсканируйте фактический паллет-сорт для целевого короба.');
    let box = await tx.box.findUnique({ where: { code }, include: { storagePlacement: true } });
    if (box && (box.clientId !== state.clientId || box.warehouseId !== state.warehouseId || box.status !== 'active' ||
        box.storagePlacement && box.storagePlacement.palletId !== pallet.id)) throw new ConflictException('Целевой короб недоступен или находится на другом паллет-сорте.');
    if (box) {
      await this.assertUnclaimed(tx, [box.id], state.id, state.warehouseId);
      if (await tx.stockBalance.count({ where: { boxId: box.id, quantity: { not: 0 } } }) ||
          await tx.productMark.count({ where: { boxId: box.id, status: { not: 'SHIPPING' } } })) throw new ConflictException('Для формирования нужен пустой целевой короб.');
    } else box = await tx.box.create({ data: { code, clientId: state.clientId, warehouseId: state.warehouseId, status: 'active' }, include: { storagePlacement: true } });
    await this.assertMovementAllowed(tx, [box.id]);
    if (!box.storagePlacement) await tx.storagePalletBox.create({ data: { palletId: pallet.id, boxId: box.id, boxCode: box.code, source: 'MANUAL' } });
    state.targets.push({ id: box.id, code: box.code, closed: false, quantity: 0, palletCode: pallet.code });
    state.activeTargetId = box.id;
    await this.audit(tx, state, user, 'TARGET_OPENED', { boxId: box.id, palletId: pallet.id });
  }

  private async move(tx: Prisma.TransactionClient, state: PalletSortingState, dto: PalletSortingActionDto, user: AuthUser) {
    if (state.stage !== 'FORMING') throw new ConflictException('Сначала начните формирование новых коробов.');
    const target = state.targets.find(b => b.id === state.activeTargetId && !b.closed);
    if (!target) throw new ConflictException('Сначала отсканируйте целевой короб.');
    const barcode = (dto.barcode ?? '').trim();
    if (!barcode) throw new BadRequestException('Сначала отсканируйте ШК товара.');
    const identity = sortingKizIdentity(dto.kiz ?? '');
    const prior = state.moves.find(m => m.identity === identity);
    if (prior) {
      if (prior.barcode === barcode && prior.targetBoxId === target.id) return;
      throw new ConflictException('Этот КИЗ уже перемещён в другой целевой короб этой сортировки.');
    }
    // FIX: validate the explicitly scanned physical source before resolving the KIZ.
    const code = dto.sourceBoxCode ? await this.boxCodes.normalize(dto.sourceBoxCode) : null;
    if (code && !state.sources.some(b => b.code === code)) await this.includeScannedSource(tx, state, code, user);
    const marks = await tx.productMark.findMany({ where: { clientId: state.clientId, value: { startsWith: identity } }, take: 2 });
    if (marks.length > 1) throw new ConflictException('Найдено несколько записей одного КИЗ. Требуется разбор дубликата.');
    const mark = marks[0];
    let source = mark ? state.sources.find(b => b.id === mark.boxId && b.scanned && !b.archived && !b.preservedOnPallet) : undefined;
    if (mark && (!source || mark.status !== 'AVAILABLE')) throw new ConflictException('КИЗ не относится к доступному товару в отсканированных исходных коробах.');
    if (source && code && source.code !== code) throw new ConflictException('КИЗ привязан к другому исходному коробу, а не к отсканированному. Проверьте фактический источник.');
    if (!mark) {
      // ADDED: unknown KIZ never guesses which of several physical source boxes to debit.
      const candidates = await tx.stockBalance.findMany({ where: { clientId: state.clientId, warehouseId: state.warehouseId,
        boxId: { in: state.sources.filter(b => b.scanned && !b.archived && !b.preservedOnPallet && (!code || b.code === code)).map(b => b.id) },
        status: 'AVAILABLE', quantity: { gt: 0 }, sku: { barcodes: { some: { value: barcode } } } }, select: { boxId: true } });
      const ids = [...new Set(candidates.map(b => b.boxId))];
      if (!ids.length) {
        // FIX: an explicitly scanned known source may have a physical surplus too.
        // Stock service rechecks zero SKU balance in ALL statuses and global KIZ history.
        const known = code ? state.sources.find(b => b.code === code) : undefined;
        if (known && (!known.scanned || known.archived || known.preservedOnPallet)) throw new ConflictException('Нужен подтверждённый активный исходный короб сортировки.');
        const problems = (state.problemSources ?? []).filter(b => b.scanned && (!code || b.code === code));
        if (known || problems.length === 1) {
          const problem = known ?? problems[0];
          const reason = known ? 'SKU_STOCK_MISSING' : 'BOX_NOT_FOUND';
          const recovered = await this.stock.recoverSortingUnit(tx, { clientId: state.clientId, sourceBoxCode: problem.code,
            ...(known ? { knownSource: { id: known.id, placementId: known.placementId } } : {}),
            toBoxCode: target.code, barcode, kiz: (dto.kiz ?? '').replace(/<GS>/gi, '\u001d').trim(),
            sessionId: state.id, idempotencyKey: `sorting:${state.id}:${hash(identity)}` }, user);
          state.moves.push({ identity, barcode, sourceBoxId: known?.id ?? null, sourceBoxCode: problem.code, targetBoxId: target.id, recovered: true, recoveryReason: reason });
          target.quantity++;
          await this.audit(tx, state, user, 'UNIT_RECOVERED', { sourceBoxCode: problem.code, sourceBoxId: known?.id ?? null, targetBoxId: target.id,
            barcode, identity, skuId: recovered.skuId, quantity: 1, reason });
          return;
        }
      }
      if (ids.length !== 1) throw new ConflictException('КИЗ не привязан: отсканируйте исходный короб этой единицы. Неизвестный короб будет отмечен как проблемный; товар учтётся в целевом коробе.');
      source = state.sources.find(b => b.id === ids[0]);
    }
    if (!source) throw new ConflictException('Исходный короб не найден.');
    // FIX: existing FORMING sessions also release logical routes before transfer.
    await this.resetAffectedRoutes(tx, state, [source.id], user);
    const moved = await this.stock.transferSortingUnit(tx, { fromBoxCode: source.code, toBoxCode: target.code, barcode,
      kiz: mark?.value ?? (dto.kiz ?? '').replace(/<GS>/gi, '\u001d').trim(), idempotencyKey: `sorting:${state.id}:${hash(identity)}`, sessionId: state.id }, user);
    state.moves.push({ identity, barcode, sourceBoxId: source.id, targetBoxId: target.id });
    target.quantity++;
    await this.resetAffectedRoutes(tx, state, [source.id], user, moved.skuId);
    await this.audit(tx, state, user, 'UNIT_MOVED', { sourceBoxId: source.id, targetBoxId: target.id, barcode, identity,
      ignoredSettledTaskIds: moved.sortingSettledTaskIds ?? [] });
  }

  async preview(id: string, kind: 'missing' | 'remaining', user: AuthUser) {
    return this.prisma.$transaction(async tx => this.previewInTx(tx, await this.load(tx, id, user), kind), { isolationLevel: 'RepeatableRead', timeout: 30000 });
  }

  private async previewInTx(tx: Prisma.TransactionClient, state: PalletSortingState, kind: 'missing' | 'remaining') {
    const sources = state.sources.filter(b => !b.archived && !b.preservedOnPallet && (kind === 'remaining' || !b.scanned));
    const boxes = await tx.box.findMany({ where: { id: { in: sources.map(b => b.id) } }, orderBy: { id: 'asc' },
      include: { storagePlacement: true, balances: { orderBy: { id: 'asc' }, include: { sku: { select: { clientId: true, article: true, name: true, size: true, color: true } } } },
        productMarks: { orderBy: { id: 'asc' }, select: { id: true, clientId: true, status: true, updatedAt: true } } } });
    if (boxes.length !== sources.length) throw new ConflictException('Исходный состав изменился. Обновите сортировку.');
    for (const box of boxes) {
      if (box.productMarks.some(mark => mark.clientId !== state.clientId) || box.balances.some(b => b.sku.clientId !== state.clientId)) {
        throw new ConflictException(`В коробе ${box.code} есть данные другого клиента. Сначала исправьте привязку.`);
      }
      if (box.clientId !== state.clientId || box.warehouseId !== state.warehouseId || box.status !== 'active' ||
          (box.storagePlacement?.palletId ?? null) !== sources.find(b => b.id === box.id)!.placementId) throw new ConflictException(`Изменилось расположение или состояние короба ${box.code}. Списание не выполнено.`);
      if (box.balances.some(b => b.clientId !== state.clientId || b.warehouseId !== state.warehouseId || b.quantity < 0 || b.quantity > 0 && b.status !== 'AVAILABLE')) {
        throw new ConflictException(`В коробе ${box.code} есть складской резерв, иной статус или некорректный остаток. Требуется разбор перед списанием; логические FBS-маршруты перестраиваются автоматически.`);
      }
    }
    const tasks = await tx.fbsTsdAssembly.findMany({ where: { clientId: state.clientId, OR: [{ boxId: { in: sources.map(b => b.id) } }, { reservedBoxId: { in: sources.map(b => b.id) } }] }, orderBy: { id: 'asc' } });
    const quantity = boxes.reduce((sum, box) => sum + box.balances.reduce((n, row) => n + row.quantity, 0), 0);
    // FIX: the confirmation covers box lifecycle as well as quantity; never guess its policy.
    const decisions = await Promise.all(boxes.map(async box => ({ ...box, preserveOnPallet: await preserveEmptyStorageBox(box.code, this.boxCodes) })));
    return { fingerprint: hash([state.id, state.version, kind, decisions, tasks, state.problemSources, state.moves.filter(m => m.recovered)]), quantity, boxes: decisions,
      problemSources: state.problemSources ?? [], recoveredQuantity: state.moves.filter(m => m.recovered).length,
      affectedOrders: tasks.filter(t => sortingTaskCanReroute(t, sources.map(b => b.id))).map(t => t.orderId) };
  }

  private async archiveSources(tx: Prisma.TransactionClient, state: PalletSortingState, preview: Awaited<ReturnType<PalletSortingService['previewInTx']>>, user: AuthUser) {
    const ids = preview.boxes.map(b => b.id);
    await this.resetAffectedRoutes(tx, state, ids, user);
    for (const box of preview.boxes) {
      for (const balance of box.balances.filter(b => b.quantity > 0)) {
        const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity, updatedAt: balance.updatedAt }, data: { quantity: 0 } });
        if (changed.count !== 1) throw new ConflictException('Остаток изменился во время списания. Получите свежие расхождения.');
        await tx.stockMovement.create({ data: { clientId: state.clientId, warehouseId: state.warehouseId, skuId: balance.skuId,
          boxId: box.id, palletId: balance.palletId, status: balance.status, type: 'INVENTORY_ADJUSTMENT', quantity: -balance.quantity,
          idempotencyKey: `sorting:${state.id}:writeoff:${balance.id}`, sourceDocument: `PALLET_SORTING:${state.id}`,
          comment: `Подтверждённая недостача при сортировке; администратор ${user.id}` } });
      }
      // ADDED: retain the KIZ and its old box as history; shipment evidence is immutable.
      await tx.productMark.updateMany({ where: { boxId: box.id, clientId: state.clientId, status: 'AVAILABLE' }, data: { status: 'BLOCKED' } });
      const source = state.sources.find(b => b.id === box.id)!;
      // FIX: settled permanent storage stays active and keeps its actual pallet placement.
      if (box.preserveOnPallet) {
        source.preservedOnPallet = true;
      } else {
        await tx.box.update({ where: { id: box.id }, data: { status: 'archived' } });
        const detached = await this.emptyBoxes.detachIfArchivedAndEmpty({ boxId: box.id, userId: user.id, reason: `pallet-sorting:${state.id}` }, tx);
        // FIX: abort the owning transaction if policy/state changed before detachment.
        if (box.storagePlacement && !detached.detached) throw new ConflictException(`Не удалось снять с паллет-сорта короб ${box.code}. Получите свежие расхождения.`);
        source.archived = true;
      }
    }
    await this.audit(tx, state, user, 'SHORTAGE_CONFIRMED', { fingerprint: preview.fingerprint, quantity: preview.quantity,
      boxes: preview.boxes.map(b => ({ id: b.id, code: b.code, disposition: b.preserveOnPallet ? 'PRESERVED_ON_PALLET' : 'ARCHIVED', balances: b.balances.map(r => ({ skuId: r.skuId, quantity: r.quantity, status: r.status })) })), affectedOrders: preview.affectedOrders });
  }

  private async resetAffectedRoutes(tx: Prisma.TransactionClient, state: PalletSortingState, ids: string[], user: AuthUser, skuId?: string) {
    const tasks = await tx.fbsTsdAssembly.findMany({ where: { clientId: state.clientId,
      ...(skuId ? { AND: [{ OR: [{ sourceSkuId: skuId }, { sourceSkuId: null, skuId }] }] } : {}),
      OR: [{ boxId: { in: ids } }, { reservedBoxId: { in: ids } }] } });
    for (const task of tasks.filter(t => sortingTaskCanReroute(t, ids))) {
      // FIX: physical scans win a race. Do not turn ledger-picked goods into available stock.
      const picked = await tx.stockMovement.findFirst({ where: { idempotencyKey: { startsWith: `fbs-sticker-pick:${task.id}:` }, quantity: { lt: 0 } }, select: { id: true } });
      if (picked) continue;
      const automatic = task.requestId.startsWith('AUTO:');
      const request = automatic ? null : await tx.clientRequest.findUnique({ where: { id: task.requestId }, select: { warehouseId: true, clientId: true } });
      // FIX: an AUTO task is scoped by its verified source box; it has no ClientRequest row.
      if (!automatic && (!request || request.warehouseId !== state.warehouseId || request.clientId !== state.clientId)) throw new ConflictException(`Нельзя однозначно определить филиал задания ${task.orderId}. Списание не выполнено.`);
      const changed = await tx.fbsTsdAssembly.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null },
        data: { boxId: null, boxCode: null, reservedBoxId: null, reservedBoxCode: null, reservedAt: null, storageBoxes: [],
          status: task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'WAITING_STOCK', errorMessage: 'Источник изменён при сортировке. Выполняется перестроение маршрута.' } });
      if (changed.count !== 1) throw new ConflictException('Сборщик изменил задание. Повторите проверку расхождений.');
      let pending = state.pendingRoutes.find(p => p.requestId === task.requestId);
      if (!pending) { pending = { requestId: task.requestId, taskIds: [], revision: state.version + 1 }; state.pendingRoutes.push(pending); }
      pending.revision = state.version + 1;
      if (!pending.taskIds.includes(task.id)) pending.taskIds.push(task.id);
      await this.audit(tx, state, user, 'FBS_ROUTE_INVALIDATED', { taskId: task.id, orderId: task.orderId, previousBoxId: task.boxId, previousReservedBoxId: task.reservedBoxId });
    }
  }

  async rebuildRoutes(id: string, user: AuthUser) {
    const snapshot = await this.get(id, user);
    for (const pending of snapshot.pendingRoutes) {
      let error: string | undefined;
      try {
        if (pending.requestId.startsWith('AUTO:')) await this.marketplace.repairFbsSortingAutomaticTasks(pending.taskIds, snapshot.clientId, user);
        else await this.marketplace.repairFbsRequestSelection(pending.requestId, user, pending.taskIds);
      }
      catch (caught) { error = caught instanceof Error ? caught.message : 'Не удалось перестроить маршрут.'; }
      await this.prisma.$transaction(async tx => {
        const current = await this.load(tx, id, user, true);
        const row = current.pendingRoutes.find(p => p.requestId === pending.requestId);
        if (!row || row.revision !== pending.revision) return;
        if (error) row.error = error;
        else row.taskIds = row.taskIds.filter(taskId => !pending.taskIds.includes(taskId));
        current.pendingRoutes = current.pendingRoutes.filter(p => p.taskIds.length);
        current.version++;
        await this.save(tx, current);
        await this.audit(tx, current, user, 'FBS_ROUTES_REBUILT', { requestId: pending.requestId, taskIds: pending.taskIds, success: !error, error: error ?? null });
      }, { isolationLevel: 'Serializable', timeout: 30000 });
    }
    return this.get(id, user);
  }

  private async assertMovementAllowed(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$executeRaw(Prisma.sql`LOCK TABLE "InventorySession" IN SHARE MODE`);
    if (await tx.inventorySession.findFirst({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } }, select: { id: true } })) throw new ConflictException('На время полной инвентаризации перемещения остановлены.');
    if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Box" WHERE "id" IN (${Prisma.join([...ids].sort())}) ORDER BY "id" FOR UPDATE`);
    if (await tx.inventoryAuditBox.findFirst({ where: { boxId: { in: ids }, status: { in: ['COUNTING', 'MISMATCH'] } }, select: { id: true } })) throw new ConflictException('Один из коробов сейчас пересчитывается. Сначала завершите актуализацию.');
    if (await tx.clientRequestBoxSelection.findFirst({ where: { boxId: { in: ids }, requestItem: { request: {
      status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] }, fbsOrderLinks: { none: {} },
    } } }, select: { id: true } })) throw new ConflictException('Короб участвует в активной заявке не FBS. Сначала завершите или разберите эту заявку.');
  }

  private audit(tx: Prisma.TransactionClient, state: PalletSortingState, user: AuthUser, action: string, payload: unknown) {
    return tx.auditLog.create({ data: { userId: user.id, action: `PALLET_SORTING_${action}`, entity: 'PalletSortingSession', entityId: state.id,
      payload: JSON.parse(JSON.stringify({ clientId: state.clientId, warehouseId: state.warehouseId, ...payload as object })) as Prisma.InputJsonValue } });
  }
}
