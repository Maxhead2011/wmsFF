import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { CreateIntegrationCredentialDto } from './dto/create-integration-credential.dto';
import { WMS_INTEGRATION_SCOPES, WMS_INTEGRATION_SCOPE_LABELS } from './integration-api.constants';
import { generateWmsApiKey, normalizeAllowedIps, normalizeIntegrationScopes } from './integration-api-key';

@Injectable()
export class IntegrationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  scopes() {
    return WMS_INTEGRATION_SCOPES.map((code) => ({ code, name: WMS_INTEGRATION_SCOPE_LABELS[code] }));
  }

  async options(user: AuthUser) {
    const global = user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
    // FIX: the dedicated role authorizes key management without granting general client editing rights.
    const clientIds = global ? undefined : user.clientIds;
    const clients = await this.prisma.client.findMany({
      where: { status: 'ACTIVE', ...(clientIds ? { id: { in: clientIds } } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    const allowedClientIds = clients.map((client) => client.id);
    const warehouseIds = !global && !user.roleCodes.includes('CLIENT') ? user.writableWarehouseIds ?? [] : undefined;
    const links = await this.prisma.warehouseClient.findMany({
      where: {
        status: 'ACTIVE',
        clientId: { in: allowedClientIds },
        warehouse: { isActive: true, ...(warehouseIds ? { id: { in: warehouseIds } } : {}) },
      },
      select: {
        clientId: true,
        warehouse: { select: { id: true, code: true, name: true, city: true } },
      },
      orderBy: { warehouse: { sortOrder: 'asc' } },
    });
    return { clients, warehouses: links.map((link) => ({ clientId: link.clientId, ...link.warehouse })) };
  }

  async list(user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const credentials = await this.prisma.wmsApiCredential.findMany({
      where: { clientId: clientFilter },
      select: {
        id: true,
        name: true,
        clientId: true,
        warehouseId: true,
        keyPrefix: true,
        scopes: true,
        allowedIps: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        lastUsedIp: true,
        createdAt: true,
        client: { select: { code: true, name: true } },
        warehouse: { select: { code: true, name: true, city: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return credentials.map((credential) => ({
      ...credential,
      scopes: jsonStringArray(credential.scopes),
      allowedIps: jsonStringArray(credential.allowedIps),
    }));
  }

  async create(dto: CreateIntegrationCredentialDto, user: AuthUser) {
    await this.requireCredentialTarget(user, dto.clientId, dto.warehouseId);
    const material = generateWmsApiKey();
    const scopes = normalizeIntegrationScopes(dto.scopes);
    const allowedIps = normalizeAllowedIps(dto.allowedIps);
    const expiresAt = parseFutureExpiry(dto.expiresAt);

    const saved = await this.prisma.wmsApiCredential.create({
      data: {
        name: dto.name.trim(),
        clientId: dto.clientId,
        warehouseId: dto.warehouseId,
        keyPrefix: material.keyPrefix,
        keyHash: material.keyHash,
        scopes: scopes as Prisma.InputJsonValue,
        allowedIps: allowedIps as Prisma.InputJsonValue,
        expiresAt,
        createdByUserId: user.id,
      },
      select: { id: true, name: true, clientId: true, warehouseId: true, keyPrefix: true, createdAt: true },
    });
    await this.audit(user, 'wms_api.credential.created', saved.id, {
      clientId: dto.clientId,
      warehouseId: dto.warehouseId,
      keyPrefix: material.keyPrefix,
      scopes,
      allowedIps,
      expiresAt,
    });

    // FIX: the raw secret is returned exactly once and is never persisted.
    return { credential: saved, apiKey: material.rawKey, shownOnce: true };
  }

  async rotate(id: string, user: AuthUser) {
    const credential = await this.requireCredential(id, user);
    const material = generateWmsApiKey();
    const updated = await this.prisma.wmsApiCredential.update({
      where: { id },
      data: { keyPrefix: material.keyPrefix, keyHash: material.keyHash, revokedAt: null },
      select: { id: true, name: true, clientId: true, warehouseId: true, keyPrefix: true, updatedAt: true },
    });
    await this.audit(user, 'wms_api.credential.rotated', id, {
      previousKeyPrefix: credential.keyPrefix,
      keyPrefix: material.keyPrefix,
    });
    return { credential: updated, apiKey: material.rawKey, shownOnce: true };
  }

  async revoke(id: string, user: AuthUser) {
    await this.requireCredential(id, user);
    const revokedAt = new Date();
    const credential = await this.prisma.wmsApiCredential.update({
      where: { id },
      data: { revokedAt },
      select: { id: true, name: true, keyPrefix: true, revokedAt: true },
    });
    await this.audit(user, 'wms_api.credential.revoked', id, { revokedAt });
    return credential;
  }

  private async requireCredential(id: string, user: AuthUser) {
    const credential = await this.prisma.wmsApiCredential.findUnique({ where: { id } });
    if (!credential) throw new NotFoundException('API-доступ не найден.');
    await this.requireCredentialTarget(user, credential.clientId, credential.warehouseId);
    return credential;
  }

  private async requireCredentialTarget(user: AuthUser, clientId: string, warehouseId: string) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const isGlobal = user.permissionCodes.includes('system:admin');
    if (!isGlobal && !user.roleCodes.includes('CLIENT') && !user.writableWarehouseIds?.includes(warehouseId)) {
      throw new ForbiddenException('Нет права создавать API-доступ для этого филиала.');
    }
    const link = await this.prisma.warehouseClient.findUnique({
      where: { warehouseId_clientId: { warehouseId, clientId } },
      include: { warehouse: { select: { isActive: true } } },
    });
    if (!link || link.status !== 'ACTIVE' || !link.warehouse.isActive) {
      throw new BadRequestException('Клиент не активирован на выбранном складе.');
    }
  }

  private audit(user: AuthUser, action: string, entityId: string, payload: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({
      data: { userId: user.id, action, entity: 'WmsApiCredential', entityId, payload },
    });
  }
}

function parseFutureExpiry(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (parsed.getTime() <= Date.now()) {
    throw new BadRequestException('Срок действия API-ключа должен быть в будущем.');
  }
  return parsed;
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
