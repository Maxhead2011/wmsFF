import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ClientRequestStatus, Prisma } from '@prisma/client';
import { captureShippedKizHistory } from '../../common/shipment-history/shipped-kiz-history';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

@Injectable()
export class WarehouseShipmentHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async list(
    filter: {
      clientId?: string;
      periodFrom?: string;
      periodTo?: string;
      search?: string;
    },
    user: AuthUser,
  ) {
    const clientId = filter.clientId?.trim();
    const search = filter.search?.trim();
    const periodFrom = optionalDate(filter.periodFrom, false);
    const periodTo = optionalDate(filter.periodTo, true);
    const warehouseId = resolveScopedWarehouseId(user, 'read');
    return this.prisma.shippedKizHistory.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, clientId || undefined),
        ...(warehouseId ? { warehouseId } : {}),
        shippedAt:
          periodFrom || periodTo
            ? {
                gte: periodFrom,
                lte: periodTo,
              }
            : undefined,
        ...(search
          ? {
              OR: [
                { kiz: { contains: search, mode: 'insensitive' } },
                { orderId: { contains: search, mode: 'insensitive' } },
                { internalSku: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
                { productName: { contains: search, mode: 'insensitive' } },
                { sourceBoxCode: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { shippedAt: 'desc' },
      take: 1000,
    });
  }

  async sync(user: AuthUser, clientIdValue?: string) {
    const clientId = clientIdValue?.trim();
    const clientFilter = this.clientScopes.resolveClientFilter(user, clientId || undefined);
    const warehouseId = resolveScopedWarehouseId(user, 'write');
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: clientFilter,
        status: ClientRequestStatus.DONE,
        ...(warehouseId ? { warehouseId } : {}),
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    let added = 0;
    for (const request of requests) {
      added += await this.prisma.$transaction((tx) =>
        captureShippedKizHistory(tx, request.id, request.updatedAt),
      );
    }
    return { checkedRequests: requests.length, added };
  }
}

function resolveScopedWarehouseId(user: AuthUser, access: 'read' | 'write') {
  if (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.includes('CLIENT') ||
    (!user.roleCodes.includes('BRANCH_MANAGER') && (user.warehouseIds?.length ?? 0) === 0)
  ) {
    return null;
  }
  const warehouseId = user.activeWarehouseId?.trim() || null;
  const allowedWarehouseIds = access === 'write' ? user.writableWarehouseIds : user.warehouseIds;
  if (!warehouseId || !(allowedWarehouseIds ?? []).includes(warehouseId)) {
    throw new ForbiddenException(
      access === 'write'
        ? 'Выберите доступный для изменения активный филиал.'
        : 'Выберите доступный активный филиал.',
    );
  }
  return warehouseId;
}

function optionalDate(value: string | undefined, endOfDay: boolean) {
  if (!value?.trim()) return undefined;
  const parsed = new Date(`${value.trim()}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Некорректный период истории.');
  return parsed;
}
