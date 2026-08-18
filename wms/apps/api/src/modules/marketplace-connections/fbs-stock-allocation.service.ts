import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  ExternalFbsStockAllocationDto,
  ExternalFbsStocksDto,
  UpdateFbsStockAllocationDto,
} from './dto/fbs-stock-allocation.dto';
import {
  recommendFbsStockPercentages,
  validateFbsStockAllocationShares,
} from './fbs-stock-allocation';

export type FbsStockAllocationActor = {
  source: 'WMS' | 'CLIENT_PORTAL' | 'EXTERNAL_CLIENT';
  userId?: string;
  apiKeyId?: string;
  externalReference?: string;
};

@Injectable()
export class FbsStockAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    clientId: string,
    connectionId: string,
    demandByWarehouse: ReadonlyMap<string, number> = new Map(),
  ) {
    const connection = await this.requireConnection(clientId, connectionId);
    const routes = await this.workingRoutes(connection.id);
    const policy = await this.prisma.fbsStockAllocationPolicy.findUnique({
      where: { connectionId: connection.id },
      include: {
        shares: { orderBy: [{ isPrimary: 'desc' }, { warehouseName: 'asc' }] },
        changes: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { apiKey: { select: { id: true, name: true, keyPrefix: true } } },
        },
        _count: { select: { overrides: true } },
      },
    });
    const keys = await this.prisma.fbsStockIntegrationApiKey.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        isActive: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    const routeIds = routes.map((route) => route.warehouseId);
    const recommendations = recommendFbsStockPercentages(routeIds, demandByWarehouse);
    const recommendationById = new Map(
      recommendations.map((row) => [row.warehouseId, row.percent]),
    );
    const savedById = new Map(policy?.shares.map((share) => [share.warehouseId, share]));
    const primaryWarehouseId =
      policy?.primaryWarehouseId || connection.fbsWarehouseId || routes[0]?.warehouseId || null;
    const shares = routes.map((route) => ({
      ...route,
      percent: savedById.get(route.warehouseId)?.percent ?? 0,
      isPrimary: route.warehouseId === primaryWarehouseId,
      recommendedPercent: recommendationById.get(route.warehouseId) ?? 0,
    }));

    return {
      client: connection.client,
      connection: {
        id: connection.id,
        accountName: connection.accountName,
        primaryWarehouseId: connection.fbsWarehouseId,
      },
      policy: {
        id: policy?.id ?? null,
        enabled: policy?.enabled ?? false,
        lowStockThreshold: policy?.lowStockThreshold ?? 10,
        recommendationDays: policy?.recommendationDays ?? 30,
        updatedSource: policy?.updatedSource ?? 'WMS',
        changedByClientAt: policy?.changedByClientAt?.toISOString() ?? null,
        lastSyncedAt: policy?.lastSyncedAt?.toISOString() ?? null,
        lastError: policy?.lastError ?? null,
        overrideCount: policy?._count.overrides ?? 0,
      },
      shares,
      recommendation: {
        periodDays: policy?.recommendationDays ?? 30,
        basedOnOrders: [...demandByWarehouse.values()].reduce((sum, value) => sum + value, 0),
      },
      integrationKeys: keys.map((key) => ({
        ...key,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
      changes: (policy?.changes ?? []).map((change) => ({
        id: change.id,
        source: change.source,
        changeType: change.changeType,
        externalReference: change.externalReference,
        payload: change.payload,
        acknowledged: Boolean(change.acknowledgedAt),
        acknowledgedAt: change.acknowledgedAt?.toISOString() ?? null,
        createdAt: change.createdAt.toISOString(),
        integration: change.apiKey,
      })),
      unacknowledgedChanges: (policy?.changes ?? []).filter((change) => !change.acknowledgedAt).length,
    };
  }

  async saveInternal(dto: UpdateFbsStockAllocationDto, actor: FbsStockAllocationActor) {
    return this.save(dto, actor);
  }

  async saveExternal(
    clientId: string,
    dto: ExternalFbsStockAllocationDto,
    apiKeyId: string,
  ) {
    return this.save(
      {
        clientId,
        connectionId: dto.connectionId,
        enabled: dto.enabled,
        lowStockThreshold: dto.lowStockThreshold,
        recommendationDays: 30,
        shares: dto.shares,
      },
      {
        source: 'EXTERNAL_CLIENT',
        apiKeyId,
        externalReference: dto.externalReference,
      },
    );
  }

  private async save(dto: UpdateFbsStockAllocationDto, actor: FbsStockAllocationActor) {
    const connection = await this.requireConnection(dto.clientId.trim(), dto.connectionId.trim());
    const routes = await this.workingRoutes(connection.id);
    if (routes.length === 0) {
      throw new BadRequestException(
        'Сначала настройте рабочие склады в маршрутизации FBS.',
      );
    }
    const routeById = new Map(routes.map((route) => [route.warehouseId, route]));
    let validated;
    try {
      validated = validateFbsStockAllocationShares(dto.shares);
    } catch (caught) {
      throw new BadRequestException(caught instanceof Error ? caught.message : 'Неверные доли складов.');
    }
    const unknown = validated.filter((share) => !routeById.has(share.warehouseId));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Склады отсутствуют в маршрутизации FBS: ${unknown.map((row) => row.warehouseId).join(', ')}.`,
      );
    }
    const normalized = routes.map((route) => {
      const configured = validated.find((share) => share.warehouseId === route.warehouseId);
      return {
        warehouseId: route.warehouseId,
        warehouseName: route.warehouseName,
        percent: configured?.percent ?? 0,
        isPrimary: configured?.isPrimary ?? false,
      };
    });
    if (normalized.filter((row) => row.isPrimary).length !== 1) {
      throw new BadRequestException('Основной склад должен входить в рабочую маршрутизацию FBS.');
    }
    const primaryWarehouseId = normalized.find((row) => row.isPrimary)!.warehouseId;
    const now = new Date();
    const existingDuplicate = actor.externalReference && actor.apiKeyId
      ? await this.prisma.fbsStockAllocationChange.findUnique({
          where: {
            apiKeyId_externalReference: {
              apiKeyId: actor.apiKeyId,
              externalReference: actor.externalReference,
            },
          },
          select: { id: true },
        })
      : null;
    if (existingDuplicate) return { updated: false, duplicate: true, changeId: existingDuplicate.id };

    const policy = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.fbsStockAllocationPolicy.upsert({
        where: { connectionId: connection.id },
        create: {
          clientId: dto.clientId,
          connectionId: connection.id,
          enabled: dto.enabled,
          primaryWarehouseId,
          lowStockThreshold: dto.lowStockThreshold,
          recommendationDays: dto.recommendationDays,
          updatedSource: actor.source,
          changedByClientAt: actor.source === 'WMS' ? null : now,
        },
        update: {
          enabled: dto.enabled,
          primaryWarehouseId,
          lowStockThreshold: dto.lowStockThreshold,
          recommendationDays: dto.recommendationDays,
          updatedSource: actor.source,
          changedByClientAt: actor.source === 'WMS' ? null : now,
          lastError: null,
        },
      });
      await tx.fbsStockAllocationShare.deleteMany({ where: { policyId: saved.id } });
      await tx.fbsStockAllocationShare.createMany({
        data: normalized.map((share) => ({ policyId: saved.id, ...share })),
      });
      let changeId: string | null = null;
      if (actor.source !== 'WMS') {
        const change = await tx.fbsStockAllocationChange.create({
          data: {
            clientId: dto.clientId,
            policyId: saved.id,
            apiKeyId: actor.apiKeyId,
            source: actor.source,
            changeType: 'PERCENTAGES_UPDATED',
            externalReference: actor.externalReference,
            payload: {
              enabled: dto.enabled,
              lowStockThreshold: dto.lowStockThreshold,
              shares: normalized,
            },
          },
        });
        changeId = change.id;
      }
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: actor.source === 'WMS'
            ? 'FBS_STOCK_ALLOCATION_UPDATED'
            : 'FBS_STOCK_ALLOCATION_CHANGED_BY_CLIENT',
          entity: 'FbsStockAllocationPolicy',
          entityId: saved.id,
          payload: {
            clientId: dto.clientId,
            connectionId: connection.id,
            source: actor.source,
            enabled: dto.enabled,
            lowStockThreshold: dto.lowStockThreshold,
            shares: normalized,
            changeId,
          },
        },
      });
      return { saved, changeId };
    });
    return { updated: true, duplicate: false, policyId: policy.saved.id, changeId: policy.changeId };
  }

  async createApiKey(clientId: string, name: string, userId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден.');
    const secret = `wms_fbs_${randomBytes(32).toString('base64url')}`;
    const keyHash = apiKeyHash(secret);
    const key = await this.prisma.fbsStockIntegrationApiKey.create({
      data: {
        clientId,
        name: name.trim(),
        keyHash,
        keyPrefix: secret.slice(0, 16),
        createdByUserId: userId,
      },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'FBS_STOCK_INTEGRATION_KEY_CREATED',
        entity: 'FbsStockIntegrationApiKey',
        entityId: key.id,
        payload: { clientId, name: key.name, keyPrefix: key.keyPrefix },
      },
    });
    // ADDED: The plaintext key is returned once and is never persisted.
    return { ...key, createdAt: key.createdAt.toISOString(), apiKey: secret };
  }

  async revokeApiKey(clientId: string, keyId: string, userId: string) {
    const key = await this.prisma.fbsStockIntegrationApiKey.findFirst({
      where: { id: keyId, clientId },
      select: { id: true },
    });
    if (!key) throw new NotFoundException('Интеграционный ключ не найден.');
    await this.prisma.$transaction([
      this.prisma.fbsStockIntegrationApiKey.update({
        where: { id: key.id },
        data: { isActive: false, revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'FBS_STOCK_INTEGRATION_KEY_REVOKED',
          entity: 'FbsStockIntegrationApiKey',
          entityId: key.id,
          payload: { clientId },
        },
      }),
    ]);
    return { revoked: true, keyId: key.id };
  }

  async authenticateApiKey(value: string | undefined) {
    const secret = value?.trim() ?? '';
    if (!secret.startsWith('wms_fbs_') || secret.length < 32) {
      throw new UnauthorizedException('Неверный X-WMS-API-Key.');
    }
    const key = await this.prisma.fbsStockIntegrationApiKey.findUnique({
      where: { keyHash: apiKeyHash(secret) },
      select: { id: true, clientId: true, isActive: true, revokedAt: true },
    });
    if (!key?.isActive || key.revokedAt) throw new UnauthorizedException('Интеграционный ключ отключён.');
    await this.prisma.fbsStockIntegrationApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });
    return key;
  }

  async saveExternalStockOverrides(clientId: string, apiKeyId: string, dto: ExternalFbsStocksDto) {
    const connection = await this.requireConnection(clientId, dto.connectionId);
    const policy = await this.prisma.fbsStockAllocationPolicy.findUnique({
      where: { connectionId: connection.id },
      select: { id: true, enabled: true },
    });
    if (!policy?.enabled) {
      throw new ConflictException('Сначала включите распределение остатков в WMS.');
    }
    if (dto.externalReference) {
      const duplicate = await this.prisma.fbsStockAllocationChange.findUnique({
        where: {
          apiKeyId_externalReference: { apiKeyId, externalReference: dto.externalReference },
        },
        select: { id: true },
      });
      if (duplicate) return { updated: false, duplicate: true, changeId: duplicate.id };
    }
    // FIX: keep external stock rows strongly typed before de-duplication.
    const resolved: Array<{ skuId: string; requestedAmount: number }> = [];
    for (const item of dto.items) {
      const sku = await this.resolveSku(clientId, item);
      resolved.push({ skuId: sku.id, requestedAmount: item.requestedAmount });
    }
    const unique = new Map(resolved.map((row) => [row.skuId, row]));
    if (unique.size !== resolved.length) {
      throw new BadRequestException('Один товар указан в запросе несколько раз.');
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of resolved) {
        await tx.fbsStockAllocationOverride.upsert({
          where: { policyId_skuId: { policyId: policy.id, skuId: item.skuId } },
          create: {
            clientId,
            policyId: policy.id,
            skuId: item.skuId,
            requestedAmount: item.requestedAmount,
            updatedSource: 'EXTERNAL_CLIENT',
            changedByClientAt: now,
            updatedByApiKeyId: apiKeyId,
          },
          update: {
            requestedAmount: item.requestedAmount,
            updatedSource: 'EXTERNAL_CLIENT',
            changedByClientAt: now,
            updatedByApiKeyId: apiKeyId,
          },
        });
      }
      const change = await tx.fbsStockAllocationChange.create({
        data: {
          clientId,
          policyId: policy.id,
          apiKeyId,
          source: 'EXTERNAL_CLIENT',
          changeType: 'STOCK_LIMITS_UPDATED',
          externalReference: dto.externalReference,
          payload: {
            items: resolved.slice(0, 500),
            itemCount: resolved.length,
            truncated: resolved.length > 500,
          },
        },
      });
      await tx.fbsStockAllocationPolicy.update({
        where: { id: policy.id },
        data: { updatedSource: 'EXTERNAL_CLIENT', changedByClientAt: now, lastError: null },
      });
      await tx.auditLog.create({
        data: {
          action: 'FBS_STOCK_LIMITS_CHANGED_BY_CLIENT',
          entity: 'FbsStockAllocationPolicy',
          entityId: policy.id,
          payload: { clientId, connectionId: connection.id, itemCount: resolved.length, changeId: change.id },
        },
      });
      return change;
    });
    return { updated: true, duplicate: false, updatedItems: resolved.length, changeId: result.id };
  }

  async acknowledgeChange(clientId: string, changeId: string, userId: string) {
    const change = await this.prisma.fbsStockAllocationChange.findFirst({
      where: { id: changeId, clientId },
      select: { id: true },
    });
    if (!change) throw new NotFoundException('Изменение остатков не найдено.');
    const acknowledgedAt = new Date();
    await this.prisma.fbsStockAllocationChange.update({
      where: { id: change.id },
      data: { acknowledgedAt, acknowledgedByUserId: userId },
    });
    return { acknowledged: true, changeId: change.id, acknowledgedAt: acknowledgedAt.toISOString() };
  }

  async activePolicy(connectionId: string) {
    return this.prisma.fbsStockAllocationPolicy.findFirst({
      where: { connectionId, enabled: true },
      include: { shares: true, overrides: true },
    });
  }

  async markSync(policyId: string, error: string | null) {
    await this.prisma.fbsStockAllocationPolicy.update({
      where: { id: policyId },
      data: error
        ? { lastError: error }
        : { lastError: null, lastSyncedAt: new Date() },
    });
  }

  private async requireConnection(clientId: string, connectionId: string) {
    const connection = await this.prisma.clientMarketplaceConnection.findFirst({
      where: { id: connectionId, clientId, marketplace: 'WILDBERRIES', isActive: true },
      include: { client: { select: { id: true, code: true, name: true } } },
    });
    if (!connection) throw new NotFoundException('Подключение Wildberries этого клиента не найдено.');
    return connection;
  }

  private async workingRoutes(connectionId: string) {
    const rows = await this.prisma.fbsWarehouseRoutingRule.findMany({
      where: { connectionId, mode: { not: 'EXCLUDED' } },
      orderBy: [{ marketplaceWarehouseName: 'asc' }, { marketplaceWarehouseId: 'asc' }],
      select: { marketplaceWarehouseId: true, marketplaceWarehouseName: true, mode: true },
    });
    return rows.map((row) => ({
      warehouseId: row.marketplaceWarehouseId,
      warehouseName: row.marketplaceWarehouseName || `Склад WB ${row.marketplaceWarehouseId}`,
      routeMode: row.mode,
    }));
  }

  private async resolveSku(
    clientId: string,
    item: { skuId?: string; barcode?: string; article?: string },
  ) {
    const references = [item.skuId, item.barcode, item.article].filter((value) => value?.trim());
    if (references.length !== 1) {
      throw new BadRequestException('Для товара укажите ровно одно поле: skuId, barcode или article.');
    }
    const where = item.skuId
      ? { id: item.skuId.trim(), clientId }
      : item.barcode
        ? { clientId, barcodes: { some: { value: { equals: item.barcode.trim(), mode: 'insensitive' as const } } } }
        : {
            clientId,
            OR: [
              { article: { equals: item.article!.trim(), mode: 'insensitive' as const } },
              { clientSku: { equals: item.article!.trim(), mode: 'insensitive' as const } },
              { internalSku: { equals: item.article!.trim(), mode: 'insensitive' as const } },
            ],
          };
    const rows = await this.prisma.sku.findMany({ where, select: { id: true }, take: 2 });
    if (rows.length === 0) throw new NotFoundException('Товар клиента не найден.');
    if (rows.length > 1) throw new ConflictException('Артикул неоднозначен; передайте skuId или штрихкод.');
    return rows[0]!;
  }
}

function apiKeyHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
