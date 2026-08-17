import { Injectable } from '@nestjs/common';
import { Prisma, TsdOperationStatus, TsdReviewReason } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ScanOperationDto } from './dto/scan-operation.dto';
import { TsdOperationResult } from './tsd-operation.types';

@Injectable()
export class TsdOperationLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  findExisting(operationKey: string) {
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
  ) {
    const persistedStatus = this.toPersistedStatus(status);

    await this.prisma.tsdOperation.upsert({
      where: { operationKey: operation.operationKey },
      update: {
        status: persistedStatus,
        serverMessage: message,
        reviewReason,
        resolutionMessage,
      },
      create: {
        deviceId: operation.deviceId,
        operationKey: operation.operationKey,
        operationType: operation.operationType,
        payload: operation.payload as Prisma.InputJsonValue,
        status: persistedStatus,
        serverMessage: message,
        reviewReason,
        resolutionMessage,
      },
    });

    return this.result(operation, status, message, reviewReason, resolutionMessage);
  }

  existingResult(
    operation: ScanOperationDto,
    existing: {
      status: TsdOperationStatus;
      serverMessage?: string | null;
      reviewReason?: TsdReviewReason | null;
      resolutionMessage?: string | null;
    },
  ): TsdOperationResult {
    const message = existing.resolutionMessage ?? existing.serverMessage ?? undefined;
    const reviewReason = existing.reviewReason ?? undefined;
    const resolutionMessage = existing.resolutionMessage ?? undefined;

    if (existing.status === TsdOperationStatus.ACCEPTED) {
      return this.result(operation, 'ALREADY_APPLIED', message, reviewReason, resolutionMessage);
    }

    return this.result(operation, existing.status, message, reviewReason, resolutionMessage);
  }

  result(
    operation: ScanOperationDto,
    status: TsdOperationResult['status'],
    message?: string,
    reviewReason?: TsdReviewReason,
    resolutionMessage?: string,
  ): TsdOperationResult {
    return {
      operationKey: operation.operationKey,
      operationType: operation.operationType,
      status,
      message,
      reviewReason,
      resolutionMessage,
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
