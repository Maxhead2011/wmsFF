import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { ResolveTsdReviewDto } from './dto/resolve-tsd-review.dto';
import { TsdPayloadParser } from './tsd-payload.parser';

@Injectable()
export class TsdReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly stockOperations: StockOperationsService,
    private readonly payloadParser: TsdPayloadParser,
  ) {}

  async listReceiptReviewDashboard(user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const where: Prisma.TsdOperationWhereInput = {
      operationType: 'receipt_scan',
      OR: [{ status: TsdOperationStatus.NEEDS_REVIEW }, { createdAt: { gte: since } }],
    };
    const [operations, summaryOperations] = await Promise.all([
      this.prisma.tsdOperation.findMany({
        where,
        orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
        take: 5000,
      }),
      this.prisma.tsdOperation.findMany({
        where,
        select: {
          status: true,
          payload: true,
          reviewReason: true,
          reviewAction: true,
          reviewComment: true,
          serverMessage: true,
          resolutionMessage: true,
        },
      }),
    ]);

    const payloads = operations.map((operation) => receiptPayload(operation.payload));
    const clientIds = unique(payloads.map((payload) => payload.clientId));
    const skuIds = unique(payloads.map((payload) => payload.skuId));
    const barcodes = unique(payloads.map((payload) => payload.barcode));
    const kizValues = unique(payloads.map((payload) => payload.kiz));
    const deviceIds = unique(operations.map((operation) => operation.deviceId));
    const issuePayloads = payloads.filter((_, index) => {
      const result = receiptReviewResult(operations[index]);
      return result === 'NOT_ACCEPTED' || result === 'REJECTED';
    });
    const issueClientIds = unique(issuePayloads.map((payload) => payload.clientId));
    const issueBoxCodes = unique(issuePayloads.map((payload) => payload.boxCode));

    const [clients, skus, duplicateMarks, devices, issueBoxes] = await Promise.all([
      clientIds.length
        ? this.prisma.client.findMany({
            where: { id: { in: clientIds } },
            select: { id: true, code: true, name: true },
          })
        : [],
      skuIds.length || (clientIds.length && barcodes.length)
        ? this.prisma.sku.findMany({
            where: {
              OR: [
                skuIds.length ? { id: { in: skuIds } } : undefined,
                clientIds.length && barcodes.length
                  ? { clientId: { in: clientIds }, barcodes: { some: { value: { in: barcodes } } } }
                  : undefined,
              ].filter(Boolean) as Prisma.SkuWhereInput[],
            },
            select: {
              id: true,
              clientId: true,
              internalSku: true,
              article: true,
              name: true,
              color: true,
              size: true,
              barcodes: { select: { value: true, isPrimary: true } },
            },
          })
        : [],
      clientIds.length && kizValues.length
        ? this.prisma.productMark.findMany({
            where: {
              clientId: { in: clientIds },
              value: { in: kizValues },
            },
            select: {
              id: true,
              clientId: true,
              value: true,
              box: { select: { code: true } },
              sku: {
                select: {
                  id: true,
                  internalSku: true,
                  article: true,
                  name: true,
                  color: true,
                  size: true,
                  barcodes: { select: { value: true, isPrimary: true } },
                },
              },
            },
          })
        : [],
      deviceIds.length
        ? this.prisma.tsdDevice.findMany({
            where: { OR: [{ code: { in: deviceIds } }, { id: { in: deviceIds } }] },
            select: { id: true, code: true, name: true, user: { select: { name: true, email: true } } },
          })
        : [],
      issueClientIds.length && issueBoxCodes.length
        ? this.prisma.box.findMany({
            where: {
              clientId: { in: issueClientIds },
              code: { in: issueBoxCodes, mode: Prisma.QueryMode.insensitive },
            },
            select: {
              clientId: true,
              code: true,
              balances: { select: { quantity: true } },
            },
          })
        : [],
    ]);

    const clientById = new Map(clients.map((client) => [client.id, client]));
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const skuByBarcode = new Map<string, (typeof skus)[number]>();
    skus.forEach((sku) =>
      sku.barcodes.forEach((barcode) => skuByBarcode.set(receiptLookupKey(sku.clientId, barcode.value), sku)),
    );
    const markByKiz = new Map(
      duplicateMarks.map((mark) => [receiptLookupKey(mark.clientId, mark.value), mark]),
    );
    const actorByDevice = new Map<string, (typeof devices)[number]>();
    devices.forEach((device) => {
      actorByDevice.set(device.id, device);
      actorByDevice.set(device.code, device);
    });
    const accountedQuantityByBox = new Map(
      issueBoxes.map((box) => [
        receiptLookupKey(box.clientId, box.code),
        box.balances.reduce((sum, balance) => sum + Math.max(0, balance.quantity), 0),
      ]),
    );
    const scansByKiz = new Map<string, Array<{ boxCode: string; deviceId: string; createdAt: Date }>>();
    operations.forEach((operation, index) => {
      const payload = payloads[index];
      if (!payload.clientId || !payload.kiz) {
        return;
      }
      const key = receiptLookupKey(payload.clientId, payload.kiz);
      scansByKiz.set(key, [
        ...(scansByKiz.get(key) ?? []),
        { boxCode: payload.boxCode, deviceId: operation.deviceId, createdAt: operation.createdAt },
      ]);
    });

    const items = operations.map((operation, index) => {
      const payload = payloads[index];
      const quantity = positiveInteger(payload.quantity, 1);
      const sku =
        (payload.skuId ? skuById.get(payload.skuId) : undefined) ??
        (payload.barcode ? skuByBarcode.get(receiptLookupKey(payload.clientId, payload.barcode)) : undefined) ??
        null;
      const duplicate = payload.kiz ? markByKiz.get(receiptLookupKey(payload.clientId, payload.kiz)) ?? null : null;
      const relatedScans = payload.kiz
        ? scansByKiz.get(receiptLookupKey(payload.clientId, payload.kiz)) ?? []
        : [];
      const result = receiptReviewResult(operation);
      const actor = actorByDevice.get(operation.deviceId);
      const kizAssessment = assessReceiptKiz({
        kiz: payload.kiz,
        targetBoxCode: payload.boxCode,
        duplicate,
        relatedScans,
      });

      return {
        id: operation.id,
        operationKey: operation.operationKey,
        result,
        client: clientById.get(payload.clientId) ?? { id: payload.clientId, code: '', name: 'Клиент не найден' },
        boxCode: payload.boxCode,
        sourceDocument: payload.sourceDocument,
        quantity,
        barcode: payload.barcode,
        kiz: payload.kiz,
        sku: sku
          ? {
              id: sku.id,
              internalSku: sku.internalSku,
              article: sku.article,
              name: sku.name,
              color: sku.color,
              size: sku.size,
              barcode: primaryBarcode(sku.barcodes) || payload.barcode,
            }
          : null,
        duplicate:
          duplicate && result !== 'ACCEPTED'
            ? {
                markId: duplicate.id,
                boxCode: duplicate.box?.code ?? null,
                skuId: duplicate.sku.id,
                name: duplicate.sku.name,
                article: duplicate.sku.article ?? duplicate.sku.internalSku,
                color: duplicate.sku.color,
                size: duplicate.sku.size,
                barcode: primaryBarcode(duplicate.sku.barcodes),
              }
            : null,
        kizAssessment,
        reviewReason: operation.reviewReason,
        message: operation.resolutionMessage ?? operation.serverMessage,
        deviceCode: actor?.code ?? operation.deviceId,
        operatorName: actor?.user.name ?? null,
        createdAt: operation.createdAt.toISOString(),
        reviewedAt: operation.reviewedAt?.toISOString() ?? null,
      };
    }).sort((left, right) => {
      const priority = { NOT_ACCEPTED: 0, ACCEPTED_WITH_ERROR: 1, REJECTED: 2, ACCEPTED: 3 } as const;
      return priority[left.result] - priority[right.result] || right.createdAt.localeCompare(left.createdAt);
    });
    const boxesToCheckMap = new Map<
      string,
      {
        client: (typeof items)[number]['client'];
        boxCode: string;
        notAcceptedQuantity: number;
        issueOperations: number;
        duplicateKizQuantity: number;
        lastIssueAt: string;
      }
    >();

    items.forEach((item) => {
      if ((item.result !== 'NOT_ACCEPTED' && item.result !== 'REJECTED') || !item.boxCode) {
        return;
      }

      const key = receiptLookupKey(item.client.id, item.boxCode);
      const current = boxesToCheckMap.get(key) ?? {
        client: item.client,
        boxCode: item.boxCode,
        notAcceptedQuantity: 0,
        issueOperations: 0,
        duplicateKizQuantity: 0,
        lastIssueAt: item.createdAt,
      };
      current.notAcceptedQuantity += item.quantity;
      current.issueOperations += 1;
      current.duplicateKizQuantity += isKizConflict(item.kizAssessment) ? item.quantity : 0;
      current.lastIssueAt = current.lastIssueAt > item.createdAt ? current.lastIssueAt : item.createdAt;
      boxesToCheckMap.set(key, current);
    });

    const boxesToCheck = [...boxesToCheckMap.entries()]
      .map(([key, box]) => {
        const accountedQuantity = accountedQuantityByBox.get(key) ?? 0;
        return {
          ...box,
          boxExists: accountedQuantityByBox.has(key),
          accountedQuantity,
          maximumPhysicalQuantity: accountedQuantity + box.notAcceptedQuantity,
        };
      })
      .sort(
        (left, right) =>
          right.notAcceptedQuantity - left.notAcceptedQuantity || right.lastIssueAt.localeCompare(left.lastIssueAt),
      );

    return {
      generatedAt: new Date().toISOString(),
      periodFrom: since.toISOString(),
      stats: {
        acceptedQuantity: sumReceiptOperationQuantity(summaryOperations, 'ACCEPTED'),
        notAcceptedQuantity:
          sumReceiptOperationQuantity(summaryOperations, 'NOT_ACCEPTED') +
          sumReceiptOperationQuantity(summaryOperations, 'REJECTED'),
        acceptedWithErrorQuantity: sumReceiptOperationQuantity(summaryOperations, 'ACCEPTED_WITH_ERROR'),
        duplicateKizQuantity: summaryOperations
          .filter(isDuplicateReceiptOperation)
          .reduce((sum, operation) => sum + positiveInteger(receiptPayload(operation.payload).quantity, 1), 0),
        totalOperations: summaryOperations.length,
        shownOperations: items.length,
      },
      boxesToCheck,
      items,
    };
  }

  async getReceiptReviewBoxesXlsx(user: AuthUser, clientId?: string) {
    const dashboard = await this.listReceiptReviewDashboard(user);
    const selectedClientId = clientId?.trim();
    const boxes = dashboard.boxesToCheck.filter((box) => !selectedClientId || box.client.id === selectedClientId);
    const issueItems = dashboard.items.filter(
      (item) =>
        (!selectedClientId || item.client.id === selectedClientId) &&
        (item.result === 'NOT_ACCEPTED' || item.result === 'REJECTED'),
    );
    const workbook = XLSX.utils.book_new();

    const boxRows: Array<Array<string | number>> = [[
      'Клиент',
      'Код клиента',
      'Короб',
      'Учтено в WMS, шт.',
      'Не принято, шт.',
      'Максимум физически, шт.',
      'Ошибок',
      'Проблемных КИЗ, шт.',
      'Что проверить',
      'Последняя ошибка',
    ]];
    boxes.forEach((box) => {
      const boxIssues = issueItems.filter(
        (item) => item.client.id === box.client.id && normalizeText(item.boxCode) === normalizeText(box.boxCode),
      );
      boxRows.push([
        box.client.name,
        box.client.code,
        box.boxCode,
        box.accountedQuantity,
        box.notAcceptedQuantity,
        box.maximumPhysicalQuantity,
        box.issueOperations,
        box.duplicateKizQuantity,
        boxCheckGuidance(box, boxIssues),
        formatExcelDate(box.lastIssueAt),
      ]);
    });
    appendReviewSheet(workbook, 'Короба на проверку', boxRows, [28, 15, 22, 18, 17, 24, 10, 22, 70, 20]);

    const kizRows: Array<Array<string | number>> = [[
      'Клиент',
      'Короб сканирования',
      'КИЗ',
      'Товар',
      'Артикул',
      'Штрихкод',
      'Количество',
      'Вывод по КИЗ',
      'Вероятный случайный повтор',
      'Сканов КИЗ за период',
      'Короба в сканах',
      'Где КИЗ числится в WMS',
      'Что проверить',
      'Ошибка WMS',
      'Оператор',
      'ТСД',
      'Дата скана',
    ]];
    issueItems.forEach((item) => {
      kizRows.push([
        item.client.name,
        item.boxCode || '',
        item.kiz || '',
        item.sku?.name || item.duplicate?.name || '',
        item.sku?.article || item.sku?.internalSku || item.duplicate?.article || '',
        item.barcode || item.sku?.barcode || item.duplicate?.barcode || '',
        item.quantity,
        item.kizAssessment.label,
        item.kizAssessment.likelyAccidental === true
          ? 'Да'
          : item.kizAssessment.likelyAccidental === false
            ? 'Нет, требуется физическая проверка'
            : 'Не определено',
        item.kizAssessment.scanOccurrences,
        item.kizAssessment.scannedBoxCodes.join(', '),
        item.kizAssessment.registeredBoxCode || '',
        item.kizAssessment.guidance,
        item.message || '',
        item.operatorName || '',
        item.deviceCode,
        formatExcelDate(item.createdAt),
      ]);
    });
    appendReviewSheet(
      workbook,
      'Проблемные КИЗ',
      kizRows,
      [28, 22, 34, 36, 20, 22, 12, 34, 26, 20, 32, 26, 75, 50, 24, 18, 20],
    );

    appendReviewSheet(workbook, 'Инструкция', receiptReviewInstructionRows(), [28, 105]);
    const generatedDate = dashboard.generatedAt.slice(0, 10);
    return {
      fileName: `proverka-korobov-tsd-${generatedDate}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    };
  }

  async resolveReviewOperation(operationId: string, dto: ResolveTsdReviewDto, user: AuthUser) {
    const operation = await this.prisma.tsdOperation.findUnique({
      where: { id: operationId },
    });

    if (!operation || operation.status !== TsdOperationStatus.NEEDS_REVIEW) {
      throw new NotFoundException('Операция ТСД на разборе не найдена.');
    }

    if (dto.action === 'REJECT') {
      this.clientScopes.requireClientAccess(user, this.reviewClientId(operation.operationType, operation.payload), 'write');
      const reviewReason = dto.reason ?? operation.reviewReason ?? TsdReviewReason.MANUAL_REJECT;
      const reviewComment = dto.comment?.trim();
      const resolutionMessage = reviewComment
        ? `Отклонено: ${reviewComment}`
        : `Отклонено: ${this.reviewReasonLabel(reviewReason)}.`;

      const updated = await this.prisma.tsdOperation.update({
        where: { id: operation.id },
        data: {
          status: TsdOperationStatus.REJECTED,
          reviewReason,
          resolutionMessage,
          reviewAction: dto.action,
          reviewComment,
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
        },
      });

      return {
        operation: updated,
        resolution: {
          action: dto.action,
        },
      };
    }

    if (dto.action === 'ACCEPT_RECEIPT_WITH_ERROR') {
      return this.acceptReceiptWithError(operation, dto, user);
    }

    if (operation.operationType !== 'inventory_scan') {
      throw new BadRequestException('Автоматическая корректировка доступна только для inventory_scan.');
    }

    const payload = this.payloadParser.parseInventoryPayload(operation.payload as Record<string, unknown>);
    this.clientScopes.requireClientAccess(user, payload.clientId, 'write');

    const adjustment = await this.stockOperations.adjustInventoryToCounted(
      {
        clientId: payload.clientId,
        barcode: payload.barcode,
        skuId: payload.skuId,
        boxCode: payload.boxCode,
        countedQuantity: payload.countedQuantity,
        status: payload.status,
        idempotencyKey: `${operation.operationKey}:inventory-adjustment`,
        comment: dto.comment?.trim() || `Подтвержден разбор ТСД ${operation.deviceId}`,
      },
      user,
    );

    // Русский комментарий: после подтверждения расхождение закрывается, а изменение остатка уже отражено в stock ledger.
    const resolutionMessage = `Разбор подтвержден: дельта ${adjustment.delta}.`;
    const updated = await this.prisma.tsdOperation.update({
      where: { id: operation.id },
      data: {
        status: TsdOperationStatus.ACCEPTED,
        reviewReason: operation.reviewReason ?? TsdReviewReason.INVENTORY_MISMATCH,
        resolutionMessage,
        reviewAction: dto.action,
        reviewComment: dto.comment?.trim(),
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      },
    });

    return {
      operation: updated,
      resolution: {
        action: dto.action,
        adjustment,
      },
    };
  }

  private async acceptReceiptWithError(
    operation: { id: string; operationKey: string; operationType: string; payload: Prisma.JsonValue; reviewReason: TsdReviewReason | null; serverMessage: string | null; deviceId: string },
    dto: ResolveTsdReviewDto,
    user: AuthUser,
  ) {
    if (operation.operationType !== 'receipt_scan') {
      throw new BadRequestException('Принять с ошибкой можно только строку приемки товара.');
    }

    this.clientScopes.requireGlobalClientAccess(user);
    const payload = this.payloadParser.parseReceiptPayload(operation.payload as Record<string, unknown>);
    this.clientScopes.requireClientAccess(user, payload.clientId, 'write');

    const duplicate = payload.kiz
      ? await this.prisma.productMark.findFirst({
          where: {
            clientId: payload.clientId,
            value: { equals: payload.kiz, mode: Prisma.QueryMode.insensitive },
          },
          select: { box: { select: { code: true } }, sku: { select: { name: true } } },
        })
      : null;
    const duplicateText = duplicate?.box?.code
      ? ` Дубль КИЗ уже числится в коробе ${duplicate.box.code}${duplicate.sku.name ? `, товар «${duplicate.sku.name}»` : ''}.`
      : '';
    const auditComment = [
      'ПРИНЯТО С ОШИБКОЙ ПО РЕШЕНИЮ АДМИНИСТРАТОРА.',
      operation.serverMessage,
      payload.kiz ? `Исходный КИЗ: ${payload.kiz}.` : null,
      duplicateText.trim() || null,
      dto.comment?.trim() || null,
    ]
      .filter(Boolean)
      .join(' ');

    const receipt = await this.stockOperations.receiveIntoBox(
      {
        clientId: payload.clientId,
        barcode: payload.barcode,
        skuId: payload.skuId,
        boxCode: payload.boxCode,
        quantity: payload.quantity,
        status: payload.status,
        sourceDocument: payload.sourceDocument,
        idempotencyKey: `${operation.operationKey}:accepted-with-error`,
        comment: auditComment,
        allowReceiptError: true,
      },
      user,
    );

    const resolutionMessage = `Принято с ошибкой в короб ${payload.boxCode}: ${payload.quantity} шт.${duplicateText}`.trim();
    const updated = await this.prisma.tsdOperation.update({
      where: { id: operation.id },
      data: {
        status: TsdOperationStatus.ACCEPTED,
        reviewReason: operation.reviewReason ?? TsdReviewReason.RECEIPT_FAILED,
        resolutionMessage,
        reviewAction: 'APPLY_INVENTORY_ADJUSTMENT',
        reviewComment: `[RECEIPT_ERROR_ACCEPTED] ${dto.comment?.trim() || 'Фактическое количество подтверждено.'}`,
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      },
    });

    return {
      operation: updated,
      resolution: {
        action: dto.action,
        receipt,
        duplicate: duplicate
          ? {
              boxCode: duplicate.box?.code ?? null,
              skuName: duplicate.sku.name,
            }
          : null,
      },
    };
  }

  listReviewHistory(user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);

    return this.prisma.tsdOperation.findMany({
      where: {
        reviewedAt: {
          not: null,
        },
      },
      include: {
        reviewedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: [{ reviewedAt: 'desc' }],
      take: 200,
    });
  }

  private reviewClientId(operationType: string, payload: unknown) {
    const rawPayload = payload as Record<string, unknown>;

    if (operationType === 'move_scan') {
      return this.payloadParser.parseMovePayload(rawPayload).clientId;
    }

    if (operationType === 'receipt_scan') {
      return this.payloadParser.parseReceiptPayload(rawPayload).clientId;
    }

    return this.payloadParser.parseInventoryPayload(rawPayload).clientId;
  }

  private reviewReasonLabel(reason: TsdReviewReason) {
    const labels: Record<TsdReviewReason, string> = {
      INVENTORY_MISMATCH: 'расхождение инвентаризации',
      SKU_NOT_FOUND: 'SKU или штрихкод не найден',
      BOX_NOT_FOUND: 'короб не найден',
      RECEIPT_FAILED: 'приемка требует разбора',
      DEVICE_MISMATCH: 'операция пришла не от этого ТСД',
      VALIDATION_ERROR: 'ошибка данных операции',
      MANUAL_REJECT: 'ручное отклонение оператором',
      OTHER: 'другая причина',
    };

    return labels[reason];
  }
}

function receiptPayload(value: Prisma.JsonValue) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    clientId: textValue(payload.clientId),
    skuId: textValue(payload.skuId),
    barcode: textValue(payload.barcode),
    kiz: textValue(payload.kiz),
    boxCode: textValue(payload.boxCode ?? payload.toBoxCode),
    sourceDocument: textValue(payload.sourceDocument),
    quantity: payload.quantity,
  };
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function receiptLookupKey(clientId: string, value: string) {
  return `${clientId.trim().toUpperCase()}|${value.trim().toUpperCase()}`;
}

function primaryBarcode(barcodes: Array<{ value: string; isPrimary: boolean }>) {
  return barcodes.find((barcode) => barcode.isPrimary)?.value ?? barcodes[0]?.value ?? '';
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function receiptReviewResult(operation: {
  status: TsdOperationStatus;
  reviewReason: TsdReviewReason | null;
  reviewAction: string | null;
  reviewComment: string | null;
}) {
  if (
    operation.status === TsdOperationStatus.ACCEPTED &&
    operation.reviewReason === TsdReviewReason.RECEIPT_FAILED &&
    operation.reviewAction === 'APPLY_INVENTORY_ADJUSTMENT' &&
    operation.reviewComment?.startsWith('[RECEIPT_ERROR_ACCEPTED]')
  ) {
    return 'ACCEPTED_WITH_ERROR' as const;
  }
  if (operation.status === TsdOperationStatus.ACCEPTED) {
    return 'ACCEPTED' as const;
  }
  if (operation.status === TsdOperationStatus.REJECTED) {
    return 'REJECTED' as const;
  }
  return 'NOT_ACCEPTED' as const;
}

function sumReceiptOperationQuantity(
  operations: Array<{
    status: TsdOperationStatus;
    payload: Prisma.JsonValue;
    reviewReason: TsdReviewReason | null;
    reviewAction: string | null;
    reviewComment: string | null;
  }>,
  result: 'ACCEPTED' | 'NOT_ACCEPTED' | 'ACCEPTED_WITH_ERROR' | 'REJECTED',
) {
  return operations
    .filter((operation) => receiptReviewResult(operation) === result)
    .reduce((sum, operation) => sum + positiveInteger(receiptPayload(operation.payload).quantity, 1), 0);
}

function isDuplicateReceiptOperation(operation: {
  serverMessage: string | null;
  resolutionMessage: string | null;
}) {
  return /(?:ДУБЛ|КИЗ уже|КИЗ.*короб)/iu.test(`${operation.serverMessage ?? ''} ${operation.resolutionMessage ?? ''}`);
}

type ReceiptKizAssessmentKind =
  | 'NOT_PROVIDED'
  | 'ALREADY_IN_TARGET_BOX'
  | 'REGISTERED_IN_OTHER_BOX'
  | 'REGISTERED_WITHOUT_BOX'
  | 'REPEATED_SCAN'
  | 'SCANNED_IN_MULTIPLE_BOXES'
  | 'UNCONFIRMED';

function assessReceiptKiz(input: {
  kiz: string;
  targetBoxCode: string;
  duplicate: { box: { code: string } | null } | null;
  relatedScans: Array<{ boxCode: string; deviceId: string; createdAt: Date }>;
}) {
  const scannedBoxCodes = unique(input.relatedScans.map((scan) => scan.boxCode));
  const registeredBoxCode = input.duplicate?.box?.code ?? null;
  let kind: ReceiptKizAssessmentKind;
  let label: string;
  let likelyAccidental: boolean | null;
  let guidance: string;

  if (!input.kiz) {
    kind = 'NOT_PROVIDED';
    label = 'КИЗ не передан';
    likelyAccidental = null;
    guidance = 'Проверить товар, штрихкод и фактическое количество в коробе. Для маркируемого товара сверить КИЗ на упаковке.';
  } else if (registeredBoxCode && normalizeText(registeredBoxCode) === normalizeText(input.targetBoxCode)) {
    kind = 'ALREADY_IN_TARGET_BOX';
    label = 'КИЗ уже учтен в этом коробе';
    likelyAccidental = true;
    guidance = `Найти КИЗ физически в коробе ${input.targetBoxCode}. Если единица одна, это повторный скан — повторно товар не принимать. Если упаковок две с одинаковым КИЗ, изолировать их и проверить маркировку.`;
  } else if (registeredBoxCode) {
    kind = 'REGISTERED_IN_OTHER_BOX';
    label = `КИЗ числится в другом коробе: ${registeredBoxCode}`;
    likelyAccidental = false;
    guidance = `Проверить короба ${input.targetBoxCode || 'сканирования'} и ${registeredBoxCode}. Найти упаковку с этим КИЗ и установить фактический короб до принятия решения.`;
  } else if (input.duplicate) {
    kind = 'REGISTERED_WITHOUT_BOX';
    label = 'КИЗ есть в WMS без короба';
    likelyAccidental = false;
    guidance = 'КИЗ уже зарегистрирован в WMS, но короб не указан. Найти товар физически и восстановить его фактическое местоположение.';
  } else if (input.relatedScans.length > 1 && scannedBoxCodes.length > 1) {
    kind = 'SCANNED_IN_MULTIPLE_BOXES';
    label = 'Один КИЗ сканировали в разных коробах';
    likelyAccidental = false;
    guidance = `Проверить все короба из сканов: ${scannedBoxCodes.join(', ')}. Один физический КИЗ должен находиться только в одном коробе.`;
  } else if (input.relatedScans.length > 1) {
    kind = 'REPEATED_SCAN';
    label = 'Вероятный повтор сканирования';
    likelyAccidental = true;
    guidance = `КИЗ отсканирован ${input.relatedScans.length} раз${input.targetBoxCode ? ` в короб ${input.targetBoxCode}` : ''}. Пересчитать товар и убедиться, что упаковка с этим КИЗ физически одна.`;
  } else {
    kind = 'UNCONFIRMED';
    label = 'Дубль КИЗ не подтвержден';
    likelyAccidental = null;
    guidance = 'В текущем реестре WMS этот КИЗ не найден. Проверить исходную ошибку, товар, короб и читаемость маркировки.';
  }

  return {
    kind,
    label,
    likelyAccidental,
    scanOccurrences: input.relatedScans.length,
    scannedBoxCodes,
    registeredBoxCode,
    guidance,
  };
}

function boxCheckGuidance(
  box: { boxCode: string; accountedQuantity: number; maximumPhysicalQuantity: number },
  issues: Array<{ kizAssessment: ReturnType<typeof assessReceiptKiz> }>,
) {
  const otherBoxes = unique(
    issues
      .filter((item) => item.kizAssessment.kind === 'REGISTERED_IN_OTHER_BOX')
      .map((item) => item.kizAssessment.registeredBoxCode ?? ''),
  );
  const repeated = issues.filter((item) => item.kizAssessment.likelyAccidental === true).length;
  const parts = [
    `Полностью пересчитать короб ${box.boxCode}: ожидаемый диапазон ${box.accountedQuantity}–${box.maximumPhysicalQuantity} шт.`,
    'Сверить каждый проблемный КИЗ с физической упаковкой.',
  ];
  if (repeated) {
    parts.push(`Для ${repeated} строк возможен случайный повтор сканирования: проверить, что упаковка с КИЗ одна.`);
  }
  if (otherBoxes.length) {
    parts.push(`Дополнительно проверить короба, где КИЗ уже числятся в WMS: ${otherBoxes.join(', ')}.`);
  }
  return parts.join(' ');
}

function isKizConflict(assessment: ReturnType<typeof assessReceiptKiz>) {
  return assessment.kind !== 'NOT_PROVIDED' && assessment.kind !== 'UNCONFIRMED';
}

function appendReviewSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: Array<Array<string | number>>,
  widths: number[],
) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 0 && rows[0].length > 0) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 } }) };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function receiptReviewInstructionRows(): Array<Array<string | number>> {
  return [
    ['Шаг', 'Что делать'],
    [1, 'Открыть лист «Короба на проверку» и взять короб в работу. Полностью пересчитать его физическое содержимое.'],
    [2, 'Сравнить пересчет с колонками «Учтено в WMS» и «Максимум физически». Верхняя граница предполагает, что каждый непринятый скан был отдельной единицей.'],
    [3, 'На листе «Проблемные КИЗ» найти строки этого короба и сверить каждый КИЗ с кодом на физической упаковке.'],
    [4, '«КИЗ уже учтен в этом коробе» или «Вероятный повтор сканирования»: если физическая упаковка одна, повторно товар не принимать.'],
    [5, '«КИЗ числится в другом коробе»: проверить оба короба и определить, где упаковка находится фактически. До этого не принимать строку с ошибкой.'],
    [6, 'Если физически найдены две упаковки с одинаковым КИЗ, изолировать обе и передать ответственному за маркировку — один КИЗ не должен обозначать две единицы.'],
    [7, 'После проверки зафиксировать фактический короб и количество, затем принять с ошибкой только подтвержденную физическую единицу или отклонить ошибочный повтор.'],
    ['', 'Важно: вывод «вероятный случайный повтор» является подсказкой по данным WMS, а не заменяет физическую проверку.'],
  ];
}

function normalizeText(value: string) {
  return value.trim().toUpperCase();
}

function formatExcelDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
