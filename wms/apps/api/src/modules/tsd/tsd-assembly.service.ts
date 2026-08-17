import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClientRequestStatus,
  ClientRequestType,
  MovementType,
  PickWaveBalanceReviewStatus,
  PickWaveStatus,
  Prisma,
  TsdOperationStatus,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PickInstructionService } from '../stock/pick-instruction.service';
import type { PickInstructionDocument } from '../stock/pick-instruction.types';
import { FbsRequestBoxAuditService } from '../stock/fbs-request-box-audit.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  assertWarehouseAccess,
  effectiveWarehouseId,
  warehouseScopeWhere,
} from '../client-requests/client-request-warehouse-scope';

const activeAssemblyStatuses = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
];
const FBS_KIZ_DUPLICATE_SCAN_ACTION = 'FBS_KIZ_DUPLICATE_SCAN';
const FBS_KIZ_LOCAL_STATUS_CONFLICT_ACTION = 'FBS_KIZ_LOCAL_STATUS_CONFLICT';

type TsdRequestStage = 'box-search' | 'relabel' | 'moves' | 'boxless-packing';

type TsdProcessSummary = {
  stage: string;
  stageLabel: string;
  deviceCode: string;
  workerName: string | null;
  updatedAt: string;
  foundCount: number;
  foundBoxCodes: string[];
  totalBoxCount?: number;
  progressText: string;
};

type TsdMovementPlanTask = {
  sourceBox: string;
  targetBox: string;
  purpose: 'BALANCE' | 'SHIPMENT' | string;
  targetRole: 'STOCK' | 'SHIPMENT' | string;
  barcode?: string;
  name?: string;
  size?: string;
  quantity: number;
  note?: string;
};

@Injectable()
export class TsdAssemblyService {
  private readonly instructionCache = new Map<string, { expiresAt: number; promise: Promise<PickInstructionDocument & { html?: string }> }>();
  // The web preview used to request the same expensive instruction every
  // 1.5 seconds. A short shared cache protects StockMovement aggregation from
  // duplicate browser tabs while all mutating TSD actions still invalidate it.
  private readonly instructionCacheTtlMs = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly pickInstructions: PickInstructionService,
    private readonly stockOperations: StockOperationsService,
    private readonly fbsRequestBoxAudits: FbsRequestBoxAuditService,
  ) {}

  async listActiveRequests(user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: clientFilter,
        ...warehouseScopeWhere(user),
        type: ClientRequestType.OUTBOUND,
        status: { in: activeAssemblyStatuses },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        destinationCity: true,
        desiredDate: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true, code: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        pickWaveRequests: {
          where: { wave: { status: { in: [PickWaveStatus.BALANCE_REVIEW, PickWaveStatus.FROZEN, PickWaveStatus.PICKING] } } },
          select: {
            wave: { select: { id: true, waveNumber: true, status: true, balanceReviewStatus: true } },
          },
          take: 1,
        },
        _count: { select: { items: true } },
      },
    });
    const activeProcesses = await this.loadActiveTsdProcesses(requests.map((request) => request.id));

    return requests.map((request) => ({
      id: request.id,
      requestId: request.id,
      title: request.title,
      name: request.title,
      status: request.status,
      city: request.destinationCity,
      destinationCity: request.destinationCity,
      deliveryCity: request.destinationCity,
      cityName: request.destinationCity,
      destination: request.destinationCity,
      deliveryDestination: request.destinationCity,
      desiredDate: request.desiredDate?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      client: request.client,
      rowsCount: request._count.items,
      itemsCount: request._count.items,
      itemCount: request._count.items,
      linesCount: request._count.items,
      inWorkBy: request.assignedTo
        ? {
            id: request.assignedTo.id,
            name: request.assignedTo.name,
            email: request.assignedTo.email,
          }
        : null,
      activeTsdProcess: activeProcesses.get(request.id)?.[0] ?? null,
      activeTsdProcesses: activeProcesses.get(request.id) ?? [],
      pickWave: request.pickWaveRequests[0]?.wave ?? null,
      balanceReviewPending:
        request.pickWaveRequests[0]?.wave.balanceReviewStatus === PickWaveBalanceReviewStatus.PENDING ||
        request.pickWaveRequests[0]?.wave.balanceReviewStatus === PickWaveBalanceReviewStatus.SUBMITTED,
    }));
  }

  async getRequestPlan(requestId: string, user: AuthUser) {
    const exists = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        warehouseId: true,
        client: { select: { storesWithoutBoxes: true } },
        pickWaveRequests: {
          where: { wave: { status: PickWaveStatus.BALANCE_REVIEW } },
          select: { wave: { select: { waveNumber: true, balanceReviewStatus: true } } },
          take: 1,
        },
      },
    });
    if (!exists) {
      throw new NotFoundException('Заявка для ТСД не найдена.');
    }

    this.clientScopes.requireClientAccess(user, exists.clientId, 'read');
    assertWarehouseAccess(user, exists, 'read', 'Заявка для ТСД не найдена в выбранном филиале.');
    const pendingWave = exists.pickWaveRequests[0]?.wave;
    if (
      pendingWave &&
      (pendingWave.balanceReviewStatus === PickWaveBalanceReviewStatus.PENDING ||
        pendingWave.balanceReviewStatus === PickWaveBalanceReviewStatus.SUBMITTED)
    ) {
      throw new BadRequestException(
        `Волна ${pendingWave.waveNumber} ожидает проверки балансов клиентом. Сборка еще не зафиксирована.`,
      );
    }
    const document = await this.getCachedInstruction(requestId, user);
    const plan = await this.toTsdPlan(document);
    return {
      ...plan,
      storesWithoutBoxes: exists.client.storesWithoutBoxes,
      assemblyMode: exists.client.storesWithoutBoxes ? 'BOXLESS_PACKING' : 'BOX_WORKFLOW',
    };
  }

  async assertRelabelProgressAvailable(requestId: string, payload: Record<string, unknown>, user: AuthUser) {
    await this.requireRequestAccess(requestId, user, 'write');
    // В этой инсталляции одна и та же физическая позиция может повторно
    // проходить переклейку. Не блокируем сканирование по рассчитанному
    // остатку очереди: фактический ШК/КИЗ и итог заявки проверяются дальше.
    await this.getRequestPlan(requestId, user);
    void payload;
  }

  async assertMovementProgressAvailable(requestId: string, payload: Record<string, unknown>, user: AuthUser) {
    await this.requireRequestAccess(requestId, user, 'write');
    const plan = await this.getRequestPlan(requestId, user);
    const sourceBox = normalizeBoxCode(textValue(payload, 'fromBoxCode'));
    const barcode = normalizeScanCode(textValue(payload, 'barcode'));
    const quantity = Math.max(1, Number(payload.quantity) || 1);
    const rows = plan.movementProgress?.rows ?? [];
    const remaining = rows
      .filter(
        (row: Record<string, unknown>) =>
          normalizeBoxCode(textValue(row, 'sourceBox')) === sourceBox && normalizeScanCode(textValue(row, 'barcode')) === barcode,
      )
      .reduce((sum: number, row: Record<string, unknown>) => sum + Math.max(0, Number(row.remainingQuantity) || 0), 0);
    if (remaining < quantity) {
      throw new BadRequestException('Эта позиция перемещения уже выполнена другим сборщиком. Обновите заявку на ТСД.');
    }
  }

  async assertOutgoingBoxAvailable(requestId: string, payload: Record<string, unknown>, user: AuthUser) {
    await this.requireRequestAccess(requestId, user, 'write');
    const plan = await this.getRequestPlan(requestId, user);
    const boxCode = normalizeBoxCode(textValue(payload, 'boxCode'));
    if (!(plan.outgoingBoxCodes ?? []).some((value: string) => normalizeBoxCode(value) === boxCode)) {
      throw new BadRequestException('Короб не входит в актуальный список коробов на отправку. Обновите заявку на ТСД.');
    }
    if ((plan.confirmedOutgoingBoxCodes ?? []).some((value: string) => normalizeBoxCode(value) === boxCode)) {
      throw new BadRequestException('Этот короб уже был пропикан и подтвержден к отгрузке. Повторный скан отклонен.');
    }
  }

  async getOutgoingBoxesXlsx(requestId: string, user: AuthUser) {
    const document = await this.loadInstructionWithAccess(requestId, user);
    const plan = await this.toTsdPlan(document);
    const outgoingBoxes = Array.isArray(plan.outgoingBoxes) ? plan.outgoingBoxes : [];
    const rows: Array<Array<string | number>> = [
      ['№', 'Короб', 'Тип', 'Из короба', 'Статус', 'Город', 'Паллет', 'Количество'],
      ...outgoingBoxes.map((box, index) => [
        index + 1,
        box.boxCode,
        box.typeLabel,
        box.sourceBox || '',
        box.status || '',
        box.city || document.destinationCity || '',
        box.pallet || '',
        box.quantity || '',
      ]),
    ];

    return {
      fileName: `outgoing-boxes-${safeFileName(document.requestTitle)}-${document.requestId.slice(0, 8)}.xlsx`,
      mimeType: xlsxMimeType(),
      content: buildWorkbook(rows, 'Короба на отправку', [8, 28, 20, 30, 24, 22, 18, 14]),
    };
  }

  async getOutgoingContentsXlsx(requestId: string, user: AuthUser) {
    const document = await this.loadInstructionWithAccess(requestId, user);
    const plan = await this.toTsdPlan(document);
    const actualRows = plan.movementProgress?.actualRows ?? [];
    const wholeBoxCodes = new Set(document.warehouseWholeBoxes.map((row) => normalizeBoxCode(row.box)).filter(Boolean));
    const rows: Array<Array<string | number>> = [
      ['№', 'Короб', 'Тип', 'Из короба', 'ШК', 'Наименование', 'Размер', 'Количество', 'Город', 'Паллет', 'Примечание'],
    ];

    for (const row of document.warehouseRows) {
      if (!wholeBoxCodes.has(normalizeBoxCode(row.sourceBox)) || row.quantity <= 0) {
        continue;
      }
      rows.push([
        rows.length,
        row.sourceBox,
        'Целый короб',
        row.sourceBox,
        row.barcodeOnBox,
        row.artOnBox,
        row.size,
        row.quantity,
        row.city || document.destinationCity || '',
        row.pallet,
        row.comment || row.note || '',
      ]);
    }

    for (const row of actualRows) {
      if (row.purpose !== 'SHIPMENT' || row.quantity <= 0) {
        continue;
      }
      rows.push([
        rows.length,
        row.targetBox,
        'Короб поставки',
        row.sourceBox,
        row.barcode,
        row.name ?? '',
        row.size ?? '',
        row.quantity,
        document.destinationCity ?? '',
        '',
        'Собран после перемещения',
      ]);
    }

    return {
      fileName: `outgoing-contents-${safeFileName(document.requestTitle)}-${document.requestId.slice(0, 8)}.xlsx`,
      mimeType: xlsxMimeType(),
      content: buildWorkbook(rows, 'Состав коробов', [8, 28, 20, 30, 22, 44, 16, 14, 22, 18, 28]),
    };
  }

  async getMovementsXlsx(requestId: string, user: AuthUser) {
    const document = await this.loadInstructionWithAccess(requestId, user);
    const plan = await this.toTsdPlan(document);
    const movementRows = plan.movementProgress?.rows ?? [];
    const rows: Array<Array<string | number>> = [
      [
        '№',
        'Из короба',
        'Куда',
        'ШК',
        'Наименование',
        'Размер',
        'Нужно переместить',
        'Уже перемещено',
        'Осталось',
        'Назначение',
        'Примечание',
      ],
      ...movementRows.map((row, index) => [
        index + 1,
        row.sourceBox,
        movementTargetsText(row),
        row.barcode ?? '',
        row.name ?? '',
        row.size ?? '',
        row.requiredQuantity ?? row.quantity,
        row.movedQuantity ?? 0,
        row.remainingQuantity ?? row.quantity,
        movementPurposeLabel(row.purpose, row.targetRole),
        row.note ?? '',
      ]),
    ];

    if (rows.length === 1) {
      rows.push(['', '', '', '', 'Перемещения по заявке не требуются', '', 0, 0, 0, '', '']);
    }

    return {
      fileName: `movements-${safeFileName(document.requestTitle)}-${document.requestId.slice(0, 8)}.xlsx`,
      mimeType: xlsxMimeType(),
      content: buildWorkbook(rows, 'Перемещения', [8, 28, 30, 22, 44, 16, 16, 16, 16, 22, 42]),
    };
  }

  private async loadInstructionWithAccess(requestId: string, user: AuthUser) {
    const exists = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true, warehouseId: true },
    });
    if (!exists) {
      throw new NotFoundException('Заявка для ТСД не найдена.');
    }

    this.clientScopes.requireClientAccess(user, exists.clientId, 'read');
    assertWarehouseAccess(user, exists, 'read', 'Заявка для ТСД не найдена в выбранном филиале.');
    return this.getCachedInstruction(requestId, user);
  }

  private async getCachedInstruction(requestId: string, user: AuthUser) {
    const now = Date.now();
    const cached = this.instructionCache.get(requestId);
    if (cached && cached.expiresAt > now) {
      return cached.promise;
    }

    this.pruneInstructionCache(now);
    const promise = this.pickInstructions.getRequestInstruction(requestId, user);
    this.instructionCache.set(requestId, { expiresAt: now + this.instructionCacheTtlMs, promise });

    try {
      return await promise;
    } catch (error) {
      if (this.instructionCache.get(requestId)?.promise === promise) {
        this.instructionCache.delete(requestId);
      }
      throw error;
    }
  }

  private pruneInstructionCache(now: number) {
    for (const [key, value] of this.instructionCache.entries()) {
      if (value.expiresAt <= now) {
        this.instructionCache.delete(key);
      }
    }
  }

  private invalidateInstructionCache(requestId: string) {
    this.instructionCache.delete(requestId);
  }

  async getRequestStage(requestId: string, stage: TsdRequestStage, user: AuthUser) {
    const plan = await this.getRequestPlan(requestId, user);
    const payload = stagePayload(plan, stage);
    return stage === 'boxless-packing'
      ? { ...payload, packingProgress: await this.loadBoxlessPackingProgress(requestId, plan) }
      : payload;
  }

  async handleStageAction(
    requestId: string,
    stage: TsdRequestStage,
    action: string,
    body: Record<string, unknown> | string | undefined,
    user: AuthUser,
  ) {
    await this.requireRequestAccess(requestId, user, 'write');
    const plan = await this.getRequestPlan(requestId, user);
    const scannedCode =
      stage === 'boxless-packing' && action === 'scan-item' && isRecord(body)
        ? textValue(body, 'barcode')
        : scannedValue(body);
    let result = validateStageAction(plan, stage, action, scannedCode);
    let actionBody = isRecord(body) ? { ...body } : {};
    if (stage === 'boxless-packing' && result.accepted) {
      if (!plan.storesWithoutBoxes) {
        throw new BadRequestException('Для этого клиента используется обычная сборка по складским коробам.');
      }
      const progress = await this.loadBoxlessPackingProgress(requestId, plan);
      if (action === 'scan-item') {
        const row = (progress.rows as Array<Record<string, any>>).find((item) => sameCode(item.barcode, scannedCode ?? ''));
        if (!row || Number(row.remainingQuantity) <= 0) {
          result = actionResult('REJECTED', false, 'Эта позиция уже полностью упакована или отсутствует в заявке.');
        } else {
          actionBody = { ...actionBody, requestItemId: row.requestItemId, quantity: 1 };
        }
      }
      if (result.accepted && ['open-box', 'scan-item', 'close-box'].includes(action)) {
        await this.recordBoxlessPackingAction(requestId, action, scannedCode ?? '', actionBody, user);
      }
      if (result.accepted && action === 'finish') {
        const finalProgress = await this.loadBoxlessPackingProgress(requestId, plan);
        if (finalProgress.remainingQuantity > 0) {
          throw new BadRequestException(`Не упаковано товаров: ${finalProgress.remainingQuantity}.`);
        }
        if (finalProgress.boxes.some((box) => !box.closed)) {
          throw new BadRequestException('Перед завершением закройте все открытые короба.');
        }
        await this.stockOperations.packageClientRequest(
          {
            requestId,
            boxes: finalProgress.boxes.length,
            packedUnits: finalProgress.packedQuantity,
            idempotencyKey: `tsd-boxless-pack:${requestId}`,
            comment: 'Сборка по коробам завершена на ТСД.',
            packages: finalProgress.boxes.map((box) => ({
              packageCode: box.boxCode,
              packageType: 'BOX',
              items: box.items.map((item) => ({ requestItemId: item.requestItemId, quantity: item.quantity })),
            })),
          },
          user,
        );
        this.invalidateInstructionCache(requestId);
      }
    }
    if (stage === 'box-search' && action === 'scan' && result.accepted && scannedCode) {
      await this.recordFoundBoxSearch(requestId, scannedCode, body, user);
      this.invalidateInstructionCache(requestId);
    }
    const nextPlan = stage === 'box-search' && action === 'scan' && result.accepted ? await this.getRequestPlan(requestId, user) : plan;
    const stageData = stagePayload(nextPlan, stage);
    const packingProgress = stage === 'boxless-packing' ? await this.loadBoxlessPackingProgress(requestId, nextPlan) : undefined;

    return {
      ...stageData,
      ...result,
      requestId,
      stage,
      action,
      scannedCode,
      deviceCode: isRecord(body) ? textValue(body, 'deviceCode') : undefined,
      serverTime: new Date().toISOString(),
      plan: stageData,
      ...(packingProgress ? { packingProgress } : {}),
    };
  }

  async findSkuByBarcode(query: { clientId?: string; barcode?: string }, user: AuthUser) {
    const clientId = query.clientId?.trim();
    const barcode = query.barcode?.trim();

    if (!clientId) {
      throw new BadRequestException('Не указан клиент для поиска товара.');
    }
    if (!barcode) {
      throw new BadRequestException('Не указан штрихкод товара.');
    }

    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const warehouseId = effectiveWarehouseId(user, 'read');

    const matches = await this.prisma.barcode.findMany({
      where: {
        value: barcode,
        sku: { clientId },
      },
      include: {
        sku: {
          include: {
            barcodes: true,
            balances: {
              where: {
                quantity: { gt: 0 },
                warehouseId: warehouseId ?? undefined,
              },
              select: { quantity: true, status: true },
            },
            client: { select: { id: true, code: true, name: true } },
          },
        },
      },
      take: 20,
    });

    const found =
      matches.find((match) => !match.sku.isDraft && match.sku.balances.some((balance) => balance.quantity > 0)) ??
      matches.find((match) => !match.sku.isDraft) ??
      matches[0];

    if (!found) {
      throw new NotFoundException('Товар по штрихкоду не найден.');
    }

    const sku = found.sku;
    const marketplacePhotos = extractMarketplacePhotos(sku.marketplacePayload);

    return {
      id: sku.id,
      skuId: sku.id,
      clientId: sku.clientId,
      client: sku.client,
      internalSku: sku.internalSku,
      clientSku: sku.clientSku,
      article: sku.article,
      name: sku.name,
      brand: sku.brand,
      category: sku.category,
      color: sku.color,
      size: sku.size,
      weightGrams: sku.weightGrams,
      lengthCm: decimalToNumber(sku.lengthCm),
      widthCm: decimalToNumber(sku.widthCm),
      heightCm: decimalToNumber(sku.heightCm),
      volumeLiters: decimalToNumber(sku.volumeLiters),
      shelfLifeUntil: sku.shelfLifeUntil?.toISOString() ?? null,
      needsChestnyZnak: sku.needsChestnyZnak,
      isUnmarked: sku.isUnmarked,
      isDraft: sku.isDraft,
      draftSource: sku.draftSource,
      barcode: found.value,
      barcodes: sku.barcodes.map((item) => ({ value: item.value, isPrimary: item.isPrimary })),
      availableQuantity: sku.balances.reduce((sum, balance) => sum + balance.quantity, 0),
      marketplace: sku.marketplace,
      marketplaceProductId: sku.marketplaceProductId,
      marketplaceOfferId: sku.marketplaceOfferId,
      marketplacePhotos,
      imageUrl: marketplacePhotos[0] ?? null,
      photoUrl: marketplacePhotos[0] ?? null,
    };
  }

  private async requireRequestAccess(
    requestId: string,
    user: AuthUser,
    mode: 'read' | 'write',
  ) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true, warehouseId: true },
    });
    if (!request) {
      throw new NotFoundException('Заявка для ТСД не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, mode);
    assertWarehouseAccess(user, request, mode, 'Заявка для ТСД не найдена в выбранном филиале.');
    return request;
  }

  private async toTsdPlan(document: PickInstructionDocument & { html?: string }) {
    const rawSearchBoxCodes = uniqueSorted([
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
    ]);
    const movementTargetBoxes = new Set(document.warehouseBalanceMoves.map((row) => normalizeBoxCode(row.newBox)).filter(Boolean));
    const shipmentBoxes = document.warehouseWholeBoxes.map((row) => boxEntry(row.box));
    const shipmentBoxCodes = shipmentBoxes.map((box) => box.boxCode);
    let searchBoxes = rawSearchBoxCodes
      .filter((boxCode) => shouldShowInTsdBoxSearch(boxCode, movementTargetBoxes))
      .map((boxCode) => boxEntry(boxCode));
    const [activeProcessesByRequest, fbsAssembly] = await Promise.all([
      this.loadActiveTsdProcesses([document.requestId]),
      this.loadFbsAssemblyFacts(document.requestId, document.rows),
    ]);
    const fbsBoxAudit = fbsAssembly
      ? await this.fbsRequestBoxAudits.auditDocument(document)
      : null;
    if (fbsBoxAudit) {
      const liveBoxCodes = new Set(
        fbsBoxAudit.rows
          .filter((row) => row.state === 'OK')
          .map((row) => normalizeBoxCode(row.code)),
      );
      searchBoxes = searchBoxes.filter((box) => liveBoxCodes.has(normalizeBoxCode(box.boxCode)));
    }
    const activeTsdProcesses = activeProcessesByRequest.get(document.requestId) ?? [];
    let activeTsdProcess = activeTsdProcesses[0] ?? null;
    const foundSearchBoxCodes = await this.loadFoundBoxSearchCodes(
      document.requestId,
      searchBoxes.map((box) => box.boxCode),
    );
    const foundSearchBoxMatchers = [...foundSearchBoxCodes, ...(activeTsdProcess?.foundBoxCodes ?? [])];
    searchBoxes = searchBoxes.map((box) =>
      foundSearchBoxMatchers.some((boxCode) => sameCode(boxCode, box.boxCode)) ? { ...box, found: true, isFound: true } : box,
    );

    const rawRelabelTasks = collapseRows(
      document.warehouseRows
        .filter((row) => row.sourceBox && row.quantity > 0 && row.rebrandNote)
        .map((row) => {
          const parsed = parseRelabelNote(row.rebrandNote);
          return {
            sourceBox: row.sourceBox,
            oldBarcode: parsed.oldBarcode || row.barcodeOnBox,
            newBarcode: parsed.newBarcode || row.barcodeOnBox,
            barcode: parsed.newBarcode || row.barcodeOnBox,
            name: row.artOnBox,
            size: row.size,
            quantity: row.quantity,
            note: row.rebrandNote,
          };
        }),
      (row) => `${row.sourceBox}|${row.oldBarcode}|${row.newBarcode}|${row.size}`,
    );
    const sharedProgress = await this.loadSharedAssemblyProgress(document.requestId);
    const relabelTasks = rawRelabelTasks.map((task) => {
      const doneQuantity = Math.min(task.quantity, sharedProgress.relabelDone.get(relabelTaskProgressKey(task)) ?? 0);
      return {
        ...task,
        doneQuantity,
        remainingQuantity: Math.max(0, task.quantity - doneQuantity),
        done: doneQuantity >= task.quantity,
      };
    });

    const allMovementTasks = collapseRows(
      document.warehouseBalanceMoves
        .filter((row) => row.sourceBox && row.quantity > 0)
        .map((row) => ({
          sourceBox: row.sourceBox,
          targetBox: row.newBox,
          purpose: row.purpose ?? (row.newBox ? 'BALANCE' : 'SHIPMENT'),
          targetRole: row.targetRole ?? (row.newBox ? 'STOCK' : 'SHIPMENT'),
          barcode: row.barcodeOnBox,
          name: row.artOnBox,
          size: row.size,
          quantity: row.quantity,
          note: row.note,
        })),
      (row) => `${row.sourceBox}|${row.targetBox}|${row.purpose}|${row.targetRole}|${row.barcode}|${row.size}`,
    );
    searchBoxes = searchBoxes.map((box) => {
      const requiresRelabel = relabelTasks.some((row) => sameCode(row.sourceBox, box.boxCode));
      const requiresMovement = allMovementTasks.some((row) => sameCode(row.sourceBox, box.boxCode));
      const shipsWhole = shipmentBoxCodes.some((boxCode) => sameCode(boxCode, box.boxCode));
      const servesMultipleCities = document.warehouseRows.some(
        (row) =>
          sameCode(row.sourceBox, box.boxCode) &&
          row.comment.toLocaleUpperCase('ru-RU').includes('НЕСКОЛЬКО ГОРОДОВ'),
      );

      return {
        ...box,
        ...boxSearchInstruction({ requiresRelabel, requiresMovement, shipsWhole }),
        servesMultipleCities,
        multiCityLabel: servesMultipleCities ? 'ТОВАР УЕЗЖАЕТ В НЕСКОЛЬКО ГОРОДОВ' : '',
      };
    });
    const storagePlacementCodes = uniqueSorted(
      searchBoxes
        .map((box) => safeDecode(box.boxCode).trim())
        .filter(Boolean),
    );
    const storagePlacements = storagePlacementCodes.length
      ? await this.prisma.storagePalletBox.findMany({
          where: {
            OR: storagePlacementCodes.map((boxCode) => ({
              boxCode: { equals: boxCode, mode: 'insensitive' as const },
            })),
          },
          include: { pallet: { include: { zone: true } } },
        })
      : [];
    const storageLocationByBox = new Map(
      storagePlacements.map((placement) => [
        normalizeBoxCode(placement.boxCode),
        {
          palletId: placement.palletId,
          palletCode: placement.pallet.code,
          zoneId: placement.pallet.zoneId,
          zoneCode: placement.pallet.zone?.code ?? null,
          zoneName: placement.pallet.zone?.name ?? null,
        },
      ]),
    );
    const currentPalletId =
      searchBoxes
        .filter((box) => box.found || box.isFound)
        .map((box) => storageLocationByBox.get(normalizeBoxCode(box.boxCode))?.palletId)
        .find(Boolean) ?? null;
    searchBoxes = searchBoxes
      .map((box) => ({
        ...box,
        storageLocation: storageLocationByBox.get(normalizeBoxCode(box.boxCode)) ?? null,
      }))
      .sort((left, right) => {
        const leftCurrent = currentPalletId && left.storageLocation?.palletId === currentPalletId;
        const rightCurrent = currentPalletId && right.storageLocation?.palletId === currentPalletId;
        return Number(rightCurrent) - Number(leftCurrent) ||
          (left.storageLocation?.palletCode ?? '\uffff').localeCompare(
            right.storageLocation?.palletCode ?? '\uffff',
            'ru-RU',
          ) ||
          left.boxCode.localeCompare(right.boxCode, 'ru-RU');
      });
    const movementProgress = await this.loadMovementProgress(document, allMovementTasks);
    const completedMoveSourceBoxes = new Set(
      movementProgress.sourceBoxes.filter((box) => box.done).map((box) => normalizeBoxCode(box.sourceBox)),
    );
    const movementTasks = allMovementTasks.filter((row) => !completedMoveSourceBoxes.has(normalizeBoxCode(row.sourceBox)));
    const outgoingBoxes = buildOutgoingBoxes(document, movementProgress.actualRows);
    const outgoingBoxCodes = outgoingBoxes.map((box) => box.boxCode);

    const totalRelabel = relabelTasks.reduce((sum, row) => sum + row.quantity, 0);
    const totalMove = movementTasks.reduce((sum, row) => sum + row.quantity, 0);
    const totalMoveRequired = allMovementTasks.reduce((sum, row) => sum + row.quantity, 0);
    const searchBoxCodes = searchBoxes.map((box) => box.boxCode);
    const foundBoxes = searchBoxes.filter((box) => box.found || box.isFound);
    const remainingBoxes = searchBoxes.filter((box) => !box.found && !box.isFound);
    const foundBoxCodes = foundBoxes.map((box) => box.boxCode);
    const remainingBoxCodes = remainingBoxes.map((box) => box.boxCode);
    if (activeTsdProcess && searchBoxes.length > 0) {
      const totalBoxCount = searchBoxes.length;
      const activeFoundCount = Math.max(activeTsdProcess.foundCount, foundBoxes.length);
      activeTsdProcess = {
        ...activeTsdProcess,
        foundCount: activeFoundCount,
        totalBoxCount,
        progressText: `найдено коробов: ${activeFoundCount} из ${totalBoxCount}`,
      };
    }

    const requestRows = document.rows.map((row) => ({
      id: row.itemId,
      itemId: row.itemId,
      skuId: row.skuId,
      internalSku: row.internalSku,
      name: row.name,
      barcode: row.barcode,
      quantity: row.requestedQuantity,
      requestedQuantity: row.requestedQuantity,
      allocatedQuantity: row.allocatedQuantity,
      shortageQuantity: row.shortageQuantity,
      status: row.status,
      statusLabel: row.statusLabel,
      comment: row.comment,
      allocations: row.allocations,
    }));

    return {
      id: document.requestId,
      requestId: document.requestId,
      title: document.requestTitle,
      name: document.requestTitle,
      status: document.requestStatus,
      statusLabel: document.requestStatusLabel,
      city: document.destinationCity,
      destinationCity: document.destinationCity,
      deliveryCity: document.destinationCity,
      cityName: document.destinationCity,
      destination: document.destinationCity,
      deliveryDestination: document.destinationCity,
      desiredDate: document.desiredDate,
      client: document.client,
      rowsCount: document.rowsCount,
      itemsCount: document.rowsCount,
      itemCount: document.rowsCount,
      linesCount: document.rowsCount,
      totalRequested: document.totalRequested,
      totalQuantity: document.totalRequested,
      requestedQuantity: document.totalRequested,
      boxesTotal: searchBoxes.length,
      boxesCount: searchBoxes.length,
      relabelTotal: totalRelabel,
      relabelCount: totalRelabel,
      movementTotal: totalMove,
      movementRequiredTotal: totalMoveRequired,
      movementCount: totalMove,
      rows: requestRows,
      items: requestRows,
      requestRows,
      searchBoxes,
      shipmentBoxes,
      outgoingBoxes,
      shipmentBoxCodes,
      outgoingBoxCodes,
      boxesToSearch: searchBoxes,
      boxesToFind: searchBoxes,
      searchTasks: searchBoxes,
      boxTasks: searchBoxes,
      boxCodes: searchBoxCodes,
      searchBoxCodes,
      boxesToSearchCodes: searchBoxCodes,
      boxesToFindCodes: searchBoxCodes,
      foundBoxCodes,
      foundBoxesCodes: foundBoxCodes,
      remainingBoxCodes,
      remainingBoxes,
      remainingBoxTasks: remainingBoxes,
      remainingCount: remainingBoxes.length,
      remaining: remainingBoxes.length,
      remainingBoxesCount: remainingBoxes.length,
      foundCount: foundBoxes.length,
      found: foundBoxes.length,
      foundBoxes,
      boxSearchProgress: {
        total: searchBoxes.length,
        found: foundBoxes.length,
        remaining: remainingBoxes.length,
        foundBoxCodes,
        remainingBoxCodes,
      },
      activeTsdProcess,
      activeTsdProcesses,
      confirmedOutgoingBoxCodes: [...sharedProgress.confirmedOutgoingBoxes],
      relabelProgress: {
        totalRequired: totalRelabel,
        totalDone: relabelTasks.reduce((sum, task) => sum + task.doneQuantity, 0),
        totalRemaining: relabelTasks.reduce((sum, task) => sum + task.remainingQuantity, 0),
      },
      relabelTasks,
      relabelBoxes: groupTasksByBox(relabelTasks),
      allMovementTasks,
      movementTasks,
      moveTasks: movementTasks,
      movementBoxes: groupTasksByBox(movementTasks),
      movementProgress,
      fbsAssembly,
      fbsBoxAudit: fbsBoxAudit
        ? {
            checkedAt: fbsBoxAudit.checkedAt,
            summary: fbsBoxAudit.summary,
          }
        : null,
    };
  }

  private async loadFbsAssemblyFacts(requestId: string, requestRows: PickInstructionDocument['rows']) {
    const [request, links, assemblyRows, duplicateKizEvents, localKizConflictEvents] = await Promise.all([
      this.prisma.clientRequest.findUnique({
        where: { id: requestId },
        select: { fbsEmergencyAssemblyAt: true },
      }),
      this.prisma.fbsOrderRequestLink.findMany({
        where: {
          requestId,
          syncStatus: { in: ['ACTIVE', 'RETURN_REQUIRED'] },
          lastCategory: { not: 'cancelled' },
        },
        select: { orderId: true, connectionId: true, lastSkuId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: { requestId, status: { not: 'RELEASED' } },
        select: {
          id: true,
          orderId: true,
          requestItemId: true,
          skuId: true,
          productName: true,
          article: true,
          boxCode: true,
          barcode: true,
          kiz: true,
          wbMetaStatus: true,
          stickerPartB: true,
          stickerBarcode: true,
          status: true,
          errorMessage: true,
          itemCount: true,
          requiresKiz: true,
          sourceBoxPending: true,
          workerName: true,
          deviceCode: true,
          completedAt: true,
          updatedAt: true,
          cargoPackingId: true,
          cargoPackedAt: true,
          cargoPackedByName: true,
          cargoPacking: {
            select: {
              id: true,
              cargoPlaceId: true,
              status: true,
              deviceCode: true,
              openedByName: true,
              openedAt: true,
              closedByName: true,
              closedAt: true,
            },
          },
        },
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: FBS_KIZ_DUPLICATE_SCAN_ACTION,
          entity: 'ClientRequest',
          entityId: requestId,
        },
        select: { id: true, payload: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: FBS_KIZ_LOCAL_STATUS_CONFLICT_ACTION,
          entity: 'ClientRequest',
          entityId: requestId,
        },
        select: { id: true, payload: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    if (links.length === 0) {
      return null;
    }
    const emergencyAssemblyAt = request?.fbsEmergencyAssemblyAt?.getTime() ?? null;
    const rows = assemblyRows.filter(
      (row) =>
        row.status !== 'COMPLETED' ||
        emergencyAssemblyAt === null ||
        Boolean(row.completedAt && row.completedAt.getTime() >= emergencyAssemblyAt),
    );
    const skuIds = uniqueSorted([
      ...rows.map((row) => row.skuId),
      ...requestRows.map((row) => row.skuId).filter((value): value is string => Boolean(value)),
    ]);
    const skus = skuIds.length > 0
      ? await this.prisma.sku.findMany({
          where: { id: { in: skuIds } },
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            color: true,
            size: true,
          },
        })
      : [];
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const facts = rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      sourceBoxCode: row.boxCode,
      productName: row.productName,
      article: row.article,
      productBarcode: row.barcode,
      kiz: row.kiz,
      wbMetaStatus: row.wbMetaStatus,
      size: skuById.get(row.skuId)?.size ?? null,
      wbStickerPartB: row.stickerPartB,
      wbStickerBarcode: row.stickerBarcode,
      status: row.status,
      statusLabel: fbsAssemblyStatusLabel(row.status),
      sourceBoxPending: row.sourceBoxPending,
      syncIssue: row.errorMessage,
      workerName: row.workerName,
      completionSource: row.deviceCode.startsWith('SOS-WB:') ? 'SOS_WB' : 'STANDARD',
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      cargoPackingId: row.cargoPackingId,
      cargoPackedAt: row.cargoPackedAt?.toISOString() ?? null,
      cargoPackedByName: row.cargoPackedByName,
      wmsBoxCode: row.cargoPacking?.cargoPlaceId ?? null,
    }));
    const completedRows = rows.filter((row) => row.status === 'COMPLETED');
    const returnRequiredRows = rows.filter((row) => row.status === 'RETURN_REQUIRED');
    const handledRows = [...completedRows, ...returnRequiredRows];
    const handledOrderIds = new Set(handledRows.map((row) => row.orderId));
    const linkedOrderIds = new Set(links.map((link) => link.orderId));
    const linkByOrderId = new Map(
      links.map((link) => [link.orderId, link]),
    );
    const rowByOrderId = new Map(rows.map((row) => [row.orderId, row]));
    const pendingOrderIds = links
      .map((link) => link.orderId)
      .filter((orderId) => !handledOrderIds.has(orderId));
    const pendingLinksBySku = new Map<string, typeof links>();
    links.forEach((link) => {
      if (!link.lastSkuId || handledOrderIds.has(link.orderId)) return;
      pendingLinksBySku.set(
        link.lastSkuId,
        [...(pendingLinksBySku.get(link.lastSkuId) ?? []), link],
      );
    });
    const handledByRequestItem = new Map<string, number>();
    handledRows.forEach((row) => {
      handledByRequestItem.set(
        row.requestItemId,
        (handledByRequestItem.get(row.requestItemId) ?? 0) + Math.max(1, row.itemCount),
      );
    });
    const notCollectedRows = requestRows
      .map((row) => {
        const requiredQuantity = Math.max(0, row.requestedQuantity);
        const collectedQuantity = Math.min(requiredQuantity, handledByRequestItem.get(row.itemId) ?? 0);
        const remainingQuantity = Math.max(0, requiredQuantity - collectedQuantity);
        const sku = row.skuId ? skuById.get(row.skuId) : null;
        const linkedSkuOrderIds = row.skuId
          ? (pendingLinksBySku.get(row.skuId) ?? []).map((link) => link.orderId)
          : [];
        const commentOrderIds = (row.comment?.match(/\d{6,}/g) ?? [])
          .filter((orderId) => linkedOrderIds.has(orderId) && !handledOrderIds.has(orderId));
        const orderIds = uniqueSorted([...linkedSkuOrderIds, ...commentOrderIds]);
        return {
          requestItemId: row.itemId,
          skuId: row.skuId,
          name: row.name,
          article: sku?.article ?? sku?.clientSku ?? sku?.internalSku ?? row.internalSku,
          color: sku?.color ?? null,
          size: sku?.size ?? null,
          barcode: row.barcode,
          requiredQuantity,
          collectedQuantity,
          remainingQuantity,
          orderIds,
          orders: orderIds
            .map((orderId) => {
              const link = linkByOrderId.get(orderId);
              const task = rowByOrderId.get(orderId);
              return link
                ? {
                    id: orderId,
                    connectionId: link.connectionId,
                    assemblyId: task?.id ?? null,
                    requiresKiz: task?.requiresKiz ?? false,
                    kizAccepted: Boolean(task?.kiz && task.wbMetaStatus === 'ACCEPTED'),
                  }
                : null;
            })
            .filter(
              (
                order,
              ): order is {
                id: string;
                connectionId: string;
                assemblyId: string | null;
                requiresKiz: boolean;
                kizAccepted: boolean;
              } =>
                Boolean(order),
            ),
          availableBoxes: row.allocations.map((allocation) => ({
            boxCode: allocation.boxCode,
            quantity: allocation.quantity,
            palletId: allocation.palletId,
            palletCode: allocation.palletCode,
          })),
        };
      })
      .filter((row) => row.remainingQuantity > 0);
    const requestRowBySkuId = new Map(
      requestRows
        .filter((row): row is typeof row & { skuId: string } => Boolean(row.skuId))
        .map((row) => [row.skuId, row]),
    );
    const wmsPackingRows = rows.filter(
      (row) => row.status === 'COMPLETED' && Boolean(row.cargoPackingId && row.cargoPacking),
    );
    const wmsBoxMap = new Map<
      string,
      {
        id: string;
        code: string;
        status: string;
        deviceCode: string | null;
        openedByName: string | null;
        openedAt: string;
        closedByName: string | null;
        closedAt: string | null;
        items: Array<{
          id: string;
          orderId: string;
          productName: string;
          article: string | null;
          productBarcode: string | null;
          size: string | null;
          kiz: string | null;
          wbStickerPartB: string | null;
          packedByName: string | null;
          packedAt: string | null;
          quantity: number;
        }>;
      }
    >();
    wmsPackingRows.forEach((row) => {
      const packing = row.cargoPacking!;
      const current = wmsBoxMap.get(packing.id) ?? {
        id: packing.id,
        code: packing.cargoPlaceId,
        status: packing.status,
        deviceCode: packing.deviceCode,
        openedByName: packing.openedByName,
        openedAt: packing.openedAt.toISOString(),
        closedByName: packing.closedByName,
        closedAt: packing.closedAt?.toISOString() ?? null,
        items: [],
      };
      current.items.push({
        id: row.id,
        orderId: row.orderId,
        productName: row.productName,
        article: row.article,
        productBarcode: row.barcode,
        size: skuById.get(row.skuId)?.size ?? null,
        kiz: row.kiz,
        wbStickerPartB: row.stickerPartB,
        packedByName: row.cargoPackedByName,
        packedAt: row.cargoPackedAt?.toISOString() ?? null,
        quantity: Math.max(1, row.itemCount),
      });
      wmsBoxMap.set(packing.id, current);
    });
    const notPackedRows = links
      .map((link) => {
        const task = rowByOrderId.get(link.orderId);
        if (task?.cargoPackingId) return null;
        const requestRow = link.lastSkuId ? requestRowBySkuId.get(link.lastSkuId) : null;
        const sku = link.lastSkuId ? skuById.get(link.lastSkuId) : null;
        return {
          orderId: link.orderId,
          productName: task?.productName ?? requestRow?.name ?? 'Товар не определён',
          article:
            task?.article ??
            sku?.article ??
            sku?.clientSku ??
            sku?.internalSku ??
            requestRow?.internalSku ??
            null,
          productBarcode: task?.barcode ?? requestRow?.barcode ?? null,
          size: task ? skuById.get(task.skuId)?.size ?? null : sku?.size ?? null,
          wbStickerPartB: task?.stickerPartB ?? null,
          assemblyStatus: task?.status ?? 'NOT_STARTED',
          assemblyStatusLabel: task ? fbsAssemblyStatusLabel(task.status) : 'Ещё не собрано',
          readyForPacking: task?.status === 'COMPLETED',
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const factById = new Map(facts.map((row) => [row.id, row]));
    const seenLocalKizConflicts = new Set<string>();
    const localKizConflicts = localKizConflictEvents
      .map((event) => localFbsKizConflictFromAudit(event))
      .filter((event): event is NonNullable<typeof event> => Boolean(event))
      .filter((event) => {
        const row = factById.get(event.assemblyId);
        if (
          !row ||
          row.status !== 'IN_PROGRESS' ||
          (row.wbMetaStatus === 'ACCEPTED' && Boolean(row.kiz))
        ) {
          return false;
        }
        const key = `${event.assemblyId}:${event.kiz}`;
        if (seenLocalKizConflicts.has(key)) return false;
        seenLocalKizConflicts.add(key);
        return true;
      })
      .map((event) => ({
        id: event.id,
        orderId: event.orderId,
        productName: event.productName,
        article: event.article,
        sourceBoxCode: event.sourceBoxCode,
        kiz: event.kiz,
        message: event.message,
        updatedAt: event.updatedAt,
      }));
    return {
      totalOrders: links.length,
      startedOrders: facts.filter(
        (row) => !['WAITING_STOCK', 'RELEASED'].includes(row.status),
      ).length,
      completedOrders: facts.filter((row) => row.status === 'COMPLETED').length,
      duplicateKizScans: duplicateKizEvents
        .map((event) => duplicateFbsKizScanFromAudit(event))
        .filter((event): event is NonNullable<typeof event> => Boolean(event)),
      kizConflicts: [
        ...facts
          .filter(
            (row) =>
              row.wbMetaStatus === 'REJECTED' &&
              Boolean(row.kiz) &&
              Boolean(row.syncIssue),
          )
          .map((row) => ({
            id: row.id,
            orderId: row.orderId,
            productName: row.productName,
            article: row.article,
            sourceBoxCode: row.sourceBoxCode,
            kiz: row.kiz!,
            message: row.syncIssue!,
            updatedAt: row.updatedAt,
          })),
        ...localKizConflicts,
      ],
      returnRequired: {
        orders: returnRequiredRows.length,
        units: returnRequiredRows.reduce((sum, row) => sum + Math.max(1, row.itemCount), 0),
        rows: facts.filter((row) => row.status === 'RETURN_REQUIRED'),
      },
      rows: facts,
      wmsBoxes: {
        totalBoxes: wmsBoxMap.size,
        closedBoxes: [...wmsBoxMap.values()].filter((box) => box.status === 'CLOSED').length,
        packedUnits: wmsPackingRows.reduce((sum, row) => sum + Math.max(1, row.itemCount), 0),
        remainingUnits: notPackedRows.length,
        boxes: [...wmsBoxMap.values()],
        notPacked: notPackedRows,
      },
      notCollected: {
        remainingOrders: pendingOrderIds.length,
        remainingPositions: notCollectedRows.length,
        remainingUnits: notCollectedRows.reduce((sum, row) => sum + row.remainingQuantity, 0),
        pendingOrderIds,
        rows: notCollectedRows,
      },
    };
  }

  private async loadMovementProgress(document: PickInstructionDocument, tasks: TsdMovementPlanTask[]) {
    const totalRequired = tasks.reduce((sum, task) => sum + task.quantity, 0);
    const empty = {
      totalRequired,
      totalMoved: 0,
      totalRemaining: totalRequired,
      doneSourceBoxes: [] as string[],
      sourceBoxes: [] as Array<{
        sourceBox: string;
        requiredQuantity: number;
        movedQuantity: number;
        remainingQuantity: number;
        done: boolean;
        targetBoxes: string[];
      }>,
      rows: [] as Array<
        TsdMovementPlanTask & {
          requiredQuantity: number;
          movedQuantity: number;
          remainingQuantity: number;
          done: boolean;
          actualTargetBoxes: string[];
        }
      >,
      actualRows: [] as Array<{
        sourceBox: string;
        targetBox: string;
        purpose: 'BALANCE' | 'SHIPMENT';
        targetRole: 'STOCK' | 'SHIPMENT';
        barcode: string;
        name: string | null;
        size: string | null;
        quantity: number;
        movedAt: string | null;
      }>,
    };

    if (tasks.length === 0 || !document.requestTitle.trim()) {
      return empty;
    }

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        clientId: document.client.id,
        type: MovementType.MOVE,
        comment: { contains: document.requestTitle },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        idempotencyKey: true,
        quantity: true,
        createdAt: true,
        box: { select: { code: true } },
        sku: {
          select: {
            name: true,
            size: true,
            barcodes: { select: { value: true, isPrimary: true } },
          },
        },
      },
    });

    const pairs = new Map<string, { out: typeof movements; in: typeof movements }>();
    for (const movement of movements) {
      const key = movementPairKey(movement.idempotencyKey);
      const side = movementPairSide(movement.idempotencyKey, movement.quantity);
      if (!key || !side) {
        continue;
      }
      const pair = pairs.get(key) ?? { out: [], in: [] };
      pair[side].push(movement);
      pairs.set(key, pair);
    }

    const balanceTargetsBySourceBox = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (!isBalanceMovementTask(task)) {
        continue;
      }
      const sourceBox = normalizeBoxCode(task.sourceBox);
      const targetBox = normalizeBoxCode(task.targetBox);
      if (!sourceBox || !targetBox) {
        continue;
      }
      const targets = balanceTargetsBySourceBox.get(sourceBox) ?? new Set<string>();
      targets.add(targetBox);
      balanceTargetsBySourceBox.set(sourceBox, targets);
    }

    const movedBySourceBox = new Map<string, number>();
    for (const movement of movements) {
      if (movement.quantity >= 0) {
        continue;
      }
      const sourceBox = normalizeBoxCode(movement.box?.code);
      if (sourceBox) {
        movedBySourceBox.set(sourceBox, (movedBySourceBox.get(sourceBox) ?? 0) + Math.abs(movement.quantity));
      }
    }

    const actualRows = new Map<string, (typeof empty.actualRows)[number]>();
    for (const pair of pairs.values()) {
      const rowsCount = Math.min(pair.out.length, pair.in.length);
      for (let index = 0; index < rowsCount; index += 1) {
        const outRow = pair.out[index];
        const inRow = pair.in[index];
        const sourceBox = outRow.box?.code?.trim() ?? '';
        const targetBox = inRow.box?.code?.trim() ?? '';
        const normalizedSourceBox = normalizeBoxCode(sourceBox);
        const normalizedTargetBox = normalizeBoxCode(targetBox);
        if (!sourceBox || !targetBox || !normalizedSourceBox || !normalizedTargetBox) {
          continue;
        }
        const isBalanceTarget = balanceTargetsBySourceBox.get(normalizedSourceBox)?.has(normalizedTargetBox) ?? false;
        const purpose = isBalanceTarget ? 'BALANCE' : 'SHIPMENT';
        const targetRole = isBalanceTarget ? 'STOCK' : 'SHIPMENT';
        const barcode = primaryBarcode(outRow.sku.barcodes);
        const quantity = Math.min(Math.abs(outRow.quantity), Math.abs(inRow.quantity));
        const key = [
          normalizedSourceBox,
          normalizedTargetBox,
          normalizeScanCode(barcode),
          outRow.sku.size?.trim().toLocaleLowerCase('ru-RU') ?? '',
          purpose,
        ].join('|');
        const current =
          actualRows.get(key) ??
          ({
            sourceBox,
            targetBox,
            purpose,
            targetRole,
            barcode,
            name: outRow.sku.name,
            size: outRow.sku.size,
            quantity: 0,
            movedAt: null,
          } as (typeof empty.actualRows)[number]);
        current.quantity += quantity;
        current.movedAt = inRow.createdAt.toISOString();
        actualRows.set(key, current);
      }
    }

    const movedByTask = new Map<string, number>();
    const actualTargetBoxesByTask = new Map<string, Set<string>>();
    for (const actual of actualRows.values()) {
      let remaining = actual.quantity;
      for (const task of tasks) {
        if (remaining <= 0 || !matchesMovementTask(task, actual)) {
          continue;
        }
        const key = movementTaskKey(task);
        const current = movedByTask.get(key) ?? 0;
        const capacity = Math.max(0, task.quantity - current);
        const accepted = Math.min(capacity, remaining);
        if (accepted <= 0) {
          continue;
        }
        movedByTask.set(key, current + accepted);
        const targetBoxes = actualTargetBoxesByTask.get(key) ?? new Set<string>();
        targetBoxes.add(actual.targetBox);
        actualTargetBoxesByTask.set(key, targetBoxes);
        remaining -= accepted;
      }
    }

    const assignedBySourceBox = new Map<string, number>();
    for (const task of tasks) {
      const sourceBox = normalizeBoxCode(task.sourceBox);
      if (!sourceBox) {
        continue;
      }
      assignedBySourceBox.set(sourceBox, (assignedBySourceBox.get(sourceBox) ?? 0) + (movedByTask.get(movementTaskKey(task)) ?? 0));
    }

    for (const [sourceBox, movedQuantity] of movedBySourceBox) {
      let unassignedQuantity = Math.max(0, movedQuantity - (assignedBySourceBox.get(sourceBox) ?? 0));
      if (unassignedQuantity <= 0) {
        continue;
      }

      for (const task of tasks) {
        if (unassignedQuantity <= 0 || normalizeBoxCode(task.sourceBox) !== sourceBox) {
          continue;
        }
        const key = movementTaskKey(task);
        const current = movedByTask.get(key) ?? 0;
        const capacity = Math.max(0, task.quantity - current);
        const accepted = Math.min(capacity, unassignedQuantity);
        if (accepted <= 0) {
          continue;
        }

        movedByTask.set(key, current + accepted);
        if (task.targetBox) {
          const targetBoxes = actualTargetBoxesByTask.get(key) ?? new Set<string>();
          targetBoxes.add(task.targetBox);
          actualTargetBoxesByTask.set(key, targetBoxes);
        }
        unassignedQuantity -= accepted;
      }
    }

    const rows = tasks.map((task) => {
      const key = movementTaskKey(task);
      const movedQuantity = Math.min(task.quantity, movedByTask.get(key) ?? 0);
      const remainingQuantity = Math.max(0, task.quantity - movedQuantity);
      return {
        ...task,
        requiredQuantity: task.quantity,
        movedQuantity,
        remainingQuantity,
        done: remainingQuantity === 0,
        actualTargetBoxes: [...(actualTargetBoxesByTask.get(key) ?? new Set<string>())],
      };
    });

    const actualRowsList = [...actualRows.values()].sort((left, right) =>
      `${left.sourceBox}:${left.targetBox}:${left.barcode}`.localeCompare(`${right.sourceBox}:${right.targetBox}:${right.barcode}`, 'ru', {
        numeric: true,
      }),
    );
    const actualMovedTotal = actualRowsList.reduce((sum, row) => sum + row.quantity, 0);
    const sourceBoxes = mergeActualMovementSourceBoxes(groupMovementProgressBySource(rows), actualRowsList);
    const plannedMovedTotal = rows.reduce((sum, row) => sum + row.movedQuantity, 0);
    const totalMoved = Math.max(plannedMovedTotal, actualMovedTotal);

    return {
      totalRequired,
      totalMoved,
      totalRemaining: Math.max(0, totalRequired - totalMoved),
      doneSourceBoxes: sourceBoxes.filter((box) => box.done).map((box) => box.sourceBox),
      sourceBoxes,
      rows,
      actualRows: actualRowsList,
    };
  }

  private async loadSharedAssemblyProgress(requestId: string) {
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        operationType: 'assembly_stage',
        status: TsdOperationStatus.ACCEPTED,
        payload: { path: ['requestId'], equals: requestId },
      },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    });
    const relabelDone = new Map<string, number>();
    const confirmedOutgoingBoxes = new Set<string>();

    for (const operation of operations) {
      const payload = operationPayload(operation.payload);
      const action = textValue(payload, 'action') ?? textValue(payload, 'progressKind') ?? '';
      if (action === 'relabel-complete') {
        const key = relabelPayloadProgressKey(payload);
        if (key) relabelDone.set(key, (relabelDone.get(key) ?? 0) + 1);
      }
      if (action === 'outgoing-confirm') {
        const boxCode = normalizeBoxCode(textValue(payload, 'boxCode'));
        if (boxCode) confirmedOutgoingBoxes.add(boxCode);
      }
    }

    return { relabelDone, confirmedOutgoingBoxes };
  }

  private async loadActiveTsdProcesses(requestIds: string[]) {
    const ids = [...new Set(requestIds.filter(Boolean))];
    if (ids.length === 0) {
      return new Map<string, TsdProcessSummary[]>();
    }

    const since = new Date(Date.now() - 30 * 60 * 1000);
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        status: TsdOperationStatus.ACCEPTED,
        operationType: { in: ['assembly_stage', 'box_search_scan', 'move_scan', 'administration_release'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 1200,
    });

    const allowedRequestIds = new Set(ids);
    const latestByWorker = new Map<string, (typeof operations)[number]>();
    const foundBoxesByRequest = new Map<string, Set<string>>();
    const userIds = new Set<string>();

    for (const operation of operations) {
      const payload = operationPayload(operation.payload);
      const requestId = operationRequestId(operation, payload);
      if (!requestId || !allowedRequestIds.has(requestId)) {
        continue;
      }

      const payloadDevice = textValue(payload, 'deviceCode') ?? operation.deviceId;
      const workerKey = `${requestId}|${payloadDevice}`;
      if (!latestByWorker.has(workerKey)) {
        latestByWorker.set(workerKey, operation);
      }

      const userId = textValue(payload, 'userId');
      if (userId) {
        userIds.add(userId);
      }

      if (operation.operationType === 'box_search_scan') {
        const boxCode = normalizeBoxCode(
          textValue(payload, 'normalizedBoxCode') ?? textValue(payload, 'boxCode') ?? operation.operationKey.split(':').pop(),
        );
        if (boxCode) {
          const boxes = foundBoxesByRequest.get(requestId) ?? new Set<string>();
          boxes.add(boxCode);
          foundBoxesByRequest.set(requestId, boxes);
        }
      }
    }

    const users = userIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    const result = new Map<string, TsdProcessSummary[]>();
    for (const operation of latestByWorker.values()) {
      if (operation.operationType === 'administration_release') continue;
      const payload = operationPayload(operation.payload);
      const requestId = operationRequestId(operation, payload);
      if (!requestId) continue;
      const user = usersById.get(textValue(payload, 'userId') ?? '');
      const stage = operationStage(operation, payload);
      const foundBoxCodes = [...(foundBoxesByRequest.get(requestId) ?? new Set<string>())];
      const foundCount = foundBoxCodes.length;
      const processes = result.get(requestId) ?? [];
      processes.push({
        stage,
        stageLabel: stageLabel(stage),
        deviceCode: textValue(payload, 'deviceCode') ?? operation.deviceId,
        workerName: user?.name ?? textValue(payload, 'workerName') ?? textValue(payload, 'operatorName') ?? null,
        updatedAt: operation.updatedAt.toISOString(),
        foundCount,
        foundBoxCodes,
        progressText: foundCount > 0 ? `найдено коробов: ${foundCount}` : stageLabel(stage),
      });
      result.set(requestId, processes);
    }

    return result;
  }

  private async loadFoundBoxSearchCodes(requestId: string, boxCodes: string[]) {
    const allowed = new Set(boxCodes.map((boxCode) => normalizeBoxCode(boxCode)).filter(Boolean));
    if (!requestId || allowed.size === 0) {
      return new Set<string>();
    }

    const prefix = boxSearchOperationPrefix(requestId);
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        operationType: 'box_search_scan',
        status: TsdOperationStatus.ACCEPTED,
        OR: [{ operationKey: { startsWith: prefix } }, { payload: { path: ['requestId'], equals: requestId } }],
      },
      select: { operationKey: true, payload: true },
    });

    const found = new Set<string>();
    for (const operation of operations) {
      const payload = operationPayload(operation.payload);
      const candidates = [
        operation.operationKey.startsWith(prefix) ? operation.operationKey.slice(prefix.length) : operation.operationKey.split(':').pop(),
        textValue(payload, 'normalizedBoxCode'),
        textValue(payload, 'boxCode'),
      ];
      for (const candidate of candidates) {
        const normalized = normalizeBoxCode(candidate);
        const allowedCode = [...allowed].find((boxCode) => sameCode(boxCode, normalized));
        if (allowedCode) {
          found.add(allowedCode);
          break;
        }
      }
    }

    return found;
  }

  private async recordFoundBoxSearch(
    requestId: string,
    scannedCode: string,
    body: Record<string, unknown> | string | undefined,
    user: AuthUser,
  ) {
    const normalizedBoxCode = normalizeScanCode(scannedCode);
    if (!normalizedBoxCode) {
      return;
    }

    const operationKey = `${boxSearchOperationPrefix(requestId)}${normalizedBoxCode}`;
    const payload = {
      requestId,
      boxCode: scannedCode.trim(),
      normalizedBoxCode,
      deviceCode: isRecord(body) ? textValue(body, 'deviceCode') : user.deviceCode,
      userId: user.id,
    } as Prisma.InputJsonValue;

    try {
      await this.prisma.tsdOperation.create({
        data: {
          deviceId: user.deviceId ?? user.id,
          operationKey,
          operationType: 'box_search_scan',
          payload,
          status: TsdOperationStatus.ACCEPTED,
          serverMessage: 'Короб найден.',
        },
      });
    } catch (caught) {
      if (isPrismaUniqueConflict(caught)) {
        throw new BadRequestException('Этот короб уже был пропикан в данной заявке. Повторный скан отклонен.');
      }
      throw caught;
    }
  }

  private async recordBoxlessPackingAction(
    requestId: string,
    action: string,
    scannedCode: string,
    body: Record<string, unknown>,
    user: AuthUser,
  ) {
    const boxCode = textValue(body, 'boxCode') || (action !== 'scan-item' ? scannedCode : '');
    if (!boxCode || !boxCode.toLocaleUpperCase('ru-RU').startsWith('FFL')) {
      throw new BadRequestException('Сначала отсканируйте номер нового короба, начинающийся с FFL.');
    }
    const operationKey =
      textValue(body, 'operationKey') ||
      `boxless-packing:${requestId}:${action}:${user.deviceId ?? user.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const payload = {
      ...body,
      requestId,
      stage: 'boxless-packing',
      action,
      boxCode: boxCode.trim(),
      scannedCode,
      deviceCode: textValue(body, 'deviceCode') || user.deviceCode,
      userId: user.id,
    } as Prisma.InputJsonValue;

    await this.prisma.tsdOperation.upsert({
      where: { operationKey },
      update: { payload, status: TsdOperationStatus.ACCEPTED, serverMessage: 'Операция сборки по коробам принята.' },
      create: {
        deviceId: user.deviceId ?? user.id,
        operationKey,
        operationType: 'assembly_stage',
        payload,
        status: TsdOperationStatus.ACCEPTED,
        serverMessage: 'Операция сборки по коробам принята.',
      },
    });
  }

  private async loadBoxlessPackingProgress(requestId: string, plan: Record<string, any>) {
    const operations = await this.prisma.tsdOperation.findMany({
      where: {
        operationType: 'assembly_stage',
        status: TsdOperationStatus.ACCEPTED,
        payload: { path: ['requestId'], equals: requestId },
      },
      orderBy: { createdAt: 'asc' },
      select: { operationKey: true, payload: true, deviceId: true, createdAt: true },
    });
    const requestRows = (plan.requestRows ?? plan.rows ?? []) as Array<Record<string, any>>;
    const boxes = new Map<
      string,
      {
        boxCode: string;
        closed: boolean;
        deviceCode: string;
        openedAt: string;
        closedAt: string | null;
        items: Map<string, { requestItemId: string; barcode: string; name: string; quantity: number }>;
      }
    >();

    for (const operation of operations) {
      const payload = operationPayload(operation.payload);
      if (textValue(payload, 'stage') !== 'boxless-packing') continue;
      const action = textValue(payload, 'action');
      const rawBoxCode = textValue(payload, 'boxCode') ?? '';
      const normalized = normalizeBoxCode(rawBoxCode);
      if (!normalized) continue;
      const current = boxes.get(normalized) ?? {
        boxCode: rawBoxCode,
        closed: false,
        deviceCode: textValue(payload, 'deviceCode') || operation.deviceId,
        openedAt: operation.createdAt.toISOString(),
        closedAt: null,
        items: new Map<string, { requestItemId: string; barcode: string; name: string; quantity: number }>(),
      };
      if (action === 'open-box') {
        current.closed = false;
        current.deviceCode = textValue(payload, 'deviceCode') || operation.deviceId;
      }
      if (action === 'scan-item') {
        const requestItemId = textValue(payload, 'requestItemId');
        const row = requestRows.find((item) => item.itemId === requestItemId || item.id === requestItemId);
        if (requestItemId && row) {
          const existing = current.items.get(requestItemId);
          current.items.set(requestItemId, {
            requestItemId,
            barcode: textValue(row, 'barcode') ?? '',
            name: textValue(row, 'name') ?? '',
            quantity: (existing?.quantity ?? 0) + Math.max(1, Number(payload.quantity) || 1),
          });
        }
      }
      if (action === 'close-box') {
        current.closed = true;
        current.closedAt = operation.createdAt.toISOString();
      }
      boxes.set(normalized, current);
    }

    const packedByItem = new Map<string, number>();
    const boxRows = [...boxes.values()].map((box) => {
      const items = [...box.items.values()];
      for (const item of items) packedByItem.set(item.requestItemId, (packedByItem.get(item.requestItemId) ?? 0) + item.quantity);
      return { ...box, items, quantity: items.reduce((sum, item) => sum + item.quantity, 0) };
    });
    const rows = requestRows.map((row) => {
      const requestItemId = textValue(row, 'itemId') || textValue(row, 'id') || '';
      const requiredQuantity = Number(row.requestedQuantity ?? row.quantity) || 0;
      const packedQuantity = Math.min(requiredQuantity, packedByItem.get(requestItemId) ?? 0);
      return {
        requestItemId,
        barcode: textValue(row, 'barcode') ?? '',
        name: textValue(row, 'name') ?? '',
        requiredQuantity,
        packedQuantity,
        remainingQuantity: Math.max(0, requiredQuantity - packedQuantity),
      };
    });

    return {
      boxes: boxRows,
      rows,
      packedQuantity: rows.reduce((sum, row) => sum + row.packedQuantity, 0),
      totalQuantity: rows.reduce((sum, row) => sum + row.requiredQuantity, 0),
      remainingQuantity: rows.reduce((sum, row) => sum + row.remainingQuantity, 0),
      closedBoxes: boxRows.filter((box) => box.closed).length,
      openBoxes: boxRows.filter((box) => !box.closed).length,
    };
  }
}

type CollapsibleRow = {
  sourceBox: string;
  quantity: number;
};

function stagePayload(plan: Record<string, any>, stage: TsdRequestStage) {
  const requestRows = plan.requestRows ?? plan.rows ?? [];
  const base = {
    ...plan,
    stage,
    requestId: plan.requestId ?? plan.id,
    destinationCity: plan.destinationCity ?? plan.city ?? null,
    deliveryCity: plan.deliveryCity ?? plan.destinationCity ?? plan.city ?? null,
    city: plan.city ?? plan.destinationCity ?? null,
    cityName: plan.cityName ?? plan.destinationCity ?? plan.city ?? null,
    destination: plan.destination ?? plan.destinationCity ?? plan.city ?? null,
    deliveryDestination: plan.deliveryDestination ?? plan.destinationCity ?? plan.city ?? null,
    rowsCount: plan.rowsCount ?? requestRows.length,
    itemsCount: plan.itemsCount ?? plan.rowsCount ?? requestRows.length,
    itemCount: plan.itemCount ?? plan.rowsCount ?? requestRows.length,
    linesCount: plan.linesCount ?? plan.rowsCount ?? requestRows.length,
    rows: requestRows,
    items: requestRows,
  };

  if (stage === 'box-search') {
    const tasks = normalizeBoxTasks(plan.searchBoxes ?? []);
    const boxCodes = tasks.map((box) => box.boxCode);
    const foundBoxes = tasks.filter((box) => box.found || box.isFound);
    const remainingBoxes = tasks.filter((box) => !box.found && !box.isFound);
    const foundBoxCodes = foundBoxes.map((box) => box.boxCode);
    const remainingBoxCodes = remainingBoxes.map((box) => box.boxCode);
    return {
      ...base,
      tasks,
      boxes: tasks,
      boxTasks: tasks,
      searchBoxes: tasks,
      boxesToSearch: tasks,
      boxesToFind: tasks,
      boxCodes,
      searchBoxCodes: boxCodes,
      boxesToSearchCodes: boxCodes,
      boxesToFindCodes: boxCodes,
      foundBoxCodes,
      foundBoxesCodes: foundBoxCodes,
      remainingBoxCodes,
      total: tasks.length,
      totalCount: tasks.length,
      foundCount: foundBoxes.length,
      found: foundBoxes.length,
      remainingCount: remainingBoxes.length,
      remaining: remainingBoxes.length,
      remainingBoxesCount: remainingBoxes.length,
      foundBoxes,
      remainingBoxes,
      remainingBoxTasks: remainingBoxes,
      boxSearchProgress: {
        total: tasks.length,
        found: foundBoxes.length,
        remaining: remainingBoxes.length,
        foundBoxCodes,
        remainingBoxCodes,
      },
    };
  }

  if (stage === 'relabel') {
    const tasks = plan.relabelTasks ?? [];
    return {
      ...base,
      tasks,
      relabelTasks: tasks,
      boxes: groupTasksByBox(tasks),
      relabelBoxes: groupTasksByBox(tasks),
      total: tasks.reduce((sum: number, row: { quantity?: number }) => sum + (row.quantity ?? 0), 0),
      totalCount: tasks.length,
      doneCount: 0,
      remainingCount: tasks.length,
    };
  }

  if (stage === 'moves') {
    const tasks = plan.movementTasks ?? [];
    return {
      ...base,
      tasks,
      movementTasks: tasks,
      moveTasks: tasks,
      boxes: groupTasksByBox(tasks),
      movementBoxes: groupTasksByBox(tasks),
      total: tasks.reduce((sum: number, row: { quantity?: number }) => sum + (row.quantity ?? 0), 0),
      totalCount: tasks.length,
      doneCount: 0,
      remainingCount: tasks.length,
    };
  }

  return {
    ...base,
    tasks: requestRows,
    total: plan.totalRequested ?? plan.totalQuantity ?? 0,
    totalCount: requestRows.length,
    packedCount: 0,
    closedBoxes: [],
  };
}

function normalizeBoxTasks(values: Array<{ boxCode?: string; code?: string; found?: boolean; isFound?: boolean } | string>) {
  return values
    .map((value) =>
      typeof value === 'string' ? boxEntry(value) : boxEntry(value.boxCode ?? value.code ?? '', Boolean(value.found ?? value.isFound)),
    )
    .filter((box) => box.boxCode);
}

function boxSearchOperationPrefix(requestId: string) {
  return `box-search:${requestId}:`;
}

function operationPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function duplicateFbsKizScanFromAudit(event: { id: string; payload: Prisma.JsonValue | null; createdAt: Date }) {
  const payload = operationPayload(event.payload ?? {});
  const attempt = isRecord(payload.attempt) ? payload.attempt : {};
  const existing = isRecord(payload.existing) ? payload.existing : {};
  const kiz = textValue(payload, 'kiz');
  const attemptOrderId = textValue(attempt, 'orderId');
  const existingOrderId = textValue(existing, 'orderId');
  if (!kiz || !attemptOrderId || !existingOrderId) {
    return null;
  }

  return {
    id: event.id,
    eventKey: textValue(payload, 'eventKey') ?? event.id,
    kiz,
    detectedAt: textValue(payload, 'detectedAt') ?? event.createdAt.toISOString(),
    attempt: duplicateFbsKizOccurrence(attempt, event.createdAt),
    existing: duplicateFbsKizOccurrence(existing, event.createdAt),
  };
}

function localFbsKizConflictFromAudit(event: {
  id: string;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  const payload = operationPayload(event.payload ?? {});
  const assemblyId = textValue(payload, 'assemblyId');
  const orderId = textValue(payload, 'orderId');
  const kiz = textValue(payload, 'kiz');
  if (!assemblyId || !orderId || !kiz) return null;
  return {
    id: event.id,
    assemblyId,
    orderId,
    productName: textValue(payload, 'productName') ?? 'Товар не определён',
    article: textValue(payload, 'article') ?? null,
    sourceBoxCode: textValue(payload, 'boxCode') ?? null,
    kiz,
    message:
      textValue(payload, 'message') ??
      'КИЗ требует сверки с данными WMS и Wildberries.',
    updatedAt:
      textValue(payload, 'detectedAt') ??
      event.createdAt.toISOString(),
  };
}

function duplicateFbsKizOccurrence(value: Record<string, unknown>, fallbackDate: Date) {
  const requestNumberValue = value.requestNumber;
  const requestNumber =
    typeof requestNumberValue === 'number' && Number.isSafeInteger(requestNumberValue)
      ? requestNumberValue
      : typeof requestNumberValue === 'string' && /^\d+$/.test(requestNumberValue)
        ? Number(requestNumberValue)
        : null;
  return {
    requestId: textValue(value, 'requestId') ?? '',
    requestNumber,
    requestTitle: textValue(value, 'requestTitle') ?? null,
    assemblyId: textValue(value, 'assemblyId') ?? '',
    orderId: textValue(value, 'orderId') ?? '',
    boxCode: textValue(value, 'boxCode') ?? 'БЕЗ КОРОБА',
    deviceCode: textValue(value, 'deviceCode') ?? null,
    workerName: textValue(value, 'workerName') ?? null,
    status: textValue(value, 'status') ?? null,
    scannedAt: textValue(value, 'scannedAt') ?? fallbackDate.toISOString(),
  };
}

function operationRequestId(operation: { operationKey: string; operationType: string }, payload: Record<string, unknown>) {
  const fromPayload = textValue(payload, 'requestId');
  if (fromPayload) {
    return fromPayload;
  }
  if (operation.operationType === 'box_search_scan') {
    const parts = operation.operationKey.split(':');
    return parts.length >= 3 ? parts[1] : '';
  }
  return '';
}

function operationStage(operation: { operationType: string }, payload: Record<string, unknown>) {
  if (operation.operationType === 'box_search_scan') {
    return 'box-search';
  }
  if (operation.operationType === 'move_scan') {
    return 'moves';
  }
  return textValue(payload, 'stage') ?? 'open';
}

function relabelTaskProgressKey(task: { sourceBox?: string; oldBarcode?: string; newBarcode?: string; size?: string }) {
  return [
    normalizeBoxCode(task.sourceBox),
    normalizeScanCode(task.oldBarcode),
    normalizeScanCode(task.newBarcode),
    (task.size ?? '').trim().toLocaleLowerCase('ru-RU'),
  ].join('|');
}

function relabelPayloadProgressKey(payload: Record<string, unknown>) {
  return relabelTaskProgressKey({
    sourceBox: textValue(payload, 'sourceBox'),
    oldBarcode: textValue(payload, 'oldBarcode'),
    newBarcode: textValue(payload, 'newBarcode'),
    size: textValue(payload, 'size'),
  });
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    open: 'открыта заявка',
    'box-search': 'поиск коробов',
    relabel: 'перемаркировка',
    moves: 'перемещения',
    'boxless-packing': 'сборка по коробам',
    packed: 'упаковано',
  };
  return labels[stage] ?? stage;
}

function requireFflScanCode(code: string) {
  return code.toLocaleUpperCase('ru-RU').startsWith('FFL')
    ? null
    : actionResult('REJECTED', false, 'Номер короба должен начинаться с FFL. Отсканируйте корректный ШК короба.');
}

function normalizeBoxCode(value?: string | null) {
  return safeDecode(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function shouldShowInTsdBoxSearch(boxCode: string, movementTargetBoxes: Set<string>) {
  const normalized = normalizeBoxCode(boxCode);
  if (!normalized) {
    return false;
  }

  if (movementTargetBoxes.has(normalized)) {
    return false;
  }

  return true;
}

function boxEntry(boxCode: string, found = false) {
  const code = boxCode.trim();
  return {
    boxCode: code,
    code,
    number: code,
    name: code,
    title: code,
    label: code,
    value: code,
    found,
    isFound: found,
  };
}

export function boxSearchInstruction(input: {
  requiresRelabel: boolean;
  requiresMovement: boolean;
  shipsWhole: boolean;
}) {
  if (input.requiresRelabel && input.requiresMovement) {
    return {
      instructionType: 'RELABEL_MOVEMENT' as const,
      instructionLabel: 'МАРК+ПЕРЕМЕЩЕНИЕ',
      requiresRelabel: true,
      requiresMovement: true,
      shipsWhole: input.shipsWhole,
    };
  }
  if (input.requiresRelabel) {
    return {
      instructionType: 'RELABEL' as const,
      instructionLabel: 'ПЕРЕМАРКИРОВКА',
      requiresRelabel: true,
      requiresMovement: false,
      shipsWhole: input.shipsWhole,
    };
  }
  if (input.requiresMovement) {
    return {
      instructionType: 'MOVEMENT' as const,
      instructionLabel: 'ПЕРЕМЕЩЕНИЕ',
      requiresRelabel: false,
      requiresMovement: true,
      shipsWhole: input.shipsWhole,
    };
  }

  return {
    instructionType: 'WHOLE' as const,
    instructionLabel: 'ЦЕЛИКОМ',
    requiresRelabel: false,
    requiresMovement: false,
    shipsWhole: input.shipsWhole,
  };
}

export function validateStageAction(plan: Record<string, any>, stage: TsdRequestStage, action: string, scannedCode?: string) {
  const code = normalizeScanCode(scannedCode);

  if (stage === 'box-search' && action === 'scan') {
    if (!code) {
      return actionResult('REJECTED', false, 'Не прочитан номер короба.');
    }
    const boxGuard = requireFflScanCode(code);
    if (boxGuard) {
      return boxGuard;
    }
    const matched = (plan.searchBoxes ?? []).find((box: { boxCode?: string }) => sameCode(box.boxCode, code));
    if (matched?.found || matched?.isFound) {
      return actionResult('DUPLICATE', false, 'Этот короб уже был пропикан в данной заявке. Повторный скан отклонен.');
    }
    return actionResult(matched ? 'FOUND' : 'NOT_REQUIRED', Boolean(matched), matched ? 'Короб найден.' : 'Короб не участвует в этой заявке.');
  }

  if ((stage === 'moves' && action === 'target-box') || (stage === 'boxless-packing' && action === 'open-box')) {
    if (!code) {
      return actionResult('REJECTED', false, 'Не прочитан номер короба.');
    }
    const boxGuard = requireFflScanCode(code);
    if (boxGuard) {
      return boxGuard;
    }
  }

  if (stage === 'relabel' && action === 'scan-source') {
    const found = (plan.relabelTasks ?? []).some((task: { oldBarcode?: string; barcode?: string }) =>
      sameCode(task.oldBarcode ?? task.barcode, code),
    );
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Старый штрихкод принят.' : 'Неверный старый штрихкод для перемаркировки.');
  }

  if (stage === 'relabel' && action === 'scan-target') {
    const found = (plan.relabelTasks ?? []).some((task: { newBarcode?: string; barcode?: string }) =>
      sameCode(task.newBarcode ?? task.barcode, code),
    );
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Новый штрихкод принят.' : 'Неверный новый штрихкод для перемаркировки.');
  }

  if (stage === 'moves' && action === 'scan-item') {
    const found = (plan.movementTasks ?? []).some((task: { barcode?: string }) => sameCode(task.barcode, code));
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Товар для перемещения принят.' : 'Товар не найден в списке перемещений.');
  }

  if (stage === 'boxless-packing' && action === 'scan-item') {
    const rows = plan.requestRows ?? plan.rows ?? [];
    const found = rows.some((row: { barcode?: string }) => sameCode(row.barcode, code));
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Товар принят в короб.' : 'Товар не найден в заявке.');
  }

  return actionResult('ACCEPTED', true, 'Операция принята.');
}

function actionResult(status: string, accepted: boolean, message: string) {
  return {
    status,
    result: status,
    accepted,
    ok: accepted,
    success: accepted,
    valid: accepted,
    isValid: accepted,
    matched: accepted,
    match: accepted,
    isMatched: accepted,
    found: accepted,
    isFound: accepted,
    needed: accepted,
    required: accepted,
    notRequired: !accepted,
    rejected: !accepted,
    error: !accepted,
    isError: !accepted,
    message,
  };
}

function groupTasksByBox<T extends { sourceBox?: string; quantity?: number }>(tasks: T[]) {
  const byBox = new Map<string, { boxCode: string; sourceBox: string; remaining: number; quantity: number; tasks: T[] }>();
  for (const task of tasks) {
    const sourceBox = task.sourceBox?.trim();
    if (!sourceBox) {
      continue;
    }
    const current = byBox.get(sourceBox) ?? { boxCode: sourceBox, sourceBox, remaining: 0, quantity: 0, tasks: [] };
    current.remaining += task.quantity ?? 0;
    current.quantity += task.quantity ?? 0;
    current.tasks.push(task);
    byBox.set(sourceBox, current);
  }
  return [...byBox.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function movementPairKey(value?: string | null) {
  return value?.replace(/:(out|in)$/i, '') ?? '';
}

function movementPairSide(value: string | null | undefined, quantity: number): 'out' | 'in' | null {
  if (value?.match(/:out$/i)) {
    return 'out';
  }
  if (value?.match(/:in$/i)) {
    return 'in';
  }
  if (quantity < 0) {
    return 'out';
  }
  if (quantity > 0) {
    return 'in';
  }
  return null;
}

function primaryBarcode(barcodes: Array<{ value: string; isPrimary: boolean }>) {
  return barcodes.find((barcode) => barcode.isPrimary)?.value ?? barcodes[0]?.value ?? '';
}

function isBalanceMovementTask(task: Pick<TsdMovementPlanTask, 'purpose' | 'targetRole' | 'targetBox'>) {
  const purpose = task.purpose?.trim().toUpperCase();
  const targetRole = task.targetRole?.trim().toUpperCase();
  return purpose === 'BALANCE' || targetRole === 'STOCK' || Boolean(task.targetBox?.trim());
}

function isShipmentMovementTask(task: Pick<TsdMovementPlanTask, 'purpose' | 'targetRole' | 'targetBox' | 'note'>) {
  const purpose = task.purpose?.trim().toUpperCase();
  const targetRole = task.targetRole?.trim().toUpperCase();
  if (purpose === 'SHIPMENT' || targetRole === 'SHIPMENT') {
    return true;
  }
  return !task.targetBox?.trim() || Boolean(task.note?.toLocaleLowerCase('ru-RU').includes('постав'));
}

function movementTaskKey(task: TsdMovementPlanTask) {
  return [
    normalizeBoxCode(task.sourceBox),
    normalizeBoxCode(task.targetBox),
    isShipmentMovementTask(task) ? 'SHIPMENT' : 'BALANCE',
    normalizeScanCode(task.barcode),
    task.size?.trim().toLocaleLowerCase('ru-RU') ?? '',
  ].join('|');
}

function matchesMovementTask(
  task: TsdMovementPlanTask,
  actual: {
    sourceBox: string;
    targetBox: string;
    purpose: 'BALANCE' | 'SHIPMENT';
    barcode: string;
    name: string | null;
    size: string | null;
  },
) {
  if (!sameCode(task.sourceBox, actual.sourceBox)) {
    return false;
  }
  if (isShipmentMovementTask(task) !== (actual.purpose === 'SHIPMENT')) {
    return false;
  }
  if (isBalanceMovementTask(task) && task.targetBox && !sameCode(task.targetBox, actual.targetBox)) {
    return false;
  }
  const barcodeMatches = task.barcode && actual.barcode ? sameCode(task.barcode, actual.barcode) : true;
  const sizeMatches = task.size && actual.size ? task.size.trim().toLocaleLowerCase('ru-RU') === actual.size.trim().toLocaleLowerCase('ru-RU') : true;
  const nameMatches = task.name && actual.name ? task.name.trim().toLocaleLowerCase('ru-RU') === actual.name.trim().toLocaleLowerCase('ru-RU') : true;
  return barcodeMatches && sizeMatches && nameMatches;
}

function groupMovementProgressBySource(
  rows: Array<
    TsdMovementPlanTask & {
      requiredQuantity: number;
      movedQuantity: number;
      remainingQuantity: number;
      actualTargetBoxes: string[];
    }
  >,
) {
  const bySource = new Map<
    string,
    {
      sourceBox: string;
      requiredQuantity: number;
      movedQuantity: number;
      remainingQuantity: number;
      done: boolean;
      targetBoxes: string[];
    }
  >();

  for (const row of rows) {
    const sourceBox = row.sourceBox.trim();
    if (!sourceBox) {
      continue;
    }
    const current =
      bySource.get(sourceBox) ??
      ({
        sourceBox,
        requiredQuantity: 0,
        movedQuantity: 0,
        remainingQuantity: 0,
        done: false,
        targetBoxes: [],
      } as {
        sourceBox: string;
        requiredQuantity: number;
        movedQuantity: number;
        remainingQuantity: number;
        done: boolean;
        targetBoxes: string[];
      });
    current.requiredQuantity += row.requiredQuantity;
    current.movedQuantity += row.movedQuantity;
    current.remainingQuantity += row.remainingQuantity;
    for (const targetBox of row.actualTargetBoxes) {
      if (targetBox && !current.targetBoxes.some((value) => sameCode(value, targetBox))) {
        current.targetBoxes.push(targetBox);
      }
    }
    current.done = current.remainingQuantity <= 0;
    bySource.set(sourceBox, current);
  }

  return [...bySource.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function mergeActualMovementSourceBoxes(
  sourceBoxes: Array<{
    sourceBox: string;
    requiredQuantity: number;
    movedQuantity: number;
    remainingQuantity: number;
    done: boolean;
    targetBoxes: string[];
  }>,
  actualRows: Array<{
    sourceBox: string;
    targetBox: string;
    quantity: number;
  }>,
) {
  const bySource = new Map(
    sourceBoxes.map((box) => [
      normalizeBoxCode(box.sourceBox),
      {
        ...box,
        targetBoxes: [...box.targetBoxes],
      },
    ]),
  );
  const actualBySource = new Map<string, { sourceBox: string; movedQuantity: number; targetBoxes: string[] }>();

  for (const row of actualRows) {
    const sourceKey = normalizeBoxCode(row.sourceBox);
    if (!sourceKey) {
      continue;
    }
    const current = actualBySource.get(sourceKey) ?? {
      sourceBox: row.sourceBox,
      movedQuantity: 0,
      targetBoxes: [],
    };
    current.movedQuantity += row.quantity;
    if (row.targetBox && !current.targetBoxes.some((value) => sameCode(value, row.targetBox))) {
      current.targetBoxes.push(row.targetBox);
    }
    actualBySource.set(sourceKey, current);
  }

  for (const [sourceKey, actual] of actualBySource) {
    const current = bySource.get(sourceKey);
    if (!current) {
      bySource.set(sourceKey, {
        sourceBox: actual.sourceBox,
        requiredQuantity: actual.movedQuantity,
        movedQuantity: actual.movedQuantity,
        remainingQuantity: 0,
        done: true,
        targetBoxes: actual.targetBoxes,
      });
      continue;
    }

    current.movedQuantity = Math.max(current.movedQuantity, actual.movedQuantity);
    current.remainingQuantity = Math.max(0, current.requiredQuantity - current.movedQuantity);
    current.done = current.remainingQuantity <= 0;
    for (const targetBox of actual.targetBoxes) {
      if (!current.targetBoxes.some((value) => sameCode(value, targetBox))) {
        current.targetBoxes.push(targetBox);
      }
    }
    bySource.set(sourceKey, current);
  }

  return [...bySource.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function buildOutgoingBoxes(
  document: PickInstructionDocument,
  actualRows: Array<{
    sourceBox: string;
    targetBox: string;
    purpose: 'BALANCE' | 'SHIPMENT';
    quantity: number;
  }>,
) {
  const boxes = new Map<
    string,
    {
      boxCode: string;
      code: string;
      number: string;
      label: string;
      type: 'WHOLE_BOX' | 'SHIPMENT_MOVE';
      typeLabel: string;
      sourceBox: string;
      quantity: number;
      status: string;
      city: string | null;
      pallet: string | null;
    }
  >();

  const addBox = (
    boxCode: string,
    data: {
      type: 'WHOLE_BOX' | 'SHIPMENT_MOVE';
      typeLabel: string;
      sourceBox?: string;
      quantity?: number;
      status?: string;
      city?: string | null;
      pallet?: string | null;
    },
  ) => {
    const normalized = normalizeBoxCode(boxCode);
    if (!normalized) {
      return;
    }
    const safeCode = boxCode.trim();
    const current =
      boxes.get(normalized) ??
      ({
        boxCode: safeCode,
        code: safeCode,
        number: safeCode,
        label: safeCode,
        type: data.type,
        typeLabel: data.typeLabel,
        sourceBox: '',
        quantity: 0,
        status: '',
        city: null,
        pallet: null,
      } as {
        boxCode: string;
        code: string;
        number: string;
        label: string;
        type: 'WHOLE_BOX' | 'SHIPMENT_MOVE';
        typeLabel: string;
        sourceBox: string;
        quantity: number;
        status: string;
        city: string | null;
        pallet: string | null;
      });
    current.quantity += data.quantity ?? 0;
    current.status = current.status || data.status || '';
    current.city = current.city || data.city || null;
    current.pallet = current.pallet || data.pallet || null;
    if (data.sourceBox && !current.sourceBox.split(', ').some((value) => sameCode(value, data.sourceBox))) {
      current.sourceBox = current.sourceBox ? `${current.sourceBox}, ${data.sourceBox}` : data.sourceBox;
    }
    if (current.type !== 'WHOLE_BOX' && data.type === 'WHOLE_BOX') {
      current.type = data.type;
      current.typeLabel = data.typeLabel;
    }
    boxes.set(normalized, current);
  };

  for (const row of document.warehouseWholeBoxes) {
    addBox(row.box, {
      type: 'WHOLE_BOX',
      typeLabel: 'Целый короб',
      sourceBox: row.box,
      status: row.status,
      city: row.city || null,
      pallet: row.pallet || null,
    });
  }

  for (const row of actualRows) {
    if (row.purpose !== 'SHIPMENT') {
      continue;
    }
    addBox(row.targetBox, {
      type: 'SHIPMENT_MOVE',
      typeLabel: 'Короб поставки',
      sourceBox: row.sourceBox,
      quantity: row.quantity,
      status: 'Собран из перемещений',
    });
  }

  return [...boxes.values()].sort((left, right) => left.boxCode.localeCompare(right.boxCode, 'ru', { numeric: true }));
}

function buildWorkbook(rows: Array<Array<string | number>>, sheetName: string, columnWidths: number[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = columnWidths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function movementTargetsText(row: { actualTargetBoxes?: string[]; targetBox?: string; purpose?: string; targetRole?: string }) {
  if (row.actualTargetBoxes?.length) {
    return row.actualTargetBoxes.join(', ');
  }

  if (row.targetBox) {
    return row.targetBox;
  }

  return row.purpose === 'SHIPMENT' || row.targetRole === 'SHIPMENT' ? 'Новый короб поставки' : 'Новый короб баланса';
}

function movementPurposeLabel(purpose?: string, targetRole?: string) {
  if (purpose === 'SHIPMENT' || targetRole === 'SHIPMENT') {
    return 'В поставку';
  }

  if (purpose === 'BALANCE' || targetRole === 'STOCK') {
    return 'Остаток на склад';
  }

  return [purpose, targetRole].filter(Boolean).join(' / ');
}

function xlsxMimeType() {
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_').replace(/^_+|_+$/g, '') || 'request';
}

function scannedValue(body: Record<string, unknown> | string | undefined) {
  if (typeof body === 'string') {
    return body.trim() || undefined;
  }
  if (!body) {
    return undefined;
  }

  for (const key of [
    'boxCode',
    'box_code',
    'box-code',
    'box',
    'boxNo',
    'boxNum',
    'boxId',
    'boxNumber',
    'boxBarcode',
    'boxQr',
    'boxQrCode',
    'boxQRCode',
    'packageCode',
    'package',
    'targetBoxCode',
    'targetBox',
    'sourceBox',
    'barcode',
    'barCode',
    'barcodeText',
    'oldBarcode',
    'newBarcode',
    'sourceBarcode',
    'targetBarcode',
    'itemBarcode',
    'code',
    'value',
    'scan',
    'scanCode',
    'scanData',
    'scanText',
    'scanValue',
    'scanResult',
    'scannedCode',
    'scannedValue',
    'qr',
    'qrCode',
    'qrText',
    'raw',
    'rawValue',
    'rawText',
    'text',
    'serial',
  ]) {
    const value = textValue(body, key);
    if (value) {
      return value;
    }
  }

  const payload = body?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return scannedValue(payload as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(body)) {
    if (looksLikeScannedKey(key, value)) {
      return key.trim();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(body: Record<string, unknown> | undefined, key: string) {
  const value = body?.[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return undefined;
}

function normalizeScanCode(value?: string) {
  return safeDecode(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function sameCode(left?: string | null, right?: string) {
  const leftCode = normalizeScanCode(left ?? undefined);
  const rightCode = normalizeScanCode(right);
  const leftCompact = compactScanCode(leftCode);
  const rightCompact = compactScanCode(rightCode);
  return Boolean(
    leftCode &&
      rightCode &&
      (leftCode === rightCode ||
        rightCode.includes(leftCode) ||
        leftCode.includes(rightCode) ||
        (leftCompact && rightCompact && (leftCompact === rightCompact || rightCompact.includes(leftCompact) || leftCompact.includes(rightCompact)))),
  );
}

function isPrismaUniqueConflict(value: unknown) {
  return Boolean(value && typeof value === 'object' && 'code' in value && value.code === 'P2002');
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function compactScanCode(value: string) {
  return value.replace(/[^0-9a-zа-я]+/giu, '');
}

function looksLikeScannedKey(key: string, value: unknown) {
  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length < 3) {
    return false;
  }
  if (['deviceCode', 'device', 'token', 'stage', 'action'].includes(normalizedKey)) {
    return false;
  }
  return value === '' || value == null || value === true || typeof value === 'number';
}

function collapseRows<T extends CollapsibleRow>(rows: T[], keyOf: (row: T) => string) {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = byKey.get(key);
    if (current) {
      current.quantity += row.quantity;
    } else {
      byKey.set(key, { ...row });
    }
  }

  return [...byKey.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true }),
  );
}

function fbsAssemblyStatusLabel(status: string) {
  return ({
    IN_PROGRESS: 'В работе',
    COMPLETED: 'Собрано',
    RELEASED: 'Отложено',
    RETURN_REQUIRED: 'Требуется решение',
  } as Record<string, string>)[status] ?? status;
}

function decimalToNumber(value: { toNumber?: () => number } | number | string | null | undefined) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return typeof value.toNumber === 'function' ? value.toNumber() : null;
}

function extractMarketplacePhotos(payload: unknown) {
  const photos: string[] = [];

  visitMarketplacePayload(payload, (value, key) => {
    const normalizedKey = key.toLowerCase();
    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
      return;
    }

    if (!['photo', 'photos', 'image', 'images', 'picture', 'pictures', 'media', 'primary_image'].some((name) => normalizedKey.includes(name))) {
      return;
    }

    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
      return;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const field of ['url', 'big', 'small', 'file_name', 'link', 'c246x328', 'c516x688', 'hq', 'tm']) {
        const candidate = record[field];
        if (typeof candidate === 'string' && looksLikeImageUrl(candidate)) {
          photos.push(candidate);
        }
      }
    }
  });

  return [...new Set(photos)].slice(0, 20);
}

function visitMarketplacePayload(value: unknown, visit: (value: unknown, key: string) => void, key = '', depth = 0) {
  if (depth > 6 || value == null) {
    return;
  }

  visit(value, key);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMarketplacePayload(item, visit, `${key}.${index}`, depth + 1));
    return;
  }

  if (typeof value === 'object') {
    for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
      visitMarketplacePayload(nextValue, visit, nextKey, depth + 1);
    }
  }
}

function looksLikeImageUrl(value: string) {
  return /^https?:\/\//i.test(value) && /\.(?:jpg|jpeg|png|webp)(?:\?|#|$)/i.test(value);
}

function parseRelabelNote(note: string) {
  const match = note.match(/перемаркировать\s+(.+?)\s*->\s*(.+)$/i);
  return {
    oldBarcode: match?.[1]?.trim() ?? '',
    newBarcode: match?.[2]?.trim() ?? '',
  };
}
