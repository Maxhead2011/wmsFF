import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ClientRequestEventType,
  ClientRequestStatus,
  MovementType,
  Prisma,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import type { ResolveKizIssueDto } from './dto/resolve-kiz-issue.dto';
import type { WriteOffKizDiscrepancyDto } from './dto/write-off-kiz-discrepancy.dto';

const DUPLICATE_ACTION = 'FBS_KIZ_DUPLICATE_SCAN';
const BOX_EXHAUSTED_ACTION = 'FBS_KIZ_BOX_EXHAUSTED';
const LOCAL_STATUS_CONFLICT_ACTION = 'FBS_KIZ_LOCAL_STATUS_CONFLICT';
const ACCEPTED_SCAN_ACTION = 'FBS_KIZ_SCAN_ACCEPTED';
const RESOLVED_ACTION = 'FBS_KIZ_ISSUE_RESOLVED';
const READ_ACTION = 'FBS_KIZ_ISSUE_READ';
const DISCREPANCY_WRITE_OFF_ACTION = 'KIZ_BOX_DISCREPANCY_WRITTEN_OFF';
const BULK_DISCREPANCY_WRITE_OFF_ACTION =
  'KIZ_BOX_DISCREPANCY_BULK_WRITTEN_OFF';
const CLOSED_REQUEST_STATUSES: ClientRequestStatus[] = [
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
];

type KizIssueKind =
  | 'WB_REJECTED'
  | 'WB_SYNC_STUCK'
  | 'COMPLETED_WITHOUT_ACCEPTED_KIZ'
  | 'MARK_MISSING'
  | 'MARK_WRONG_CLIENT'
  | 'MARK_WRONG_SKU'
  | 'MARK_WRONG_BOX'
  | 'MARK_WRONG_STATUS'
  | 'LOCAL_STATUS_CONFLICT'
  | 'DUPLICATE_SCAN'
  | 'BOX_KIZ_EXHAUSTED';

type KizIssueRow = {
  issueKey: string;
  kind: KizIssueKind;
  status: 'OPEN' | 'RESOLVED';
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  explanation: string;
  detectedAt: string;
  isUnread: boolean;
  readAt: string | null;
  resolvedAt: string | null;
  resolution: {
    action: string;
    comment: string | null;
    userName: string | null;
  } | null;
  client: { id: string; code: string; name: string } | null;
  branch: { id: string; code: string; city: string; name: string } | null;
  request: {
    id: string;
    number: number;
    title: string;
    status: ClientRequestStatus;
  } | null;
  orderId: string | null;
  assemblyId: string | null;
  sku: {
    id: string;
    internalSku: string;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
  } | null;
  boxCode: string | null;
  kiz: string | null;
  wbMetaStatus: string | null;
  workerName: string | null;
  errorMessage: string | null;
  duplicate: {
    existingRequestNumber: number | null;
    existingOrderId: string | null;
    existingBoxCode: string | null;
    existingWorkerName: string | null;
    existingProduct: {
      internalSku: string | null;
      article: string | null;
      name: string | null;
      color: string | null;
      size: string | null;
    } | null;
  } | null;
  stockConflict: {
    availableQuantity: number;
    registeredKizCount: number;
    usedKizCount: number;
    usedAssignments: Array<{
      requestNumber: number | null;
      orderId: string | null;
      boxCode: string | null;
      status: string | null;
    }>;
  } | null;
  canReplace: boolean;
  allowedActions: Array<
    | 'REPLACE_KIZ'
    | 'REGISTER_EXTRA_UNIT'
    | 'PREPARE_EXTRA_UNIT'
    | 'RELEASE_BOX'
    | 'MARK_RESOLVED'
  >;
};

type BoxKizDiscrepancyRow = {
  boxId: string;
  boxCode: string;
  boxStatus: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseCity: string | null;
  warehouseName: string | null;
  skuId: string;
  internalSku: string;
  article: string | null;
  productName: string;
  color: string | null;
  size: string | null;
  boxQuantity: number;
  registeredKizCount: number;
  excessKizCount: number;
  protectedKizCount: number;
  removableKizCount: number;
  totalRows: number;
  totalExcessKiz: number;
  totalBlockedRows: number;
};

@Injectable()
export class KizIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplace: MarketplaceConnectionsService,
  ) {}

  async listBoxDiscrepancies(
    filter: {
      search?: string;
      clientId?: string;
      limit?: string;
      writableOnly?: boolean;
    },
    user: AuthUser,
  ) {
    const search = (filter.search ?? '').trim();
    const searchPattern = `%${search}%`;
    const clientId = (filter.clientId ?? '').trim();
    const warehouseId = user.activeWarehouseId ?? '';
    const writableOnly = filter.writableOnly === true;
    const limit = Math.min(
      1000,
      Math.max(25, Number.parseInt(filter.limit ?? '300', 10) || 300),
    );
    const rows = await this.prisma.$queryRaw<BoxKizDiscrepancyRow[]>(Prisma.sql`
      WITH balances AS (
        SELECT "boxId", "skuId", SUM(quantity)::int AS "boxQuantity"
        FROM "StockBalance"
        WHERE "boxId" IS NOT NULL AND quantity > 0
        GROUP BY "boxId", "skuId"
      ), mark_counts AS (
        SELECT "boxId", "skuId", COUNT(*)::int AS "registeredKizCount"
        FROM "ProductMark"
        WHERE "boxId" IS NOT NULL
        GROUP BY "boxId", "skuId"
      ), protected_counts AS (
        SELECT pm."boxId", pm."skuId", COUNT(DISTINCT pm.id)::int AS "protectedKizCount"
        FROM "ProductMark" pm
        JOIN "FbsTsdAssembly" task
          ON task."clientId" = pm."clientId"
         AND task."skuId" = pm."skuId"
         AND task.kiz = pm.value
         AND task.status <> 'RELEASED'
        JOIN "ClientRequest" request ON request.id = task."requestId"
        WHERE pm."boxId" IS NOT NULL
          AND request.status NOT IN ('DONE', 'CANCELLED', 'REJECTED')
        GROUP BY pm."boxId", pm."skuId"
      )
      SELECT
        box.id AS "boxId",
        box.code AS "boxCode",
        box.status AS "boxStatus",
        client.id AS "clientId",
        client.code AS "clientCode",
        client.name AS "clientName",
        warehouse.id AS "warehouseId",
        warehouse.code AS "warehouseCode",
        warehouse.city AS "warehouseCity",
        warehouse.name AS "warehouseName",
        sku.id AS "skuId",
        sku."internalSku" AS "internalSku",
        sku.article,
        sku.name AS "productName",
        sku.color,
        sku.size,
        COALESCE(balance."boxQuantity", 0)::int AS "boxQuantity",
        marks."registeredKizCount"::int AS "registeredKizCount",
        (marks."registeredKizCount" - COALESCE(balance."boxQuantity", 0))::int AS "excessKizCount",
        COALESCE(protected."protectedKizCount", 0)::int AS "protectedKizCount",
        (marks."registeredKizCount" - COALESCE(protected."protectedKizCount", 0))::int AS "removableKizCount",
        COUNT(*) OVER()::int AS "totalRows",
        SUM(marks."registeredKizCount" - COALESCE(balance."boxQuantity", 0)) OVER()::int AS "totalExcessKiz",
        SUM(
          CASE
            WHEN COALESCE(protected."protectedKizCount", 0) > COALESCE(balance."boxQuantity", 0)
            THEN 1 ELSE 0
          END
        ) OVER()::int AS "totalBlockedRows"
      FROM mark_counts marks
      LEFT JOIN balances balance
        ON balance."boxId" = marks."boxId" AND balance."skuId" = marks."skuId"
      LEFT JOIN protected_counts protected
        ON protected."boxId" = marks."boxId" AND protected."skuId" = marks."skuId"
      JOIN "Box" box ON box.id = marks."boxId"
      JOIN "Client" client ON client.id = box."clientId"
      JOIN "Sku" sku ON sku.id = marks."skuId"
      LEFT JOIN "Warehouse" warehouse ON warehouse.id = box."warehouseId"
      WHERE marks."registeredKizCount" > COALESCE(balance."boxQuantity", 0)
        AND (
          ${writableOnly} = false
          OR COALESCE(protected."protectedKizCount", 0) <= COALESCE(balance."boxQuantity", 0)
        )
        AND (${clientId} = '' OR client.id = ${clientId})
        AND (${warehouseId} = '' OR box."warehouseId" = ${warehouseId})
        AND (
          ${search} = ''
          OR box.code ILIKE ${searchPattern}
          OR client.code ILIKE ${searchPattern}
          OR client.name ILIKE ${searchPattern}
          OR sku."internalSku" ILIKE ${searchPattern}
          OR COALESCE(sku.article, '') ILIKE ${searchPattern}
          OR sku.name ILIKE ${searchPattern}
        )
      ORDER BY
        (marks."registeredKizCount" - COALESCE(balance."boxQuantity", 0)) DESC,
        client.name,
        box.code,
        sku."internalSku"
      LIMIT ${limit}
    `);
    const normalized = rows.map((row) => ({
      ...row,
      canWriteOff:
        row.excessKizCount > 0 &&
        row.removableKizCount >= row.excessKizCount &&
        row.protectedKizCount <= row.boxQuantity,
    }));
    return {
      generatedAt: new Date().toISOString(),
      activeWarehouseId: user.activeWarehouseId ?? null,
      summary: {
        rows: normalized[0]?.totalRows ?? 0,
        boxes: new Set(normalized.map((row) => row.boxId)).size,
        excessKiz: normalized[0]?.totalExcessKiz ?? 0,
        blockedRows: normalized[0]?.totalBlockedRows ?? 0,
      },
      discrepancies: normalized,
    };
  }

  async writeOffBoxDiscrepancy(
    boxIdValue: string,
    skuIdValue: string,
    dto: WriteOffKizDiscrepancyDto,
    user: AuthUser,
    options?: { bulkWriteOffId?: string },
  ) {
    const boxId = boxIdValue.trim();
    const skuId = skuIdValue.trim();
    if (!boxId || !skuId || dto.confirm !== true) {
      throw new BadRequestException('Подтвердите списание расхождения КИЗ.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [box, sku] = await Promise.all([
        tx.box.findUnique({
          where: { id: boxId },
          select: {
            id: true,
            code: true,
            status: true,
            clientId: true,
            warehouseId: true,
            client: { select: { code: true, name: true } },
            warehouse: { select: { code: true, city: true, name: true } },
          },
        }),
        tx.sku.findUnique({
          where: { id: skuId },
          select: {
            id: true,
            clientId: true,
            internalSku: true,
            article: true,
            name: true,
            color: true,
            size: true,
          },
        }),
      ]);
      if (!box || !sku || box.clientId !== sku.clientId) {
        throw new NotFoundException('Короб или товар для сверки КИЗ не найден.');
      }
      if (user.activeWarehouseId && box.warehouseId !== user.activeWarehouseId) {
        throw new BadRequestException('Короб относится к другому выбранному филиалу.');
      }

      const [balance, marks] = await Promise.all([
        tx.stockBalance.aggregate({
          where: { boxId, skuId, quantity: { gt: 0 } },
          _sum: { quantity: true },
        }),
        tx.productMark.findMany({
          where: { boxId, skuId },
          select: { id: true, value: true, status: true, createdAt: true, updatedAt: true },
          orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
      const boxQuantity = Math.max(0, balance._sum.quantity ?? 0);
      const excessKizCount = marks.length - boxQuantity;
      if (excessKizCount <= 0) {
        throw new BadRequestException(
          `Расхождения уже нет: в коробе ${boxQuantity} шт. и зарегистрировано ${marks.length} КИЗ.`,
        );
      }

      const markValues = marks.map((mark) => mark.value);
      const tasks = markValues.length
        ? await tx.fbsTsdAssembly.findMany({
            where: {
              clientId: box.clientId,
              skuId,
              kiz: { in: markValues },
              status: { not: 'RELEASED' },
            },
            select: { kiz: true, requestId: true, orderId: true, status: true },
          })
        : [];
      const requestIds = unique(tasks.map((task) => task.requestId));
      const requests = requestIds.length
        ? await tx.clientRequest.findMany({
            where: { id: { in: requestIds } },
            select: { id: true, number: true, status: true },
          })
        : [];
      const requestById = new Map(requests.map((request) => [request.id, request]));
      const protectedKiz = new Set(
        tasks
          .filter((task) => {
            const request = requestById.get(task.requestId);
            return Boolean(
              task.kiz &&
              request &&
              !CLOSED_REQUEST_STATUSES.includes(request.status),
            );
          })
          .map((task) => task.kiz!),
      );
      if (protectedKiz.size > boxQuantity) {
        throw new BadRequestException(
          `Списание заблокировано: в активных FBS-заказах занято ${protectedKiz.size} КИЗ, ` +
            `а в коробе числится ${boxQuantity} шт. Сначала исправьте активные заказы.`,
        );
      }

      const histories = markValues.length
        ? await tx.shippedKizHistory.findMany({
            where: { clientId: box.clientId, skuId, kiz: { in: markValues } },
            select: { kiz: true, requestNumber: true, orderId: true, shippedAt: true },
          })
        : [];
      const shippedByKiz = new Map(histories.map((history) => [history.kiz, history]));
      const closedTaskByKiz = new Map(
        tasks
          .filter((task) => {
            const request = requestById.get(task.requestId);
            return Boolean(task.kiz && request && CLOSED_REQUEST_STATUSES.includes(request.status));
          })
          .map((task) => [task.kiz!, task]),
      );
      const removable = marks
        .filter((mark) => !protectedKiz.has(mark.value))
        .sort((left, right) => {
          const leftScore = shippedByKiz.has(left.value)
            ? 0
            : closedTaskByKiz.has(left.value)
              ? 1
              : left.status !== StockStatus.AVAILABLE
                ? 2
                : 3;
          const rightScore = shippedByKiz.has(right.value)
            ? 0
            : closedTaskByKiz.has(right.value)
              ? 1
              : right.status !== StockStatus.AVAILABLE
                ? 2
                : 3;
          return leftScore - rightScore || left.updatedAt.getTime() - right.updatedAt.getTime();
        });
      if (removable.length < excessKizCount) {
        throw new BadRequestException(
          `Нельзя безопасно списать ${excessKizCount} КИЗ: свободно только ${removable.length}. ` +
            'Остальные коды заняты активными FBS-заказами.',
        );
      }
      const removed = removable.slice(0, excessKizCount);
      await tx.productMark.deleteMany({ where: { id: { in: removed.map((mark) => mark.id) } } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: DISCREPANCY_WRITE_OFF_ACTION,
          entity: 'BoxKizDiscrepancy',
          entityId: `${box.id}:${sku.id}`,
          payload: cleanJson({
            box: { id: box.id, code: box.code, status: box.status },
            warehouse: box.warehouse,
            client: { id: box.clientId, ...box.client },
            sku,
            boxQuantity,
            registeredKizBefore: marks.length,
            removedKizCount: removed.length,
            registeredKizAfter: marks.length - removed.length,
            protectedKizCount: protectedKiz.size,
            removedKiz: removed.map((mark) => ({
              value: printableKiz(mark.value),
              previousStatus: mark.status,
              shipped: shippedByKiz.has(mark.value),
              shipment: shippedByKiz.get(mark.value) ?? null,
              closedFbsOrder: closedTaskByKiz.get(mark.value)?.orderId ?? null,
            })),
            comment: dto.comment?.trim() || null,
            bulkWriteOffId: options?.bulkWriteOffId ?? null,
            writtenOffAt: new Date().toISOString(),
            writtenOffByName: user.name,
          }),
        },
      });
      return {
        boxId: box.id,
        boxCode: box.code,
        skuId: sku.id,
        internalSku: sku.internalSku,
        boxQuantity,
        registeredKizBefore: marks.length,
        writtenOffKiz: removed.length,
        registeredKizAfter: marks.length - removed.length,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      ...result,
      message:
        `Списано лишних КИЗ: ${result.writtenOffKiz}. ` +
        `В коробе ${result.boxCode} теперь ${result.registeredKizAfter} КИЗ на ${result.boxQuantity} шт. товара.`,
    };
  }

  async writeOffAllBoxDiscrepancies(
    filter: { search?: string; clientId?: string },
    dto: WriteOffKizDiscrepancyDto,
    user: AuthUser,
  ) {
    if (dto.confirm !== true) {
      throw new BadRequestException(
        'Подтвердите массовое списание расхождений КИЗ.',
      );
    }

    const bulkWriteOffId = randomUUID();
    const attempted = new Set<string>();
    const failures: Array<{
      boxId: string;
      boxCode: string;
      skuId: string;
      internalSku: string;
      message: string;
    }> = [];
    let processedRows = 0;
    let writtenOffKiz = 0;

    // Повторно читаем выдачу после каждой порции: операция может охватывать
    // больше лимита одной страницы, а остатки параллельно продолжают меняться.
    for (let pass = 0; pass < 25; pass += 1) {
      const report = await this.listBoxDiscrepancies(
        {
          ...filter,
          limit: '1000',
          writableOnly: true,
        },
        user,
      );
      const candidates = report.discrepancies.filter(
        (row) => !attempted.has(`${row.boxId}:${row.skuId}`),
      );
      if (candidates.length === 0) break;

      for (let offset = 0; offset < candidates.length; offset += 10) {
        const portion = candidates.slice(offset, offset + 10);
        const results = await Promise.allSettled(
          portion.map((row) => {
            attempted.add(`${row.boxId}:${row.skuId}`);
            return this.writeOffBoxDiscrepancy(
              row.boxId,
              row.skuId,
              {
                confirm: true,
                comment:
                  dto.comment?.trim() ||
                  'Массовое исправление расхождений КИЗ по коробам',
              },
              user,
              { bulkWriteOffId },
            );
          }),
        );
        results.forEach((result, index) => {
          const row = portion[index];
          if (result.status === 'fulfilled') {
            processedRows += 1;
            writtenOffKiz += result.value.writtenOffKiz;
            return;
          }
          failures.push({
            boxId: row.boxId,
            boxCode: row.boxCode,
            skuId: row.skuId,
            internalSku: row.internalSku,
            message:
              result.reason instanceof Error
                ? result.reason.message
                : 'Не удалось безопасно списать расхождение.',
          });
        });
      }
    }

    const remaining = await this.listBoxDiscrepancies(
      { ...filter, limit: '25' },
      user,
    );
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: BULK_DISCREPANCY_WRITE_OFF_ACTION,
        entity: 'BoxKizDiscrepancy',
        entityId: bulkWriteOffId,
        payload: cleanJson({
          bulkWriteOffId,
          filter: {
            search: filter.search?.trim() || null,
            clientId: filter.clientId?.trim() || null,
            warehouseId: user.activeWarehouseId ?? null,
          },
          processedRows,
          writtenOffKiz,
          failedRows: failures.length,
          failures: failures.slice(0, 100),
          remainingRows: remaining.summary.rows,
          remainingExcessKiz: remaining.summary.excessKiz,
          comment: dto.comment?.trim() || null,
          writtenOffAt: new Date().toISOString(),
          writtenOffByName: user.name,
        }),
      },
    });

    return {
      bulkWriteOffId,
      processedRows,
      writtenOffKiz,
      failedRows: failures.length,
      failures: failures.slice(0, 20),
      remainingRows: remaining.summary.rows,
      remainingExcessKiz: remaining.summary.excessKiz,
      message:
        failures.length === 0
          ? `Исправление завершено: списано ${writtenOffKiz} лишних КИЗ в ${processedRows} строках.`
          : `Списано ${writtenOffKiz} лишних КИЗ в ${processedRows} строках. Не удалось исправить: ${failures.length}.`,
    };
  }

  async list(
    filter: {
      status?: string;
      search?: string;
      clientId?: string;
      limit?: string;
    },
    user: AuthUser,
  ) {
    const status = ['open', 'resolved', 'all'].includes(
      (filter.status ?? '').toLowerCase(),
    )
      ? (filter.status ?? '').toLowerCase()
      : 'open';
    const search = (filter.search ?? '').trim().toLocaleLowerCase('ru-RU');
    const clientId = (filter.clientId ?? '').trim();
    const limit = Math.min(
      500,
      Math.max(25, Number.parseInt(filter.limit ?? '200', 10) || 200),
    );
    const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

    const requests = await this.prisma.clientRequest.findMany({
      where: {
        createdAt: { gte: since },
        ...(clientId ? { clientId } : {}),
        ...(user.activeWarehouseId
          ? { warehouseId: user.activeWarehouseId }
          : {}),
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        clientId: true,
        warehouse: {
          select: { id: true, code: true, city: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const requestById = new Map(
      requests.map((request) => [request.id, request]),
    );
    const requestIds = requests.map((request) => request.id);
    if (requestIds.length === 0) {
      return emptyReport(status, user.activeWarehouseId ?? null);
    }

    const [tasks, duplicateLogs, exhaustedLogs, localStatusConflictLogs] = await Promise.all([
      this.prisma.fbsTsdAssembly.findMany({
        where: {
          requestId: { in: requestIds },
          requiresKiz: true,
          updatedAt: { gte: since },
        },
        orderBy: { updatedAt: 'desc' },
        take: 1500,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: DUPLICATE_ACTION,
          createdAt: { gte: since },
        },
        select: {
          id: true,
          entityId: true,
          payload: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: BOX_EXHAUSTED_ACTION,
          createdAt: { gte: since },
        },
        select: {
          id: true,
          entityId: true,
          payload: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: LOCAL_STATUS_CONFLICT_ACTION,
          createdAt: { gte: since },
        },
        select: {
          id: true,
          entityId: true,
          payload: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    const clientIds = unique([
      ...requests.map((request) => request.clientId),
      ...tasks.map((task) => task.clientId),
    ]);
    const loggedSkuIds = [
      ...localStatusConflictLogs.flatMap((log) => {
        const payload = record(log.payload);
        const mark = record(payload.mark);
        const existing = record(payload.existing);
        return [text(mark.skuId), text(existing.skuId)];
      }),
      ...duplicateLogs.map((log) => {
        const existing = record(record(log.payload).existing);
        return text(existing.skuId);
      }),
    ].filter((value): value is string => Boolean(value));
    const skuIds = unique([
      ...tasks.map((task) => task.skuId),
      ...loggedSkuIds,
    ]);
    const boxIds = unique(
      tasks.map((task) => task.boxId).filter((value): value is string => Boolean(value)),
    );
    const kizValues = unique(
      tasks.map((task) => task.kiz).filter((value): value is string => Boolean(value)),
    );
    const conflictKizValues = unique(
      localStatusConflictLogs
        .map((log) => text(record(log.payload).kiz))
        .filter((value): value is string => Boolean(value)),
    );
    const loggedBoxIds = unique(
      localStatusConflictLogs
        .map((log) => text(record(record(log.payload).mark).boxId))
        .filter((value): value is string => Boolean(value)),
    );
    const [
      clients,
      skus,
      boxes,
      marks,
      shippedKizHistories,
      acceptedScanLogs,
      relatedMovements,
    ] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.sku.findMany({
        where: { id: { in: skuIds } },
        select: {
          id: true,
          internalSku: true,
          article: true,
          name: true,
          color: true,
          size: true,
        },
      }),
      this.prisma.box.findMany({
        where: { id: { in: boxIds } },
        select: { id: true, code: true },
      }),
      kizValues.length
        ? this.prisma.productMark.findMany({
            where: {
              value: {
                in: kizValues,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            select: {
              id: true,
              clientId: true,
              skuId: true,
              boxId: true,
              value: true,
              status: true,
              updatedAt: true,
            },
          })
        : [],
      conflictKizValues.length
        ? this.prisma.shippedKizHistory.findMany({
            where: {
              clientId: { in: clientIds },
              kiz: { in: conflictKizValues },
            },
            select: {
              assemblyId: true,
              requestId: true,
              requestNumber: true,
              orderId: true,
              skuId: true,
              internalSku: true,
              article: true,
              productName: true,
              color: true,
              size: true,
              kiz: true,
              sourceBoxCode: true,
              shippedAt: true,
            },
            orderBy: { shippedAt: 'desc' },
          })
        : [],
      conflictKizValues.length
        ? this.prisma.auditLog.findMany({
            where: {
              action: ACCEPTED_SCAN_ACTION,
              createdAt: { gte: since },
            },
            select: {
              entityId: true,
              payload: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 5000,
          })
        : [],
      loggedSkuIds.length && loggedBoxIds.length
        ? this.prisma.stockMovement.findMany({
            where: {
              clientId: { in: clientIds },
              skuId: { in: loggedSkuIds },
              boxId: { in: loggedBoxIds },
              sourceDocument: { in: requestIds },
              type: { in: [MovementType.PACK, MovementType.SHIP] },
              createdAt: { gte: since },
            },
            select: {
              clientId: true,
              skuId: true,
              boxId: true,
              sourceDocument: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 5000,
          })
        : [],
    ]);
    const clientById = new Map(clients.map((row) => [row.id, row]));
    const skuById = new Map(skus.map((row) => [row.id, row]));
    const boxById = new Map(boxes.map((row) => [row.id, row]));
    const markByValue = new Map(
      marks.map((row) => [row.value.toLocaleLowerCase('ru-RU'), row]),
    );
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const acceptedScans = acceptedScanLogs.map((log) => ({
      ...log,
      data: record(log.payload),
    }));

    const issues: KizIssueRow[] = [];
    for (const task of tasks) {
      const request = requestById.get(task.requestId) ?? null;
      const common = () => ({
        client: clientById.get(task.clientId) ?? null,
        branch: request?.warehouse ?? null,
        request: request
          ? {
              id: request.id,
              number: request.number,
              title: request.title,
              status: request.status,
            }
          : null,
        orderId: task.orderId,
        assemblyId: task.id,
        sku: skuById.get(task.skuId) ?? null,
        boxCode:
          task.boxCode ??
          (task.boxId ? boxById.get(task.boxId)?.code ?? null : null),
        kiz: task.kiz ? printableKiz(task.kiz) : null,
        wbMetaStatus: task.wbMetaStatus,
        workerName: task.workerName,
        errorMessage: task.errorMessage,
        duplicate: null,
        stockConflict: null,
        canReplace: canReplaceTask(task, request?.status),
        allowedActions: (
          canReplaceTask(task, request?.status)
            ? ['REPLACE_KIZ', 'MARK_RESOLVED']
            : ['MARK_RESOLVED']
        ) as KizIssueRow['allowedActions'],
      });

      if (task.wbMetaStatus === 'REJECTED') {
        issues.push(
          issue({
            issueKey: `task:${task.id}:WB_REJECTED`,
            kind: 'WB_REJECTED',
            severity: 'CRITICAL',
            title: 'Wildberries отклонил КИЗ',
            explanation:
              task.errorMessage ||
              'КИЗ не был принят Wildberries. Укажите корректный код и отправьте его повторно.',
            detectedAt: task.updatedAt,
            ...common(),
          }),
        );
      } else if (task.wbMetaStatus === 'REMOVING') {
        issues.push(
          issue({
            issueKey: `task:${task.id}:WB_SYNC_STUCK`,
            kind: 'WB_SYNC_STUCK',
            severity: 'WARNING',
            title: 'Удаление КИЗ не завершено',
            explanation:
              task.errorMessage ||
              'Синхронизация удаления КИЗ с Wildberries не завершилась.',
            detectedAt: task.updatedAt,
            ...common(),
          }),
        );
      }

      if (
        task.status === 'COMPLETED' &&
        (!task.kiz || task.wbMetaStatus !== 'ACCEPTED')
      ) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:COMPLETED_WITHOUT_ACCEPTED_KIZ`,
            kind: 'COMPLETED_WITHOUT_ACCEPTED_KIZ',
            severity: 'CRITICAL',
            title: 'Заказ отпикан без подтверждённого КИЗ',
            explanation:
              'Сборка завершена, но в WMS нет подтверждённого Wildberries КИЗ.',
            detectedAt: task.updatedAt,
            ...common(),
          }),
        );
      }

      if (request && CLOSED_REQUEST_STATUSES.includes(request.status)) {
        continue;
      }
      if (!task.kiz || task.wbMetaStatus !== 'ACCEPTED') continue;
      const mark = markByValue.get(task.kiz.toLocaleLowerCase('ru-RU'));
      if (!mark) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:MARK_MISSING`,
            kind: 'MARK_MISSING',
            severity: 'CRITICAL',
            title: 'КИЗ принят WB, но отсутствует в WMS',
            explanation:
              'КИЗ есть в отпиканном заказе, но его регистрация в остатках WMS не найдена.',
            detectedAt: task.updatedAt,
            ...common(),
          }),
        );
        continue;
      }
      if (mark.clientId !== task.clientId) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:MARK_WRONG_CLIENT`,
            kind: 'MARK_WRONG_CLIENT',
            severity: 'CRITICAL',
            title: 'КИЗ относится к другому клиенту',
            explanation:
              'Отпиканный КИЗ зарегистрирован в WMS у другого клиента.',
            detectedAt: later(task.updatedAt, mark.updatedAt),
            ...common(),
          }),
        );
      } else if (mark.skuId !== task.skuId) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:MARK_WRONG_SKU`,
            kind: 'MARK_WRONG_SKU',
            severity: 'CRITICAL',
            title: 'КИЗ относится к другому товару',
            explanation:
              'SKU отпиканного заказа не совпадает с SKU регистрации КИЗ в WMS.',
            detectedAt: later(task.updatedAt, mark.updatedAt),
            ...common(),
          }),
        );
      } else if (mark.boxId !== task.boxId) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:MARK_WRONG_BOX`,
            kind: 'MARK_WRONG_BOX',
            severity: 'WARNING',
            title: 'КИЗ числится в другом коробе',
            explanation:
              'Фактический короб отбора не совпадает с коробом, записанным у КИЗ в WMS.',
            detectedAt: later(task.updatedAt, mark.updatedAt),
            ...common(),
          }),
        );
      }
      if (mark.status !== StockStatus.AVAILABLE) {
        issues.push(
          issue({
            issueKey: `task:${task.id}:MARK_WRONG_STATUS`,
            kind: 'MARK_WRONG_STATUS',
            severity: 'WARNING',
            title: 'Статус КИЗ не соответствует сборке',
            explanation: `Текущий статус КИЗ в WMS: ${mark.status}.`,
            detectedAt: later(task.updatedAt, mark.updatedAt),
            ...common(),
          }),
        );
      }
    }

    const seenLocalStatusConflicts = new Set<string>();
    for (const log of localStatusConflictLogs) {
      const payload = record(log.payload);
      const assemblyId = text(payload.assemblyId);
      const scannedKiz = text(payload.kiz);
      const deduplicationKey = `${assemblyId}|${scannedKiz.toLocaleLowerCase('ru-RU')}`;
      if (!assemblyId || seenLocalStatusConflicts.has(deduplicationKey)) {
        continue;
      }
      seenLocalStatusConflicts.add(deduplicationKey);

      const requestId = text(payload.requestId) || log.entityId || '';
      const request = requestById.get(requestId);
      if (!request || log.entityId !== requestId) continue;
      const task = taskById.get(assemblyId);
      if (!task) continue;

      const mark = record(payload.mark);
      const existing = record(payload.existing);
      const conflictType = text(payload.conflictType);
      const isWrongSku = conflictType === 'WRONG_SKU';
      const detectedAt =
        validDate(text(payload.detectedAt)) ?? log.createdAt;
      const existingAssemblyId = text(existing.assemblyId);
      const existingTask = existingAssemblyId
        ? taskById.get(existingAssemblyId)
        : null;
      const normalizedKiz = scannedKiz.toLocaleLowerCase('ru-RU');
      const shippedHistory = shippedKizHistories.find(
        (row) =>
          row.kiz.toLocaleLowerCase('ru-RU') === normalizedKiz &&
          row.shippedAt <= detectedAt,
      );
      const acceptedScan = acceptedScans.find(
        (row) =>
          text(row.data.kiz).toLocaleLowerCase('ru-RU') === normalizedKiz &&
          row.createdAt <= detectedAt &&
          text(row.data.assemblyId) !== assemblyId,
      );
      const movement = relatedMovements.find(
        (row) =>
          row.clientId === request.clientId &&
          row.skuId === text(mark.skuId) &&
          row.boxId === text(mark.boxId) &&
          row.createdAt <= detectedAt,
      );
      const acceptedRequest = requestById.get(
        text(acceptedScan?.data.requestId),
      );
      const movementRequest = requestById.get(
        movement?.sourceDocument ?? '',
      );
      const existingSku =
        (existingTask ? skuById.get(existingTask.skuId) : null) ??
        (text(existing.skuId) ? skuById.get(text(existing.skuId)) : null) ??
        (shippedHistory ? skuById.get(shippedHistory.skuId) : null) ??
        (text(mark.skuId) ? skuById.get(text(mark.skuId)) : null);
      const canReplace = canReplaceTask(task, request.status);
      issues.push(
        issue({
          issueKey: `local:${log.id}:${assemblyId}`,
          kind: isWrongSku ? 'MARK_WRONG_SKU' : 'LOCAL_STATUS_CONFLICT',
          severity: 'CRITICAL',
          title: isWrongSku
            ? 'КИЗ относится к другому товару'
            : 'КИЗ уже находится в сборке или был отгружен',
          explanation:
            text(payload.message) ||
            (isWrongSku
              ? 'SKU задания не совпадает с товаром, к которому КИЗ зарегистрирован в WMS.'
              : 'Отсканированный КИЗ имеет занятый или отгруженный статус в WMS. Требуется решение администратора.'),
          detectedAt,
          client: clientById.get(request.clientId) ?? null,
          branch: request.warehouse,
          request: {
            id: request.id,
            number: request.number,
            title: request.title,
            status: request.status,
          },
          orderId: text(payload.orderId) || task.orderId,
          assemblyId,
          sku: skuById.get(task.skuId) ?? null,
          boxCode: text(payload.boxCode) || task.boxCode || null,
          kiz: scannedKiz ? printableKiz(scannedKiz) : null,
          wbMetaStatus: task.wbMetaStatus,
          workerName: task.workerName,
          errorMessage: text(mark.status)
            ? `Текущий статус КИЗ в WMS: ${text(mark.status)}.`
            : null,
          duplicate: {
            existingRequestNumber:
              number(existing.requestNumber) ??
              shippedHistory?.requestNumber ??
              acceptedRequest?.number ??
              movementRequest?.number ??
              null,
            existingOrderId:
              text(existing.orderId) ||
              shippedHistory?.orderId ||
              text(acceptedScan?.data.orderId) ||
              null,
            existingBoxCode:
              text(existing.boxCode) ||
              shippedHistory?.sourceBoxCode ||
              text(acceptedScan?.data.boxCode) ||
              text(mark.boxCode) ||
              null,
            existingWorkerName: text(existing.workerName) || null,
            existingProduct: existingSku
              ? {
                  internalSku: existingSku.internalSku,
                  article: existingSku.article,
                  name: existingSku.name,
                  color: existingSku.color,
                  size: existingSku.size,
                }
              : existingTask || text(mark.productName)
                ? {
                  internalSku: null,
                  article:
                      existingTask?.article ||
                      text(existing.article) ||
                      shippedHistory?.article ||
                      text(mark.article) ||
                      null,
                  name:
                      existingTask?.productName ||
                      text(existing.productName) ||
                      shippedHistory?.productName ||
                      text(mark.productName) ||
                      null,
                    color:
                      shippedHistory?.color ||
                      text(mark.color) ||
                      null,
                    size:
                      shippedHistory?.size ||
                      text(mark.size) ||
                      null,
                  }
                : null,
          },
          stockConflict: null,
          canReplace,
          allowedActions: (
            canReplace
              ? ['REPLACE_KIZ', 'MARK_RESOLVED']
              : ['MARK_RESOLVED']
          ) as KizIssueRow['allowedActions'],
        }),
      );
    }

    for (const log of duplicateLogs) {
      const payload = record(log.payload);
      const attempt = record(payload.attempt);
      const existing = record(payload.existing);
      const requestId = text(attempt.requestId) || text(payload.requestId);
      const request = requestById.get(requestId);
      if (!request || log.entityId !== requestId) continue;
      const assemblyId = text(attempt.assemblyId);
      const task = taskById.get(assemblyId);
      const detectedAt =
        validDate(text(payload.detectedAt)) ?? log.createdAt;
      issues.push(
        issue({
          issueKey: `duplicate:${log.id}:${assemblyId || 'none'}`,
          kind: 'DUPLICATE_SCAN',
          severity: 'CRITICAL',
          title: 'Один КИЗ отсканирован повторно',
          explanation:
            'КИЗ уже связан с другим FBS-заказом. Проверьте обе физические единицы и укажите корректный КИЗ.',
          detectedAt,
          client: clientById.get(request.clientId) ?? null,
          branch: request.warehouse,
          request: {
            id: request.id,
            number: request.number,
            title: request.title,
            status: request.status,
          },
          orderId: text(attempt.orderId) || null,
          assemblyId: assemblyId || null,
          sku: task ? skuById.get(task.skuId) ?? null : null,
          boxCode: text(attempt.boxCode) || null,
          kiz: text(payload.kiz) || null,
          wbMetaStatus: task?.wbMetaStatus ?? null,
          workerName: text(attempt.workerName) || task?.workerName || null,
          errorMessage: null,
          duplicate: {
            existingRequestNumber: number(existing.requestNumber),
            existingOrderId: text(existing.orderId) || null,
            existingBoxCode: text(existing.boxCode) || null,
            existingWorkerName: text(existing.workerName) || null,
            existingProduct: (() => {
              const existingAssemblyId = text(existing.assemblyId);
              const existingTask = existingAssemblyId
                ? taskById.get(existingAssemblyId)
                : null;
              const existingSku = existingTask
                ? skuById.get(existingTask.skuId)
                : text(existing.skuId)
                  ? skuById.get(text(existing.skuId))
                  : null;
              return existingSku
                ? {
                    internalSku: existingSku.internalSku,
                    article: existingSku.article,
                    name: existingSku.name,
                    color: existingSku.color,
                    size: existingSku.size,
                  }
                  : existingTask ||
                      text(existing.productName) ||
                      text(existing.article)
                  ? {
                      internalSku: null,
                      article:
                        existingTask?.article ||
                        text(existing.article) ||
                        null,
                      name:
                        existingTask?.productName ||
                        text(existing.productName) ||
                        null,
                      color: null,
                      size: null,
                    }
                  : null;
            })(),
          },
          stockConflict: null,
          canReplace: Boolean(task && canReplaceTask(task, request.status)),
          allowedActions: (
            task && canReplaceTask(task, request.status)
              ? ['REPLACE_KIZ', 'MARK_RESOLVED']
              : ['MARK_RESOLVED']
          ) as KizIssueRow['allowedActions'],
        }),
      );
    }

    for (const log of exhaustedLogs) {
      const payload = record(log.payload);
      const assemblyId = text(payload.assemblyId) || log.entityId || '';
      const task = taskById.get(assemblyId);
      const requestId = text(payload.requestId) || task?.requestId || '';
      const request = requestById.get(requestId);
      if (!task || !request || task.kiz || task.status !== 'IN_PROGRESS') {
        continue;
      }
      const detectedAt =
        validDate(text(payload.detectedAt)) ?? log.createdAt;
      const usedAssignments = Array.isArray(payload.usedAssignments)
        ? payload.usedAssignments.map((value) => record(value))
        : [];
      const issueBoxCode = text(payload.boxCode) || task.boxCode || '';
      const boxAssignments = usedAssignments.filter(
        (assignment) => text(assignment.boxCode) === issueBoxCode,
      );
      const relevantAssignments =
        boxAssignments.length > 0 ? boxAssignments : usedAssignments;
      const registeredKizCount = number(payload.registeredMarks) ?? 0;
      const canFix = canFixBoxExhaustion(task, request.status);
      issues.push(
        issue({
          issueKey: `exhausted:${assemblyId}`,
          kind: 'BOX_KIZ_EXHAUSTED',
          severity: 'CRITICAL',
          title: 'В коробе закончились свободные КИЗ',
          explanation:
            'Физический товар отсканирован, но весь учтённый остаток и зарегистрированные КИЗ этого товара уже заняты другими FBS-заказами.',
          detectedAt,
          client: clientById.get(request.clientId) ?? null,
          branch: request.warehouse,
          request: {
            id: request.id,
            number: request.number,
            title: request.title,
            status: request.status,
          },
          orderId: text(payload.orderId) || task.orderId,
          assemblyId,
          sku: skuById.get(task.skuId) ?? null,
          boxCode: issueBoxCode || null,
          kiz: text(payload.scannedKiz) || null,
          wbMetaStatus: task.wbMetaStatus,
          workerName: text(payload.workerName) || task.workerName,
          errorMessage:
            'Система не стала самовольно увеличивать остаток. Решение должен выбрать администратор.',
          duplicate: null,
          stockConflict: {
            availableQuantity: number(payload.availableQuantity) ?? 0,
            registeredKizCount,
            usedKizCount: Math.min(
              registeredKizCount,
              relevantAssignments.length,
            ),
            usedAssignments: relevantAssignments.map((assignment) => {
              const relatedRequest = requestById.get(text(assignment.requestId));
              return {
                requestNumber: relatedRequest?.number ?? null,
                orderId: text(assignment.orderId) || null,
                boxCode: text(assignment.boxCode) || null,
                status: text(assignment.status) || null,
              };
            }),
          },
          canReplace: false,
          allowedActions: canFix
            ? [
                'PREPARE_EXTRA_UNIT',
                ...(task.boxId ? ['RELEASE_BOX' as const] : []),
                'MARK_RESOLVED',
              ]
            : ['MARK_RESOLVED'],
        }),
      );
    }

    const issueKeys = unique(issues.map((row) => row.issueKey));
    const [resolutions, reads] = issueKeys.length
      ? await Promise.all([
          this.prisma.auditLog.findMany({
          where: {
            action: RESOLVED_ACTION,
            entity: 'FbsKizIssue',
            entityId: { in: issueKeys },
          },
          select: {
            entityId: true,
            payload: true,
            createdAt: true,
            user: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          }),
          this.prisma.auditLog.findMany({
            where: {
              action: READ_ACTION,
              entity: 'FbsKizIssue',
              entityId: { in: issueKeys },
            },
            select: {
              entityId: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [[], []];
    const resolutionByKey = new Map<
      string,
      (typeof resolutions)[number]
    >();
    resolutions.forEach((row) => {
      if (row.entityId && !resolutionByKey.has(row.entityId)) {
        resolutionByKey.set(row.entityId, row);
      }
    });
    const readByKey = new Map<string, Date>();
    reads.forEach((row) => {
      if (row.entityId && !readByKey.has(row.entityId)) {
        readByKey.set(row.entityId, row.createdAt);
      }
    });
    issues.forEach((row) => {
      const readAt = readByKey.get(row.issueKey);
      if (readAt && readAt >= new Date(row.detectedAt)) {
        row.isUnread = false;
        row.readAt = readAt.toISOString();
      }
      const resolution = resolutionByKey.get(row.issueKey);
      if (!resolution || resolution.createdAt < new Date(row.detectedAt)) return;
      const payload = record(resolution.payload);
      row.status = 'RESOLVED';
      row.resolvedAt = resolution.createdAt.toISOString();
      row.resolution = {
        action: text(payload.action) || 'MARK_RESOLVED',
        comment: text(payload.comment) || null,
        userName: resolution.user?.name ?? null,
      };
    });

    const deduplicated = deduplicateIssues(issues).sort(
      (left, right) =>
        Number(right.status === 'OPEN') - Number(left.status === 'OPEN') ||
        Number(right.severity === 'CRITICAL') -
          Number(left.severity === 'CRITICAL') ||
        right.detectedAt.localeCompare(left.detectedAt),
    );
    const summary = {
      all: deduplicated.length,
      open: deduplicated.filter((row) => row.status === 'OPEN').length,
      critical: deduplicated.filter(
        (row) => row.status === 'OPEN' && row.severity === 'CRITICAL',
      ).length,
      warning: deduplicated.filter(
        (row) => row.status === 'OPEN' && row.severity === 'WARNING',
      ).length,
      unread: deduplicated.filter(
        (row) => row.status === 'OPEN' && row.isUnread,
      ).length,
      resolved: deduplicated.filter((row) => row.status === 'RESOLVED').length,
    };
    const visible = deduplicated
      .filter((row) =>
        status === 'all'
          ? true
          : status === 'resolved'
            ? row.status === 'RESOLVED'
            : row.status === 'OPEN',
      )
      .filter((row) => !search || issueSearchText(row).includes(search))
      .slice(0, limit);

    return {
      generatedAt: new Date().toISOString(),
      activeWarehouseId: user.activeWarehouseId ?? null,
      status,
      summary,
      issues: visible,
    };
  }

  async resolve(
    issueKeyValue: string,
    dto: ResolveKizIssueDto,
    user: AuthUser,
  ) {
    const issueKey = decodeURIComponent(issueKeyValue).trim();
    if (!issueKey) throw new BadRequestException('Не указана проблема КИЗ.');

    const assemblyId = issueAssemblyId(issueKey);
    if (
      dto.action === 'REPLACE_KIZ' ||
      dto.action === 'REGISTER_EXTRA_UNIT'
    ) {
      if (!assemblyId) {
        throw new BadRequestException(
          'Для этой проблемы нет задания FBS, в котором можно заменить КИЗ.',
        );
      }
      const newKiz = (dto.kiz ?? '').trim();
      if (newKiz.length < 16 || newKiz.length > 135) {
        throw new BadRequestException(
          'Укажите корректный КИЗ Data Matrix длиной от 16 до 135 символов.',
        );
      }
      if (dto.action === 'REGISTER_EXTRA_UNIT') {
        if (!issueKey.startsWith('exhausted:')) {
          throw new BadRequestException(
            'Подтверждение дополнительной единицы доступно только для конфликта остатка в коробе.',
          );
        }
        await this.registerExtraUnit(
          assemblyId,
          newKiz,
          dto.comment,
          user,
        );
      } else {
        await this.replaceKiz(
          assemblyId,
          newKiz,
          dto.confirmBoxMove === true,
          dto.comment,
          user,
        );
      }
    } else if (dto.action === 'PREPARE_EXTRA_UNIT') {
      if (!assemblyId || !issueKey.startsWith('exhausted:')) {
        throw new BadRequestException(
          'Подтверждение физической единицы доступно только для конфликта остатка КИЗ.',
        );
      }
      await this.prepareExtraUnitForRescan(
        assemblyId,
        dto.comment,
        user,
      );
    } else if (dto.action === 'RELEASE_BOX') {
      if (!assemblyId || !issueKey.startsWith('exhausted:')) {
        throw new BadRequestException(
          'Смена короба доступна только для конфликта остатка в коробе.',
        );
      }
      await this.releaseBox(assemblyId, dto.comment, user);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: RESOLVED_ACTION,
        entity: 'FbsKizIssue',
        entityId: issueKey,
        payload: cleanJson({
          action: dto.action,
          comment: dto.comment?.trim() || null,
          assemblyId,
          kiz:
            dto.action === 'REPLACE_KIZ' ||
            dto.action === 'REGISTER_EXTRA_UNIT'
              ? printableKiz(dto.kiz ?? '')
              : null,
          resolvedAt: new Date().toISOString(),
          resolvedByName: user.name,
        }),
      },
    });

    return {
      issueKey,
      resolved: true,
      action: dto.action,
      message: resolutionMessage(dto.action),
    };
  }

  async markRead(issueKeyValue: string, user: AuthUser) {
    const issueKey = decodeURIComponent(issueKeyValue).trim();
    if (!issueKey) throw new BadRequestException('Не указана проблема КИЗ.');
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: READ_ACTION,
        entity: 'FbsKizIssue',
        entityId: issueKey,
        payload: cleanJson({
          readAt: new Date().toISOString(),
          readByName: user.name,
          activeWarehouseId: user.activeWarehouseId ?? null,
        }),
      },
    });
    return { issueKey, read: true };
  }

  private async registerExtraUnit(
    assemblyId: string,
    kiz: string,
    comment: string | undefined,
    user: AuthUser,
  ) {
    const task = await this.prisma.fbsTsdAssembly.findUnique({
      where: { id: assemblyId },
    });
    if (!task) throw new NotFoundException('Задание FBS не найдено.');
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: task.requestId },
      select: { id: true, number: true, status: true, warehouseId: true },
    });
    assertKizAdminTask(task, request, user);
    if (task.status !== 'IN_PROGRESS' || task.kiz) {
      throw new BadRequestException(
        'Задание уже изменилось. Обновите раздел «КИЗ» и проверьте его состояние.',
      );
    }
    const box = await this.prisma.box.findUnique({
      where: { id: task.boxId! },
      select: { id: true, code: true, palletId: true, warehouseId: true },
    });
    if (!box) throw new BadRequestException('Короб задания не найден.');

    const warehouseId = box.warehouseId ?? request?.warehouseId ?? null;
    if (!warehouseId) {
      throw new BadRequestException('Не удалось определить филиал физической единицы.');
    }
    const adjustmentId = randomUUID();
    const balanceKey = kizBalanceKey(
      task.clientId,
      task.skuId,
      box.id,
      box.palletId,
      warehouseId,
    );
    const adjusted = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.fbsTsdAssembly.findUnique({
        where: { id: task.id },
      });
      if (!fresh || fresh.status !== 'IN_PROGRESS' || fresh.kiz) {
        throw new BadRequestException(
          'Задание уже изменилось. Обновите раздел «КИЗ».',
        );
      }
      const [available, registeredMarks] = await Promise.all([
        tx.stockBalance.aggregate({
          where: {
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: box.id,
            status: StockStatus.AVAILABLE,
          },
          _sum: { quantity: true },
        }),
        tx.productMark.count({
          where: {
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: box.id,
            status: StockStatus.AVAILABLE,
          },
        }),
      ]);
      if ((available._sum.quantity ?? 0) > registeredMarks) return false;
      await tx.stockBalance.upsert({
        where: { balanceKey },
        update: { warehouseId, quantity: { increment: 1 } },
        create: {
          balanceKey,
          warehouseId,
          clientId: fresh.clientId,
          skuId: fresh.skuId,
          boxId: box.id,
          palletId: box.palletId,
          status: StockStatus.AVAILABLE,
          quantity: 1,
        },
      });
      await tx.stockMovement.create({
        data: {
          warehouseId,
          clientId: fresh.clientId,
          skuId: fresh.skuId,
          boxId: box.id,
          palletId: box.palletId,
          type: MovementType.INVENTORY_ADJUSTMENT,
          status: StockStatus.AVAILABLE,
          quantity: 1,
          sourceDocument: `КИЗ: заявка №${request!.number}, заказ WB ${fresh.orderId}`,
          idempotencyKey: `kiz-extra:${adjustmentId}:increase`,
          comment:
            `Администратор ${user.name} подтвердил дополнительную физическую единицу в коробе ${box.code}` +
            `${comment?.trim() ? `; ${comment.trim()}` : ''}.`,
        },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const adminAsTaskOwner: AuthUser = {
      ...user,
      deviceCode: task.deviceCode,
    };
    try {
      await this.marketplace.scanFbsTsdKiz(
        task.id,
        { kiz, confirmBoxMove: true },
        adminAsTaskOwner,
      );
      await this.marketplace.completeFbsTsdAssembly(
        task.id,
        adminAsTaskOwner,
      );
      await this.prisma.clientRequestEvent.create({
        data: {
          requestId: task.requestId,
          clientId: task.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Проблема КИЗ исправлена администратором',
          body:
            `Подтверждена дополнительная единица в коробе ${box.code}; ` +
            `КИЗ принят для заказа WB ${task.orderId}; администратор ${user.name}.`,
          createdByUserId: user.id,
        },
      });
    } catch (caught) {
      if (adjusted) {
        await this.rollbackExtraUnit(
          task,
          box,
          balanceKey,
          adjustmentId,
          caught,
          user,
        );
      }
      throw caught;
    }
  }

  private async prepareExtraUnitForRescan(
    assemblyId: string,
    comment: string | undefined,
    user: AuthUser,
  ) {
    const task = await this.prisma.fbsTsdAssembly.findUnique({
      where: { id: assemblyId },
    });
    if (!task) throw new NotFoundException('Задание FBS не найдено.');
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: task.requestId },
      select: { id: true, number: true, status: true, warehouseId: true },
    });
    assertKizAdminTask(task, request, user);
    if (task.status !== 'IN_PROGRESS' || task.kiz) {
      throw new BadRequestException(
        'Задание уже изменилось. Обновите раздел «КИЗ» и проверьте его состояние.',
      );
    }

    const box = task.boxId
      ? await this.prisma.box.findUnique({
          where: { id: task.boxId },
          select: { id: true, code: true, palletId: true, warehouseId: true },
        })
      : null;
    if (!box && !isKizNoBoxTask(task)) {
      throw new BadRequestException('Источник товара в задании больше не доступен.');
    }

    const sourceBoxId = box?.id ?? null;
    const sourcePalletId = box?.palletId ?? null;
    const sourceLabel = box?.code ?? 'хранении без коробов';
    const warehouseId = box?.warehouseId ?? request?.warehouseId ?? null;
    if (!warehouseId) {
      throw new BadRequestException(
        'Не удалось определить филиал остатка без короба. Обновите филиал заявки.',
      );
    }
    const adjustmentId = randomUUID();
    const balanceKey = kizBalanceKey(
      task.clientId,
      task.skuId,
      sourceBoxId,
      sourcePalletId,
      warehouseId,
    );
    const adjusted = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.fbsTsdAssembly.findUnique({
        where: { id: task.id },
      });
      if (!fresh || fresh.status !== 'IN_PROGRESS' || fresh.kiz) {
        throw new BadRequestException(
          'Задание уже изменилось. Обновите раздел «КИЗ».',
        );
      }
      const [available, registeredMarks] = await Promise.all([
        tx.stockBalance.aggregate({
          where: {
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: sourceBoxId,
            status: StockStatus.AVAILABLE,
          },
          _sum: { quantity: true },
        }),
        tx.productMark.count({
          where: {
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: sourceBoxId,
            status: StockStatus.AVAILABLE,
          },
        }),
      ]);
      const needsAdjustment =
        (available._sum.quantity ?? 0) <= registeredMarks;
      if (needsAdjustment) {
        await tx.stockBalance.upsert({
          where: { balanceKey },
          update: { warehouseId, quantity: { increment: 1 } },
          create: {
            balanceKey,
            warehouseId,
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: sourceBoxId,
            palletId: sourcePalletId,
            status: StockStatus.AVAILABLE,
            quantity: 1,
          },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId,
            clientId: fresh.clientId,
            skuId: fresh.skuId,
            boxId: sourceBoxId,
            palletId: sourcePalletId,
            type: MovementType.INVENTORY_ADJUSTMENT,
            status: StockStatus.AVAILABLE,
            quantity: 1,
            sourceDocument: `КИЗ: заявка №${request!.number}, заказ WB ${fresh.orderId}`,
            idempotencyKey: `kiz-extra-rescan:${adjustmentId}:increase`,
            comment:
              `Администратор ${user.name} подтвердил физическую единицу в ${sourceLabel} для повторного сканирования КИЗ` +
              `${comment?.trim() ? `; ${comment.trim()}` : ''}.`,
          },
        });
      }
      await tx.fbsTsdAssembly.update({
        where: { id: fresh.id },
        data: {
          kiz: null,
          wbMetaStatus: 'PENDING',
          errorMessage: null,
        },
      });
      return needsAdjustment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.prisma.clientRequestEvent.create({
      data: {
        requestId: task.requestId,
        clientId: task.clientId,
        eventType: ClientRequestEventType.COMMENT,
        title: 'Разрешено повторное сканирование КИЗ',
        body:
          `${adjusted ? 'Добавлена одна подтверждённая физическая единица' : 'Свободная физическая единица уже была учтена'} в ${sourceLabel}; ` +
          `заказ WB ${task.orderId}; сотрудник должен повторно отсканировать фактический КИЗ; администратор ${user.name}.`,
        createdByUserId: user.id,
      },
    });
  }

  private async rollbackExtraUnit(
    task: Prisma.FbsTsdAssemblyGetPayload<{}>,
    box: { id: string; code: string; palletId: string | null },
    balanceKey: string,
    adjustmentId: string,
    caught: unknown,
    user: AuthUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.findUnique({
        where: { balanceKey },
      });
      if (balance) {
        if (balance.quantity <= 1) {
          await tx.stockBalance.delete({ where: { id: balance.id } });
        } else {
          await tx.stockBalance.update({
            where: { id: balance.id },
            data: { quantity: { decrement: 1 } },
          });
        }
      }
      await tx.stockMovement.create({
        data: {
          clientId: task.clientId,
          skuId: task.skuId,
          boxId: box.id,
          palletId: box.palletId,
          type: MovementType.INVENTORY_ADJUSTMENT,
          status: StockStatus.AVAILABLE,
          quantity: -1,
          sourceDocument: `КИЗ: откат заказа WB ${task.orderId}`,
          idempotencyKey: `kiz-extra:${adjustmentId}:rollback`,
          comment:
            `Откат подтверждения дополнительной единицы: ${caught instanceof Error ? caught.message : 'ошибка исправления КИЗ'}; администратор ${user.name}.`,
        },
      });
    });
  }

  private async releaseBox(
    assemblyId: string,
    comment: string | undefined,
    user: AuthUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.fbsTsdAssembly.findUnique({
        where: { id: assemblyId },
      });
      if (!task) throw new NotFoundException('Задание FBS не найдено.');
      const request = await tx.clientRequest.findUnique({
        where: { id: task.requestId },
        select: { id: true, number: true, status: true, warehouseId: true },
      });
      assertKizAdminTask(task, request, user);
      if (task.status !== 'IN_PROGRESS' || task.kiz) {
        throw new BadRequestException(
          'Сменить короб можно только у незавершённого задания без принятого КИЗ.',
        );
      }
      const previousBoxCode = task.boxCode ?? 'без номера';
      const selection = await tx.clientRequestBoxSelection.findUnique({
        where: {
          requestItemId_boxId: {
            requestItemId: task.requestItemId,
            boxId: task.boxId!,
          },
        },
      });
      if (selection) {
        if (selection.quantity <= task.itemCount) {
          await tx.clientRequestBoxSelection.delete({
            where: { id: selection.id },
          });
        } else {
          await tx.clientRequestBoxSelection.update({
            where: { id: selection.id },
            data: { quantity: { decrement: task.itemCount } },
          });
        }
      }
      await tx.fbsTsdAssembly.update({
        where: { id: task.id },
        data: {
          boxId: null,
          boxCode: null,
          sourceBarcode: null,
          barcode: null,
          relabelConfirmedAt: null,
          errorMessage:
            'Администратор снял проблемный короб. На ТСД выберите другой короб.',
        },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: task.requestId,
          clientId: task.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Смена короба из раздела «КИЗ»',
          body:
            `Для заказа WB ${task.orderId} снят короб ${previousBoxCode}; ` +
            `на ТСД требуется выбрать другой короб; администратор ${user.name}` +
            `${comment?.trim() ? `; комментарий: ${comment.trim()}` : ''}.`,
          createdByUserId: user.id,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async replaceKiz(
    assemblyId: string,
    newKiz: string,
    confirmBoxMove: boolean,
    comment: string | undefined,
    user: AuthUser,
  ) {
    let task = await this.prisma.fbsTsdAssembly.findUnique({
      where: { id: assemblyId },
    });
    if (!task) throw new NotFoundException('Задание FBS не найдено.');
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: task.requestId },
      select: { id: true, number: true, status: true, warehouseId: true },
    });
    if (!request || CLOSED_REQUEST_STATUSES.includes(request.status)) {
      throw new BadRequestException(
        'Заявка уже закрыта. КИЗ можно исправить только до закрытия заявки.',
      );
    }
    if (
      user.activeWarehouseId &&
      request.warehouseId !== user.activeWarehouseId
    ) {
      throw new BadRequestException(
        'Проблема относится к другому городу. Переключите филиал и повторите.',
      );
    }
    if (!task.boxId || !task.barcode) {
      throw new BadRequestException(
        'Сначала на ТСД должны быть подтверждены короб и штрихкод товара.',
      );
    }
    if (task.cargoPackedAt) {
      throw new BadRequestException(
        'Заказ уже уложен в грузоместо. Сначала отмените упаковку грузоместа.',
      );
    }

    const adminAsTaskOwner: AuthUser = {
      ...user,
      deviceCode: task.deviceCode,
    };
    if (task.status === 'COMPLETED') {
      await this.reopenCompletedTask(task, request.number, comment, user);
      task = (await this.prisma.fbsTsdAssembly.findUnique({
        where: { id: task.id },
      }))!;
    } else if (task.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Задание имеет статус ${task.status} и не может быть исправлено автоматически.`,
      );
    }

    let oldKizRemoved = false;
    try {
      if (task.kiz && task.wbMetaStatus === 'ACCEPTED') {
        await this.marketplace.undoFbsTsdKiz(task.id, adminAsTaskOwner);
        oldKizRemoved = true;
      }
      const result = await this.marketplace.scanFbsTsdKiz(
        task.id,
        { kiz: newKiz, confirmBoxMove },
        adminAsTaskOwner,
      );
      if (record(result).state === 'CONFIRM_KIZ_MOVE') {
        throw new BadRequestException(
          'КИЗ числится в другом коробе. Разрешите перепривязку к фактическому коробу и повторите.',
        );
      }
      await this.marketplace.completeFbsTsdAssembly(
        task.id,
        adminAsTaskOwner,
      );
    } catch (caught) {
      if (oldKizRemoved) {
        const message =
          caught instanceof Error ? caught.message : 'Не удалось исправить КИЗ.';
        await this.prisma.fbsTsdAssembly.updateMany({
          where: { id: task.id, status: 'IN_PROGRESS' },
          data: {
            wbMetaStatus: 'REJECTED',
            errorMessage: `Исправление КИЗ не завершено: ${message}`,
          },
        });
      }
      throw caught;
    }
  }

  private async reopenCompletedTask(
    task: Prisma.FbsTsdAssemblyGetPayload<{}>,
    requestNumber: number,
    comment: string | undefined,
    user: AuthUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.fbsTsdAssembly.findUnique({
        where: { id: task.id },
      });
      if (!fresh || fresh.status !== 'COMPLETED') {
        throw new BadRequestException(
          'Состояние задания изменилось. Обновите раздел КИЗ.',
        );
      }
      if (fresh.boxId) {
        const selection = await tx.clientRequestBoxSelection.findUnique({
          where: {
            requestItemId_boxId: {
              requestItemId: fresh.requestItemId,
              boxId: fresh.boxId,
            },
          },
        });
        if (!selection || selection.quantity < fresh.itemCount) {
          throw new BadRequestException(
            'Не удалось безопасно вернуть отпиканную единицу в работу: изменился выбор короба.',
          );
        }
        if (selection.quantity === fresh.itemCount) {
          await tx.clientRequestBoxSelection.delete({
            where: { id: selection.id },
          });
        } else {
          await tx.clientRequestBoxSelection.update({
            where: { id: selection.id },
            data: { quantity: { decrement: fresh.itemCount } },
          });
        }
      }
      await tx.fbsTsdAssembly.update({
        where: { id: fresh.id },
        data: {
          status: 'IN_PROGRESS',
          completedAt: null,
          errorMessage: 'Задание возвращено в работу для исправления КИЗ.',
        },
      });
      await tx.clientRequestEvent.create({
        data: {
          requestId: fresh.requestId,
          clientId: fresh.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'Исправление КИЗ администратором',
          body:
            `Заказ WB ${fresh.orderId} временно возвращён в работу для замены КИЗ; ` +
            `заявка №${String(requestNumber).padStart(6, '0')}; администратор ${user.name}` +
            `${comment?.trim() ? `; комментарий: ${comment.trim()}` : ''}.`,
          createdByUserId: user.id,
        },
      });
    });
  }
}

function issue(
  input: Omit<
    KizIssueRow,
    | 'status'
    | 'isUnread'
    | 'readAt'
    | 'resolvedAt'
    | 'resolution'
    | 'detectedAt'
  > & {
    detectedAt: Date;
  },
): KizIssueRow {
  return {
    ...input,
    detectedAt: input.detectedAt.toISOString(),
    isUnread: true,
    readAt: null,
    status: 'OPEN',
    resolvedAt: null,
    resolution: null,
  };
}

function canFixBoxExhaustion(
  task: Prisma.FbsTsdAssemblyGetPayload<{}>,
  requestStatus: ClientRequestStatus | undefined,
) {
  return (
    Boolean((task.boxId || isKizNoBoxTask(task)) && task.barcode) &&
    !task.cargoPackedAt &&
    task.status === 'IN_PROGRESS' &&
    !task.kiz &&
    Boolean(requestStatus && !CLOSED_REQUEST_STATUSES.includes(requestStatus))
  );
}

function isKizNoBoxTask(task: Prisma.FbsTsdAssemblyGetPayload<{}>) {
  return (
    !task.boxId &&
    (task.boxCode ?? '').trim().toLocaleUpperCase('ru-RU') === 'БЕЗ КОРОБА'
  );
}

function assertKizAdminTask(
  task: Prisma.FbsTsdAssemblyGetPayload<{}>,
  request:
    | {
        id: string;
        number: number;
        status: ClientRequestStatus;
        warehouseId: string | null;
      }
    | null,
  user: AuthUser,
) {
  if (!request || CLOSED_REQUEST_STATUSES.includes(request.status)) {
    throw new BadRequestException(
      'Заявка уже закрыта. Изменение остатка или короба запрещено.',
    );
  }
  if (
    user.activeWarehouseId &&
    request.warehouseId !== user.activeWarehouseId
  ) {
    throw new BadRequestException(
      'Проблема относится к другому городу. Переключите филиал и повторите.',
    );
  }
  if ((!task.boxId && !isKizNoBoxTask(task)) || !task.barcode) {
    throw new BadRequestException(
      'В задании уже нет подтверждённого короба или штрихкода. Обновите очередь.',
    );
  }
  if (task.cargoPackedAt) {
    throw new BadRequestException(
      'Заказ уже находится в грузоместе. Сначала отмените упаковку.',
    );
  }
}

function kizBalanceKey(
  clientId: string,
  skuId: string,
  boxId: string | null,
  palletId: string | null,
  warehouseId: string,
) {
  const parts = [
    clientId,
    skuId,
    boxId ?? 'no-box',
    palletId ?? 'no-pallet',
    StockStatus.AVAILABLE,
  ];
  if (!boxId && !palletId) {
    parts.push('warehouse', warehouseId);
  }
  return parts.join(':');
}

function resolutionMessage(action: ResolveKizIssueDto['action']) {
  if (action === 'REPLACE_KIZ') {
    return 'КИЗ исправлен, повторно передан в Wildberries и синхронизирован с WMS.';
  }
  if (action === 'REGISTER_EXTRA_UNIT') {
    return 'Дополнительная физическая единица зарегистрирована, КИЗ принят Wildberries, заказ завершён.';
  }
  if (action === 'PREPARE_EXTRA_UNIT') {
    return 'Физическая единица учтена. Сотрудник может повторно отсканировать КИЗ на ТСД — код зарегистрируется в WMS и будет передан в Wildberries.';
  }
  if (action === 'RELEASE_BOX') {
    return 'Проблемный короб снят с задания. На ТСД можно выбрать другой короб.';
  }
  return 'Проблема отмечена решённой и сохранена в журнале.';
}

function canReplaceTask(
  task: Prisma.FbsTsdAssemblyGetPayload<{}>,
  requestStatus: ClientRequestStatus | undefined,
) {
  return (
    Boolean(task.boxId && task.barcode) &&
    !task.cargoPackedAt &&
    ['IN_PROGRESS', 'COMPLETED'].includes(task.status) &&
    Boolean(requestStatus && !CLOSED_REQUEST_STATUSES.includes(requestStatus))
  );
}

function issueAssemblyId(issueKey: string) {
  if (issueKey.startsWith('task:')) {
    return issueKey.split(':')[1] || null;
  }
  if (issueKey.startsWith('duplicate:')) {
    const value = issueKey.split(':')[2] || '';
    return value && value !== 'none' ? value : null;
  }
  if (issueKey.startsWith('exhausted:')) {
    return issueKey.split(':')[1] || null;
  }
  if (issueKey.startsWith('local:')) {
    const value = issueKey.split(':')[2] || '';
    return value && value !== 'none' ? value : null;
  }
  return null;
}

function emptyReport(status: string, activeWarehouseId: string | null) {
  return {
    generatedAt: new Date().toISOString(),
    activeWarehouseId,
    status,
    summary: {
      all: 0,
      open: 0,
      critical: 0,
      warning: 0,
      unread: 0,
      resolved: 0,
    },
    issues: [],
  };
}

function deduplicateIssues(rows: KizIssueRow[]) {
  const byKey = new Map<string, KizIssueRow>();
  rows.forEach((row) => {
    const current = byKey.get(row.issueKey);
    if (!current || current.detectedAt < row.detectedAt) {
      byKey.set(row.issueKey, row);
    }
  });
  return [...byKey.values()];
}

function issueSearchText(row: KizIssueRow) {
  return [
    row.title,
    row.explanation,
    row.client?.code,
    row.client?.name,
    row.branch?.city,
    row.request?.number,
    row.request?.title,
    row.orderId,
    row.sku?.internalSku,
    row.sku?.article,
    row.sku?.name,
    row.sku?.size,
    row.boxCode,
    row.kiz,
    row.workerName,
    row.errorMessage,
    row.duplicate?.existingOrderId,
    row.duplicate?.existingBoxCode,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLocaleLowerCase('ru-RU');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function later(left: Date, right: Date) {
  return left > right ? left : right;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function printableKiz(value: string) {
  return value
    .replace(/\u001d/gi, '<GS>')
    .replace(/[\u0000-\u001c\u001e-\u001f\u007f]/g, (symbol) =>
      `<0x${symbol.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}>`,
    );
}

function cleanJson(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
