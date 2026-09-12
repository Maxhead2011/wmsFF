import type { FbsOrderSelectionDto } from './dto/fbs-order-selection.dto';
import { NO_STOCK_SUPPLY_NAME, stockTransferBlockedReason, type StockTransferPurpose } from './fbs-stock-transfer';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FbsReshipmentRun, type FbsTsdAssembly, type FbsSupplyPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { canUseFbsReshipment, requireFbsReshipmentClientAccess } from './fbs-reshipment-access';
import { createRepeatAttemptData } from './fbs-repeat-assembly';
import { assertReshipmentEnabled, reshipmentCycle, reshipmentEligibility, reshipmentFingerprint, reshipmentHash, reshipmentVisibility, supplyRecoveryAction, type ReshipmentMode } from './fbs-reshipment';
import type { CheckFbsReshipmentDto, CreateFbsReshipmentDto, PreviewFbsReshipmentDto, ResumeFbsReshipmentDto } from './dto/fbs-reshipment.dto';

type Link = Prisma.FbsOrderRequestLinkGetPayload<{ include: { request: true } }>;
type OrderKey = { id: string; connectionId: string };
type Status = { supplierStatus: string; wbStatus: string };
type JournalRow = { id: string; connectionId: string; cycle: string; taskId: string; linkId: string;
  requestId: string; sourceSupplyId: string | null; taskRevision: string; linkRevision: string };
type Delivery = Pick<FbsSupplyPlan, 'deliveryDestination' | 'marketplaceWarehouseId' | 'marketplaceWarehouseName' |
  'destinationOfficeId' | 'destinationOfficeName' | 'itemsPerCargoPlace'>;
const identity = (order: OrderKey) => `${order.connectionId}:${order.id}`;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const linkRevision = (link: Link) => reshipmentHash([link.id, link.requestId, link.clientId, link.connectionId,
  link.orderId, link.request.warehouseId, link.syncStatus, link.lastSkuId, link.lastItemCount]);
// FIX: ignore cache-sync timestamps, but retain every physical/reservation fact.
const taskRevision = (task: FbsTsdAssembly) => {
  const { updatedAt: _updatedAt, supplyId: _supplyId, ...physicalFacts } = task;
  return reshipmentHash(physicalFacts);
};

@Injectable()
export class FbsReshipmentService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly connections: MarketplaceConnectionsService) {}

  capabilities(user: AuthUser) {
    return { enabled: canUseFbsReshipment(user) && process.env.WMS_FBS_RESHIPMENT_ENABLED === 'true' };
  }

  private async authorize(clientId: string, user: AuthUser) {
    assertReshipmentEnabled();
    requireFbsReshipmentClientAccess(user, clientId);
    this.scopes.requireClientAccess(user, clientId, 'write');
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId || (user.writableWarehouseIds && !user.writableWarehouseIds.includes(warehouseId))) {
      throw new ForbiddenException('Выберите доступный для работы филиал.');
    }
    const [client, warehouse] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true, isDemo: true } }),
      this.prisma.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true } }),
    ]);
    if (!client || client.isDemo || !warehouse) throw new ForbiddenException('Клиент или филиал недоступен.');
    return warehouseId;
  }

  private selection(dto: PreviewFbsReshipmentDto) {
    if (!['SAME_ITEM', 'NEW_ITEM'].includes(dto.mode) || !Array.isArray(dto.orders) || !dto.orders.length || dto.orders.length > 100 ||
      dto.orders.some(row => !row.id || !row.connectionId) || new Set(dto.orders.map(identity)).size !== dto.orders.length ||
      new Set(dto.orders.map(row => row.connectionId)).size !== 1) {
      throw new BadRequestException('Выберите от 1 до 100 неповторяющихся заказов одного кабинета WB и способ повторной отгрузки.');
    }
  }

  private async local(clientId: string, warehouseId: string, selected?: OrderKey[], discovered: { direct: OrderKey[]; linkIds: string[] } = { direct: [], linkIds: [] }) {
    const OR: Prisma.FbsOrderRequestLinkWhereInput[] = selected ? selected.map(row => ({ connectionId: row.connectionId, orderId: row.id })) : [
      { lastSupplierStatus: 'complete', lastCategory: 'shipped', lastSupplyId: { not: null } },
      ...discovered.direct.map(row => ({ connectionId: row.connectionId, orderId: row.id })),
      ...(discovered.linkIds.length ? [{ id: { in: discovered.linkIds } }] : []),
    ];
    // FIX: keyset pagination never truncates a mature client's history and does
    // not inspect arbitrary fresh/finished orders outside the discovery proof.
    const links: Link[] = []; const tasks: FbsTsdAssembly[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.fbsOrderRequestLink.findMany({ where: { clientId, marketplace: 'WILDBERRIES', request: { warehouseId }, OR },
        include: { request: true }, orderBy: { id: 'asc' }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      links.push(...page);
      if (page.length) tasks.push(...await this.prisma.fbsTsdAssembly.findMany({ where: { clientId, marketplace: 'WILDBERRIES',
        OR: page.map(row => ({ connectionId: row.connectionId, orderId: row.orderId })) } }));
      if (page.length < 1000) break;
      const last = page[page.length - 1].id;
      if (last === cursor) throw new ConflictException('История заказов изменилась во время чтения. Повторите проверку.');
      cursor = last;
    }
    return { links, tasks };
  }

  private async inspect(clientId: string, warehouseId: string, user: AuthUser, selected?: OrderKey[], purpose?: StockTransferPurpose) {
    const [direct, events] = await Promise.all([purpose ? Promise.resolve([]) : this.connections.readReshipmentWbCandidates(clientId, user),
      this.prisma.auditLog.findMany({ where: { action: 'FBS_WB_RETURNED_TO_ASSEMBLY', entity: 'FbsOrderRequestLink',
        payload: { path: ['clientId'], equals: clientId } }, select: { entityId: true, payload: true } })]);
    const local = await this.local(clientId, warehouseId, selected, { direct, linkIds: events.map(row => row.entityId).filter((id): id is string => !!id) });
    const returnEvidence = (task: FbsTsdAssembly | undefined, link: Link) => task ? events.find(event => {
      const payload = event.payload;
      return event.entityId === link.id && !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
        payload.clientId === clientId && payload.connectionId === task.connectionId && payload.orderId === task.orderId &&
        payload.requestId === task.requestId && payload.assemblyId === task.id && payload.sourceSupplyId &&
        payload.targetSupplyId === link.lastSupplyId && payload.supplierStatusFrom === 'complete' &&
        payload.supplierStatusTo === 'confirm' && payload.wbStatus === 'waiting';
    })?.payload : null;
    const keys = new Map<string, OrderKey>();
    for (const row of direct) keys.set(identity(row), row);
    for (const row of local.links) {
      const task = local.tasks.find(task => task.connectionId === row.connectionId && task.orderId === row.orderId);
      if ((row.lastSupplierStatus === 'complete' && row.lastCategory === 'shipped' && row.lastSupplyId) || returnEvidence(task, row)) {
        const key = { id: row.orderId, connectionId: row.connectionId }; keys.set(identity(key), key);
      }
    }
    if (selected) for (const row of selected) keys.set(identity(row), row);
    const values = [...keys.values()].filter(row => !selected || selected.some(item => identity(item) === identity(row)));
    const statuses = new Map<string, Status>();
    for (const connectionId of new Set(values.map(row => row.connectionId))) {
      const connectionRows = values.filter(row => row.connectionId === connectionId);
      for (let offset = 0; offset < connectionRows.length; offset += 100) {
        const current = connectionRows.slice(offset, offset + 100);
        const result = await this.connections.readReshipmentWbStatuses(clientId, connectionId, current.map(row => row.id), user);
        for (const row of current) { const status = result.get(row.id); if (status) statuses.set(identity(row), status); }
      }
    }
    return values.map(order => {
      const task = local.tasks.find(row => row.connectionId === order.connectionId && row.orderId === order.id);
      const link = local.links.find(row => row.connectionId === order.connectionId && row.orderId === order.id && row.requestId === task?.requestId);
      const status = statuses.get(identity(order)) ?? null;
      // FIX: retain WB-listed inconsistencies for review, without relaxing supply-match eligibility.
      const directListed = direct.some(row => identity(row) === identity(order));
      const directCandidate = direct.some(row => identity(row) === identity(order) && (!row.supplyId || row.supplyId === task?.supplyId));
      const evidence = link ? returnEvidence(task, link) : null;
      const returned = !!evidence || (!!task && !!link && link.lastSupplierStatus === 'complete' &&
        link.lastCategory === 'shipped' && !!link.lastSupplyId && link.lastSupplyId === task.supplyId);
      const historicalSupply = evidence && typeof evidence === 'object' && !Array.isArray(evidence) && typeof evidence.sourceSupplyId === 'string' ? evidence.sourceSupplyId : null;
      const modeReason = (mode: ReshipmentMode) => !task || !link || link.request.warehouseId !== warehouseId ? 'Нет подтверждённой сборки и заявки в выбранном филиале.' :
        purpose ? stockTransferBlockedReason(task, link, status) : reshipmentEligibility(task, link, status, directCandidate, mode, !!evidence);
      const eligibleModes = (['SAME_ITEM', 'NEW_ITEM'] as ReshipmentMode[]).filter(mode => !modeReason(mode));
      const blockedReason = eligibleModes.length ? null : modeReason('NEW_ITEM');
      return { task, link, status, directCandidate, visibility: reshipmentVisibility(status, directListed, returned), view: { ...order,
        sourceRequestNumber: link?.request.number ?? null, sourceSupplyId: historicalSupply ?? task?.supplyId ?? null,
        productName: task?.productName ?? null, article: task?.article ?? null,
        barcode: task?.barcode ?? (Array.isArray(task?.barcodes) ? String(task.barcodes[0] ?? '') : null),
        assemblyStatus: task?.status ?? null, supplierStatus: status?.supplierStatus ?? null, wbStatus: status?.wbStatus ?? null,
        eligibleModes, blockedReason,
      } };
    });
  }

  async check(dto: CheckFbsReshipmentDto, user: AuthUser) {
    const warehouseId = await this.authorize(dto.clientId, user);
    const [rows, runs] = await Promise.all([this.inspect(dto.clientId, warehouseId, user),
      this.prisma.fbsReshipmentRun.findMany({ where: { clientId: dto.clientId, warehouseId }, orderBy: { createdAt: 'desc' }, take: 50 })]);
    // FIX: filtering affects the check response only; mutation validation and recovery runs are independent.
    return { candidates: rows.filter(row => row.visibility === 'ACTIONABLE').map(row => row.view),
      unverifiedCount: rows.filter(row => row.visibility === 'UNVERIFIED').length,
      runs: await Promise.all(runs.map(run => this.view(run))) };
  }

  // FIX: the ordinary move button routes shortages separately; journal handles survive partial WB failures.
  async moveWithStockRouting(dto: FbsOrderSelectionDto, user: AuthUser) {
    if (process.env.WMS_FBS_NO_STOCK_TRANSFER_ENABLED !== 'true') return this.connections.moveFbsOrdersToNewSupply(dto, user);
    const warehouseId = await this.authorize(dto.clientId, user);
    const selection = await this.connections.prepareFbsStockTransfer(dto, user);
    const regular = selection.orders.filter(row => !row.noStock && row.supplierStatus !== 'complete');
    const routed = selection.orders.filter(row => row.noStock || row.supplierStatus === 'complete');
    const groups = new Map<string, typeof routed>();
    for (const row of routed) {
      const key = JSON.stringify([row.connectionId, row.warehouseId || row.officeId, row.cargoType, row.crossBorderType, row.noStock]);
      const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    }
    const planned = [];
    for (const group of groups.values()) for (let offset = 0; offset < group.length; offset += 100) {
      const rows = group.slice(offset, offset + 100);
      const purpose: StockTransferPurpose = rows[0].noStock ? 'NO_STOCK' : 'TRANSFER';
      const input = { clientId: dto.clientId, orders: rows.map(row => ({ id: row.id, connectionId: row.connectionId })), mode: 'NEW_ITEM' as const };
      planned.push({ input, purpose, plan: await this.plan(input, warehouseId, user, purpose) });
    }
    const transfers: Array<Awaited<ReturnType<FbsReshipmentService['view']>> & { orderCount: number }> = [];
    const errors: string[] = [];
    // Resolve an existing in-flight cycle via the same fingerprint before any second POST.
    for (const item of planned) {
      try { transfers.push({ ...await this.createPlanned({ ...item.input, confirm: true, previewToken: item.plan.previewToken },
        warehouseId, user, item.plan, item.purpose), orderCount: item.input.orders.length }); }
      catch (error) { errors.push(`${item.input.orders.map(row => row.id).join(', ')}: ${error instanceof Error ? error.message : 'Перенос не выполнен.'}`); }
    }
    let regularTransfer: Awaited<ReturnType<MarketplaceConnectionsService['moveFbsOrdersToNewSupply']>> | null = null;
    if (regular.length) {
      try { regularTransfer = await this.connections.moveFbsOrdersToNewSupply({ ...dto, orders: regular.map(row => ({ id: row.id, connectionId: row.connectionId })) }, user); }
      catch (error) { errors.push(`Заказы с остатком: ${error instanceof Error ? error.message : 'Перенос не выполнен.'}`); }
    }
    return { routedTransfer: true as const, transfers, regularTransfer, errors, skippedOrders: selection.skippedOrders };
  }

  private async plan(dto: PreviewFbsReshipmentDto, warehouseId: string, user: AuthUser, purpose?: StockTransferPurpose) {
    this.selection(dto);
    const inspected = await this.inspect(dto.clientId, warehouseId, user, dto.orders, purpose);
    const rows = dto.orders.map(order => {
      const row = inspected.find(row => identity(row.view) === identity(order));
      if (!row?.task || !row.link || !row.view.eligibleModes.includes(dto.mode)) {
        throw new ConflictException(`Заказ ${order.id}: ${row?.view.blockedReason ?? 'не подтверждён WB для повторной отгрузки'}`);
      }
      return { ...row, task: row.task, link: row.link };
    }).sort((a, b) => identity(a.view).localeCompare(identity(b.view)));
    const journal = rows.map(row => ({ id: row.task.orderId, connectionId: row.task.connectionId,
      cycle: reshipmentCycle(row.task), taskId: row.task.id, linkId: row.link.id, requestId: row.task.requestId,
      sourceSupplyId: row.task.supplyId, taskRevision: taskRevision(row.task), linkRevision: linkRevision(row.link) }));
    const plans = await this.prisma.fbsSupplyPlan.findMany({ where: { clientId: dto.clientId, marketplace: 'WILDBERRIES',
      connectionId: dto.orders[0].connectionId, supplyId: { in: rows.map(row => row.view.sourceSupplyId).filter((id): id is string => !!id) } } });
    const fallback = purpose && rows.some(row => !row.view.sourceSupplyId) ? await this.connections.stockTransferDefaultDelivery(dto.clientId) : null;
    const deliveryPlans = rows.map(row => {
      const plan = plans.find(plan => plan.supplyId === row.view.sourceSupplyId) ?? (!row.view.sourceSupplyId ? fallback : null);
      if (!plan || !['PICKUP_POINT', 'VNUKOVO_SORTING_CENTER'].includes(plan.deliveryDestination)) {
        throw new ConflictException(`Для заказа ${row.task.orderId} неизвестно назначение прежней поставки. Сначала укажите его в WMS.`);
      }
      const delivery: Delivery = { deliveryDestination: plan.deliveryDestination, marketplaceWarehouseId: plan.marketplaceWarehouseId,
        marketplaceWarehouseName: plan.marketplaceWarehouseName, destinationOfficeId: plan.destinationOfficeId,
        destinationOfficeName: plan.destinationOfficeName, itemsPerCargoPlace: plan.itemsPerCargoPlace };
      return delivery;
    });
    if (new Set(deliveryPlans.map(reshipmentHash)).size !== 1) throw new ConflictException('Разные назначения поставок: создайте отдельную заявку для каждого назначения.');
    const delivery = deliveryPlans[0];
    return { rows, journal, delivery, previewToken: reshipmentHash([dto.clientId, warehouseId, dto.mode, journal, delivery, ...(purpose ? [purpose] : [])]) };
  }

  async preview(dto: PreviewFbsReshipmentDto, user: AuthUser) {
    const warehouseId = await this.authorize(dto.clientId, user);
    const plan = await this.plan(dto, warehouseId, user);
    return { orders: plan.rows.map(row => row.view), orderCount: plan.rows.length,
      additionalUnits: dto.mode === 'NEW_ITEM' ? plan.rows.filter(row => row.task.status === 'COMPLETED').length : 0, previewToken: plan.previewToken,
      warning: dto.mode === 'SAME_ITEM' ? 'Довезти уже собранное: прежние КИЗ, сборка и списания сохраняются. Вторую вещь не брать.' :
        'Собрать заново: вы подтверждаете новый физический отбор и дополнительное списание при сканировании. Прежняя история сохраняется.' };
  }

  async create(dto: CreateFbsReshipmentDto, user: AuthUser) {
    const warehouseId = await this.authorize(dto.clientId, user); this.selection(dto);
    if (dto.confirm !== true || !/^[a-f0-9]{64}$/.test(dto.previewToken)) throw new BadRequestException('Подтвердите предварительную проверку и выбранный способ.');
    // FIX: resolve a lost response before re-reading now-changed WB/task state.
    const previous = await this.prisma.fbsReshipmentRun.findFirst({ where: { clientId: dto.clientId, warehouseId,
      previewToken: dto.previewToken, mode: dto.mode } });
    if (previous) {
      if (reshipmentHash(dto.orders.map(identity).sort()) !== reshipmentHash(this.journal(previous).map(identity).sort())) {
        throw new BadRequestException('Изменён состав заказов подтверждённой операции. Повторите предварительную проверку.');
      }
      return this.drive(previous.id, dto.clientId, warehouseId, user);
    }
    const plan = await this.plan(dto, warehouseId, user);
    if (plan.previewToken !== dto.previewToken) throw new ConflictException('Данные изменились. Повторите предварительную проверку.');
    return this.createPlanned(dto, warehouseId, user, plan);
  }

  private async createPlanned(dto: CreateFbsReshipmentDto, warehouseId: string, user: AuthUser,
    plan: Awaited<ReturnType<FbsReshipmentService['plan']>>, purpose?: StockTransferPurpose) {
    const fingerprint = reshipmentFingerprint(dto.clientId, warehouseId, dto.mode, plan.journal);
    const id = randomUUID();
    let run: FbsReshipmentRun;
    try {
      run = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))::text`;
        const existing = await tx.fbsReshipmentRun.findUnique({ where: { fingerprint } });
        if (existing) {
          if (this.transferPurpose(existing) !== purpose) throw new ConflictException('У заказа уже есть другая операция. Продолжите её через журнал.');
          return existing;
        }
        const created = await tx.fbsReshipmentRun.create({ data: { id, fingerprint, previewToken: dto.previewToken,
          clientId: dto.clientId, warehouseId, connectionId: dto.orders[0].connectionId, mode: dto.mode,
          // FIX: journal supplyName is unique in the DB; the WB display name is derived separately.
          supplyName: `WMS-RES-${id}`, createdByUserId: user.id,
          sourceRequestIds: [...new Set(plan.journal.map(row => row.requestId))],
          snapshot: json({ ...(purpose ? { transferPurpose: purpose } : {}), orders: plan.journal, delivery: plan.delivery, physicalEvidence: plan.rows.map(row => ({ task: row.task, link: row.link })) }) } });
        // FIX: unique per-order cycle claims also protect overlapping selections.
        await tx.fbsReshipmentClaim.createMany({ data: plan.journal.map(row => ({ runId: id, connectionId: row.connectionId, orderId: row.id, cycle: row.cycle })) });
        return created;
      }, { isolationLevel: 'Serializable', timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const existing = await this.prisma.fbsReshipmentRun.findUnique({ where: { fingerprint } });
        if (existing) return this.drive(existing.id, dto.clientId, warehouseId, user);
        throw new ConflictException('Один из заказов уже включён в другую операцию повторной отгрузки. Новые изменения WB не выполнены.');
      }
      throw error;
    }
    return this.drive(run.id, dto.clientId, warehouseId, user);
  }

  async resume(dto: ResumeFbsReshipmentDto, user: AuthUser) {
    const warehouseId = await this.authorize(dto.clientId, user);
    return this.drive(dto.runId, dto.clientId, warehouseId, user);
  }

  private journal(run: FbsReshipmentRun): JournalRow[] {
    const snapshot = run.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.orders)) throw new ConflictException('Журнал операции повреждён.');
    return snapshot.orders.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConflictException('Строка журнала повреждена.');
      for (const field of ['id', 'connectionId', 'cycle', 'taskId', 'linkId', 'requestId', 'taskRevision', 'linkRevision']) {
        if (typeof value[field] !== 'string' || !value[field]) throw new ConflictException('Строка журнала неполная.');
      }
      return value as unknown as JournalRow;
    });
  }

  private async freshStatuses(run: FbsReshipmentRun, rows: JournalRow[], user: AuthUser, mustConfirm = false) {
    const statuses = await this.connections.readReshipmentWbStatuses(run.clientId, run.connectionId, rows.map(row => row.id), user);
    for (const row of rows) {
      const status = statuses.get(row.id);
      if (!status || status.wbStatus !== 'waiting' || !(mustConfirm ? ['confirm'] : ['complete', 'confirm']).includes(status.supplierStatus)) {
        throw new ConflictException(`Заказ ${row.id}: WB не подтверждает ${mustConfirm ? 'возврат в сборку' : 'возможность повторной отгрузки'}. Проверьте отмену или получение.`);
      }
    }
  }

  private async validateBeforeMutation(run: FbsReshipmentRun, rows: JournalRow[], user: AuthUser) {
    const purpose = this.transferPurpose(run);
    if (purpose && process.env.WMS_FBS_NO_STOCK_TRANSFER_ENABLED !== 'true') throw new ForbiddenException('Перенос с проверкой остатка отключён.');
    const inspected = await this.inspect(run.clientId, run.warehouseId, user, rows, purpose);
    for (const row of rows) {
      const current = inspected.find(item => identity(item.view) === identity(row));
      if (!current?.task || !current.link || !current.view.eligibleModes.includes(run.mode as ReshipmentMode) ||
        taskRevision(current.task) !== row.taskRevision || linkRevision(current.link) !== row.linkRevision ||
        ![row.sourceSupplyId, run.supplyId].includes(current.task.supplyId)) {
        throw new ConflictException(`Заказ ${row.id}: физическая сборка или разрешение WB изменились; новая запись WB не выполнена.`);
      }
    }
  }

  private async drive(id: string, clientId: string, warehouseId: string, user: AuthUser) {
    let run = await this.prisma.fbsReshipmentRun.findFirst({ where: { id, clientId, warehouseId } });
    if (!run) throw new NotFoundException('Операция не найдена в выбранном клиенте и филиале.');
    if (run.status === 'CREATED') {
      if (this.transferPurpose(run) && run.phase === 'SOURCE_SYNC_PENDING') await this.finishSourceSync(run);
      return this.view((await this.prisma.fbsReshipmentRun.findUnique({ where: { id } }))!);
    }
    const leaseToken = randomUUID();
    const lease = await this.prisma.fbsReshipmentRun.updateMany({ where: { id, status: { not: 'CREATED' },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 180_000), errorMessage: null } });
    if (lease.count !== 1) return this.view(run);
    // FIX: the predecessor may have committed WB_CREATE_STARTED between our
    // initial read and lease acquisition. Never decide POST from that stale read.
    run = (await this.prisma.fbsReshipmentRun.findUnique({ where: { id } }))!;
    const save = async (data: Prisma.FbsReshipmentRunUpdateManyMutationInput) => {
      const saved = await this.prisma.fbsReshipmentRun.updateMany({ where: { id, leaseToken }, data });
      if (saved.count !== 1) throw new ConflictException('Операция продолжена другим процессом. Повторите проверку журнала.');
      run = (await this.prisma.fbsReshipmentRun.findUnique({ where: { id } }))!;
    };
    const fence = async () => {
      const renewed = await this.prisma.fbsReshipmentRun.updateMany({ where: { id, leaseToken, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + 180_000) } });
      if (renewed.count !== 1) throw new ConflictException('Срок владения операцией истёк. Запись WB не выполнена; повторите сверку.');
    };
    try {
      const rows = this.journal(run);
      await this.validateBeforeMutation(run, rows, user);
      if (!run.supplyId) {
        // FIX: fixed display names are not operation identifiers. Never adopt another transfer's supply.
        // A lost POST response stays in the journal for manual reconciliation; never repeat that POST.
        const found = this.transferPurpose(run) === 'NO_STOCK' ? null :
          await this.connections.findReshipmentWbSupply(clientId, run.connectionId, run.supplyName, user);
        const action = supplyRecoveryAction(run.phase, found);
        if (action === 'RECONCILE_ONLY') throw new ConflictException(this.transferPurpose(run) === 'NO_STOCK'
          ? 'Ответ WB при создании поставки неизвестен. Требуется ручная сверка идентификатора поставки администратором. Повторно поставку не создаём.'
          : 'Ответ WB при создании поставки неизвестен. Новую поставку повторно не создаём; повторите сверку позже.');
        if (found) await save({ supplyId: found.id, phase: 'SUPPLY_READY' });
        else {
          // FIX: durable intent BEFORE POST; any crash after this point is read-only recovery.
          await this.validateBeforeMutation(run, rows, user);
          await fence();
          await save({ phase: 'WB_CREATE_STARTED' });
          const supplyId = await this.connections.createReshipmentWbSupply(clientId, run.connectionId, this.supplyDisplayName(run), user);
          await save({ supplyId, phase: 'SUPPLY_READY' });
        }
      }
      const supplyId = run.supplyId!;
      let supply = await this.connections.readReshipmentWbSupply(clientId, run.connectionId, supplyId, user);
      if (supply.done) throw new ConflictException('Целевая поставка уже закрыта. Требуется сверка.');
      if (supply.id !== supplyId || supply.orderIds.some(orderId => !rows.some(row => row.id === orderId))) {
        throw new ConflictException('Поставка содержит посторонние заказы или её идентификатор не совпадает с журналом. Требуется сверка.');
      }
      const missing = rows.filter(row => !supply.orderIds.includes(row.id));
      if (missing.length) {
        await this.validateBeforeMutation(run, rows, user);
        await fence();
        await save({ phase: 'WB_MOVE_STARTED' });
        await this.connections.addReshipmentWbOrders(clientId, run.connectionId, supplyId, missing.map(row => row.id), user);
        supply = await this.connections.readReshipmentWbSupply(clientId, run.connectionId, supplyId, user);
      }
      if (supply.id !== supplyId || supply.done || rows.some(row => !supply.orderIds.includes(row.id)) ||
        supply.orderIds.some(orderId => !rows.some(row => row.id === orderId))) throw new ConflictException('WB ещё не подтвердил точный состав поставки. Повторите сверку; новая заявка не создана.');
      await this.freshStatuses(run, rows, user, true);
      await fence();
      await save({ phase: 'WB_VERIFIED' });
      await this.finalize(run, rows, leaseToken, user);
      if (this.transferPurpose(run)) await this.finishSourceSync(run);
      this.connections.invalidateRepeatAssemblyCache(clientId);
    } catch (error) {
      // Return the durable operation handle even for an unknown remote outcome.
      // FIX: post-commit cache/response failure must never downgrade success.
      await this.prisma.fbsReshipmentRun.updateMany({ where: { id, leaseToken, status: { not: 'CREATED' } }, data: {
        status: 'NEEDS_RECONCILIATION', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Ошибка сверки WB.',
      } });
    } finally {
      await this.prisma.fbsReshipmentRun.updateMany({ where: { id, leaseToken }, data: { leaseToken: null, leaseUntil: null } });
    }
    return this.view((await this.prisma.fbsReshipmentRun.findUnique({ where: { id } }))!);
  }

  private async finalize(run: FbsReshipmentRun, rows: JournalRow[], leaseToken: string, user: AuthUser) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FbsReshipmentRun" WHERE id = ${run.id} FOR UPDATE`;
      const current = await tx.fbsReshipmentRun.findUnique({ where: { id: run.id } });
      if (current?.status === 'CREATED') return;
      if (!current || current.leaseToken !== leaseToken || current.phase !== 'WB_VERIFIED') throw new ConflictException('Состояние операции изменилось.');
      const tasks = await tx.fbsTsdAssembly.findMany({ where: { id: { in: rows.map(row => row.taskId) } } });
      const links = await tx.fbsOrderRequestLink.findMany({ where: { id: { in: rows.map(row => row.linkId) } }, include: { request: true } });
      const selected = rows.map(row => {
        const task = tasks.find(task => task.id === row.taskId); const link = links.find(link => link.id === row.linkId);
        if (!task || !link || (this.transferPurpose(run) && stockTransferBlockedReason(task, link, { supplierStatus: 'confirm', wbStatus: 'waiting' })) || taskRevision(task) !== row.taskRevision || linkRevision(link) !== row.linkRevision ||
          task.clientId !== run.clientId || link.request.warehouseId !== run.warehouseId ||
          ![row.sourceSupplyId, run.supplyId].includes(task.supplyId)) throw new ConflictException(`Сборка заказа ${row.id} изменилась. WB перенос проверен, но новая заявка требует сверки.`);
        return { row, task, link };
      });
      const groups = new Map<string, { skuId: string; name: string; barcode: string | null; quantity: number; comment: string }>();
      for (const { task } of selected) {
        const group = groups.get(task.skuId);
        if (group) { group.quantity++; group.comment += `, ${task.orderId}`; }
        else groups.set(task.skuId, { skuId: task.skuId, name: task.productName, barcode: task.barcode,
          quantity: 1, comment: `FBS-заказы: ${task.orderId}` });
      }
      const now = new Date(); const sourceNumbers = [...new Set(selected.map(row => row.link.request.number))];
      const snapshot = run.snapshot;
      const delivery = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.delivery : null;
      if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery) ||
        !['PICKUP_POINT', 'VNUKOVO_SORTING_CENTER'].includes(String(delivery.deliveryDestination))) throw new ConflictException('Назначение поставки отсутствует в журнале.');
      // FIX: a new supply must be visible to cargo-packing, without copying old
      // cargo ids, sent/ignored flags or a historic planned delivery date.
      await tx.fbsSupplyPlan.create({ data: { ...(delivery as Delivery), clientId: run.clientId, marketplace: 'WILDBERRIES',
        connectionId: run.connectionId, supplyId: run.supplyId!, orderIds: rows.map(row => row.id),
        cargoPlaceCount: 0, cargoPlaceIds: [], cargoPlaceBarcodes: {}, createdByUserId: user.id } });
      const request = await tx.clientRequest.create({ data: { clientId: run.clientId, warehouseId: run.warehouseId,
        type: 'OUTBOUND', status: 'IN_WORK', priority: 'HIGH', title: this.transferPurpose(run) === 'NO_STOCK' ? NO_STOCK_SUPPLY_NAME : `${run.mode === 'SAME_ITEM' ? 'Довоз собранного' : 'Повторная сборка'} WB — ${rows.length} заказов`,
        destinationCity: 'Повторная отгрузка WB', comment: `Поставка WB: ${run.supplyId}. Исходные заявки: ${sourceNumbers.join(', ')}. ` +
          (this.transferPurpose(run) ? 'ПЕРЕНОС НЕОТОБРАННОГО ТОВАРА. Списание только при физической сборке.' : run.mode === 'SAME_ITEM' ? 'ДОВОЗ УЖЕ СОБРАННОГО. Прежние КИЗ и списания сохранены; второй отбор запрещён.' : 'НОВЫЙ ФИЗИЧЕСКИЙ ОТБОР. Дополнительный расход подтверждён пользователем; списание только при сканировании.'),
        createdByUserId: user.id, items: { create: [...groups.values()] } }, include: { items: true } });
      for (const { task, link } of selected) {
        const item = request.items.find(item => item.skuId === task.skuId)!;
        let data: Prisma.FbsTsdAssemblyUpdateManyMutationInput = { requestId: request.id, requestItemId: item.id, supplyId: run.supplyId };
        if (this.transferPurpose(run) === 'NO_STOCK') {
          // FIX: transfer the existing untouched task; do not invent a second physical attempt.
          data = { ...data, status: 'WAITING_STOCK', reservedBoxId: null, reservedBoxCode: null, reservedAt: null,
            deviceCode: 'AUTO', workerUserId: null, workerName: null, storageBoxes: [],
            errorMessage: 'Перенесён в поставку logoff нет на складе. Ожидается доступный товар.' };
        } else if (run.mode === 'NEW_ITEM' && !this.transferPurpose(run)) {
          const successorId = randomUUID();
          if (task.status === 'COMPLETED' && task.completedAt) await tx.fbsAssemblyAttemptHistory.create({ data: { id: task.id, clientId: task.clientId, requestId: task.requestId,
            orderId: task.orderId, workerUserId: task.workerUserId, completedAt: task.completedAt!, successorId,
            repeatRunId: run.id, taskSnapshot: json(task), kiz: task.kiz, linkSnapshot: json(link), archivedByUserId: user.id } });
          data = { ...createRepeatAttemptData(task, successorId, request.id, item.id, now), supplyId: run.supplyId };
        }
        const changed = await tx.fbsTsdAssembly.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, requestId: task.requestId }, data });
        const linked = await tx.fbsOrderRequestLink.updateMany({ where: { id: link.id, updatedAt: link.updatedAt, requestId: link.requestId },
          data: { requestId: request.id, syncStatus: 'ACTIVE', syncIssue: null, lastSupplierStatus: 'confirm', lastWbStatus: 'waiting',
            lastCategory: 'active', lastSupplyId: run.supplyId, lastSkuId: task.skuId, lastItemCount: task.itemCount, lastSeenAt: now } });
        if (changed.count !== 1 || linked.count !== 1) throw new ConflictException('Параллельное изменение сборки. Заявка не создана.');
      }
      if (this.transferPurpose(run)) for (const requestId of new Set(rows.map(row => row.requestId))) {
        await tx.clientRequestEvent.create({ data: { requestId, clientId: run.clientId, eventType: 'COMMENT',
          title: 'Неотобранные заказы перенесены', body: `Поставка ${run.supplyId}, заявка №${request.number}. Заказы: ${rows.filter(row => row.requestId === requestId).map(row => row.id).join(', ')}.`, createdByUserId: user.id } });
      }
      await tx.clientRequestEvent.create({ data: { requestId: request.id, clientId: run.clientId, eventType: 'CREATED',
        title: 'Повторная отгрузка WB', body: `Операция ${run.id}; исходные заявки ${sourceNumbers.join(', ')}.`, statusTo: 'IN_WORK', createdByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'FBS_RESHIPMENT_CREATED', entity: 'ClientRequest', entityId: request.id,
        payload: { runId: run.id, mode: run.mode, supplyId: run.supplyId, orderIds: rows.map(row => row.id), previousRequestIds: rows.map(row => row.requestId),
          physicalStockMutationPerformed: false, additionalStockConsumptionConfirmed: !this.transferPurpose(run) && run.mode === 'NEW_ITEM' } } });
      await tx.fbsReshipmentRun.update({ where: { id: run.id }, data: { status: 'CREATED', phase: this.transferPurpose(run) ? 'SOURCE_SYNC_PENDING' : 'COMPLETED', requestId: request.id, errorMessage: null } });
    }, { isolationLevel: 'Serializable', timeout: 60_000 });
  }

  // FIX: a crash after local commit leaves a resumable source-composition step, without repeating WB mutations.
  private async finishSourceSync(run: FbsReshipmentRun) {
    try {
      await this.connections.finishStockTransferRequests(run.clientId, run.connectionId, run.supplyId!, this.journal(run));
      await this.prisma.fbsReshipmentRun.updateMany({ where: { id: run.id, status: 'CREATED', phase: 'SOURCE_SYNC_PENDING' },
        data: { phase: 'COMPLETED', errorMessage: null } });
    } catch (error) {
      await this.prisma.fbsReshipmentRun.updateMany({ where: { id: run.id, status: 'CREATED', phase: 'SOURCE_SYNC_PENDING' },
        data: { errorMessage: `Перенос подтверждён. Требуется пересчёт исходной заявки: ${error instanceof Error ? error.message : 'ошибка синхронизации'}` } });
    }
  }

  private supplyDisplayName(run: FbsReshipmentRun) {
    return this.transferPurpose(run) === 'NO_STOCK' ? NO_STOCK_SUPPLY_NAME : run.supplyName;
  }

  private transferPurpose(run: FbsReshipmentRun): StockTransferPurpose | undefined {
    const snapshot = run.snapshot;
    const purpose = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.transferPurpose : null;
    return purpose === 'NO_STOCK' || purpose === 'TRANSFER' ? purpose : undefined;
  }

  private async view(run: FbsReshipmentRun) {
    const request = run.requestId ? await this.prisma.clientRequest.findUnique({ where: { id: run.requestId }, select: { number: true } }) : null;
    return { runId: run.id, status: run.status, mode: run.mode, supplyName: this.supplyDisplayName(run), transferPurpose: this.transferPurpose(run) ?? null, supplyId: run.supplyId, requestId: run.requestId,
      requestNumber: request?.number ?? null, sourceSyncPending: this.transferPurpose(run) ? run.phase === 'SOURCE_SYNC_PENDING' : false, errorMessage: run.errorMessage ?? null };
  }
}
