import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClientRequestEventType,
  ClientRequestPriority,
  ClientRequestStatus,
  ClientRequestType,
  PickWaveStatus,
  Prisma,
  StockStatus,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import {
  assertWarehouseAccess,
  effectiveWarehouseId,
  warehouseScopeWhere,
} from '../client-requests/client-request-warehouse-scope';
import {
  renderPickInstructionHtml,
  requestPriorityLabel,
  requestStatusLabel,
  rowStatusLabel,
  safeFileName,
} from './pick-instruction-renderer';
import type {
  PickInstructionAllocation,
  WarehouseBalanceLabelRow,
  WarehouseBalanceMoveRow,
  PickInstructionBoxSummary,
  PickInstructionDocument,
  PickInstructionRow,
  PickInstructionRowStatus,
  WarehouseInstructionRow,
  WarehouseMarkRow,
  WarehouseWholeBoxRow,
} from './pick-instruction.types';
import { buildPickInstructionWorkbook, pickInstructionXlsxMimeType } from './pick-instruction-xlsx';
import {
  isManualPickInstructionFileName,
  ManualPickInstructionParseError,
  manualPickInstructionDisplayFilePrefix,
  manualPickInstructionPlanFilePrefix,
  parseManualPickInstructionWorkbook,
  type ManualInstructionRow,
  type ParsedManualPickInstruction,
} from './manual-pick-instruction';

type RequestForInstruction = Prisma.ClientRequestGetPayload<typeof pickInstructionRequestArgs>;
type RequestItemForInstruction = RequestForInstruction['items'][number];
type SkuForInstruction = NonNullable<RequestItemForInstruction['sku']>;
type SkuCatalogForInstruction = Prisma.SkuGetPayload<typeof skuCatalogArgs>;
type BalanceForInstruction = Prisma.StockBalanceGetPayload<typeof stockBalanceArgs>;
type PickInstructionWithHtml = PickInstructionDocument & { html: string };
type WarehousePlan = {
  rows: WarehouseInstructionRow[];
  wholeBoxes: WarehouseWholeBoxRow[];
  balanceMoves: WarehouseBalanceMoveRow[];
  balanceLabels: WarehouseBalanceLabelRow[];
  markRows: WarehouseMarkRow[];
};
type WarehouseReservation = {
  orderId: string;
  balanceId: string;
  sourceBox: string;
  quantity: number;
};
type BuiltWarehousePlan = WarehousePlan & {
  reservations: WarehouseReservation[];
};
export type ForcedWarehouseAllocation = {
  orderId: string;
  balanceId: string;
  quantity: number;
};
type CompiledManualPickInstruction = {
  version: 1;
  originalFileName: string;
  uploadedAt: string;
  outboundQuantity: number;
  balanceQuantity: number;
  shortageQuantity: number;
  warehousePlan: WarehousePlan;
};

const maxManualInstructionFileSizeBytes = 10 * 1024 * 1024;
// A request starts reserving stock only after it is explicitly moved to work.
// Draft/review requests remain previews and must not change instructions for
// warehouse operations that are already running.
const activeReservationStatuses = new Set<ClientRequestStatus>([ClientRequestStatus.IN_WORK]);
const forcedInstructionRefreshEventTitle = 'Принудительный пересчёт заявки по текущим остаткам';

@Injectable()
export class PickInstructionService {
  private readonly instructionCache = new Map<string, { expiresAt: number; promise: Promise<PickInstructionWithHtml> }>();
  private readonly instructionCacheTtlMs = 15000;
  private readonly warehouseAuxiliaryCache = new Map<
    string,
    { expiresAt: number; promise: Promise<WarehouseAuxiliaryData> }
  >();
  private readonly warehouseAuxiliaryCacheTtlMs = 60_000;
  private activeRequestBoxOverlapCache:
    | {
        expiresAt: number;
        promise: ReturnType<PickInstructionService['calculateActiveRequestBoxOverlaps']>;
        stalePromise?: ReturnType<PickInstructionService['calculateActiveRequestBoxOverlaps']>;
      }
    | undefined;
  private readonly activeRequestBoxOverlapCacheTtlMs = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getRequestInstruction(requestId: string, user: AuthUser) {
    await this.requireRequestWarehouseAccess(requestId, user, 'read');
    const now = Date.now();
    const cacheKey = `${requestId}:${user.id}`;
    const cached = this.instructionCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.promise;
    }

    this.pruneInstructionCache(now);
    const promise = this.buildRequestInstruction(requestId, user);
    this.instructionCache.set(cacheKey, { expiresAt: now + this.instructionCacheTtlMs, promise });

    try {
      return await promise;
    } catch (error) {
      if (this.instructionCache.get(cacheKey)?.promise === promise) {
        this.instructionCache.delete(cacheKey);
      }
      throw error;
    }
  }

  async buildWaveDraft(
    requestIds: string[],
    user: AuthUser,
    forcedAllocations: ForcedWarehouseAllocation[] = [],
  ) {
    const ids = [...new Set(requestIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('Для волны сборки нужна хотя бы одна заявка.');
    }

    const requests = await this.prisma.clientRequest.findMany({
      where: { id: { in: ids } },
      ...pickInstructionRequestArgs,
    });
    if (requests.length !== ids.length) {
      throw new NotFoundException('Одна или несколько заявок волны не найдены.');
    }

    const clientIds = new Set(requests.map((request) => request.clientId));
    if (clientIds.size !== 1) {
      throw new BadRequestException('В одной волне могут находиться только заявки одного клиента.');
    }

    const warehouseIds = new Set(requests.map((request) => request.warehouseId));
    if (warehouseIds.size !== 1 || !requests[0].warehouseId) {
      throw new BadRequestException('Все заявки волны должны относиться к одному выбранному филиалу.');
    }
    const warehouseId = requests[0].warehouseId;

    const clientId = requests[0].clientId;
    const contexts: Array<{
      request: RequestForInstruction;
      rows: ReturnType<PickInstructionService['prepareRows']>;
      auxiliary: WarehouseAuxiliaryData;
    }> = [];
    for (const request of requests.sort(compareRequestReservationOrder)) {
      this.clientScopes.requireClientAccess(user, request.clientId, 'write');
      assertWarehouseAccess(user, request, 'write', 'Заявка волны не найдена в выбранном филиале.');
      if (request.type !== ClientRequestType.OUTBOUND) {
        throw new BadRequestException('В волну можно включить только заявки на отгрузку.');
      }
      const rows = this.prepareRows(request, await this.resolveMissingSkusByBarcode(request));
      contexts.push({
        request,
        rows,
        auxiliary: await this.loadWarehouseAuxiliaryData(request.clientId, request.files),
      });
    }

    const allRows = contexts.flatMap((context) => context.rows);
    const balances = await this.loadAvailableBalances(clientId, warehouseId, allRows, true);
    const requestIdByOrderId = new Map<string, string>();
    const destinationCityByOrderId = new Map<string, string>();
    contexts.forEach((context) => {
      context.rows.forEach((row) => {
        requestIdByOrderId.set(row.item.id, context.request.id);
        destinationCityByOrderId.set(row.item.id, context.request.destinationCity ?? '');
      });
    });

    const plan = await this.buildWarehousePlan(
      contexts[0].request,
      allRows,
      cloneBalances(balances),
      mergeWarehouseAuxiliaryData(contexts.map((context) => context.auxiliary)),
      { requestIdByOrderId, destinationCityByOrderId, forcedAllocations },
    );
    const plannedByBalanceId = new Map<string, number>();
    plan.reservations.forEach((reservation) => {
      plannedByBalanceId.set(
        reservation.balanceId,
        (plannedByBalanceId.get(reservation.balanceId) ?? 0) + reservation.quantity,
      );
    });
    const involvedBoxes = new Set(plan.reservations.map((reservation) => normalizeInstructionBoxCode(reservation.sourceBox)));
    const balanceLines = balances
      .filter((balance) => Boolean(balance.box?.code) && involvedBoxes.has(normalizeInstructionBoxCode(balance.box!.code)))
      .map((balance) => {
        const plannedQuantity = plannedByBalanceId.get(balance.id) ?? 0;
        const remainingQuantity = Math.max(0, balance.quantity - plannedQuantity);
        return {
          balanceId: balance.id,
          sourceBoxId: balance.boxId,
          sourceBoxCode: balance.box?.code ?? '',
          skuId: balance.skuId,
          internalSku: balance.sku.internalSku,
          barcode: primaryBarcodeValue(balance.sku),
          name: balance.sku.name,
          color: balance.sku.color,
          size: balance.sku.size,
          originalQuantity: balance.quantity,
          plannedQuantity,
          remainingQuantity,
        };
      })
      .filter((line) => line.remainingQuantity > 0)
      .sort(
        (left, right) =>
          left.sourceBoxCode.localeCompare(right.sourceBoxCode, 'ru', { numeric: true }) ||
          left.internalSku.localeCompare(right.internalSku, 'ru', { numeric: true }),
      );

    return {
      client: contexts[0].request.client,
      requests: contexts.map((context) => ({
        id: context.request.id,
        title: context.request.title,
        destinationCity: context.request.destinationCity,
        status: context.request.status,
      })),
      generatedAt: new Date().toISOString(),
      plan,
      balanceLines,
    };
  }

  async getActiveRequestBoxOverlaps(user: AuthUser) {
    this.requireBoxOverlapAccess(user);
    if (effectiveWarehouseId(user, 'read')) {
      return this.calculateActiveRequestBoxOverlaps(user);
    }
    const now = Date.now();
    const cached = this.activeRequestBoxOverlapCache;
    if (cached && cached.expiresAt > now) {
      return cached.stalePromise ?? cached.promise;
    }
    if (cached) {
      const promise = this.calculateActiveRequestBoxOverlaps(user);
      this.activeRequestBoxOverlapCache = {
        expiresAt: now + this.activeRequestBoxOverlapCacheTtlMs,
        promise,
        stalePromise: cached.promise,
      };
      void promise
        .then(() => {
          const current = this.activeRequestBoxOverlapCache;
          if (current?.promise === promise) {
            this.activeRequestBoxOverlapCache = {
              expiresAt: current.expiresAt,
              promise,
            };
          }
        })
        .catch(() => {
          if (this.activeRequestBoxOverlapCache?.promise === promise) {
            this.activeRequestBoxOverlapCache = {
              expiresAt: Date.now() + 30_000,
              promise: cached.promise,
            };
          }
        });
      return cached.promise;
    }

    const promise = this.calculateActiveRequestBoxOverlaps(user);
    this.activeRequestBoxOverlapCache = {
      expiresAt: now + this.activeRequestBoxOverlapCacheTtlMs,
      promise,
    };
    try {
      return await promise;
    } catch (error) {
      if (this.activeRequestBoxOverlapCache?.promise === promise) {
        this.activeRequestBoxOverlapCache = undefined;
      }
      throw error;
    }
  }

  private async calculateActiveRequestBoxOverlaps(user: AuthUser) {
    const activeStatuses = [
      ClientRequestStatus.SUBMITTED,
      ClientRequestStatus.IN_REVIEW,
      ClientRequestStatus.APPROVED,
      ClientRequestStatus.IN_WORK,
    ];
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        type: ClientRequestType.OUTBOUND,
        status: { in: activeStatuses },
        ...warehouseScopeWhere(user),
      },
      select: {
        id: true,
        number: true,
        clientId: true,
        warehouseId: true,
        title: true,
        status: true,
        destinationCity: true,
        createdAt: true,
        client: { select: { id: true, code: true, name: true } },
        items: { select: { id: true } },
        files: { select: { fileName: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 300,
    });
    const requestIds = requests.map((request) => request.id);
    const [pickedMovements, selectedBoxes] = requestIds.length
      ? await Promise.all([
          this.prisma.stockMovement.findMany({
            where: {
              sourceDocument: { in: requestIds },
              type: 'PICK',
              status: StockStatus.PACKING,
              quantity: { gt: 0 },
              boxId: { not: null },
            },
            select: { sourceDocument: true, box: { select: { code: true } } },
          }),
          this.prisma.clientRequestBoxSelection.findMany({
            where: { requestItem: { requestId: { in: requestIds } } },
            select: {
              requestItem: { select: { requestId: true } },
              box: { select: { code: true } },
            },
          }),
        ])
      : [[], []];
    const pickedBoxes = new Map<string, Set<string>>();
    for (const movement of pickedMovements) {
      if (!movement.sourceDocument || !movement.box?.code) continue;
      const values = pickedBoxes.get(movement.sourceDocument) ?? new Set<string>();
      values.add(movement.box.code);
      pickedBoxes.set(movement.sourceDocument, values);
    }
    const explicitlySelectedBoxes = new Map<string, Set<string>>();
    for (const selection of selectedBoxes) {
      const requestId = selection.requestItem.requestId;
      const values = explicitlySelectedBoxes.get(requestId) ?? new Set<string>();
      values.add(selection.box.code);
      explicitlySelectedBoxes.set(requestId, values);
    }

    const plans = new Map<string, Set<string>>();
    const errors: Array<{ requestId: string; title: string; message: string }> = [];

    for (const request of requests) {
      const picked = pickedBoxes.get(request.id) ?? new Set<string>();
      const selected = explicitlySelectedBoxes.get(request.id) ?? new Set<string>();
      if (picked.size > 0 || selected.size > 0) {
        plans.set(request.id, new Set([...picked, ...selected]));
      }
    }

    const unresolvedManualRequests = requests.filter(
      (request) =>
        !plans.has(request.id) &&
        request.files.some((file) =>
          file.fileName.startsWith(manualPickInstructionPlanFilePrefix),
        ),
    );
    const manualResults = await Promise.allSettled(
      unresolvedManualRequests.map((request) =>
        this.getRequestInstruction(request.id, user),
      ),
    );
    manualResults.forEach((result, index) => {
      const request = unresolvedManualRequests[index];
      if (result.status === 'rejected') {
        errors.push({
          requestId: request.id,
          title: request.title,
          message: overlapErrorMessage(result.reason),
        });
        return;
      }
      plans.set(request.id, instructionSourceBoxes(result.value));
    });

    const automaticRequestsByClient = new Map<string, typeof requests>();
    for (const request of requests) {
      const hasManualPlan = request.files.some((file) =>
        file.fileName.startsWith(manualPickInstructionPlanFilePrefix),
      );
      if (hasManualPlan) continue;
      const clientWarehouseKey = `${request.clientId}:${request.warehouseId ?? ''}`;
      automaticRequestsByClient.set(clientWarehouseKey, [
        ...(automaticRequestsByClient.get(clientWarehouseKey) ?? []),
        request,
      ]);
    }
    for (const clientRequests of automaticRequestsByClient.values()) {
      const unresolved = clientRequests.filter((request) => !plans.has(request.id));
      if (unresolved.length === 0) continue;
      try {
        const draft = await this.buildWaveDraft(
          clientRequests.map((request) => request.id),
          user,
        );
        const requestIdByItemId = new Map(
          clientRequests.flatMap((request) =>
            request.items.map((item) => [item.id, request.id] as const),
          ),
        );
        const boxesByRequestId = new Map<string, Set<string>>();
        for (const reservation of draft.plan.reservations) {
          const requestId = requestIdByItemId.get(reservation.orderId);
          if (!requestId || !reservation.sourceBox) continue;
          const values = boxesByRequestId.get(requestId) ?? new Set<string>();
          values.add(reservation.sourceBox);
          boxesByRequestId.set(requestId, values);
        }
        for (const request of unresolved) {
          plans.set(
            request.id,
            boxesByRequestId.get(request.id) ?? new Set<string>(),
          );
        }
      } catch (error) {
        for (const request of unresolved) {
          errors.push({
            requestId: request.id,
            title: request.title,
            message: overlapErrorMessage(error),
          });
        }
      }
    }

    const boxes = new Map<string, { boxCode: string; clientId: string; requests: typeof requests }>();
    for (const request of requests) {
      for (const boxCode of plans.get(request.id) ?? []) {
        const key = `${request.clientId}:${request.warehouseId ?? ''}:${normalizeInstructionBoxCode(boxCode)}`;
        const entry = boxes.get(key) ?? { boxCode, clientId: request.clientId, requests: [] };
        entry.requests.push(request);
        boxes.set(key, entry);
      }
    }
    const overlaps = [...boxes.values()]
      .filter((entry) => entry.requests.length > 1)
      .sort((left, right) => right.requests.length - left.requests.length || left.boxCode.localeCompare(right.boxCode, 'ru'))
      .map((entry) => ({
        boxCode: entry.boxCode,
        clientId: entry.clientId,
        client: entry.requests[0].client,
        requests: entry.requests.map((request) => ({
          id: request.id,
          number: request.number,
          title: request.title,
          status: request.status,
          destinationCity: request.destinationCity,
          createdAt: request.createdAt,
        })),
      }));
    const conflictingRequestIds = new Set(overlaps.flatMap((entry) => entry.requests.map((request) => request.id)));
    const statusCounts = activeStatuses.map((status) => ({
      status,
      count: requests.filter((request) => request.status === status).length,
    }));

    return {
      generatedAt: new Date().toISOString(),
      activeRequestsCount: requests.length,
      checkedRequestsCount: plans.size,
      requestsWithOverlapsCount: conflictingRequestIds.size,
      overlappingBoxesCount: overlaps.length,
      statusCounts,
      overlaps,
      errors,
    };
  }

  private async buildRequestInstruction(requestId: string, user: AuthUser): Promise<PickInstructionWithHtml> {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      ...pickInstructionRequestArgs,
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');

    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException('Складская инструкция доступна только для заявок на отгрузку.');
    }

    const skuByBarcode = await this.resolveMissingSkusByBarcode(request);
    const rows = this.prepareRows(request, skuByBarcode);
    const manualInstruction = this.readCompiledManualInstruction(request.files);
    const auxiliary = await this.loadWarehouseAuxiliaryData(request.clientId, request.files);
    const allBalances = await this.loadAvailableBalances(
      request.clientId,
      request.warehouseId,
      rows,
      true,
    );
    const planning = await this.buildActiveRequestPlanningContext(request, rows, allBalances, auxiliary);
    const balances = planning.balances;
    const warehousePlan = manualInstruction ? manualInstruction.warehousePlan : planning.plan;
    const allocated = manualInstruction
      ? this.allocateRows(rows, balances)
      : this.allocateRowsFromWarehouseReservations(rows, balances, planning.plan.reservations);
    const instructionRows = allocated.instructionRows;
    const boxes = await this.buildBoxSummaries(request.clientId, allocated.boxAllocations);
    const manualBoxCodes = manualInstruction
      ? new Set(
          [
            ...warehousePlan.rows.map((row) => row.sourceBox),
            ...warehousePlan.wholeBoxes.map((row) => row.box),
            ...warehousePlan.balanceMoves.map((row) => row.sourceBox),
          ].filter(Boolean),
        )
      : null;

    const document: PickInstructionDocument = {
      requestId: request.id,
      title: `Инструкция сборки ${request.title}`,
      fileName: `${safeFileName(`pick-instruction-${request.title}-${request.id.slice(0, 8)}`)}.html`,
      requestTitle: request.title,
      requestStatus: request.status,
      requestStatusLabel: requestStatusLabel(request.status),
      priority: request.priority,
      priorityLabel: requestPriorityLabel(request.priority),
      client: request.client,
      generatedAt: new Date().toISOString(),
      desiredDate: request.desiredDate?.toISOString() ?? null,
      destinationCity: request.destinationCity,
      deliveryAddress: request.deliveryAddress,
      totalRequested: instructionRows.reduce((sum, row) => sum + row.requestedQuantity, 0),
      totalAllocated: manualInstruction
        ? manualInstruction.outboundQuantity
        : instructionRows.reduce((sum, row) => sum + row.allocatedQuantity, 0),
      totalShortage: manualInstruction
        ? manualInstruction.shortageQuantity
        : instructionRows.reduce((sum, row) => sum + row.shortageQuantity, 0),
      rowsCount: instructionRows.length,
      readyRowsCount: instructionRows.filter((row) => row.status === 'READY').length,
      shortageRowsCount: instructionRows.filter((row) => row.status !== 'READY').length,
      boxesCount: manualBoxCodes?.size ?? boxes.length,
      fullBoxesCount: manualInstruction ? warehousePlan.wholeBoxes.length : boxes.filter((box) => box.isFullBox).length,
      rows: instructionRows,
      boxes,
      warehouseRows: warehousePlan.rows,
      warehouseWholeBoxes: warehousePlan.wholeBoxes,
      warehouseBalanceMoves: warehousePlan.balanceMoves,
      warehouseBalanceLabels: warehousePlan.balanceLabels,
      warehouseMarkRows: warehousePlan.markRows,
      instructionSource: manualInstruction ? 'MANUAL' : 'AUTOMATIC',
      manualInstructionFileName: manualInstruction?.originalFileName ?? null,
      manualInstructionUploadedAt: manualInstruction?.uploadedAt ?? null,
    };

    return {
      ...document,
      html: renderPickInstructionHtml(document),
    };
  }

  private pruneInstructionCache(now: number) {
    for (const [key, value] of this.instructionCache.entries()) {
      if (value.expiresAt <= now) {
        this.instructionCache.delete(key);
      }
    }
  }

  private async buildActiveRequestPlanningContext(
    request: RequestForInstruction,
    rows: ReturnType<PickInstructionService['prepareRows']>,
    allBalances: BalanceForInstruction[],
    auxiliary: WarehouseAuxiliaryData,
  ): Promise<{ balances: BalanceForInstruction[]; plan: BuiltWarehousePlan }> {
    const frozenWaveLink =
      typeof this.prisma.pickWaveRequest?.findFirst === 'function'
        ? await this.prisma.pickWaveRequest.findFirst({
            where: {
              requestId: request.id,
              wave: {
                warehouseId: request.warehouseId,
                status: { in: [PickWaveStatus.FROZEN, PickWaveStatus.PICKING, PickWaveStatus.DONE, PickWaveStatus.FAILED] },
              },
            },
            include: {
              wave: {
                select: {
                  plan: true,
                  requests: {
                    select: {
                      requestId: true,
                      request: { select: { items: { select: { id: true } } } },
                    },
                    orderBy: { requestId: 'asc' },
                  },
                },
              },
            },
            orderBy: { wave: { createdAt: 'desc' } },
          })
        : null;
    const frozenPlan = readPersistedWavePlan(frozenWaveLink?.wave.plan);
    if (frozenWaveLink && frozenPlan) {
      const requestIdByOrderId = new Map<string, string>();
      frozenWaveLink.wave.requests.forEach((link) => {
        link.request.items.forEach((item) => requestIdByOrderId.set(item.id, link.requestId));
      });
      return {
        balances: cloneBalances(allBalances),
        plan: sliceJointWarehousePlan(
          frozenPlan,
          new Set(rows.map((row) => row.item.id)),
          request.id,
          requestIdByOrderId,
          frozenWaveLink.wave.requests.map((link) => link.requestId),
        ),
      };
    }

    if (!activeReservationStatuses.has(request.status)) {
      return {
        balances: cloneBalances(allBalances),
        plan: await this.buildWarehousePlan(request, rows, cloneBalances(allBalances), auxiliary),
      };
    }

    const peerRequests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: request.clientId,
        warehouseId: request.warehouseId,
        type: ClientRequestType.OUTBOUND,
        status: { in: [...activeReservationStatuses] },
      },
      ...pickInstructionRequestArgs,
    });
    const requests = [...new Map([request, ...peerRequests].map((candidate) => [candidate.id, candidate])).values()].sort(
      compareRequestReservationOrder,
    );
    const contexts: Array<{
      request: RequestForInstruction;
      rows: ReturnType<PickInstructionService['prepareRows']>;
      auxiliary: WarehouseAuxiliaryData;
    }> = [];

    for (const candidate of requests) {
      contexts.push({
        request: candidate,
        rows:
          candidate.id === request.id
            ? rows
            : this.prepareRows(candidate, await this.resolveMissingSkusByBarcode(candidate)),
        auxiliary:
          candidate.id === request.id
            ? auxiliary
            : await this.loadWarehouseAuxiliaryData(candidate.clientId, candidate.files),
      });
    }

    // Automatic requests for one client must be planned as one combined shipment.
    // Otherwise the same physical box is independently selected by every city.
    if (!contexts.some((context) => this.readCompiledManualInstruction(context.request.files))) {
      const planningBalances = await this.loadBalancesAtActiveBatchStart(
        request.clientId,
        request.warehouseId,
        requests,
        allBalances,
      );
      const requestIdByOrderId = new Map<string, string>();
      const destinationCityByOrderId = new Map<string, string>();
      contexts.forEach((context) => {
        context.rows.forEach((row) => {
          requestIdByOrderId.set(row.item.id, context.request.id);
          destinationCityByOrderId.set(row.item.id, context.request.destinationCity ?? '');
        });
      });
      const jointPlan = await this.buildWarehousePlan(
        request,
        contexts.flatMap((context) => context.rows),
        cloneBalances(planningBalances),
        mergeWarehouseAuxiliaryData(contexts.map((context) => context.auxiliary)),
        { requestIdByOrderId, destinationCityByOrderId },
      );

      return {
        balances: cloneBalances(planningBalances),
        plan: sliceJointWarehousePlan(
          jointPlan,
          new Set(rows.map((row) => row.item.id)),
          request.id,
          requestIdByOrderId,
          requests.map((candidate) => candidate.id),
        ),
      };
    }

    let availableBalances = cloneBalances(allBalances);
    const entries: Array<{
      request: RequestForInstruction;
      rows: ReturnType<PickInstructionService['prepareRows']>;
      auxiliary: WarehouseAuxiliaryData;
      balances: BalanceForInstruction[];
      plan: BuiltWarehousePlan;
    }> = [];

    for (const context of contexts) {
      const candidate = context.request;
      const candidateRows = context.rows;
      const candidateAuxiliary = context.auxiliary;
      const balancesBefore = cloneBalances(availableBalances);
      const manualInstruction = this.readCompiledManualInstruction(candidate.files);
      const plan = manualInstruction
        ? {
            ...manualInstruction.warehousePlan,
            reservations: this.allocateRows(candidateRows, balancesBefore).instructionRows.flatMap((row) =>
              row.allocations.map((allocation) => ({
                orderId: row.itemId,
                balanceId: allocation.balanceId,
                sourceBox: allocation.boxCode,
                quantity: allocation.quantity,
              })),
            ),
          }
        : await this.buildWarehousePlan(candidate, candidateRows, balancesBefore, candidateAuxiliary);

      entries.push({ request: candidate, rows: candidateRows, auxiliary: candidateAuxiliary, balances: balancesBefore, plan });
      availableBalances = applyWarehouseReservations(availableBalances, plan.reservations);
    }

    const current = entries.find((entry) => entry.request.id === request.id);
    if (!current) {
      const balances = cloneBalances(allBalances);
      return { balances, plan: await this.buildWarehousePlan(request, rows, balances, auxiliary) };
    }

    return { balances: current.balances, plan: current.plan };
  }

  private async loadBalancesAtActiveBatchStart(
    clientId: string,
    warehouseId: string | null,
    requests: RequestForInstruction[],
    currentBalances: BalanceForInstruction[],
  ): Promise<BalanceForInstruction[]> {
    if (
      typeof this.prisma.clientRequestEvent?.findFirst !== 'function' ||
      typeof this.prisma.stockMovement?.groupBy !== 'function'
    ) {
      return cloneBalances(currentBalances);
    }

    const requestIds = requests.map((candidate) => candidate.id);
    const [firstInWorkEvent, latestForcedRefreshEvent] = await Promise.all([
      this.prisma.clientRequestEvent.findFirst({
        where: {
          requestId: { in: requestIds },
          statusTo: ClientRequestStatus.IN_WORK,
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.clientRequestEvent.findFirst({
        where: {
          requestId: { in: requestIds },
          eventType: ClientRequestEventType.COMMENT,
          title: forcedInstructionRefreshEventTitle,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    if (!firstInWorkEvent) {
      return cloneBalances(currentBalances);
    }
    const snapshotAt =
      latestForcedRefreshEvent && latestForcedRefreshEvent.createdAt > firstInWorkEvent.createdAt
        ? latestForcedRefreshEvent.createdAt
        : firstInWorkEvent.createdAt;

    const snapshotGroups = await this.prisma.stockMovement.groupBy({
      by: ['skuId', 'boxId', 'palletId', 'status'],
      where: {
        clientId,
        warehouseId: warehouseId ?? undefined,
        status: StockStatus.AVAILABLE,
        boxId: { not: null },
        createdAt: { lte: snapshotAt },
      },
      _sum: { quantity: true },
    });
    const positiveGroups = snapshotGroups.filter((group) => (group._sum.quantity ?? 0) > 0 && Boolean(group.boxId));
    if (positiveGroups.length === 0 && currentBalances.length > 0) {
      return cloneBalances(currentBalances);
    }

    const skuIds = [...new Set(positiveGroups.map((group) => group.skuId))];
    const boxIds = [...new Set(positiveGroups.map((group) => group.boxId).filter((id): id is string => Boolean(id)))];
    const palletIds = [...new Set(positiveGroups.map((group) => group.palletId).filter((id): id is string => Boolean(id)))];
    const [skus, boxes, pallets] = await Promise.all([
      this.prisma.sku.findMany({ where: { id: { in: skuIds } }, ...skuCatalogArgs }),
      this.prisma.box.findMany({
        where: {
          id: { in: boxIds },
          status: { notIn: ['deleted', 'archived'] },
        },
        select: { id: true, code: true, warehouseId: true },
      }),
      palletIds.length > 0
        ? this.prisma.pallet.findMany({ where: { id: { in: palletIds } }, select: { id: true, code: true } })
        : Promise.resolve([]),
    ]);
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const boxById = new Map(boxes.map((box) => [box.id, box]));
    const palletById = new Map(pallets.map((pallet) => [pallet.id, pallet]));

    return positiveGroups
      .map((group): BalanceForInstruction | null => {
        const boxId = group.boxId;
        const sku = skuById.get(group.skuId);
        const box = boxId ? boxById.get(boxId) : undefined;
        if (!boxId || !sku || !box) {
          return null;
        }
        const snapshotKey = `${group.skuId}:${boxId}:${group.palletId ?? ''}:${group.status}`;
        return {
          id: `snapshot:${snapshotKey}`,
          balanceKey: `snapshot:${snapshotKey}`,
          warehouseId: box.warehouseId,
          clientId,
          skuId: group.skuId,
          boxId,
          palletId: group.palletId,
          status: group.status,
          quantity: group._sum.quantity ?? 0,
          updatedAt: snapshotAt,
          sku,
          box,
          pallet: group.palletId ? palletById.get(group.palletId) ?? null : null,
        };
      })
      .filter((balance): balance is BalanceForInstruction => Boolean(balance))
      .sort(compareInstructionBalances);
  }

  private async requireRequestWarehouseAccess(
    requestId: string,
    user: AuthUser,
    mode: 'read' | 'write',
  ) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true, warehouseId: true },
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, mode);
    assertWarehouseAccess(user, request, mode, 'Заявка не найдена в выбранном филиале.');
    return request;
  }

  private requireBoxOverlapAccess(user: AuthUser) {
    if (user.permissionCodes.includes('system:admin') || user.roleCodes.some((code) => code === 'ADMIN' || code === 'OWNER')) {
      return;
    }
    throw new ForbiddenException('Статистика пересечений коробов доступна администраторам и владельцам.');
  }

  async refreshRequestInstruction(requestId: string, user: AuthUser) {
    this.requireInstructionRefreshAccess(user);
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        warehouseId: true,
        number: true,
        type: true,
        status: true,
      },
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException('Принудительный пересчёт доступен только для заявок на отгрузку.');
    }
    if (
      request.status === ClientRequestStatus.DONE ||
      request.status === ClientRequestStatus.CANCELLED ||
      request.status === ClientRequestStatus.REJECTED
    ) {
      throw new BadRequestException('Завершённую, отменённую или отклонённую заявку пересчитывать нельзя.');
    }

    await this.prisma.clientRequestEvent.create({
      data: {
        requestId: request.id,
        clientId: request.clientId,
        eventType: ClientRequestEventType.COMMENT,
        title: forcedInstructionRefreshEventTitle,
        body:
          'Оставшийся план сборки пересчитан по текущим остаткам. Архивные и удалённые короба исключены; уже выполненные действия сохранены в истории.',
        createdByUserId: user.id,
      },
    });

    const activePeerRequests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: request.clientId,
        warehouseId: request.warehouseId,
        type: ClientRequestType.OUTBOUND,
        status: { in: [...activeReservationStatuses] },
      },
      select: { id: true },
    });
    const affectedRequestIds = new Set([requestId, ...activePeerRequests.map((candidate) => candidate.id)]);
    affectedRequestIds.forEach((id) => this.invalidateRequestInstruction(id));
    this.warehouseAuxiliaryCache.delete(request.clientId);
    return this.getRequestInstruction(requestId, user);
  }

  async uploadManualRequestInstruction(requestId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    this.requireManualInstructionAccess(user);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Excel-файл инструкции не передан.');
    }
    if (file.buffer.length > maxManualInstructionFileSizeBytes) {
      throw new BadRequestException('Файл инструкции больше 10 МБ.');
    }
    if (!/\.xlsx$/i.test(file.originalname || '')) {
      throw new BadRequestException('Загрузите инструкцию в формате XLSX.');
    }

    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      ...pickInstructionRequestArgs,
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException('Своя складская инструкция доступна только для заявок на отгрузку.');
    }
    if (
      request.status === ClientRequestStatus.DONE ||
      request.status === ClientRequestStatus.CANCELLED ||
      request.status === ClientRequestStatus.REJECTED
    ) {
      throw new BadRequestException('Нельзя перестроить завершенную, отмененную или отклоненную заявку.');
    }

    let parsed: ParsedManualPickInstruction;
    try {
      parsed = parseManualPickInstructionWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof ManualPickInstructionParseError) {
        throw new BadRequestException(error.issues.join('\n'));
      }
      throw error;
    }

    await this.validateManualPickInstruction(request, parsed);
    const uploadedAt = new Date();
    const warehousePlan = await this.buildManualWarehousePlan(parsed, request.client.name, uploadedAt);
    const originalFileName = safeFileName(file.originalname || 'Инструкция_для_склада.xlsx');
    const stamp = uploadedAt.toISOString().replace(/\D/g, '').slice(0, 14);
    const compiled: CompiledManualPickInstruction = {
      version: 1,
      originalFileName,
      uploadedAt: uploadedAt.toISOString(),
      outboundQuantity: parsed.outboundQuantity,
      balanceQuantity: parsed.balanceQuantity,
      shortageQuantity: parsed.shortageQuantity,
      warehousePlan,
    };
    const compiledContent = Buffer.from(JSON.stringify(compiled), 'utf8');

    await this.prisma.$transaction(async (tx) => {
      await tx.clientRequestFile.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          fileName: `${manualPickInstructionDisplayFilePrefix}${stamp} - ${originalFileName}`,
          mimeType: file.mimetype || pickInstructionXlsxMimeType(),
          sizeBytes: file.buffer.length,
          content: Uint8Array.from(file.buffer),
          uploadedByUserId: user.id,
        },
      });
      await tx.clientRequestFile.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          fileName: `${manualPickInstructionPlanFilePrefix}${stamp}__${originalFileName}.json`,
          mimeType: 'application/vnd.logoff.manual-pick-instruction+json',
          sizeBytes: compiledContent.length,
          content: Uint8Array.from(compiledContent),
          uploadedByUserId: user.id,
        },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: request.id,
          clientId: request.clientId,
          eventType: ClientRequestEventType.FILE_UPLOADED,
          title: 'Складская инструкция заменена вручную',
          body: [
            `Файл: ${originalFileName}`,
            `к отправке: ${parsed.outboundQuantity} шт.`,
            `на баланс: ${parsed.balanceQuantity} шт.`,
            `дефицит: ${parsed.shortageQuantity} шт.`,
          ].join('; '),
          createdByUserId: user.id,
        },
      });
    });

    this.invalidateRequestInstruction(requestId);
    return this.getRequestInstruction(requestId, user);
  }

  invalidateRequestInstruction(requestId: string) {
    for (const key of this.instructionCache.keys()) {
      if (key === requestId || key.startsWith(`${requestId}:`)) {
        this.instructionCache.delete(key);
      }
    }
    if (this.activeRequestBoxOverlapCache) {
      this.activeRequestBoxOverlapCache.expiresAt = 0;
    }
  }

  async getRequestInstructionXlsx(requestId: string, user: AuthUser) {
    const document = await this.getRequestInstruction(requestId, user);

    return {
      fileName: document.fileName.replace(/\.html$/i, '.xlsx'),
      mimeType: pickInstructionXlsxMimeType(),
      content: buildPickInstructionWorkbook(document),
    };
  }

  private requireInstructionRefreshAccess(user: AuthUser) {
    if (user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role))) {
      return;
    }

    throw new ForbiddenException('Обновлять инструкцию может администратор, владелец или менеджер.');
  }

  private requireManualInstructionAccess(user: AuthUser) {
    if (user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => ['ADMIN', 'OWNER'].includes(role))) {
      return;
    }
    throw new ForbiddenException('Загружать свою инструкцию может только администратор или владелец.');
  }

  private async resolveMissingSkusByBarcode(request: RequestForInstruction) {
    const barcodes = [
      ...new Set(
        request.items
          .filter((item) => !item.skuId && item.barcode)
          .map((item) => item.barcode)
          .filter((barcode): barcode is string => Boolean(barcode)),
      ),
    ];

    if (barcodes.length === 0) {
      return new Map<string, SkuForInstruction | 'duplicate'>();
    }

    const barcodeRows = await this.prisma.barcode.findMany({
      where: {
        value: { in: barcodes },
        sku: { clientId: request.clientId },
      },
      include: {
        sku: {
          include: {
            barcodes: {
              select: {
                value: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });
    const result = new Map<string, SkuForInstruction | 'duplicate'>();

    for (const barcode of barcodes) {
      const matches = barcodeRows.filter((row) => row.value === barcode);
      if (matches.length === 1) {
        result.set(barcode, matches[0].sku);
      } else if (matches.length > 1) {
        result.set(barcode, 'duplicate');
      }
    }

    return result;
  }

  private prepareRows(request: RequestForInstruction, skuByBarcode: Map<string, SkuForInstruction | 'duplicate'>) {
    return request.items.map((item, index) => {
      const resolvedSku = item.sku ?? (item.barcode ? skuByBarcode.get(item.barcode) : null) ?? null;
      const status: PickInstructionRowStatus =
        resolvedSku && resolvedSku !== 'duplicate' ? 'SHORTAGE' : 'SKU_NOT_FOUND';
      const primaryBarcode = resolvedSku && resolvedSku !== 'duplicate' ? primaryBarcodeValue(resolvedSku) : null;

      return {
        position: index + 1,
        item,
        sku: resolvedSku === 'duplicate' ? null : resolvedSku,
        duplicateBarcode: resolvedSku === 'duplicate',
        skuId: resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.id : null,
        internalSku: resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.internalSku : null,
        name: item.name ?? (resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.name : null),
        barcode: item.barcode ?? primaryBarcode,
        requestedQuantity: item.quantity,
        status,
      };
    });
  }

  private async loadAvailableBalances(
    clientId: string,
    warehouseId: string | null,
    rows: Array<{ skuId: string | null }>,
    includeAllClientBalances = false,
  ) {
    const skuIds = [...new Set(rows.map((row) => row.skuId).filter((skuId): skuId is string => Boolean(skuId)))];
    if (!includeAllClientBalances && skuIds.length === 0) {
      return [];
    }

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        clientId,
        warehouseId: warehouseId ?? undefined,
        skuId: includeAllClientBalances ? undefined : { in: skuIds },
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
        boxId: { not: null },
        box: {
          status: { notIn: ['deleted', 'archived'] },
        },
      },
      ...stockBalanceArgs,
      orderBy: [{ id: 'asc' }],
    });

    // The reference warehouse algorithm walks the 1C stock export in box-code
    // order. updatedAt is operational metadata and must not change which box is
    // selected for the same request after an unrelated edit.
    return balances.sort(compareInstructionBalances);
  }

  private async loadWarehouseAuxiliaryData(clientId: string, files: RequestForInstruction['files'] = []): Promise<WarehouseAuxiliaryData> {
    const legacyWorkbookData = this.readAuxiliaryWorkbook(files);
    const catalog = await this.loadWarehouseAuxiliaryCatalog(clientId);
    const shk = new Map(catalog.shk);
    mergeMissingShkRecords(shk, legacyWorkbookData.shk);

    return {
      mapping: catalog.mapping.size > 0 ? catalog.mapping : legacyWorkbookData.mapping,
      boxToPallet: legacyWorkbookData.boxToPallet,
      shk,
    };
  }

  private async loadWarehouseAuxiliaryCatalog(clientId: string): Promise<WarehouseAuxiliaryData> {
    const now = Date.now();
    const cached = this.warehouseAuxiliaryCache.get(clientId);
    if (cached && cached.expiresAt > now) {
      return cached.promise;
    }

    const promise = this.buildWarehouseAuxiliaryCatalog(clientId);
    this.warehouseAuxiliaryCache.set(clientId, {
      expiresAt: now + this.warehouseAuxiliaryCacheTtlMs,
      promise,
    });
    try {
      return await promise;
    } catch (error) {
      if (this.warehouseAuxiliaryCache.get(clientId)?.promise === promise) {
        this.warehouseAuxiliaryCache.delete(clientId);
      }
      throw error;
    }
  }

  private async buildWarehouseAuxiliaryCatalog(clientId: string): Promise<WarehouseAuxiliaryData> {
    const [articleMappings, skus] = await Promise.all([
      this.prisma.clientArticleMapping.findMany({
        where: { clientId },
        orderBy: [{ targetArticle: 'asc' }, { sourceArticle: 'asc' }],
      }),
      this.prisma.sku.findMany({
        where: { clientId },
        ...skuCatalogArgs,
      }),
    ]);

    const mapping = new Map<string, Set<string>>();
    articleMappings.forEach((row) => {
      addArticleMapping(mapping, row.targetArticle, row.sourceArticle);
    });

    const shk = buildShkCatalogFromSkus(skus);

    return {
      mapping,
      boxToPallet: new Map(),
      shk,
    };
  }

  private readAuxiliaryWorkbook(files: RequestForInstruction['files'] = []): WarehouseAuxiliaryData {
    const empty = emptyWarehouseAuxiliaryData();
    const sourceFile = files.find(
      (file) => !isManualPickInstructionFileName(file.fileName) && (/\.xlsx?$/i.test(file.fileName) || file.mimeType.includes('spreadsheet')),
    );
    if (!sourceFile) {
      return empty;
    }

    try {
      const workbook = XLSX.read(Buffer.from(sourceFile.content), { type: 'buffer' });
      const sheet = (name: string) => {
        const sheetName = workbook.SheetNames.find((candidate) => candidate.trim().toLowerCase() === name.toLowerCase());
        return sheetName ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false }) : [];
      };

      return {
        mapping: parseMappingSheet(sheet('Соответствие')),
        boxToPallet: parsePalletSheet(sheet('палет сорт')),
        shk: parseShkSheet(sheet('ШК')),
      };
    } catch {
      return empty;
    }
  }

  private allocateRows(
    rows: ReturnType<PickInstructionService['prepareRows']>,
    balances: BalanceForInstruction[],
  ) {
    const balancesBySkuId = groupBalancesBySkuId(balances);
    const remainingByBalance = new Map(balances.map((balance) => [balance.id, balance.quantity]));
    const boxAllocations = new Map<string, { box: BalanceForInstruction; allocatedQuantity: number; lineIds: Set<string> }>();
    const instructionRows: PickInstructionRow[] = [];

    for (const row of rows) {
      const allocations: PickInstructionAllocation[] = [];
      let remaining = row.requestedQuantity;

      if (row.skuId) {
        for (const balance of balancesBySkuId.get(row.skuId) ?? []) {
          if (remaining <= 0) {
            break;
          }

          const available = remainingByBalance.get(balance.id) ?? 0;
          if (available <= 0 || !balance.boxId || !balance.box) {
            continue;
          }

          const quantity = Math.min(available, remaining);
          remainingByBalance.set(balance.id, available - quantity);
          remaining -= quantity;
          allocations.push({
            balanceId: balance.id,
            boxId: balance.boxId,
            boxCode: balance.box.code,
            palletId: balance.palletId,
            palletCode: balance.pallet?.code ?? null,
            quantity,
          });
          const boxAllocation = boxAllocations.get(balance.boxId) ?? {
            box: balance,
            allocatedQuantity: 0,
            lineIds: new Set<string>(),
          };
          boxAllocation.allocatedQuantity += quantity;
          boxAllocation.lineIds.add(row.item.id);
          boxAllocations.set(balance.boxId, boxAllocation);
        }
      }

      const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      const shortageQuantity = Math.max(0, row.requestedQuantity - allocatedQuantity);
      const status = this.rowStatus(row, shortageQuantity);

      instructionRows.push({
        position: row.position,
        itemId: row.item.id,
        skuId: row.skuId,
        internalSku: row.internalSku,
        name: row.name,
        barcode: row.barcode,
        requestedQuantity: row.requestedQuantity,
        allocatedQuantity,
        shortageQuantity,
        status,
        statusLabel: rowStatusLabel(status),
        comment: this.rowComment(row, shortageQuantity),
        allocations,
      });
    }

    return { instructionRows, boxAllocations };
  }

  private allocateRowsFromWarehouseReservations(
    rows: ReturnType<PickInstructionService['prepareRows']>,
    balances: BalanceForInstruction[],
    reservations: WarehouseReservation[],
  ) {
    const balancesById = new Map(balances.map((balance) => [balance.id, balance]));
    const reservationsByOrderId = new Map<string, WarehouseReservation[]>();
    reservations.forEach((reservation) => {
      reservationsByOrderId.set(reservation.orderId, [
        ...(reservationsByOrderId.get(reservation.orderId) ?? []),
        reservation,
      ]);
    });
    const boxAllocations = new Map<string, { box: BalanceForInstruction; allocatedQuantity: number; lineIds: Set<string> }>();
    const instructionRows: PickInstructionRow[] = [];

    for (const row of rows) {
      const allocations: PickInstructionAllocation[] = [];
      for (const reservation of reservationsByOrderId.get(row.item.id) ?? []) {
        const balance = balancesById.get(reservation.balanceId);
        if (!balance?.boxId || !balance.box || reservation.quantity <= 0) {
          continue;
        }
        allocations.push({
          balanceId: balance.id,
          boxId: balance.boxId,
          boxCode: balance.box.code,
          palletId: balance.palletId,
          palletCode: balance.pallet?.code ?? null,
          quantity: reservation.quantity,
        });
        const boxAllocation = boxAllocations.get(balance.boxId) ?? {
          box: balance,
          allocatedQuantity: 0,
          lineIds: new Set<string>(),
        };
        boxAllocation.allocatedQuantity += reservation.quantity;
        boxAllocation.lineIds.add(row.item.id);
        boxAllocations.set(balance.boxId, boxAllocation);
      }

      const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      const shortageQuantity = Math.max(0, row.requestedQuantity - allocatedQuantity);
      const status = this.rowStatus(row, shortageQuantity);
      instructionRows.push({
        position: row.position,
        itemId: row.item.id,
        skuId: row.skuId,
        internalSku: row.internalSku,
        name: row.name,
        barcode: row.barcode,
        requestedQuantity: row.requestedQuantity,
        allocatedQuantity,
        shortageQuantity,
        status,
        statusLabel: rowStatusLabel(status),
        comment: this.rowComment(row, shortageQuantity),
        allocations,
      });
    }

    return { instructionRows, boxAllocations };
  }

  private async buildWarehousePlan(
    request: RequestForInstruction,
    rows: ReturnType<PickInstructionService['prepareRows']>,
    balances: BalanceForInstruction[],
    auxiliary: WarehouseAuxiliaryData,
    options: {
      requestIdByOrderId?: Map<string, string>;
      destinationCityByOrderId?: Map<string, string>;
      forcedAllocations?: ForcedWarehouseAllocation[];
    } = {},
  ): Promise<BuiltWarehousePlan> {
    const demands = rows.map((row, demandIndex) => {
      const meta = parseRequestItemComment(row.item.comment);
      const artSeller = meta.artSeller || instructionSkuArticle(row.sku) || row.internalSku || row.name || '';
      const targetRecord = meta.relabelTargetBarcode ? auxiliary.shk.get(meta.relabelTargetBarcode) : undefined;
      return {
        requestId: options.requestIdByOrderId?.get(row.item.id) ?? request.id,
        orderId: row.item.id,
        demandIndex,
        skuId: row.skuId,
        artSeller,
        targetArt: targetRecord?.article || artSeller,
        barcode: row.barcode ?? '',
        size: normalizeSize(meta.size || row.sku?.size || ''),
        name: normalizeName(row.name || row.item.name || row.sku?.name || ''),
        city: meta.city || options.destinationCityByOrderId?.get(row.item.id) || request.destinationCity || '',
        needsRelabel: meta.needsRelabel || Boolean(row.sku?.needsRelabel),
        relabelSourceBarcode: meta.relabelSourceBarcode,
        relabelTargetBarcode: meta.relabelTargetBarcode,
        required: row.requestedQuantity,
        remaining: row.requestedQuantity,
      };
    });
    const demandById = new Map(demands.map((demand) => [demand.orderId, demand]));
    const forcedByBalanceId = new Map<string, Map<string, number>>();
    const forcedQuantityByOrderId = new Map<string, number>();
    for (const allocation of options.forcedAllocations ?? []) {
      if (!demandById.has(allocation.orderId) || allocation.quantity <= 0) {
        throw new BadRequestException('В распределении балансов найдена неизвестная или пустая позиция заявки.');
      }
      const byOrderId = forcedByBalanceId.get(allocation.balanceId) ?? new Map<string, number>();
      byOrderId.set(allocation.orderId, (byOrderId.get(allocation.orderId) ?? 0) + allocation.quantity);
      forcedByBalanceId.set(allocation.balanceId, byOrderId);
      forcedQuantityByOrderId.set(
        allocation.orderId,
        (forcedQuantityByOrderId.get(allocation.orderId) ?? 0) + allocation.quantity,
      );
    }
    for (const demand of demands) {
      const forcedQuantity = forcedQuantityByOrderId.get(demand.orderId) ?? 0;
      if (forcedQuantity > demand.required) {
        throw new BadRequestException(`Распределение баланса превышает количество позиции ${demand.artSeller || demand.barcode}.`);
      }
      demand.remaining -= forcedQuantity;
    }
    const inventoryByBox = new Map<string, WarehouseInventoryItem[]>();
    const inventoryByBalanceId = new Map<string, WarehouseInventoryItem>();

    balances.forEach((balance, index) => {
      if (!balance.box?.code || balance.quantity <= 0) {
        return;
      }
      const sku = balance.sku ?? fallbackBalanceSku(balance.skuId);

      const item: WarehouseInventoryItem = {
        id: balance.id || String(index),
        box: balance.box.code,
        pallet: balance.pallet?.code ?? auxiliary.boxToPallet.get(balance.box.code) ?? '',
        skuId: balance.skuId,
        barcode: primaryBarcodeValue(sku),
        barcodes: sku.barcodes.map((barcode) => barcode.value).filter(Boolean),
        artWarehouse: instructionSkuArticle(sku) || sku.name,
        name: normalizeName(sku.name),
        size: normalizeSize(sku.size || ''),
        quantity: balance.quantity,
        originalQuantity: balance.quantity,
        suitableDemands: [],
      };
      inventoryByBox.set(item.box, [...(inventoryByBox.get(item.box) ?? []), item]);
      inventoryByBalanceId.set(item.id, item);
    });

    for (const items of inventoryByBox.values()) {
      for (const item of items) {
        item.suitableDemands = demands
          .filter((demand) => isSuitableForDemand(item, demand, auxiliary.mapping))
          .map((demand) => demand.orderId);
      }
    }

    forcedByBalanceId.forEach((allocations, balanceId) => {
      const item = inventoryByBalanceId.get(balanceId);
      const forcedTotal = [...allocations.values()].reduce((sum, quantity) => sum + quantity, 0);
      if (!item || forcedTotal > item.originalQuantity) {
        throw new BadRequestException('Выбранный остаток уже изменился или его недостаточно для распределения.');
      }
      allocations.forEach((_quantity, orderId) => {
        if (!item.suitableDemands.includes(orderId)) {
          throw new BadRequestException('Выбранный остаток не соответствует товару в заявке.');
        }
      });
    });

    const actions: WarehouseAction[] = [];
    const shipmentBoxes = new Set<string>();
    const shipmentMoveSourceBoxes = new Set<string>();
    const committedForcedAllocations = new Set<string>();
    const tolerance = 0;
    const remainingOf = (orderId: string) => demandById.get(orderId)?.remaining ?? 0;
    const decreaseRemaining = (orderId: string, amount: number) => {
      const demand = demandById.get(orderId);
      if (demand) {
        demand.remaining -= amount;
      }
    };

    for (const [box, items] of inventoryByBox.entries()) {
      const totalItems = items.reduce((sum, item) => sum + item.originalQuantity, 0);
      if (totalItems === 0) {
        continue;
      }

      const tempRemaining = new Map(demands.map((demand) => [demand.orderId, demand.remaining]));
      const tempAssign: Array<{ item: WarehouseInventoryItem; orderId: string; quantity: number; forced: boolean }> = [];

      for (const item of items) {
        let remainingInItem = item.quantity;
        for (const [orderId, quantity] of forcedByBalanceId.get(item.id) ?? []) {
          if (quantity > remainingInItem) {
            throw new BadRequestException('Выбранного остатка недостаточно для распределения по городам.');
          }
          remainingInItem -= quantity;
          tempAssign.push({ item, orderId, quantity, forced: true });
        }
        const suitable = item.suitableDemands
          .filter((orderId) => (tempRemaining.get(orderId) ?? 0) > -tolerance)
          .sort((left, right) => compareDemandPriority(left, right, tempRemaining, demandById));

        for (const orderId of suitable) {
          const take = Math.min(remainingInItem, (tempRemaining.get(orderId) ?? 0) + tolerance);
          if (take > 0) {
            tempRemaining.set(orderId, (tempRemaining.get(orderId) ?? 0) - take);
            remainingInItem -= take;
            tempAssign.push({ item, orderId, quantity: take, forced: false });
          }
          if (remainingInItem === 0) {
            break;
          }
        }
      }

      const useful = tempAssign.reduce((sum, row) => sum + row.quantity, 0);
      const isCompletelyUsed = Math.abs(totalItems - useful) <= tolerance;
      const isMajorityUsed = totalItems > 0 && useful / totalItems > 0.5;
      if (useful > 0 && (isCompletelyUsed || isMajorityUsed)) {
        shipmentBoxes.add(box);
        const wholeBoxNeedsRelabel = isCompletelyUsed && tempAssign.some((assignment) => {
          const demand = demandById.get(assignment.orderId);
          return Boolean(demand && needsWarehouseRelabel(assignment.item, demand));
        });
        for (const assignment of tempAssign) {
          const demand = demandById.get(assignment.orderId)!;
          if (assignment.forced) {
            committedForcedAllocations.add(`${assignment.item.id}:${assignment.orderId}`);
          } else {
            decreaseRemaining(assignment.orderId, assignment.quantity);
          }
          assignment.item.quantity -= assignment.quantity;
          const rebrandNote = relabelNote(assignment.item, demand);
          const targetBox = isCompletelyUsed
            ? wholeBoxNeedsRelabel
              ? 'МАРК ЦЕЛЫЙ'
              : 'ЦЕЛЫЙ'
            : rebrandNote
              ? 'МАРК ПОСТАВКА'
              : 'ПОСТАВКА';
          actions.push(actionFromAssignment(assignment.item, demand, assignment.quantity, targetBox, rebrandNote, ''));
        }

        if (useful < totalItems) {
          for (const item of items) {
            if (item.quantity > 0) {
              actions.push(balanceAction(item));
              item.quantity = 0;
            }
          }
        }
      }
    }

    if (demands.some((demand) => demand.remaining > -tolerance) || forcedByBalanceId.size > 0) {
      for (const [box, items] of inventoryByBox.entries()) {
        if (shipmentBoxes.has(box)) {
          continue;
        }
        for (const item of items) {
          for (const [orderId, quantity] of forcedByBalanceId.get(item.id) ?? []) {
            const forcedKey = `${item.id}:${orderId}`;
            if (committedForcedAllocations.has(forcedKey)) {
              continue;
            }
            if (quantity > item.quantity) {
              throw new BadRequestException('Выбранный остаток уже занят другой позицией волны.');
            }
            const demand = demandById.get(orderId)!;
            const rebrandNote = relabelNote(item, demand);
            actions.push(
              actionFromAssignment(
                item,
                demand,
                quantity,
                rebrandNote ? 'МАРК ПОСТАВКА' : 'ПОСТАВКА',
                rebrandNote,
                'Добавлено клиентом при проверке балансов',
              ),
            );
            item.quantity -= quantity;
            shipmentMoveSourceBoxes.add(box);
            committedForcedAllocations.add(forcedKey);
          }
          if (item.quantity === 0) {
            continue;
          }
          const currentRemaining = new Map(demands.map((demand) => [demand.orderId, demand.remaining]));
          const suitable = item.suitableDemands
            .filter((orderId) => remainingOf(orderId) > -tolerance)
            .sort((left, right) => compareDemandPriority(left, right, currentRemaining, demandById));
          for (const orderId of suitable) {
            const demand = demandById.get(orderId)!;
            const take = Math.min(item.quantity, remainingOf(orderId) + tolerance);
            if (take > 0) {
              decreaseRemaining(orderId, take);
              item.quantity -= take;
              const rebrandNote = relabelNote(item, demand);
              actions.push(actionFromAssignment(item, demand, take, rebrandNote ? 'МАРК ПОСТАВКА' : 'ПОСТАВКА', rebrandNote, ''));
              shipmentMoveSourceBoxes.add(box);
            }
          }
        }
      }
    }

    for (const demand of demands) {
      if (demand.remaining > 0) {
        actions.push({
          requestId: demand.requestId,
          orderId: demand.orderId,
          balanceId: '',
          city: demand.city,
          sourceBox: '',
          pallet: '',
          artOnBox: demand.artSeller,
          barcodeOnBox: demand.barcode,
          targetArt: demand.artSeller,
          targetBarcode: demand.barcode,
          size: demand.size,
          quantity: demand.remaining,
          targetBox: '',
          rebrandNote: '',
          note: 'нет на складе',
        });
      }
    }

    const generatedAt = new Date();
    const existingBalanceBoxCodes = await this.loadExistingBalanceBoxCodes(generatedAt);
    const balanceBoxBySourceBox = assignBalanceBoxCodes(actions, existingBalanceBoxCodes, generatedAt);
    const wholeBoxCities = new Map<string, Set<string>>();
    actions.forEach((action) => {
      if (['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox)) {
        wholeBoxCities.set(action.sourceBox, new Set([...(wholeBoxCities.get(action.sourceBox) ?? []), action.city]));
      }
    });

    const warehouseRows: WarehouseInstructionRow[] = actions
      .filter((action) => action.targetBox !== 'БАЛАНС')
      .map((action) => {
        const actionComment = warehouseActionComment(action, wholeBoxCities);
        return {
          orderId: action.orderId,
          city: action.city,
          sourceBox: action.sourceBox,
          targetBox: balanceBoxBySourceBox.get(action.sourceBox) ?? '',
          pallet: action.pallet || auxiliary.boxToPallet.get(action.sourceBox) || '',
          artOnBox: action.artOnBox,
          barcodeOnBox: action.barcodeOnBox,
          size: instructionSize(action.size),
          quantity: action.quantity,
          comment: actionComment,
          rebrandNote: action.rebrandNote,
          note:
            action.targetBox === 'БАЛАНС' && balanceBoxBySourceBox.has(action.sourceBox)
              ? `${action.note}; новый короб ${balanceBoxBySourceBox.get(action.sourceBox)}`
              : action.note,
        };
      });
    const balanceMoves = buildBalanceMoves(actions, balanceBoxBySourceBox, shipmentMoveSourceBoxes, auxiliary.boxToPallet);
    const balanceLabels = buildBalanceLabels(balanceMoves, request.client.name);

    return {
      rows: warehouseRows,
      wholeBoxes: buildWholeBoxes(actions, auxiliary.boxToPallet, balanceBoxBySourceBox),
      balanceMoves,
      balanceLabels,
      markRows: buildMarkRows(actions, auxiliary.shk),
      reservations: collapseWarehouseReservations(
        actions
          .filter((action) => action.orderId && action.balanceId && action.sourceBox && action.targetBox !== 'БАЛАНС')
          .map((action) => ({
            orderId: action.orderId,
            balanceId: action.balanceId,
            sourceBox: action.sourceBox,
            quantity: action.quantity,
          })),
      ),
    };
  }

  private readCompiledManualInstruction(files: RequestForInstruction['files'] = []) {
    const file = files.find((candidate) => candidate.fileName.startsWith(manualPickInstructionPlanFilePrefix));
    if (!file) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(file.content).toString('utf8')) as CompiledManualPickInstruction;
      if (
        parsed.version !== 1 ||
        !parsed.originalFileName ||
        !parsed.uploadedAt ||
        !parsed.warehousePlan ||
        !Array.isArray(parsed.warehousePlan.rows) ||
        !Array.isArray(parsed.warehousePlan.wholeBoxes) ||
        !Array.isArray(parsed.warehousePlan.balanceMoves) ||
        !Array.isArray(parsed.warehousePlan.balanceLabels) ||
        !Array.isArray(parsed.warehousePlan.markRows)
      ) {
        throw new Error('invalid compiled instruction');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Сохраненная ручная инструкция повреждена. Загрузите исходный XLSX повторно.');
    }
  }

  private async validateManualPickInstruction(request: RequestForInstruction, parsed: ParsedManualPickInstruction) {
    const issues: string[] = [];
    const requestedQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
    const coveredQuantity = parsed.outboundQuantity + parsed.shortageQuantity;
    if (coveredQuantity !== requestedQuantity) {
      issues.push(
        `Количество по инструкции не совпадает с заявкой: в заявке ${requestedQuantity} шт., в инструкции к отправке и в дефиците ${coveredQuantity} шт.`,
      );
    }
    if (parsed.outboundQuantity <= 0) {
      issues.push('В инструкции нет товара со статусом «ЦЕЛЫЙ» или «ПОСТАВКА».');
    }

    const sourceBoxes = new Set(parsed.rows.map((row) => row.sourceBox).filter(Boolean));
    const normalizedSourceBoxes = new Set([...sourceBoxes].map(normalizeManualCode));
    const clientBoxes = await this.prisma.box.findMany({
      where: {
        clientId: request.clientId,
        warehouseId: request.warehouseId ?? undefined,
      },
      select: { code: true },
    });
    const knownBoxes = new Set(clientBoxes.map((box) => normalizeManualCode(box.code)));
    const missingBoxes = [...sourceBoxes].filter((box) => !knownBoxes.has(normalizeManualCode(box)));
    if (missingBoxes.length > 0) {
      issues.push(`Короба не найдены у клиента: ${missingBoxes.slice(0, 10).join(', ')}${missingBoxes.length > 10 ? '…' : ''}.`);
    }

    const rowsByBox = groupManualRowsByBox(parsed.rows);
    for (const [box, rows] of rowsByBox) {
      const outbound = rows.filter(isManualOutboundRow).reduce((sum, row) => sum + row.quantity, 0);
      if (outbound <= 0) {
        issues.push(`Короб ${box} содержит только строки баланса и не участвует в отправке.`);
      }
    }

    const unknownWholeBoxes = parsed.wholeBoxes.filter((row) => !normalizedSourceBoxes.has(normalizeManualCode(row.box)));
    if (unknownWholeBoxes.length > 0) {
      issues.push(`На листе «Целые короба» нет строк состава для: ${unknownWholeBoxes.slice(0, 10).map((row) => row.box).join(', ')}.`);
    }
    const unknownMarkBoxes = parsed.markRows.filter((row) => !normalizedSourceBoxes.has(normalizeManualCode(row.sourceBox)));
    if (unknownMarkBoxes.length > 0) {
      issues.push(`На листе «МАРК» указаны короба вне инструкции: ${unknownMarkBoxes.slice(0, 10).map((row) => row.sourceBox).join(', ')}.`);
    }

    if (issues.length > 0) {
      throw new BadRequestException(issues.slice(0, 12).join('\n'));
    }
  }

  private async buildManualWarehousePlan(
    parsed: ParsedManualPickInstruction,
    clientName: string,
    generatedAt: Date,
  ): Promise<WarehousePlan> {
    const rowsByBox = groupManualRowsByBox(parsed.rows);
    const explicitWholeBoxes = new Map(parsed.wholeBoxes.map((row) => [normalizeManualCode(row.box), row]));
    const balanceMoveSources = new Set<string>();
    const shipmentMoveSources = new Set<string>();

    for (const [box, rows] of rowsByBox) {
      const shipmentQuantity = rows.filter(isManualOutboundRow).reduce((sum, row) => sum + row.quantity, 0);
      const balanceQuantity = rows.filter((row) => row.kind === 'BALANCE').reduce((sum, row) => sum + row.quantity, 0);
      if (balanceQuantity <= 0) {
        continue;
      }
      if (shipmentQuantity < balanceQuantity) {
        shipmentMoveSources.add(box);
      } else {
        balanceMoveSources.add(box);
      }
    }

    const existingCodes = await this.loadExistingBalanceBoxCodes(generatedAt);
    const balanceBoxBySourceBox = assignManualBalanceBoxCodes(balanceMoveSources, existingCodes, generatedAt);
    const rows: WarehouseInstructionRow[] = parsed.rows.map((row) => {
      const balanceBox = balanceBoxBySourceBox.get(row.sourceBox) ?? '';
      let note = row.note;
      if (row.kind === 'BALANCE' && balanceBox) {
        note = joinNotes(note, `новый короб ${balanceBox}`);
      } else if (isManualOutboundRow(row) && shipmentMoveSources.has(row.sourceBox)) {
        note = joinNotes(
          note,
          `Меньшая часть короба уезжает: переместить ${row.quantity} ед. товара в новый FFL-короб поставки. Исходный короб остается на складе.`,
        );
      }
      return {
        city: row.city,
        sourceBox: row.sourceBox,
        targetBox: balanceBox,
        pallet: row.pallet,
        artOnBox: row.article,
        barcodeOnBox: row.barcode,
        size: row.size,
        quantity: row.quantity,
        comment: row.comment,
        rebrandNote: manualRelabelNote(row.barcode, row.relabelNote),
        note,
      };
    });

    const balanceMoves: WarehouseBalanceMoveRow[] = [];
    for (const [box, boxRows] of rowsByBox) {
      if (balanceMoveSources.has(box)) {
        const targetBox = balanceBoxBySourceBox.get(box) ?? '';
        boxRows
          .filter((row) => row.kind === 'BALANCE')
          .forEach((row) => {
            balanceMoves.push({
              sourceBox: box,
              newBox: targetBox,
              purpose: 'BALANCE',
              targetRole: 'STOCK',
              pallet: row.pallet,
              artOnBox: row.article,
              barcodeOnBox: row.barcode,
              size: row.size,
              quantity: row.quantity,
              note: row.note || 'Остаток переложить в новый короб, исходный короб уезжает.',
            });
          });
      } else if (shipmentMoveSources.has(box)) {
        boxRows.filter(isManualOutboundRow).forEach((row) => {
          balanceMoves.push({
            sourceBox: box,
            newBox: '',
            purpose: 'SHIPMENT',
            targetRole: 'SHIPMENT',
            pallet: row.pallet,
            artOnBox: row.article,
            barcodeOnBox: row.barcode,
            size: row.size,
            quantity: row.quantity,
            note:
              row.note ||
              `Меньшая часть короба уезжает: переместить ${row.quantity} ед. товара в новый FFL-короб поставки. Исходный короб остается на складе.`,
          });
        });
      }
    }
    balanceMoves.sort((left, right) =>
      `${left.sourceBox}:${left.targetRole}:${left.barcodeOnBox}:${left.size}`.localeCompare(
        `${right.sourceBox}:${right.targetRole}:${right.barcodeOnBox}:${right.size}`,
        'ru',
        { numeric: true },
      ),
    );

    const wholeBoxes = new Map<string, WarehouseWholeBoxRow>();
    for (const [box, boxRows] of rowsByBox) {
      const normalized = normalizeManualCode(box);
      const explicit = explicitWholeBoxes.get(normalized);
      const balanceQuantity = boxRows.filter((row) => row.kind === 'BALANCE').reduce((sum, row) => sum + row.quantity, 0);
      const hasWholeRow = boxRows.some((row) => row.kind === 'WHOLE');
      if (!explicit && !hasWholeRow && balanceQuantity > 0 && !balanceMoveSources.has(box)) {
        continue;
      }
      if (!explicit && !hasWholeRow && balanceQuantity === 0 && !boxRows.some(isManualOutboundRow)) {
        continue;
      }
      const city = explicit?.city || boxRows.find(isManualOutboundRow)?.city || '';
      const pallet = explicit?.pallet || boxRows.find((row) => row.pallet)?.pallet || '';
      const balanceBox = balanceBoxBySourceBox.get(box) ?? '';
      wholeBoxes.set(normalized, {
        box,
        status: balanceBox ? 'КОРОБ УЕЗЖАЕТ, ОСТАТОК ПЕРЕЛОЖИТЬ' : explicit?.status || (hasWholeRow ? 'ЦЕЛЫЙ' : 'КОРОБ УЕЗЖАЕТ'),
        city,
        pallet,
        balanceBox,
      });
    }

    const markRows: WarehouseMarkRow[] = parsed.markRows.length
      ? parsed.markRows.map((row) => ({
          comment: row.comment,
          city: row.city,
          sourceBox: row.sourceBox,
          brand: row.brand,
          ip: row.ip,
          name: row.name,
          article: row.article,
          wbArticle: row.wbArticle,
          color: row.color,
          size: row.size,
          barcode: row.barcode,
          quantity: row.quantity,
        }))
      : parsed.rows
          .filter((row) => Boolean(row.relabelNote))
          .map((row) => ({
            comment: row.comment,
            city: row.city,
            sourceBox: row.sourceBox,
            brand: '',
            ip: '',
            name: row.article,
            article: row.article,
            wbArticle: '',
            color: '',
            size: row.size,
            barcode: relabelTargetBarcode(row.relabelNote) || row.barcode,
            quantity: row.quantity,
          }));
    const balanceLabels = buildBalanceLabels(balanceMoves, clientName);

    return {
      rows,
      wholeBoxes: [...wholeBoxes.values()].sort((left, right) => left.box.localeCompare(right.box, 'ru', { numeric: true })),
      balanceMoves,
      balanceLabels,
      markRows,
    };
  }

  private async loadExistingBalanceBoxCodes(date: Date) {
    const prefix = balanceBoxPrefix(date);
    const boxes = await this.prisma.box.findMany({
      where: {
        code: { startsWith: prefix },
      },
      select: { code: true },
    });

    return new Set(boxes.map((box) => box.code));
  }

  private rowStatus(row: { skuId: string | null }, shortageQuantity: number): PickInstructionRowStatus {
    if (!row.skuId) {
      return 'SKU_NOT_FOUND';
    }

    return shortageQuantity > 0 ? 'SHORTAGE' : 'READY';
  }

  private rowComment(row: { skuId: string | null; duplicateBarcode: boolean }, shortageQuantity: number) {
    if (row.duplicateBarcode) {
      return 'Баркод привязан к нескольким SKU клиента.';
    }

    if (!row.skuId) {
      return 'Не найден SKU по строке заявки.';
    }

    return shortageQuantity > 0 ? `Не хватает ${shortageQuantity} шт. в AVAILABLE.` : null;
  }

  private async buildBoxSummaries(
    clientId: string,
    boxAllocations: Map<string, { box: BalanceForInstruction; allocatedQuantity: number; lineIds: Set<string> }>,
  ): Promise<PickInstructionBoxSummary[]> {
    const boxIds = [...boxAllocations.keys()];
    if (boxIds.length === 0) {
      return [];
    }

    const totals = await this.prisma.stockBalance.groupBy({
      by: ['boxId'],
      where: {
        clientId,
        status: StockStatus.AVAILABLE,
        boxId: { in: boxIds },
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
    });
    const availableByBoxId = new Map(totals.map((total) => [total.boxId, total._sum.quantity ?? 0]));

    return boxIds
      .map((boxId) => {
        const allocation = boxAllocations.get(boxId)!;
        const availableQuantity = availableByBoxId.get(boxId) ?? allocation.allocatedQuantity;
        const isFullBox = allocation.allocatedQuantity >= availableQuantity;

        return {
          boxId,
          boxCode: allocation.box.box?.code ?? boxId,
          palletId: allocation.box.palletId,
          palletCode: allocation.box.pallet?.code ?? null,
          allocatedQuantity: allocation.allocatedQuantity,
          availableQuantity,
          linesCount: allocation.lineIds.size,
          isFullBox,
          comment: isFullBox ? 'ЦЕЛЫЙ короб в сборку' : 'Частичный отбор из короба',
        };
      })
      .sort((left, right) => left.boxCode.localeCompare(right.boxCode, 'ru'));
  }
}

const pickInstructionRequestArgs = {
  include: {
    client: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    items: {
      include: {
        sku: {
          include: {
            barcodes: {
              select: {
                value: true,
                isPrimary: true,
              },
            },
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    },
    files: {
      select: {
        fileName: true,
        mimeType: true,
        content: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    },
  },
} satisfies Prisma.ClientRequestDefaultArgs;

const stockBalanceArgs = {
  include: {
    sku: {
      include: {
        barcodes: {
          select: {
            value: true,
            isPrimary: true,
          },
        },
      },
    },
    box: {
      select: {
        id: true,
        code: true,
      },
    },
    pallet: {
      select: {
        id: true,
        code: true,
      },
    },
  },
} satisfies Prisma.StockBalanceDefaultArgs;

const skuCatalogArgs = {
  include: {
    barcodes: {
      select: {
        value: true,
        isPrimary: true,
      },
    },
  },
} satisfies Prisma.SkuDefaultArgs;

function groupBalancesBySkuId(balances: BalanceForInstruction[]) {
  const result = new Map<string, BalanceForInstruction[]>();
  balances.forEach((balance) => {
    result.set(balance.skuId, [...(result.get(balance.skuId) ?? []), balance]);
  });
  return result;
}

function cloneBalances(balances: BalanceForInstruction[]) {
  return balances.map((balance) => ({ ...balance }));
}

function readPersistedWavePlan(value: Prisma.JsonValue | null | undefined): BuiltWarehousePlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const plan = value as Record<string, unknown>;
  if (
    !Array.isArray(plan.rows) ||
    !Array.isArray(plan.wholeBoxes) ||
    !Array.isArray(plan.balanceMoves) ||
    !Array.isArray(plan.balanceLabels) ||
    !Array.isArray(plan.markRows) ||
    !Array.isArray(plan.reservations)
  ) {
    return null;
  }
  return plan as unknown as BuiltWarehousePlan;
}

function compareInstructionBalances(left: BalanceForInstruction, right: BalanceForInstruction) {
  const leftBox = textCell(left.box?.code);
  const rightBox = textCell(right.box?.code);
  if (leftBox !== rightBox) {
    return leftBox < rightBox ? -1 : 1;
  }
  const timeDiff = left.updatedAt.getTime() - right.updatedAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return left.id.localeCompare(right.id);
}

function mergeWarehouseAuxiliaryData(values: WarehouseAuxiliaryData[]): WarehouseAuxiliaryData {
  const result = emptyWarehouseAuxiliaryData();
  values.forEach((value) => {
    value.mapping.forEach((sources, target) => {
      const merged = result.mapping.get(target) ?? new Set<string>();
      sources.forEach((source) => merged.add(source));
      result.mapping.set(target, merged);
    });
    value.boxToPallet.forEach((pallet, box) => {
      if (!result.boxToPallet.has(box)) result.boxToPallet.set(box, pallet);
    });
    value.shk.forEach((record, key) => {
      if (!result.shk.has(key)) result.shk.set(key, record);
    });
  });
  return result;
}

function sliceJointWarehousePlan(
  plan: BuiltWarehousePlan,
  orderIds: Set<string>,
  requestId: string,
  requestIdByOrderId: Map<string, string>,
  requestOrder: string[],
): BuiltWarehousePlan {
  const rows = plan.rows.filter((row) => Boolean(row.orderId && orderIds.has(row.orderId)));
  const relevantBoxes = new Set(rows.map((row) => row.sourceBox).filter(Boolean));
  const quantityByBoxAndRequest = new Map<string, Map<string, number>>();

  plan.rows.forEach((row) => {
    const rowRequestId = row.orderId ? requestIdByOrderId.get(row.orderId) : null;
    if (!row.sourceBox || !rowRequestId || row.quantity <= 0) return;
    const quantities = quantityByBoxAndRequest.get(row.sourceBox) ?? new Map<string, number>();
    quantities.set(rowRequestId, (quantities.get(rowRequestId) ?? 0) + row.quantity);
    quantityByBoxAndRequest.set(row.sourceBox, quantities);
  });

  const requestRank = new Map(requestOrder.map((id, index) => [id, index]));
  const balanceOwnerByBox = new Map<string, string>();
  quantityByBoxAndRequest.forEach((quantities, box) => {
    const owner = [...quantities.entries()].sort(
      ([leftId, leftQuantity], [rightId, rightQuantity]) =>
        rightQuantity - leftQuantity ||
        (requestRank.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
          (requestRank.get(rightId) ?? Number.MAX_SAFE_INTEGER),
    )[0]?.[0];
    if (owner) balanceOwnerByBox.set(box, owner);
  });

  const balanceMoves = plan.balanceMoves.filter((move) =>
    move.purpose === 'SHIPMENT'
      ? Boolean(move.orderId && orderIds.has(move.orderId))
      : balanceOwnerByBox.get(move.sourceBox) === requestId,
  );

  return {
    rows,
    wholeBoxes: plan.wholeBoxes.filter((row) => relevantBoxes.has(row.box)),
    balanceMoves,
    balanceLabels: plan.balanceLabels.filter((row) => balanceOwnerByBox.get(row.sourceBox) === requestId),
    markRows: plan.markRows.filter((row) => Boolean(row.orderId && orderIds.has(row.orderId))),
    reservations: plan.reservations.filter((reservation) => orderIds.has(reservation.orderId)),
  };
}

function applyWarehouseReservations(balances: BalanceForInstruction[], reservations: WarehouseReservation[]) {
  const reservedByBalanceId = new Map<string, number>();
  reservations.forEach((reservation) => {
    reservedByBalanceId.set(
      reservation.balanceId,
      (reservedByBalanceId.get(reservation.balanceId) ?? 0) + reservation.quantity,
    );
  });
  return balances
    .map((balance) => ({
      ...balance,
      quantity: Math.max(0, balance.quantity - (reservedByBalanceId.get(balance.id) ?? 0)),
    }))
    .filter((balance) => balance.quantity > 0);
}

function collapseWarehouseReservations(reservations: WarehouseReservation[]) {
  const result = new Map<string, WarehouseReservation>();
  reservations.forEach((reservation) => {
    const key = `${reservation.orderId}:${reservation.balanceId}`;
    const current = result.get(key);
    result.set(key, {
      ...reservation,
      quantity: (current?.quantity ?? 0) + reservation.quantity,
    });
  });
  return [...result.values()];
}

function primaryBarcodeValue(sku: { barcodes: Array<{ value: string; isPrimary: boolean }> }) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? null;
}

function fallbackBalanceSku(skuId: string): SkuForInstruction {
  return {
    id: skuId,
    clientId: '',
    internalSku: skuId,
    clientSku: null,
    article: null,
    name: skuId,
    brand: null,
    category: null,
    color: null,
    size: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    volumeLiters: null,
    volumeSource: 'MANUAL',
    shelfLifeUntil: null,
    needsChestnyZnak: false,
    isUnmarked: false,
    needsLabel: false,
    needsRelabel: false,
    isDraft: false,
    draftSource: null,
    marketplace: null,
    marketplaceProductId: null,
    marketplaceOfferId: null,
    marketplacePayload: null,
    marketplaceSyncedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    barcodes: [],
  };
}

type WarehouseAuxiliaryData = {
  mapping: Map<string, Set<string>>;
  boxToPallet: Map<string, string>;
  shk: Map<string, WarehouseShkRecord>;
};

type WarehouseShkRecord = {
  brand: string;
  ip: string;
  name: string;
  article: string;
  wbArticle: string;
  color: string;
  size: string;
  barcode: string;
};

type WarehouseDemand = {
  requestId: string;
  orderId: string;
  demandIndex: number;
  skuId: string | null;
  artSeller: string;
  targetArt: string;
  barcode: string;
  size: string;
  name: string;
  city: string;
  needsRelabel: boolean;
  relabelSourceBarcode: string;
  relabelTargetBarcode: string;
  required: number;
  remaining: number;
};

type WarehouseInventoryItem = {
  id: string;
  box: string;
  pallet: string;
  skuId: string;
  barcode: string;
  barcodes: string[];
  artWarehouse: string;
  name: string;
  size: string;
  quantity: number;
  originalQuantity: number;
  suitableDemands: string[];
};

type WarehouseAction = {
  requestId: string;
  orderId: string;
  balanceId: string;
  city: string;
  sourceBox: string;
  pallet: string;
  artOnBox: string;
  barcodeOnBox: string;
  targetArt: string;
  targetBarcode: string;
  size: string;
  quantity: number;
  targetBox: string;
  rebrandNote: string;
  note: string;
};

function emptyWarehouseAuxiliaryData(): WarehouseAuxiliaryData {
  return {
    mapping: new Map(),
    boxToPallet: new Map(),
    shk: new Map(),
  };
}

function parseMappingSheet(rows: unknown[][]) {
  const mapping = new Map<string, Set<string>>();
  rows.slice(1).forEach((row) => {
    const target = textCell(row[0]);
    const source = textCell(row[1]);
    if (!target || !source) {
      return;
    }
    addArticleMapping(mapping, target, source);
  });
  return mapping;
}

function addArticleMapping(mapping: Map<string, Set<string>>, targetArticle: string, sourceArticle: string) {
  const target = textCell(targetArticle);
  const source = textCell(sourceArticle);
  if (!target || !source) {
    return;
  }
  mapping.set(target, new Set([...(mapping.get(target) ?? []), source]));
}

function parsePalletSheet(rows: unknown[][]) {
  const result = new Map<string, string>();
  let currentPallet = '';
  rows.forEach((row) => {
    const value = textCell(row[0]);
    if (!value) {
      return;
    }
    if (value.toUpperCase().startsWith('PALLET_SORT')) {
      currentPallet = value;
      return;
    }
    if (currentPallet) {
      result.set(value, currentPallet);
    }
  });
  return result;
}

function parseShkSheet(rows: unknown[][]) {
  const result = new Map<string, WarehouseShkRecord>();
  rows.slice(1).forEach((row) => {
    const record = {
      brand: textCell(row[0]),
      ip: textCell(row[1]),
      name: textCell(row[2]),
      article: textCell(row[3]),
      wbArticle: textCell(row[4]),
      color: textCell(row[5]),
      size: normalizeSize(textCell(row[6])),
      barcode: textCell(row[7]),
    };
    if (record.article) {
      result.set(record.article, record);
    }
    if (record.barcode) {
      result.set(record.barcode, record);
    }
  });
  return result;
}

function instructionSkuArticle(
  sku:
    | {
        clientSku?: string | null;
        article?: string | null;
        internalSku?: string | null;
        size?: string | null;
      }
    | null
    | undefined,
) {
  if (!sku) {
    return '';
  }
  const explicit = textCell(sku.clientSku) || textCell(sku.article);
  if (explicit) {
    return explicit;
  }

  const internalSku = textCell(sku.internalSku);
  const size = textCell(sku.size);
  if (!internalSku || !size || !internalSku.toLocaleUpperCase('ru-RU').endsWith(size.toLocaleUpperCase('ru-RU'))) {
    return internalSku;
  }
  return internalSku.slice(0, -size.length).replace(/[-_/\s]+$/g, '').trim();
}

function buildShkCatalogFromSkus(skus: SkuCatalogForInstruction[]) {
  const result = new Map<string, WarehouseShkRecord>();
  skus.forEach((sku) => {
    const payload = recordFromJson(sku.marketplacePayload);
    const barcode = primaryBarcodeValue(sku) ?? textFromPayload(payload, ['barcode', 'barCode', 'sku', 'offerBarcode']);
    const article = instructionSkuArticle(sku);
    const wbArticle =
      sku.marketplaceProductId ||
      sku.marketplaceOfferId ||
      textFromPayload(payload, ['nmID', 'nmId', 'imtID', 'imtId', 'vendorCode', 'offerId']) ||
      sku.clientSku ||
      '';
    const record: WarehouseShkRecord = {
      brand: sku.brand || textFromPayload(payload, ['brand', 'brandName']),
      ip: textFromPayload(payload, ['ip', 'seller', 'sellerName', 'supplierName']),
      name: sku.name,
      article,
      wbArticle,
      color: sku.color || textFromPayload(payload, ['color', 'colour', 'colorName']),
      size: normalizeSize(sku.size || textFromPayload(payload, ['size', 'techSize', 'russianSize'])),
      barcode: barcode ?? '',
    };

    [sku.internalSku, sku.article, sku.clientSku, barcode].forEach((key) => {
      const cleaned = textCell(key);
      if (cleaned) {
        result.set(cleaned, record);
      }
    });
  });
  return result;
}

function mergeMissingShkRecords(target: Map<string, WarehouseShkRecord>, fallback: Map<string, WarehouseShkRecord>) {
  fallback.forEach((record, key) => {
    if (!target.has(key)) {
      target.set(key, record);
    }
  });
}

function parseRequestItemComment(comment: string | null) {
  const result = {
    city: '',
    artSeller: '',
    size: '',
    needsRelabel: false,
    relabelSourceBarcode: '',
    relabelTargetBarcode: '',
  };
  if (!comment) {
    return result;
  }

  comment.split(';').forEach((part) => {
    const [rawKey, ...rawValue] = part.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(':').trim();
    if (key === 'город') {
      result.city = value;
    } else if (key === 'артикул продавца') {
      result.artSeller = value;
    } else if (key === 'размер') {
      result.size = value;
    } else if (key === 'перемаркировка') {
      result.needsRelabel = ['да', 'true', '1', 'yes'].includes(value.toLowerCase());
    } else if (key === 'перемаркировка из') {
      result.relabelSourceBarcode = value;
      result.needsRelabel = true;
    } else if (key === 'перемаркировка в') {
      result.relabelTargetBarcode = value;
      result.needsRelabel = true;
    }
  });
  return result;
}

function compareDemandPriority(
  leftOrderId: string,
  rightOrderId: string,
  remainingByOrderId: Map<string, number>,
  demandById: Map<string, WarehouseDemand>,
) {
  const quantityDiff = (remainingByOrderId.get(rightOrderId) ?? 0) - (remainingByOrderId.get(leftOrderId) ?? 0);
  if (quantityDiff !== 0) {
    return quantityDiff;
  }
  const left = demandById.get(leftOrderId);
  const right = demandById.get(rightOrderId);
  if (left?.needsRelabel !== right?.needsRelabel) {
    return left?.needsRelabel ? -1 : 1;
  }
  return (left?.demandIndex ?? 0) - (right?.demandIndex ?? 0);
}

function isSuitableForDemand(item: WarehouseInventoryItem, demand: WarehouseDemand, mapping: Map<string, Set<string>>) {
  const requiredBarcode = textCell(demand.needsRelabel ? demand.relabelSourceBarcode || demand.barcode : demand.barcode);

  if (requiredBarcode && itemHasBarcode(item, requiredBarcode) && exactSizesMatch(item.size, demand.size)) {
    return true;
  }

  const baseArts = mapping.get(demand.artSeller) ?? new Set([demand.artSeller]);
  return baseArts.has(item.artWarehouse) && exactSizesMatch(item.size, demand.size);
}

function actionFromAssignment(
  item: WarehouseInventoryItem,
  demand: WarehouseDemand,
  quantity: number,
  targetBox: string,
  rebrandNote: string,
  note: string,
): WarehouseAction {
  return {
    requestId: demand.requestId,
    orderId: demand.orderId,
    balanceId: item.id,
    city: demand.city,
    sourceBox: item.box,
    pallet: item.pallet,
    artOnBox: item.artWarehouse,
    barcodeOnBox: item.barcode,
    targetArt: demand.targetArt,
    targetBarcode: demand.relabelTargetBarcode || demand.barcode,
    size: item.size || demand.size,
    quantity,
    targetBox,
    rebrandNote,
    note,
  };
}

function balanceAction(item: WarehouseInventoryItem, note = 'остаток на складе'): WarehouseAction {
  return {
    requestId: '',
    orderId: '',
    balanceId: item.id,
    city: '',
    sourceBox: item.box,
    pallet: item.pallet,
    artOnBox: item.artWarehouse,
    barcodeOnBox: item.barcode,
    targetArt: '',
    targetBarcode: '',
    size: item.size,
    quantity: item.quantity,
    targetBox: 'БАЛАНС',
    rebrandNote: '',
    note,
  };
}

function joinNotes(...notes: Array<string | null | undefined>) {
  return notes.map((note) => note?.trim()).filter(Boolean).join('; ');
}

function buildWholeBoxes(
  actions: WarehouseAction[],
  boxToPallet: Map<string, string>,
  balanceBoxBySourceBox: Map<string, string>,
): WarehouseWholeBoxRow[] {
  const boxCities = new Map<string, Set<string>>();
  const boxHasMark = new Map<string, boolean>();
  actions.forEach((action) => {
    if (!['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox) && !balanceBoxBySourceBox.has(action.sourceBox)) {
      return;
    }
    const cities = boxCities.get(action.sourceBox) ?? new Set<string>();
    if (action.city) {
      cities.add(action.city);
    }
    boxCities.set(action.sourceBox, cities);
    if (action.targetBox === 'МАРК ЦЕЛЫЙ') {
      boxHasMark.set(action.sourceBox, true);
    }
  });

  return [...boxCities.entries()]
    .map(([box, cities]) => ({
      box,
      status: balanceBoxBySourceBox.has(box)
        ? 'КОРОБ УЕЗЖАЕТ, ОСТАТОК ПЕРЕЛОЖИТЬ'
        : cities.size === 1
          ? boxHasMark.get(box)
            ? 'МАРК ЦЕЛЫЙ'
            : 'ЦЕЛЫЙ'
          : 'НЕСКОЛЬКО',
      city: cities.size === 1 ? [...cities][0] : cities.size > 1 ? 'РАЗНЫЕ ГОРОДА' : '',
      pallet: actions.find((action) => action.sourceBox === box)?.pallet || boxToPallet.get(box) || '',
      balanceBox: balanceBoxBySourceBox.get(box) ?? '',
    }))
    .sort((left, right) => left.box.localeCompare(right.box, 'ru'));
}

function buildBalanceMoves(
  actions: WarehouseAction[],
  balanceBoxBySourceBox: Map<string, string>,
  shipmentMoveSourceBoxes: Set<string>,
  boxToPallet: Map<string, string>,
): WarehouseBalanceMoveRow[] {
  const balanceMoves = actions
    .filter((action) => action.targetBox === 'БАЛАНС' && balanceBoxBySourceBox.has(action.sourceBox))
    .map((action) => ({
      orderId: action.orderId,
      sourceBox: action.sourceBox,
      newBox: balanceBoxBySourceBox.get(action.sourceBox)!,
      purpose: 'BALANCE' as const,
      targetRole: 'STOCK' as const,
      pallet: action.pallet || boxToPallet.get(action.sourceBox) || '',
      artOnBox: action.artOnBox,
      barcodeOnBox: action.barcodeOnBox,
      size: action.size,
      quantity: action.quantity,
      note: action.note || 'Остаток переложить в новый короб, исходный короб уезжает.',
    }));

  const shipmentMoves = actions
    .filter((action) => shipmentMoveSourceBoxes.has(action.sourceBox) && action.targetBox !== 'БАЛАНС')
    .map((action) => ({
      orderId: action.orderId,
      sourceBox: action.sourceBox,
      newBox: '',
      purpose: 'SHIPMENT' as const,
      targetRole: 'SHIPMENT' as const,
      pallet: action.pallet || boxToPallet.get(action.sourceBox) || '',
      artOnBox: action.targetArt || action.artOnBox,
      barcodeOnBox: action.targetBarcode || action.barcodeOnBox,
      size: action.size,
      quantity: action.quantity,
      note:
        action.note ||
        `Меньшая часть короба уезжает: переместить ${action.quantity} ед. товара в новый FFL-короб поставки. Исходный короб остается на складе.`,
    }));

  return [...balanceMoves, ...shipmentMoves].sort((left, right) =>
    `${left.sourceBox}:${left.targetRole}:${left.barcodeOnBox}:${left.size}`.localeCompare(
      `${right.sourceBox}:${right.targetRole}:${right.barcodeOnBox}:${right.size}`,
      'ru',
      { numeric: true },
    ),
  );
}

function buildBalanceLabels(balanceMoves: WarehouseBalanceMoveRow[], clientName: string): WarehouseBalanceLabelRow[] {
  const sourceByNewBox = new Map<string, string>();
  balanceMoves.filter((move) => move.purpose === 'BALANCE' && move.newBox).forEach((move) => {
    sourceByNewBox.set(move.newBox, move.sourceBox);
  });

  return [...sourceByNewBox.entries()]
    .map(([newBox, sourceBox]) => ({
      newBox,
      sourceBox,
      tspl: balanceBoxTspl(newBox, clientName),
    }))
    .sort((left, right) => left.newBox.localeCompare(right.newBox, 'ru'));
}

function assignBalanceBoxCodes(actions: WarehouseAction[], existingCodes: Set<string>, date: Date) {
  const usedCodes = new Set(existingCodes);
  const result = new Map<string, string>();
  const sourceBoxes = [
    ...new Set(
      actions
        .filter((action) => action.targetBox === 'БАЛАНС' && action.sourceBox)
        .map((action) => action.sourceBox)
        .sort((left, right) => left.localeCompare(right, 'ru')),
    ),
  ];

  let sequence = 1;
  for (const sourceBox of sourceBoxes) {
    let candidate = balanceBoxCode(date, sequence);
    while (usedCodes.has(candidate)) {
      sequence += 1;
      candidate = balanceBoxCode(date, sequence);
    }
    usedCodes.add(candidate);
    result.set(sourceBox, candidate);
    sequence += 1;
  }

  return result;
}

function balanceBoxPrefix(date: Date) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? String(date.getDate()).padStart(2, '0');
  const month = parts.find((part) => part.type === 'month')?.value ?? String(date.getMonth() + 1).padStart(2, '0');
  return `FFL_BAL${day}${month}_`;
}

function balanceBoxCode(date: Date, sequence: number) {
  return `${balanceBoxPrefix(date)}${String(sequence).padStart(2, '0')}`;
}

function warehouseActionComment(
  action: WarehouseAction,
  wholeBoxCities: Map<string, Set<string>>,
) {
  if (action.targetBox === 'БАЛАНС') {
    return 'ПЕРЕЛОЖИТЬ ОСТАТОК';
  }

  if (['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox) && (wholeBoxCities.get(action.sourceBox)?.size ?? 0) > 1) {
    return 'НЕСКОЛЬКО';
  }

  return action.targetBox;
}

function needsWarehouseRelabel(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  return demand.needsRelabel || Boolean(demand.targetArt && item.artWarehouse !== demand.targetArt);
}

function relabelNote(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  if (!needsWarehouseRelabel(item, demand)) {
    return '';
  }

  return `переклеить на ${demand.targetArt || demand.relabelTargetBarcode || demand.artSeller || demand.barcode}`;
}

function isExactBarcodeMatch(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  return Boolean(demand.barcode && itemHasBarcode(item, demand.barcode) && sizesMatch(item.size, demand.size));
}

function isExactNameMatch(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  return Boolean(item.name && demand.name && item.name === demand.name && sizesMatch(item.size, demand.size));
}

function itemHasBarcode(item: WarehouseInventoryItem, barcode: string) {
  const target = normalizeBarcode(barcode);
  return [item.barcode, ...item.barcodes].some((value) => normalizeBarcode(value) === target);
}

function normalizeBarcode(value: string | null | undefined) {
  return textCell(value).replace(/\s+/g, '').toLowerCase();
}

function balanceBoxTspl(boxCode: string, clientName: string) {
  const safeClient = sanitizeTsplText(clientName);
  const safeBox = sanitizeTsplText(boxCode);

  return [
    'SIZE 80 mm,50 mm',
    'GAP 2 mm,0',
    'CLS',
    `TEXT 40,25,"3",0,1,1,"${safeClient}"`,
    `QRCODE 170,80,L,7,A,0,"${safeBox}"`,
    `TEXT 80,310,"3",0,1,1,"${safeBox}"`,
    'PRINT 1',
  ].join('\n');
}

function sanitizeTsplText(value: string) {
  return value.replace(/"/g, '').trim();
}

function buildMarkRows(actions: WarehouseAction[], shk: Map<string, WarehouseShkRecord>): WarehouseMarkRow[] {
  return actions
    .filter((action) => ['МАРК ЦЕЛЫЙ', 'МАРК ПОСТАВКА'].includes(action.targetBox) && Boolean(action.rebrandNote))
    .map((action) => {
      const record = shk.get(action.targetArt) ?? shk.get(action.targetBarcode);
      return {
        orderId: action.orderId,
        comment: action.targetBox,
        city: action.city,
        sourceBox: action.sourceBox,
        brand: record?.brand ?? '',
        ip: record?.ip ?? '',
        name: record?.name ?? '',
        article: action.targetArt,
        wbArticle: record?.wbArticle ?? '',
        color: record?.color ?? '',
        size: action.size,
        barcode: action.targetBarcode,
        quantity: action.quantity,
      };
    });
}

function groupManualRowsByBox(rows: ManualInstructionRow[]) {
  const result = new Map<string, ManualInstructionRow[]>();
  rows.forEach((row) => {
    if (!row.sourceBox || row.kind === 'SHORTAGE') {
      return;
    }
    result.set(row.sourceBox, [...(result.get(row.sourceBox) ?? []), row]);
  });
  return result;
}

function isManualOutboundRow(row: ManualInstructionRow) {
  return row.kind === 'WHOLE' || row.kind === 'SHIPMENT';
}

function assignManualBalanceBoxCodes(sourceBoxes: Set<string>, existingCodes: Set<string>, date: Date) {
  const usedCodes = new Set(existingCodes);
  const result = new Map<string, string>();
  let sequence = 1;
  for (const sourceBox of [...sourceBoxes].sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))) {
    let candidate = balanceBoxCode(date, sequence);
    while (usedCodes.has(candidate)) {
      sequence += 1;
      candidate = balanceBoxCode(date, sequence);
    }
    usedCodes.add(candidate);
    result.set(sourceBox, candidate);
    sequence += 1;
  }
  return result;
}

function normalizeManualCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU').replace(/\s+/g, '');
}

function manualRelabelNote(sourceBarcode: string, note: string) {
  const normalized = note.trim();
  if (!normalized) {
    return '';
  }
  if (/(-|=)>|→/.test(normalized)) {
    return normalized;
  }
  return `перемаркировать ${sourceBarcode} -> ${normalized}`;
}

function relabelTargetBarcode(note: string) {
  const arrowParts = note.split(/(?:->|=>|→)/);
  if (arrowParts.length > 1) {
    return arrowParts[arrowParts.length - 1].trim();
  }
  const matches = note.match(/[A-Za-zА-Яа-я0-9_-]{6,}/g);
  return matches?.[matches.length - 1] ?? '';
}

function normalizeSize(value: string | null | undefined) {
  const raw = textCell(value).toUpperCase().replace(/М/g, 'M').replace(/Х/g, 'X');
  const match = raw.match(/\(([^)]+)\)/);
  return (match?.[1] ?? raw).replace(/\s+/g, '');
}

function instructionSize(value: string | null | undefined) {
  return normalizeSize(value).split('/')[0]?.split('-')[0] ?? '';
}

function normalizeName(value: string | null | undefined) {
  return textCell(value).toUpperCase().replace(/\s+/g, ' ');
}

function sizesMatch(left: string, right: string) {
  return !left || !right || left === right;
}

function exactSizesMatch(left: string, right: string) {
  return normalizeSize(left) === normalizeSize(right);
}

function textCell(value: unknown) {
  return value == null ? '' : String(value).replace(/\.0$/, '').trim();
}

function recordFromJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textFromPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = textCell(value);
      if (text) {
        return text;
      }
    }
  }
  return '';
}

function instructionSourceBoxes(document: PickInstructionDocument) {
  return new Set(
    [
      ...document.boxes.map((row) => row.boxCode),
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
    ].filter((value): value is string => Boolean(value?.trim())),
  );
}

function normalizeInstructionBoxCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU').replace(/\s+/g, '');
}

type RequestReservationOrder = {
  id: string;
  status: ClientRequestStatus;
  priority: ClientRequestPriority;
  createdAt: Date;
};

function compareRequestReservationOrder(left: RequestReservationOrder, right: RequestReservationOrder) {
  const statusDifference = reservationStatusRank(left.status) - reservationStatusRank(right.status);
  if (statusDifference !== 0) return statusDifference;
  const priorityDifference = reservationPriorityRank(left.priority) - reservationPriorityRank(right.priority);
  if (priorityDifference !== 0) return priorityDifference;
  const dateDifference = left.createdAt.getTime() - right.createdAt.getTime();
  return dateDifference || left.id.localeCompare(right.id);
}

function reservationStatusRank(status: ClientRequestStatus) {
  switch (status) {
    case ClientRequestStatus.IN_WORK:
      return 0;
    case ClientRequestStatus.APPROVED:
      return 1;
    case ClientRequestStatus.IN_REVIEW:
      return 2;
    case ClientRequestStatus.SUBMITTED:
      return 3;
    default:
      return 4;
  }
}

function reservationPriorityRank(priority: ClientRequestPriority) {
  switch (priority) {
    case ClientRequestPriority.URGENT:
      return 0;
    case ClientRequestPriority.HIGH:
      return 1;
    case ClientRequestPriority.NORMAL:
      return 2;
    case ClientRequestPriority.LOW:
      return 3;
  }
}

function overlapErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Не удалось построить складскую инструкцию.';
}
