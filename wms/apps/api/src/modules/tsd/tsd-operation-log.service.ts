import { Injectable } from '@nestjs/common';
import { Prisma, TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ScanOperationDto } from './dto/scan-operation.dto';
import { TsdOperationResult } from './tsd-operation.types';
import { receiptConflictDetails, TsdKizDuplicateDetails } from './kiz-receipt-conflict';

@Injectable()
export class TsdOperationLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async findExisting(operationKey: string) {
    // FIX: replay uses the durable receipt, not screenshot/payload history.
    if (process.env.WMS_COMPACT_OPERATION_RECEIPTS_ENABLED === 'true') {
      const row = await this.prisma.tsdOperation.findUnique({ where: { operationKey },
        select: { status: true, serverMessage: true, reviewReason: true, resolutionMessage: true } });
      // FIX: ordinary successful replays stay compact; only a receipt rejection needs its diagnostic.
      if (process.env.WMS_KIZ_CLIENT_GUARD_ENABLED === 'true' && row?.status === 'NEEDS_REVIEW' && row.reviewReason === 'RECEIPT_FAILED') {
        const detail = await this.prisma.tsdOperation.findUnique({ where: { operationKey }, select: { payload: true, deviceId: true, operationType: true } });
        return { ...row, ...detail };
      }
      return row;
    }
    return this.prisma.tsdOperation.findUnique({ where: { operationKey } });
  }

  listReviewQueue(user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);

    return this.prisma.tsdOperation.findMany({
      where: { status: TsdOperationStatus.NEEDS_REVIEW },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async recordResult(
    operation: ScanOperationDto,
    status: TsdOperationResult['status'],
    message?: string,
    reviewReason?: TsdReviewReason,
    resolutionMessage?: string,
    conflict?: TsdKizDuplicateDetails,
    receiptScope?: { clientId: string; warehouseId?: string | null },
  ) {
    const persistedStatus = this.toPersistedStatus(status);
    const details = status === 'NEEDS_REVIEW' ? receiptConflictDetails(conflict) : undefined;
    const payload = { ...(operation.payload as Record<string, unknown>) };
    if (process.env.WMS_KIZ_CLIENT_GUARD_ENABLED === 'true') {
      delete payload._kizDuplicate;
      delete payload._kizDuplicateScope;
      if (details) {
        payload._kizDuplicate = details;
        if (receiptScope) payload._kizDuplicateScope = { clientId: receiptScope.clientId, warehouseId: receiptScope.warehouseId ?? null };
      }
    }

    await this.prisma.tsdOperation.upsert({
      where: { operationKey: operation.operationKey },
      update: {
        status: persistedStatus,
        serverMessage: message,
        reviewReason,
        resolutionMessage,
        ...(details ? { payload: payload as Prisma.InputJsonValue } : {}),
      },
      create: {
        deviceId: operation.deviceId,
        operationKey: operation.operationKey,
        operationType: operation.operationType,
        payload: payload as Prisma.InputJsonValue,
        status: persistedStatus,
        serverMessage: message,
        reviewReason,
        resolutionMessage,
      },
    });

    return this.result(operation, status, message, reviewReason, resolutionMessage, details);
  }

  existingResult(
    operation: ScanOperationDto,
    existing: {
      status: TsdOperationStatus;
      serverMessage?: string | null;
      reviewReason?: TsdReviewReason | null;
      resolutionMessage?: string | null;
      payload?: unknown;
      deviceId?: string;
      operationType?: string;
    },
    user?: AuthUser,
  ): TsdOperationResult {
    const message = existing.resolutionMessage ?? existing.serverMessage ?? undefined;
    const reviewReason = existing.reviewReason ?? undefined;
    const resolutionMessage = existing.resolutionMessage ?? undefined;

    if (existing.status === TsdOperationStatus.ACCEPTED) {
      return this.result(operation, 'ALREADY_APPLIED', message, reviewReason, resolutionMessage);
    }

    const payload = existing.payload && typeof existing.payload === 'object'
      ? existing.payload as Record<string, unknown> : {};
    const details = receiptConflictDetails(payload._kizDuplicate);
    if (details) {
      // FIX: replay must neither disclose another receipt nor overwrite/re-execute its operation key.
      const scope = payload._kizDuplicateScope as { clientId?: string; warehouseId?: string | null } | undefined;
      let allowed = !!user && existing.operationType === 'receipt_scan' && operation.operationType === 'receipt_scan'
        && existing.deviceId === operation.deviceId && typeof payload.clientId === 'string'
        && payload.clientId === operation.payload.clientId && scope?.clientId === payload.clientId
        && (!scope.warehouseId || scope.warehouseId === user.activeWarehouseId);
      if (allowed) {
        try { this.clientScopes.requireClientAccess(user!, payload.clientId as string, 'write'); }
        catch { allowed = false; }
      }
      if (!allowed) return this.result(operation, 'REJECTED', 'Эта операция недоступна в текущем контексте приёмки. Обратитесь к администратору.');
    }
    return this.result(operation, existing.status, message, reviewReason, resolutionMessage, details);
  }

  result(
    operation: ScanOperationDto,
    status: TsdOperationResult['status'],
    message?: string,
    reviewReason?: TsdReviewReason,
    resolutionMessage?: string,
    conflict?: TsdKizDuplicateDetails,
  ): TsdOperationResult {
    return {
      operationKey: operation.operationKey,
      operationType: operation.operationType,
      status,
      message,
      reviewReason,
      resolutionMessage,
      ...(status === 'NEEDS_REVIEW' ? receiptConflictDetails(conflict) : undefined),
      serverTime: new Date().toISOString(),
    };
  }

  private toPersistedStatus(status: TsdOperationResult['status']): TsdOperationStatus {
    if (status === 'NEEDS_REVIEW') {
      return TsdOperationStatus.NEEDS_REVIEW;
    }

    if (status === 'REJECTED') {
      return TsdOperationStatus.REJECTED;
    }

    // Русский комментарий: APPLIED/ACCEPTED/ALREADY_APPLIED в TSD log считаются закрытой операцией.
    return TsdOperationStatus.ACCEPTED;
  }
}
