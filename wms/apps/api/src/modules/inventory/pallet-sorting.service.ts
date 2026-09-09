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

type Source = { id: string; code: string; scanned: boolean; archived: boolean; placementId: string | null; preservedOnPallet?: boolean; retainedReason?: string; clientId?: string; warehouseId?: string | null };
type Target = { id: string; code: string; closed: boolean; palletCode: string; quantity: number; clientId?: string; warehouseId?: string };

// FIX: missing database boxes are evidence, not invented Box IDs or zero balances.
type ProblemSource = { code: string; scanned: boolean; reason: 'BOX_NOT_FOUND' };
export type PalletSortingState = {
  id: string; clientId: string; warehouseId: string; sourceCode: string; sourcePalletId: string | null;
  stage: 'CHECKING' | 'FORMING' | 'COMPLETED'; version: number;
  sources: Source[]; targets: Target[]; activeTargetId?: string | null;
  problemSources?: ProblemSource[];
  moves: Array<{ identity: string; barcode: string; sourceBoxId: string | null; targetBoxId: string; sourceBoxCode?: string; recovered?: boolean; recoveryReason?: 'BOX_NOT_FOUND' | 'SKU_STOCK_MISSING' | 'WRITTEN_OFF_KIZ';
    sourceClientId?: string | null; targetClientId?: string;
    sourceCorrection?: { physicalBoxId: string | null; physicalBoxCode: string | null; recordedBoxCode: string } }>;
  pendingRoutes: Array<{ requestId: string; taskIds: string[]; revision: number; error?: string; clientId?: string; warehouseId?: string }>;
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
    return { enabled: process.env.WMS_PALLET_SORTING_ENABLED === 'true' && user.roleCodes.includes('ADMIN') && !user.isDemo };
  }

  async list(user: AuthUser) {
    assertSortingAdmin(user);
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession"
      WHERE "warehouseId" = ${user.activeWarehouseId!} AND "completedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 100`);
    const visible: PalletSortingState[] = [];
    for (const row of rows) {
      try { await this.assertStateVisible(this.prisma, row.state, user); visible.push(row.state); }
      catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    }
    return visible;
  }

  private async load(tx: Prisma.TransactionClient, id: string, user: AuthUser, lock = false) {
    assertSortingAdmin(user);
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession" WHERE "id" = ${id} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    const row = rows[0];
    if (!row) throw new NotFoundException('Сессия сортировки не найдена.');
    this.assertVisibleClient(user, row.clientId);
    await this.assertStateVisible(tx, row.state, user);
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
      if (!pallet && !box) throw new BadRequestException('Короб или паллет-сорт не найден.');
      const clientId = pallet?.clientId ?? box!.clientId;
      this.assertVisibleClient(user, clientId);
      const ids = pallet ? pallet.boxes.map(b => b.boxId).filter((id): id is string => Boolean(id)) : [box!.id];
      // FIX: an orphan pallet placement is shown as problematic and may be physically scanned.
      const problemSources: ProblemSource[] = [];
      for (const placement of pallet?.boxes.filter(b => !b.boxId) ?? []) {
        const problemCode = await this.boxCodes.normalize(placement.boxCode);
        if (!problemCode) throw new BadRequestException('В составе паллет-сорта найден короб без кода. Укажите его фактический код.');
        const known = await tx.box.findUnique({ where: { code: problemCode } });
        if (known) {
          // FIX: stale placement metadata does not block ADMIN; the box still requires
          // a physical scan and is not received or relocated by opening the checklist.
          if (!ids.includes(known.id)) ids.push(known.id);
          continue;
        }
        problemSources.push({ code: problemCode, scanned: false, reason: 'BOX_NOT_FOUND' });
      }
      const sources = await tx.box.findMany({ where: { id: { in: ids as string[] } }, include: { storagePlacement: true } });
      if (sources.length !== ids.length) throw new ConflictException('Состав паллет-сорта изменился. Повторите сканирование.');
      for (const source of sources) this.assertVisibleClient(user, source.clientId);
      await this.assertUnclaimed(tx, sources.map(b => b.id), dto.id, user.activeWarehouseId!);
      const state: PalletSortingState = { id: dto.id, clientId, warehouseId: user.activeWarehouseId!, sourceCode: code,
        sourcePalletId: pallet?.id ?? null, stage: 'CHECKING', version: 1, targets: [], moves: [], pendingRoutes: [], problemSources,
        sources: sources.map(b => ({ id: b.id, code: b.code, scanned: !pallet, archived: false, placementId: b.storagePlacement?.palletId ?? null, clientId: b.clientId, warehouseId: b.warehouseId })) };
      // FIX: a directly scanned box has already been physically confirmed.
      if (!pallet) {
        await this.assertMovementAllowed(tx, [box!.id], state, user);
        if (box!.warehouseId) await this.resetAffectedRoutes(tx, state, [box!.id], user, undefined, { clientId: box!.clientId, warehouseId: box!.warehouseId });
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO "PalletSortingSession" ("id", "warehouseId", "clientId", "createdByUserId", "state")
        VALUES (${dto.id}, ${state.warehouseId}, ${clientId}, ${user.id}, ${JSON.stringify(state)}::jsonb)`);
      await this.audit(tx, state, user, 'STARTED', { code });
      return state;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  private async assertUnclaimed(tx: Prisma.TransactionClient, ids: string[], sessionId: string, warehouseId: string) {
    // FIX: cross-branch ADMIN moves still cannot consume a box owned by a concurrent session.
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "PalletSortingSession" WHERE "completedAt" IS NULL AND "id" <> ${sessionId}`);
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
      // FIX: forming checks the actual moved source below, not every old checklist box.
      const checkSources = !['MOVE', 'OPEN_TARGET', 'CLOSE_TARGET'].includes(dto.action);
      await this.assertMovementAllowed(tx, [...(checkSources ? state.sources.filter(b => !b.archived && (!b.preservedOnPallet || b.retainedReason)).map(b => b.id) : []), ...state.targets.map(b => b.id)], state, user);

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
        await this.resetAffectedRoutes(tx, state, [box.id], user, undefined, { clientId: box.clientId ?? state.clientId, warehouseId: box.warehouseId ?? state.warehouseId });
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
    this.assertVisibleClient(user, box.clientId);
    if (state.targets.some(b => b.id === box.id) || state.sources.some(b => b.id === box.id)) throw new ConflictException('Короб уже включён в состав этой сортировки.');
    await this.assertUnclaimed(tx, [box.id], state.id, state.warehouseId);
    await this.assertMovementAllowed(tx, [box.id], state, user);
    state.sources.push({ id: box.id, code: box.code, scanned: true, archived: false, placementId: box.storagePlacement?.palletId ?? null, clientId: box.clientId, warehouseId: box.warehouseId });
    if (box.warehouseId) await this.resetAffectedRoutes(tx, state, [box.id], user, undefined, { clientId: box.clientId, warehouseId: box.warehouseId });
    state.problemSources = (state.problemSources ?? []).filter(b => b.code !== code);
    await this.audit(tx, state, user, 'LATE_SOURCE_SCANNED', { boxId: box.id, code, palletId: box.storagePlacement?.palletId ?? null, previousStatus: box.status, previousClientId: box.clientId, previousWarehouseId: box.warehouseId });
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
    if (state.sources.some(b => b.code === code) || state.problemSources?.some(b => b.code === code)) throw new ConflictException('Исходный короб нельзя одновременно закрыть как новый целевой.');
    let box = await tx.box.findUnique({ where: { code }, include: { storagePlacement: true } });
    // FIX: a closed destination must still refer to the original box, never a recreated code.
    const previous = state.targets.find(b => b.code === code);
    if (previous && (!box || box.id !== previous.id || !previous.closed)) throw new ConflictException('Закрытый целевой короб изменился. Проверьте его фактическое размещение.');
    // FIX: an existing destination defines ownership; scanning it does not rewrite other contents.
    const clientId = box?.clientId ?? state.clientId, warehouseId = box?.warehouseId ?? state.warehouseId;
    this.assertVisibleClient(user, clientId);
    const pallet = await tx.storagePallet.findFirst({ where: { clientId, warehouseId,
      code: { equals: (dto.palletCode ?? '').trim(), mode: 'insensitive' }, status: { notIn: ['DELETED', 'ARCHIVED'] } } });
    if (!pallet) throw new BadRequestException('Отсканируйте фактический паллет-сорт для целевого короба.');
    if (box) {
      await this.assertUnclaimed(tx, [box.id], state.id, warehouseId);
      await this.assertMovementAllowed(tx, [box.id], state, user);
      if (!box.warehouseId) {
        // FIX: the explicitly scanned pallet supplies absent legacy branch metadata.
        await tx.box.update({ where: { id: box.id }, data: { warehouseId: pallet.warehouseId } });
        await this.audit(tx, state, user, 'TARGET_BRANCH_CONFIRMED', { boxId: box.id, previousWarehouseId: null, warehouseId: pallet.warehouseId, palletId: pallet.id });
      }
      if (box.status !== 'active') {
        await tx.box.update({ where: { id: box.id }, data: { status: 'active' } });
        await this.audit(tx, state, user, 'TARGET_RESTORED', { boxId: box.id, previousStatus: box.status, clientId, warehouseId });
      }
      if (box.storagePlacement && box.storagePlacement.palletId !== pallet.id) {
        await tx.storagePalletBox.update({ where: { boxId: box.id }, data: { palletId: pallet.id, source: 'MANUAL' } });
        await this.audit(tx, state, user, 'TARGET_PLACEMENT_CONFIRMED', { boxId: box.id, previousPalletId: box.storagePlacement.palletId, palletId: pallet.id });
      }
    } else box = await tx.box.create({ data: { code, clientId, warehouseId, status: 'active' }, include: { storagePlacement: true } });
    if (!box.storagePlacement) await tx.storagePalletBox.create({ data: { palletId: pallet.id, boxId: box.id, boxCode: box.code, source: 'MANUAL' } });
    const prior = state.targets.find(b => b.id === box!.id);
    if (prior) { prior.closed = false; prior.palletCode = pallet.code; }
    else {
      // FIX: topping up an existing box preserves its quantity without repeating receipt.
      const contents = await tx.stockBalance.aggregate({ where: { boxId: box.id }, _sum: { quantity: true }, _min: { quantity: true } });
      if ((contents._min.quantity ?? 0) < 0) throw new ConflictException('В целевом коробе есть отрицательный остаток. Сначала подтвердите корректировку остатков.');
      state.targets.push({ id: box.id, code: box.code, closed: false, quantity: contents._sum.quantity ?? 0, palletCode: pallet.code, clientId, warehouseId });
    }
    state.activeTargetId = box.id;
    await this.audit(tx, state, user, 'TARGET_OPENED', { boxId: box.id, palletId: pallet.id, clientId, warehouseId });

  }

  // FIX: this menu is an ADMIN-only physical reconciliation, not ordinary picking.
  private async move(tx: Prisma.TransactionClient, state: PalletSortingState, dto: PalletSortingActionDto, user: AuthUser) {
    assertSortingAdmin(user);
    if (state.stage !== 'FORMING') throw new ConflictException('Сначала начните формирование новых коробов.');
    const target = state.targets.find(b => b.id === state.activeTargetId && !b.closed);
    if (!target) throw new ConflictException('Сначала отсканируйте целевой короб.');
    const barcode = (dto.barcode ?? '').trim();
    if (!barcode) throw new BadRequestException('Сначала отсканируйте ШК товара.');
    const identity = sortingKizIdentity(dto.kiz ?? '');
    const prior = [...state.moves].reverse().find(m => m.identity === identity);
    // FIX: a previous session scan is not proof of the current location after another operation.
    const problems = (state.problemSources ?? []).filter(p => p.scanned);
    const code = dto.sourceBoxCode ? await this.boxCodes.normalize(dto.sourceBoxCode) : problems.length === 1 ? problems[0].code : undefined;
    if (code && !await tx.box.findUnique({ where: { code } })) await this.recordProblemSource(tx, state, code, user);
    await this.assertUnclaimed(tx, [target.id], state.id, state.warehouseId);
    await this.assertMovementAllowed(tx, [target.id], state, user);
    // FIX: ordinary transfer/capacity/history restrictions are not called by this path.
    // The helper locks the KIZ globally and updates its old and target balances atomically.
    const moved = await this.stock.reconcileAdminSortingUnit(tx, {
      toBoxCode: target.code, barcode, kiz: (dto.kiz ?? '').replace(/<GS>/gi, '\u001d').trim(),
      sourceBoxCode: code, sourceBoxIds: state.sources.filter(b => b.scanned && !b.archived && !b.preservedOnPallet).map(b => b.id),
      sessionId: state.id, idempotencyKey: `sorting:${state.id}:admin:${dto.operationId ?? hash([identity, target.id, state.moves.length])}`,
    }, user);
    if (moved.alreadyApplied) return;
    if (moved.sourceBoxId) {
      await this.assertUnclaimed(tx, [moved.sourceBoxId], state.id, moved.sourceWarehouseId ?? state.warehouseId);
      await this.assertMovementAllowed(tx, [moved.sourceBoxId], state, user);
      await this.resetAffectedRoutes(tx, state, [moved.sourceBoxId], user, undefined, {
        clientId: moved.sourceClientId ?? state.clientId, warehouseId: moved.sourceWarehouseId ?? state.warehouseId,
      });
    }
    if (prior) {
      const oldTarget = state.targets.find(b => b.id === prior.targetBoxId);
      if (oldTarget && oldTarget.quantity > 0) oldTarget.quantity--;
    }
    state.moves.push({ identity, barcode, sourceBoxId: moved.sourceBoxId, sourceBoxCode: code, targetBoxId: target.id,
      sourceClientId: moved.sourceClientId, targetClientId: moved.targetClientId,
      ...(moved.recovered ? { recovered: true as const, recoveryReason: 'SKU_STOCK_MISSING' as const } : {}) });
    target.quantity++;
    await this.audit(tx, state, user, moved.recovered ? 'UNIT_RECOVERED' : 'UNIT_MOVED', {
      sourceBoxId: moved.sourceBoxId, sourceBoxCode: code, targetBoxId: target.id, barcode, identity,
      skuId: moved.skuId, markId: moved.markId, movementId: moved.movementId, quantity: 1,
      sourceClientId: moved.sourceClientId, sourceWarehouseId: moved.sourceWarehouseId,
      targetClientId: moved.targetClientId, targetWarehouseId: moved.targetWarehouseId, physicalTruth: true,
    });

  }

  async preview(id: string, kind: 'missing' | 'remaining', user: AuthUser) {
    return this.prisma.$transaction(async tx => this.previewInTx(tx, await this.load(tx, id, user), kind), { isolationLevel: 'RepeatableRead', timeout: 30000 });
  }

  private async previewInTx(tx: Prisma.TransactionClient, state: PalletSortingState, kind: 'missing' | 'remaining') {
    // FIX: legacy retained discrepancies are not settled permanent boxes; re-preview under fresh consent.
    const sources = state.sources.filter(b => !b.archived && (!b.preservedOnPallet || b.retainedReason) && (kind === 'remaining' || !b.scanned));
    const boxes = await tx.box.findMany({ where: { id: { in: sources.map(b => b.id) } }, orderBy: { id: 'asc' },
      include: { storagePlacement: true, balances: { orderBy: { id: 'asc' }, include: { sku: { select: { clientId: true, article: true, name: true, size: true, color: true } } } },
        productMarks: { orderBy: { id: 'asc' }, select: { id: true, clientId: true, status: true, updatedAt: true } } } });
    if (boxes.length !== sources.length) throw new ConflictException('Исходный состав изменился. Обновите сортировку.');
    // FIX: current ownership is included in consent; corrupt quantities are retained below.
    const tasks = await tx.fbsTsdAssembly.findMany({ where: { OR: [{ boxId: { in: sources.map(b => b.id) } }, { reservedBoxId: { in: sources.map(b => b.id) } }] }, orderBy: { id: 'asc' } });

    // FIX: the confirmation covers box lifecycle as well as quantity; never guess its policy.
    const decisions = await Promise.all(boxes.map(async box => ({ ...box, preserveOnPallet: await preserveEmptyStorageBox(box.code, this.boxCodes),
      // FIX: administrator shortage consent covers positive reservations too, not only AVAILABLE.
      // Negative/corrupt quantities need a separate recount; do not silently turn them into a receipt.
      retainedReason: box.balances.some(b => !Number.isInteger(b.quantity) || b.quantity < 0)
        ? 'Короб сохранён: отрицательный или некорректный остаток требует фактического пересчёта.' : null })));
    const quantity = decisions.filter(b => !b.retainedReason).reduce((sum, box) => sum + box.balances.reduce((n, row) => n + row.quantity, 0), 0);
    return { fingerprint: hash([state.id, state.version, kind, decisions, tasks, state.problemSources, state.moves.filter(m => m.recovered)]), quantity, boxes: decisions,
      problemSources: state.problemSources ?? [], recoveredQuantity: state.moves.filter(m => m.recovered).length,
      affectedOrders: tasks.filter(t => sortingTaskCanReroute(t, decisions.filter(b => !b.retainedReason).map(b => b.id))).map(t => t.orderId) };
  }

  private async archiveSources(tx: Prisma.TransactionClient, state: PalletSortingState, preview: Awaited<ReturnType<PalletSortingService['previewInTx']>>, user: AuthUser) {
    for (const box of preview.boxes) {
      this.assertVisibleClient(user, box.clientId);
      // FIX: preserve existing retained-discrepancy handling without blocking other boxes.
      if (box.retainedReason) {
        const source = state.sources.find(b => b.id === box.id)!;
        source.retainedReason = box.retainedReason;
        source.preservedOnPallet = true;
        continue;
      }
      await this.resetAffectedRoutes(tx, state, [box.id], user, undefined, { clientId: box.clientId ?? state.clientId, warehouseId: box.warehouseId ?? state.warehouseId });

      for (const balance of box.balances.filter(b => b.quantity > 0)) {
        this.assertVisibleClient(user, balance.clientId);
        const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity, updatedAt: balance.updatedAt }, data: { quantity: 0 } });
        if (changed.count !== 1) throw new ConflictException('Остаток изменился во время списания. Получите свежие расхождения.');
        await tx.stockMovement.create({ data: { clientId: balance.clientId ?? box.clientId ?? state.clientId, warehouseId: balance.warehouseId ?? box.warehouseId ?? state.warehouseId, skuId: balance.skuId,
          boxId: box.id, palletId: balance.palletId, status: balance.status, type: 'INVENTORY_ADJUSTMENT', quantity: -balance.quantity,
          idempotencyKey: `sorting:${state.id}:writeoff:${balance.id}`, sourceDocument: `PALLET_SORTING:${state.id}`,
          comment: `Подтверждённая недостача при сортировке; администратор ${user.id}` } });
      }
      // ADDED: retain the KIZ and its old box as history; shipment evidence is immutable.
      await tx.productMark.updateMany({ where: { boxId: box.id, status: { in: ['AVAILABLE', 'PACKING', 'RESERVED'] } }, data: { status: 'BLOCKED' } });

      const source = state.sources.find(b => b.id === box.id)!;
      delete source.retainedReason;
      delete source.preservedOnPallet;
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
      boxes: preview.boxes.map(b => ({ id: b.id, code: b.code, disposition: b.retainedReason ? 'RETAINED_DISCREPANCY' : b.preserveOnPallet ? 'PRESERVED_ON_PALLET' : 'ARCHIVED', retainedReason: b.retainedReason,
        balances: b.balances.map(r => ({ skuId: r.skuId, quantity: r.quantity, status: r.status })) })), affectedOrders: preview.affectedOrders });
  }

  private async resetAffectedRoutes(tx: Prisma.TransactionClient, state: PalletSortingState, ids: string[], user: AuthUser, skuId?: string,
    origin: { clientId: string; warehouseId: string } = state) {
    const tasks = await tx.fbsTsdAssembly.findMany({ where: { clientId: origin.clientId,
      ...(skuId ? { AND: [{ OR: [{ sourceSkuId: skuId }, { sourceSkuId: null, skuId }] }] } : {}),
      OR: [{ boxId: { in: ids } }, { reservedBoxId: { in: ids } }] } });
    for (const task of tasks.filter(t => sortingTaskCanReroute(t, ids))) {
      // FIX: physical scans win a race. Do not turn ledger-picked goods into available stock.
      const picked = await tx.stockMovement.findFirst({ where: { idempotencyKey: { startsWith: `fbs-sticker-pick:${task.id}:` }, quantity: { lt: 0 } }, select: { id: true } });
      if (picked) continue;
      const automatic = task.requestId.startsWith('AUTO:');
      const request = automatic ? null : await tx.clientRequest.findUnique({ where: { id: task.requestId }, select: { warehouseId: true, clientId: true } });
      // FIX: an AUTO task is scoped by its verified source box; it has no ClientRequest row.
      if (!automatic && (!request || request.warehouseId !== origin.warehouseId || request.clientId !== origin.clientId)) {
        await this.audit(tx, state, user, 'FBS_ROUTE_SCOPE_CONFLICT', { taskId: task.id, orderId: task.orderId, origin, request });
        continue;
      }
      const changed = await tx.fbsTsdAssembly.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, barcode: null, kiz: null, sourceBarcode: null, relabelConfirmedAt: null },
        data: { boxId: null, boxCode: null, reservedBoxId: null, reservedBoxCode: null, reservedAt: null, storageBoxes: [],
          status: task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'WAITING_STOCK', errorMessage: 'Источник изменён при сортировке. Выполняется перестроение маршрута.' } });
      if (changed.count !== 1) throw new ConflictException('Сборщик изменил задание. Повторите проверку расхождений.');
      let pending = state.pendingRoutes.find(p => p.requestId === task.requestId);
      if (!pending) { pending = { requestId: task.requestId, taskIds: [], revision: state.version + 1, clientId: origin.clientId, warehouseId: origin.warehouseId }; state.pendingRoutes.push(pending); }
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
        // FIX: use the origin context for cross-branch sorting, not the destination/session branch.
        const clientId = pending.clientId ?? snapshot.clientId;
        this.assertVisibleClient(user, clientId);
        const routeUser: AuthUser = { ...user, activeWarehouseId: pending.warehouseId ?? snapshot.warehouseId,
          clientIds: [...new Set([...(user.clientIds ?? []), clientId])],
          writableClientIds: [...new Set([...(user.writableClientIds ?? []), clientId])] };
        if (pending.requestId.startsWith('AUTO:')) await this.marketplace.repairFbsSortingAutomaticTasks(pending.taskIds, pending.clientId ?? snapshot.clientId, routeUser);
        else await this.marketplace.repairFbsRequestSelection(pending.requestId, routeUser, pending.taskIds);
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

  private assertVisibleClient(user: AuthUser, clientId: string) {
    // FIX: ADMIN bypasses stock permissions here, never demo/hidden-client isolation.
    if (user.hiddenClientIds?.includes(clientId)) throw new ForbiddenException('Клиент недоступен в этом окружении.');
  }

  private async assertStateVisible(tx: Prisma.TransactionClient, state: PalletSortingState, user: AuthUser) {
    this.assertVisibleClient(user, state.clientId);
    if (!user.hiddenClientIds?.length) return;
    // FIX: cross-owner session contents must not leak a hidden client through a visible owner.
    const clientIds = [state.clientId, ...state.sources.map(s => s.clientId), ...state.targets.map(t => t.clientId),
      ...state.moves.flatMap(m => [m.sourceClientId, m.targetClientId]), ...state.pendingRoutes.map(r => r.clientId)];
    for (const clientId of clientIds) if (clientId) this.assertVisibleClient(user, clientId);
    const ids = [...new Set([...state.sources.map(s => s.id), ...state.targets.map(t => t.id), ...state.moves.flatMap(m => [m.sourceBoxId, m.targetBoxId]).filter((id): id is string => !!id)])];
    if (!ids.length) return;
    const boxes = await tx.box.findMany({ where: { id: { in: ids } }, select: { id: true, clientId: true,
      balances: { select: { clientId: true, sku: { select: { clientId: true } } } }, productMarks: { select: { clientId: true } } } });
    for (const box of boxes) {
      this.assertVisibleClient(user, box.clientId);
      for (const balance of box.balances ?? []) { this.assertVisibleClient(user, balance.clientId); this.assertVisibleClient(user, balance.sku.clientId); }
      for (const mark of box.productMarks ?? []) this.assertVisibleClient(user, mark.clientId);
    }
  }

  private async assertMovementAllowed(tx: Prisma.TransactionClient, ids: string[], state?: PalletSortingState, user?: AuthUser) {
    await tx.$executeRaw(Prisma.sql`LOCK TABLE "InventorySession" IN SHARE MODE`);
    if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Box" WHERE "id" IN (${Prisma.join([...ids].sort())}) ORDER BY "id" FOR UPDATE`);
    const inventory = await tx.inventorySession.findFirst({ where: { type: 'FULL', status: { in: ['ACTIVE', 'REVIEW'] } }, select: { id: true } });
    const recount = await tx.inventoryAuditBox.findFirst({ where: { boxId: { in: ids }, status: { in: ['COUNTING', 'MISMATCH'] } }, select: { id: true } });
    const request = await tx.clientRequestBoxSelection.findFirst({ where: { boxId: { in: ids }, requestItem: { request: {
      status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] }, fbsOrderLinks: { none: {} },
    } } }, select: { id: true } });
    // FIX: business holds are overridable physical evidence; transaction locks remain mandatory.
    if (state && user && (inventory || recount || request)) await this.audit(tx, state, user, 'LOCKS_OVERRIDDEN', {
      boxIds: ids, inventorySessionId: inventory?.id ?? null, recountId: recount?.id ?? null, requestSelectionId: request?.id ?? null,
    });
  }

  private audit(tx: Prisma.TransactionClient, state: PalletSortingState, user: AuthUser, action: string, payload: unknown) {
    return tx.auditLog.create({ data: { userId: user.id, action: `PALLET_SORTING_${action}`, entity: 'PalletSortingSession', entityId: state.id,
      payload: JSON.parse(JSON.stringify({ clientId: state.clientId, warehouseId: state.warehouseId, ...payload as object })) as Prisma.InputJsonValue } });
  }
}
