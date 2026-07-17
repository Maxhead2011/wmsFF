import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { StockStatus, TsdReviewReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockOperationsService } from '../stock/stock-operations.service';
import { ScanOperationDto, SyncTsdOperationsDto } from './dto/scan-operation.dto';
import { TsdDeviceService } from './tsd-device.service';
import { TsdAssemblyService } from './tsd-assembly.service';
import { TsdOperationLogService } from './tsd-operation-log.service';
import { TsdOperationResult } from './tsd-operation.types';
import { TsdPayloadParser } from './tsd-payload.parser';

@Injectable()
export class TsdSyncService {
  private readonly requestLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly stockOperations: StockOperationsService,
    private readonly devices: TsdDeviceService,
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly payloadParser: TsdPayloadParser,
    private readonly operationLog: TsdOperationLogService,
    @Optional() private readonly assembly?: TsdAssemblyService,
  ) {}

  async acceptOperation(operation: ScanOperationDto, user: AuthUser) {
    const [result] = await this.syncOperations({ operations: [operation] }, user);
    return result;
  }

  async syncOperations(dto: SyncTsdOperationsDto, user: AuthUser) {
    await this.devices.touchActiveDevice(user.deviceId);

    const results: TsdOperationResult[] = [];

    for (const operation of dto.operations) {
      results.push(await this.applyOperation(operation, user));
    }

    return results;
  }

  listReviewQueue(user: AuthUser) {
    return this.operationLog.listReviewQueue(user);
  }

  private async applyOperation(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult> {
    try {
      if (user.deviceCode && operation.deviceId !== user.deviceCode) {
        return await this.operationLog.recordResult(
          operation,
          'REJECTED',
          'Операция пришла не от устройства из access token.',
          TsdReviewReason.DEVICE_MISMATCH,
        );
      }

      const existing = await this.operationLog.findExisting(operation.operationKey);
      if (existing) {
        return this.operationLog.existingResult(operation, existing);
      }

      if (operation.operationType === 'move_scan') {
        const requestId = optionalText(operation.payload.requestId);
        return requestId
          ? await this.withRequestLock(requestId, async () => {
              await this.assembly?.assertMovementProgressAvailable(requestId, operation.payload, user);
              return this.applyMoveScan(operation, user);
            })
          : await this.applyMoveScan(operation, user);
      }

      if (operation.operationType === 'receipt_scan') {
        return await this.applyReceiptScan(operation, user);
      }

      if (operation.operationType === 'assembly_stage') {
        return await this.applyAssemblyProgress(operation, user);
      }

      return await this.applyInventoryScan(operation, user);
    } catch (caught) {
      return await this.operationLog.recordResult(
        operation,
        'REJECTED',
        caught instanceof Error ? caught.message : 'Операция ТСД отклонена.',
        TsdReviewReason.VALIDATION_ERROR,
      );
    }
  }

  private async applyAssemblyProgress(operation: ScanOperationDto, user: AuthUser) {
    const requestId = optionalText(operation.payload.requestId);
    const action = optionalText(operation.payload.action) ?? optionalText(operation.payload.progressKind);
    if (!requestId || !action || !['relabel-complete', 'outgoing-confirm'].includes(action)) {
      return this.operationLog.recordResult(operation, 'ACCEPTED');
    }

    return this.withRequestLock(requestId, async () => {
      if (action === 'relabel-complete') {
        await this.assembly?.assertRelabelProgressAvailable(requestId, operation.payload, user);
      } else {
        await this.assembly?.assertOutgoingBoxAvailable(requestId, operation.payload, user);
      }
      return this.operationLog.recordResult(operation, 'ACCEPTED');
    });
  }

  private async withRequestLock<T>(requestId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.requestLocks.get(requestId) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.requestLocks.set(requestId, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.requestLocks.get(requestId) === tail) this.requestLocks.delete(requestId);
    }
  }

  private async applyMoveScan(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult> {
    const payload = this.payloadParser.parseMovePayload(operation.payload);
    const transfer = await this.stockOperations.transferBetweenBoxes(
      {
        clientId: payload.clientId,
        barcode: payload.barcode,
        skuId: payload.skuId,
        fromBoxCode: payload.fromBoxCode,
        toBoxCode: payload.toBoxCode,
        quantity: payload.quantity,
        status: payload.status,
        idempotencyKey: operation.operationKey,
        comment: payload.comment ?? `ТСД ${operation.deviceId}`,
      },
      user,
    );

    return this.operationLog.recordResult(
      operation,
      transfer.status === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED' : 'APPLIED',
    );
  }

  private async applyReceiptScan(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult> {
    const payload = this.payloadParser.parseReceiptPayload(operation.payload);

    try {
      const client = await this.prisma.client.findUnique({
        where: { id: payload.clientId },
        select: { storesWithoutBoxes: true },
      });
      if (!client) {
        throw new BadRequestException('Клиент приемки не найден.');
      }
      if (!client.storesWithoutBoxes && !payload.boxCode) {
        throw new BadRequestException('Для этого клиента приемка выполняется с коробами. Сначала отсканируйте номер короба.');
      }

      const receipt = await this.stockOperations.receiveIntoBox(
        {
          clientId: payload.clientId,
          barcode: payload.barcode,
          skuId: payload.skuId,
          kiz: payload.kiz,
          boxCode: client.storesWithoutBoxes ? undefined : payload.boxCode,
          quantity: payload.quantity,
          status: payload.status,
          sourceDocument: payload.sourceDocument,
          idempotencyKey: operation.operationKey,
          comment: payload.comment ?? `Приемка ТСД ${operation.deviceId}`,
        },
        user,
      );

      return this.operationLog.recordResult(
        operation,
        receipt.status === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED' : 'APPLIED',
      );
    } catch (caught) {
      return this.operationLog.recordResult(
        operation,
        'NEEDS_REVIEW',
        caught instanceof Error ? caught.message : 'Приемка ТСД требует разбора.',
        TsdReviewReason.RECEIPT_FAILED,
      );
    }
  }

  private async applyInventoryScan(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult> {
    const payload = this.payloadParser.parseInventoryPayload(operation.payload);
    this.clientScopes.requireClientAccess(user, payload.clientId, 'write');

    const sku = await this.findSku(payload.clientId, payload);
    if (!sku) {
      return this.operationLog.recordResult(
        operation,
        'NEEDS_REVIEW',
        'SKU или штрихкод не найден у клиента.',
        TsdReviewReason.SKU_NOT_FOUND,
      );
    }

    const box = await this.prisma.box.findUnique({
      where: { clientId_code: { clientId: payload.clientId, code: payload.boxCode } },
    });
    if (!box) {
      return this.operationLog.recordResult(
        operation,
        'NEEDS_REVIEW',
        `Короб ${payload.boxCode} не найден.`,
        TsdReviewReason.BOX_NOT_FOUND,
      );
    }

    const status = payload.status ?? StockStatus.AVAILABLE;
    const balance = await this.prisma.stockBalance.findFirst({
      where: {
        clientId: payload.clientId,
        skuId: sku.id,
        boxId: box.id,
        status,
      },
    });
    const currentQuantity = balance?.quantity ?? 0;

    if (currentQuantity !== payload.countedQuantity) {
      return this.operationLog.recordResult(
        operation,
        'NEEDS_REVIEW',
        `Расхождение инвентаризации: в WMS ${currentQuantity}, на ТСД ${payload.countedQuantity}.`,
        TsdReviewReason.INVENTORY_MISMATCH,
      );
    }

    return this.operationLog.recordResult(operation, 'ACCEPTED', 'Инвентаризация совпала с остатком WMS.');
  }

  private findSku(clientId: string, payload: { skuId?: string; barcode?: string }) {
    if (payload.skuId) {
      return this.prisma.sku.findFirst({ where: { id: payload.skuId, clientId } });
    }

    return this.prisma.barcode
      .findFirst({
        where: {
          value: payload.barcode,
          sku: { clientId },
        },
        include: { sku: true },
      })
      .then((barcode) => barcode?.sku ?? null);
  }
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
