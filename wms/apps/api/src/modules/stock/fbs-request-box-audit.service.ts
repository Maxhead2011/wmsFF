import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PickInstructionService } from './pick-instruction.service';
import type { PickInstructionDocument } from './pick-instruction.types';

const reservationStatuses = [
  'RESERVED',
  'RESCAN_REQUIRED',
  'IN_PROGRESS',
  'COMPLETED',
  'RETURN_REQUIRED',
];

const outstandingStatuses = [
  'WAITING_STOCK',
  'RELEASED',
  'RESERVED',
  'RESCAN_REQUIRED',
  'IN_PROGRESS',
  'RETURN_REQUIRED',
];

const closedRequestStatuses = [
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
];

export type FbsRequestBoxAuditState =
  | 'OK'
  | 'NO_REMAINING_DEMAND'
  | 'BLOCKED_BY_RESERVATIONS'
  | 'SKU_OR_QUANTITY_MISMATCH'
  | 'NOT_ON_PALLET_SORT'
  | 'EMPTY'
  | 'ARCHIVED'
  | 'MISSING';

export type FbsRequestBoxAuditRow = {
  code: string;
  state: FbsRequestBoxAuditState;
  stateLabel: string;
  palletCode: string | null;
  availableUnits: number;
  reservedUnits: number;
  freeUnits: number;
  requiredUnits: number;
  externalOrders: string[];
  externalOrdersCount: number;
  products: Array<{
    skuId: string;
    name: string;
    available: number;
    reserved: number;
    free: number;
    required: number;
  }>;
  recommendation: string;
};

export type FbsRequestBoxAudit = {
  checkedAt: string;
  request: {
    id: string;
    number: number;
    title: string;
    status: string;
    client: { id: string; code: string; name: string };
  };
  taskSummary: {
    total: number;
    completed: number;
    outstanding: number;
    inProgress: number;
  };
  summary: {
    planBoxes: number;
    healthy: number;
    issues: number;
    noRemainingDemand: number;
    blockedByReservations: number;
    skuOrQuantityMismatch: number;
    notOnPalletSort: number;
    empty: number;
    archived: number;
    missing: number;
  };
  rows: FbsRequestBoxAuditRow[];
};

type AssemblyTask = {
  id: string;
  requestId: string;
  orderId: string;
  status: string;
  itemCount: number;
  skuId: string;
  sourceSkuId: string | null;
  relabelConfirmedAt: Date | null;
  boxId: string | null;
  reservedBoxId: string | null;
};

@Injectable()
export class FbsRequestBoxAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly pickInstructions: PickInstructionService,
  ) {}

  async listActiveRequests(user: AuthUser) {
    const clientId = this.clientScopes.resolveClientFilter(user);
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId,
        type: ClientRequestType.OUTBOUND,
        status: {
          in: [
            ClientRequestStatus.SUBMITTED,
            ClientRequestStatus.IN_REVIEW,
            ClientRequestStatus.APPROVED,
            ClientRequestStatus.IN_WORK,
            ClientRequestStatus.PACKED,
          ],
        },
        fbsOrderLinks: { some: {} },
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        updatedAt: true,
        client: { select: { id: true, code: true, name: true } },
        _count: { select: { fbsOrderLinks: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 250,
    });
    const requestIds = requests.map((request) => request.id);
    const tasks = requestIds.length
      ? await this.prisma.fbsTsdAssembly.findMany({
          where: { requestId: { in: requestIds } },
          select: { requestId: true, status: true, itemCount: true },
        })
      : [];
    const tasksByRequest = new Map<string, { total: number; completed: number; outstanding: number }>();
    tasks.forEach((task) => {
      const current = tasksByRequest.get(task.requestId) ?? { total: 0, completed: 0, outstanding: 0 };
      const quantity = Math.max(1, task.itemCount);
      current.total += quantity;
      if (task.status === 'COMPLETED') current.completed += quantity;
      else if (outstandingStatuses.includes(task.status)) current.outstanding += quantity;
      tasksByRequest.set(task.requestId, current);
    });
    return requests.map((request) => ({
      id: request.id,
      number: request.number,
      title: request.title,
      status: request.status,
      updatedAt: request.updatedAt.toISOString(),
      client: request.client,
      orders: request._count.fbsOrderLinks,
      tasks: tasksByRequest.get(request.id) ?? { total: 0, completed: 0, outstanding: 0 },
    }));
  }

  async auditRequest(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { clientId: true },
    });
    if (!request) throw new NotFoundException('Заявка не найдена.');
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    const document = await this.pickInstructions.getRequestInstruction(requestId, user);
    const audit = await this.auditDocument(document);
    if (!audit) throw new NotFoundException('У заявки нет связанных FBS-заказов.');
    return audit;
  }

  async auditDocument(document: PickInstructionDocument): Promise<FbsRequestBoxAudit | null> {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: document.requestId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        clientId: true,
        client: { select: { id: true, code: true, name: true } },
        _count: { select: { fbsOrderLinks: true } },
      },
    });
    if (!request) throw new NotFoundException('Заявка не найдена.');
    if (request._count.fbsOrderLinks === 0) return null;

    const planBoxCodes = uniqueCodes([
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
    ]);
    const boxes = planBoxCodes.length
      ? await this.prisma.box.findMany({
          where: { clientId: request.clientId, code: { in: planBoxCodes } },
          select: {
            id: true,
            code: true,
            status: true,
            storagePlacement: {
              select: { pallet: { select: { code: true, status: true } } },
            },
            balances: {
              where: { status: StockStatus.AVAILABLE, quantity: { gt: 0 } },
              select: {
                skuId: true,
                quantity: true,
                sku: { select: { internalSku: true, name: true } },
              },
            },
          },
        })
      : [];
    const boxByCode = new Map(boxes.map((box) => [normalizeCode(box.code), box]));
    const planBoxIds = boxes.map((box) => box.id);

    const allReservationTasks = planBoxIds.length ? await this.prisma.fbsTsdAssembly.findMany({
      where: {
        clientId: request.clientId,
        status: { in: reservationStatuses },
        OR: [
          { boxId: { in: planBoxIds } },
          { boxId: null, reservedBoxId: { in: planBoxIds } },
        ],
      },
      select: {
        id: true,
        requestId: true,
        orderId: true,
        status: true,
        itemCount: true,
        skuId: true,
        sourceSkuId: true,
        relabelConfirmedAt: true,
        boxId: true,
        reservedBoxId: true,
      },
    }) : [];
    const completedRequestIds = uniqueCodes(
      allReservationTasks
        .filter((task) => task.status === 'COMPLETED')
        .map((task) => task.requestId),
    );
    const openCompletedRequests = completedRequestIds.length
      ? await this.prisma.clientRequest.findMany({
          where: { id: { in: completedRequestIds }, status: { notIn: closedRequestStatuses } },
          select: { id: true },
        })
      : [];
    const openCompletedRequestIds = new Set(openCompletedRequests.map((row) => row.id));
    const reservationTasks = allReservationTasks.filter(
      (task) => task.status !== 'COMPLETED' || openCompletedRequestIds.has(task.requestId),
    );
    const allRequestTasks = await this.prisma.fbsTsdAssembly.findMany({
      where: { requestId: request.id },
      select: {
        id: true,
        requestId: true,
        orderId: true,
        status: true,
        itemCount: true,
        skuId: true,
        sourceSkuId: true,
        relabelConfirmedAt: true,
        boxId: true,
        reservedBoxId: true,
      },
    });
    const outstandingTasks = allRequestTasks.filter((task) => outstandingStatuses.includes(task.status));
    const reservationsByBoxSku = new Map<string, AssemblyTask[]>();
    reservationTasks.forEach((task) => {
      const boxId = task.boxId ?? task.reservedBoxId;
      if (!boxId) return;
      const key = `${boxId}:${effectiveTaskSku(task)}`;
      reservationsByBoxSku.set(key, [...(reservationsByBoxSku.get(key) ?? []), task]);
    });
    const outstandingBySku = new Map<string, AssemblyTask[]>();
    outstandingTasks.forEach((task) => {
      const skuId = effectiveTaskSku(task);
      outstandingBySku.set(skuId, [...(outstandingBySku.get(skuId) ?? []), task]);
    });

    const rows: FbsRequestBoxAuditRow[] = planBoxCodes.map((code) => {
      const box = boxByCode.get(normalizeCode(code));
      if (!box) return emptyAuditRow(code, 'MISSING');
      if (['deleted', 'archived'].includes(box.status.toLocaleLowerCase('ru-RU'))) {
        return { ...emptyAuditRow(code, 'ARCHIVED'), palletCode: box.storagePlacement?.pallet.code ?? null };
      }
      if (!box.storagePlacement) return emptyAuditRow(code, 'NOT_ON_PALLET_SORT');
      if (box.balances.length === 0) {
        return { ...emptyAuditRow(code, 'EMPTY'), palletCode: box.storagePlacement.pallet.code };
      }

      let canServe = false;
      let hasDemand = false;
      const externalOrders = new Set<string>();
      const products = box.balances.map((balance) => {
        const reservations = reservationsByBoxSku.get(`${box.id}:${balance.skuId}`) ?? [];
        const reserved = reservations.reduce((sum, task) => sum + Math.max(1, task.itemCount), 0);
        const demandTasks = outstandingBySku.get(balance.skuId) ?? [];
        const required = demandTasks.reduce((sum, task) => sum + Math.max(1, task.itemCount), 0);
        if (required > 0) hasDemand = true;
        demandTasks.forEach((task) => {
          const ownReservation = reservations
            .filter((reservation) => reservation.id === task.id)
            .reduce((sum, reservation) => sum + Math.max(1, reservation.itemCount), 0);
          if (balance.quantity - reserved + ownReservation >= Math.max(1, task.itemCount)) canServe = true;
        });
        reservations.forEach((reservation) => {
          if (reservation.requestId !== request.id) externalOrders.add(reservation.orderId);
        });
        return {
          skuId: balance.skuId,
          name: balance.sku.internalSku || balance.sku.name,
          available: balance.quantity,
          reserved,
          free: balance.quantity - reserved,
          required,
        };
      });
      const availableUnits = products.reduce((sum, product) => sum + product.available, 0);
      const reservedUnits = products.reduce((sum, product) => sum + product.reserved, 0);
      const requiredUnits = products.reduce((sum, product) => sum + product.required, 0);
      let state: FbsRequestBoxAuditState = 'OK';
      if (!canServe) {
        if (!hasDemand) state = 'NO_REMAINING_DEMAND';
        else if (availableUnits - reservedUnits <= 0) state = 'BLOCKED_BY_RESERVATIONS';
        else state = 'SKU_OR_QUANTITY_MISMATCH';
      }
      const orders = [...externalOrders];
      return {
        code,
        state,
        stateLabel: auditStateLabel(state),
        palletCode: box.storagePlacement.pallet.code,
        availableUnits,
        reservedUnits,
        freeUnits: availableUnits - reservedUnits,
        requiredUnits,
        externalOrders: orders.slice(0, 20),
        externalOrdersCount: orders.length,
        products,
        recommendation: auditRecommendation(state),
      };
    });
    const count = (state: FbsRequestBoxAuditState) => rows.filter((row) => row.state === state).length;
    const healthy = count('OK');
    return {
      checkedAt: new Date().toISOString(),
      request: {
        id: request.id,
        number: request.number,
        title: request.title,
        status: request.status,
        client: request.client,
      },
      taskSummary: {
        total: allRequestTasks.reduce((sum, task) => sum + Math.max(1, task.itemCount), 0),
        completed: allRequestTasks
          .filter((task) => task.status === 'COMPLETED')
          .reduce((sum, task) => sum + Math.max(1, task.itemCount), 0),
        outstanding: outstandingTasks.reduce((sum, task) => sum + Math.max(1, task.itemCount), 0),
        inProgress: allRequestTasks
          .filter((task) => task.status === 'IN_PROGRESS')
          .reduce((sum, task) => sum + Math.max(1, task.itemCount), 0),
      },
      summary: {
        planBoxes: rows.length,
        healthy,
        issues: rows.length - healthy,
        noRemainingDemand: count('NO_REMAINING_DEMAND'),
        blockedByReservations: count('BLOCKED_BY_RESERVATIONS'),
        skuOrQuantityMismatch: count('SKU_OR_QUANTITY_MISMATCH'),
        notOnPalletSort: count('NOT_ON_PALLET_SORT'),
        empty: count('EMPTY'),
        archived: count('ARCHIVED'),
        missing: count('MISSING'),
      },
      rows,
    };
  }
}

function effectiveTaskSku(task: Pick<AssemblyTask, 'skuId' | 'sourceSkuId' | 'relabelConfirmedAt'>) {
  return task.sourceSkuId && !task.relabelConfirmedAt ? task.sourceSkuId : task.skuId;
}

function normalizeCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU');
}

function uniqueCodes(values: Array<string | null | undefined>) {
  return [...new Map(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    .map((value) => [normalizeCode(value), value])).values()].sort((left, right) => left.localeCompare(right, 'ru-RU', { numeric: true }));
}

function emptyAuditRow(code: string, state: FbsRequestBoxAuditState): FbsRequestBoxAuditRow {
  return {
    code,
    state,
    stateLabel: auditStateLabel(state),
    palletCode: null,
    availableUnits: 0,
    reservedUnits: 0,
    freeUnits: 0,
    requiredUnits: 0,
    externalOrders: [],
    externalOrdersCount: 0,
    products: [],
    recommendation: auditRecommendation(state),
  };
}

function auditStateLabel(state: FbsRequestBoxAuditState) {
  const labels: Record<FbsRequestBoxAuditState, string> = {
    OK: 'Нужен и доступен',
    NO_REMAINING_DEMAND: 'Больше не нужен заявке',
    BLOCKED_BY_RESERVATIONS: 'Занят другими FBS-заказами',
    SKU_OR_QUANTITY_MISMATCH: 'Нужный товар недоступен',
    NOT_ON_PALLET_SORT: 'Не находится на палетсорте',
    EMPTY: 'Короб пуст по живому остатку',
    ARCHIVED: 'Короб архивирован',
    MISSING: 'Короб отсутствует в базе',
  };
  return labels[state];
}

function auditRecommendation(state: FbsRequestBoxAuditState) {
  const recommendations: Record<FbsRequestBoxAuditState, string> = {
    OK: 'Короб можно использовать для сборки.',
    NO_REMAINING_DEMAND: 'Убрать короб из подсказок этой заявки.',
    BLOCKED_BY_RESERVATIONS: 'Пересчитать подбор и показать свободный альтернативный короб.',
    SKU_OR_QUANTITY_MISMATCH: 'Пересчитать подбор по SKU и доступному количеству.',
    NOT_ON_PALLET_SORT: 'Убрать из подсказок либо вернуть короб на палетсорт.',
    EMPTY: 'Убрать из подсказок и проверить физический остаток.',
    ARCHIVED: 'Исключить архивный короб из плана.',
    MISSING: 'Исключить отсутствующий короб из плана.',
  };
  return recommendations[state];
}
