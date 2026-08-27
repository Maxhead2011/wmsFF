import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WMS_API_KEY_HEADER, type WmsIntegrationScope } from './integration-api.constants';
import { parseWmsApiKey, safeApiKeyHashEquals } from './integration-api-key';
import type { WmsIntegrationRequest } from './integration-api.types';

@Injectable()
export class IntegrationApiGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<WmsIntegrationRequest>();
    const rawKey = extractApiKey(request.headers);
    const parsed = rawKey ? parseWmsApiKey(rawKey) : null;
    if (!parsed) {
      throw new UnauthorizedException('Передайте действующий API-ключ в заголовке X-WMS-API-Key.');
    }

    const credential = await this.prisma.wmsApiCredential.findUnique({
      where: { keyPrefix: parsed.keyPrefix },
      include: {
        client: { select: { status: true } },
        warehouse: { select: { isActive: true } },
      },
    });
    if (
      !credential ||
      credential.revokedAt ||
      credential.client.status !== 'ACTIVE' ||
      !credential.warehouse.isActive ||
      (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) ||
      !safeApiKeyHashEquals(credential.keyHash, parsed.rawKey)
    ) {
      throw new UnauthorizedException('API-ключ недействителен, отозван или истёк.');
    }

    const warehouseLink = await this.prisma.warehouseClient.findUnique({
      where: {
        warehouseId_clientId: {
          warehouseId: credential.warehouseId,
          clientId: credential.clientId,
        },
      },
      select: { status: true },
    });
    if (warehouseLink?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Доступ клиента к складу отключён.');
    }

    const clientIp = resolveClientIp(request);
    const allowedIps = jsonStringArray(credential.allowedIps);
    if (allowedIps.length && (!clientIp || !allowedIps.includes(clientIp))) {
      throw new UnauthorizedException('IP-адрес не входит в белый список этого API-ключа.');
    }

    request.integration = {
      credential,
      scopes: jsonStringArray(credential.scopes) as WmsIntegrationScope[],
      clientIp,
    };

    // FIX: usage telemetry never blocks the business request if only the timestamp update fails.
    void this.prisma.wmsApiCredential
      .update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date(), lastUsedIp: clientIp },
      })
      .catch(() => undefined);
    return true;
  }
}

function extractApiKey(headers: WmsIntegrationRequest['headers']) {
  const explicit = firstHeader(headers[WMS_API_KEY_HEADER]);
  if (explicit) return explicit.trim();
  const authorization = firstHeader(headers.authorization)?.trim() ?? '';
  return /^ApiKey\s+/i.test(authorization) ? authorization.replace(/^ApiKey\s+/i, '').trim() : null;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function resolveClientIp(request: WmsIntegrationRequest) {
  const direct = normalizeIp(request.ip);
  const forwarded = normalizeIp(firstHeader(request.headers['x-real-ip'])) ??
    normalizeIp(firstHeader(request.headers['x-forwarded-for'])?.split(',')[0]);
  return direct && isTrustedProxy(direct) ? forwarded ?? direct : direct ?? forwarded;
}

function normalizeIp(value?: string) {
  const normalized = value?.trim().replace(/^::ffff:/, '');
  return normalized || null;
}

function isTrustedProxy(ip: string) {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (!ip.startsWith('172.')) return false;
  const secondOctet = Number(ip.split('.')[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}
