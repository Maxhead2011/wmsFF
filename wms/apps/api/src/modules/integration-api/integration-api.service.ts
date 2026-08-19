import { ForbiddenException, Injectable } from '@nestjs/common';
import { ClientNotificationSeverity, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { StockOperationsService } from '../stock/stock-operations.service';
import { CreateIntegrationStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import {
  ListIntegrationDataDto,
  ListIntegrationRequestsDto,
  ListIntegrationStocksDto,
} from './dto/list-integration-data.dto';
import { integrationIdempotencyKey } from './integration-api-key';
import type { WmsIntegrationScope } from './integration-api.constants';
import type { WmsIntegrationContext } from './integration-api.types';

@Injectable()
export class IntegrationApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockOperations: StockOperationsService,
  ) {}

  async profile(context: WmsIntegrationContext) {
    const data = await this.prisma.wmsApiCredential.findUniqueOrThrow({
      where: { id: context.credential.id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        expiresAt: true,
        client: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true, city: true } },
      },
    });
    return { data };
  }

  async catalog(context: WmsIntegrationContext, query: ListIntegrationDataDto) {
    this.requireScope(context, 'catalog:read');
    const rows = await this.prisma.sku.findMany({
      where: {
        clientId: context.credential.clientId,
        ...(query.updatedSince ? { updatedAt: { gt: new Date(query.updatedSince) } } : {}),
      },
      include: { barcodes: { select: { value: true, isPrimary: true } } },
      orderBy: { id: 'asc' },
      ...page(query, 200),
    });
    return envelope(rows, query.limit ?? 200);
  }

  async stocks(context: WmsIntegrationContext, query: ListIntegrationStocksDto) {
    this.requireScope(context, 'stock:read');
    const rows = await this.prisma.stockBalance.findMany({
      where: {
        clientId: context.credential.clientId,
        warehouseId: context.credential.warehouseId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.updatedSince ? { updatedAt: { gt: new Date(query.updatedSince) } } : {}),
        ...(query.barcode ? { sku: { barcodes: { some: { value: query.barcode } } } } : {}),
      },
      select: {
        id: true,
        skuId: true,
        boxId: true,
        palletId: true,
        status: true,
        quantity: true,
        updatedAt: true,
        sku: {
          select: {
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            barcodes: { select: { value: true, isPrimary: true } },
          },
        },
        box: { select: { code: true } },
        pallet: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
      ...page(query, 500),
    });
    return envelope(rows, query.limit ?? 500);
  }

  async requests(context: WmsIntegrationContext, query: ListIntegrationRequestsDto) {
    this.requireScope(context, 'requests:read');
    const rows = await this.prisma.clientRequest.findMany({
      where: {
        clientId: context.credential.clientId,
        warehouseId: context.credential.warehouseId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.updatedSince ? { updatedAt: { gt: new Date(query.updatedSince) } } : {}),
      },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        priority: true,
        title: true,
        comment: true,
        desiredDate: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: { id: true, skuId: true, barcode: true, name: true, quantity: true, comment: true },
        },
      },
      orderBy: { id: 'asc' },
      ...page(query, 200),
    });
    return envelope(rows, query.limit ?? 200);
  }

  async movements(context: WmsIntegrationContext, query: ListIntegrationDataDto) {
    this.requireScope(context, 'movements:read');
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        clientId: context.credential.clientId,
        warehouseId: context.credential.warehouseId,
        ...(query.updatedSince ? { createdAt: { gt: new Date(query.updatedSince) } } : {}),
      },
      select: {
        id: true,
        skuId: true,
        boxId: true,
        palletId: true,
        type: true,
        status: true,
        quantity: true,
        sourceDocument: true,
        idempotencyKey: true,
        comment: true,
        createdAt: true,
        sku: { select: { internalSku: true, article: true, name: true } },
        box: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
      ...page(query, 200),
    });
    return envelope(rows, query.limit ?? 200);
  }

  async adjustStock(context: WmsIntegrationContext, dto: CreateIntegrationStockAdjustmentDto) {
    this.requireScope(context, 'stock:write');
    if (dto.status && dto.status !== StockStatus.AVAILABLE) {
      throw new ForbiddenException('Внешний API может корректировать только доступный остаток AVAILABLE.');
    }
    // FIX: the external id is namespaced by credential, preventing cross-client ledger collisions.
    const idempotencyKey = integrationIdempotencyKey(context.credential.keyPrefix, dto.idempotencyKey);
    const user = integrationStockUser(context);
    const result = await this.stockOperations.adjustInventoryToCounted(
      {
        clientId: context.credential.clientId,
        skuId: dto.skuId,
        barcode: dto.barcode?.trim(),
        // FIX: бескоробный клиент меняет остаток без вымышленного boxCode.
        boxCode: dto.boxCode?.trim() || undefined,
        countedQuantity: dto.countedQuantity,
        status: StockStatus.AVAILABLE,
        idempotencyKey,
        comment: `[CLIENT_API:${context.credential.keyPrefix}] ${dto.comment?.trim() || 'Остаток изменён внешней системой клиента'}`,
      },
      user,
    );

    if (result.status === 'APPLIED') {
      await this.prisma.$transaction([
        this.prisma.auditLog.create({
          data: {
            action: 'wms_api.stock.adjusted',
            entity: 'WmsApiCredential',
            entityId: context.credential.id,
            payload: {
              clientId: context.credential.clientId,
              warehouseId: context.credential.warehouseId,
              keyPrefix: context.credential.keyPrefix,
              clientIp: context.clientIp,
              result,
            } as Prisma.InputJsonObject,
          },
        }),
        this.prisma.clientNotification.create({
          data: {
            clientId: context.credential.clientId,
            title: 'Остаток изменён клиентом через API',
            body: `${context.credential.name}: ${result.box ? `короб ${result.box}` : 'без короба'}, количество ${result.previousQuantity} → ${result.countedQuantity}.`,
            severity: ClientNotificationSeverity.WARNING,
          },
        }),
      ]);
    }

    return { data: result };
  }

  private requireScope(context: WmsIntegrationContext, scope: WmsIntegrationScope) {
    if (!context.scopes.includes(scope)) {
      throw new ForbiddenException({ message: 'API-ключу не выдано требуемое право.', requiredScope: scope });
    }
  }
}

function page(query: ListIntegrationDataDto, fallback: number) {
  return {
    take: query.limit ?? fallback,
    ...(query.afterId ? { cursor: { id: query.afterId }, skip: 1 } : {}),
  };
}

function envelope<T extends { id: string }>(rows: T[], limit: number) {
  return {
    data: rows,
    meta: {
      count: rows.length,
      limit,
      nextAfterId: rows.length === limit ? rows.at(-1)?.id ?? null : null,
      generatedAt: new Date().toISOString(),
    },
  };
}

function integrationStockUser(context: WmsIntegrationContext): AuthUser {
  return {
    id: `integration:${context.credential.id}`,
    email: `integration-${context.credential.keyPrefix}@wms.local`,
    name: context.credential.name,
    roleCodes: ['WMS_INTEGRATION'],
    permissionCodes: ['stock:write'],
    clientScopeMode: 'LIMITED',
    clientIds: [context.credential.clientId],
    writableClientIds: [context.credential.clientId],
    activeWarehouseId: context.credential.warehouseId,
    warehouseIds: [context.credential.warehouseId],
    writableWarehouseIds: [context.credential.warehouseId],
  };
}
