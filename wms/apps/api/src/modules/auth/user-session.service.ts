import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { TokenPayload } from './auth.types';
import { AccessTokenService } from './access-token.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type SessionContext = {
  ip?: string;
  userAgent?: string | string[];
};

@Injectable()
export class UserSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
  ) {}

  async register(userId: string, token: string, payload: TokenPayload, context: SessionContext = {}) {
    const accessTokenId = this.tokens.fingerprint(token);
    const userAgent = normalizeHeader(context.userAgent);
    const client = describeClient(userAgent);

    return this.prisma.userSession.upsert({
      where: { accessTokenId },
      create: {
        userId,
        accessTokenId,
        ipAddress: context.ip?.trim() || null,
        userAgent: userAgent || null,
        appName: client.appName,
        browserName: client.browserName,
        expiresAt: new Date(payload.exp * 1000),
      },
      update: {
        lastSeenAt: new Date(),
      },
    });
  }

  async assertActive(userId: string, token: string, payload: TokenPayload, context: SessionContext = {}) {
    const accessTokenId = this.tokens.fingerprint(token);
    const existing = await this.prisma.userSession.findUnique({ where: { accessTokenId } });

    if (existing) {
      if (existing.userId !== userId || (existing.expiresAt && existing.expiresAt.getTime() <= Date.now())) {
        throw new UnauthorizedException('Сессия закрыта. Войдите в систему повторно.');
      }

      if (Date.now() - existing.lastSeenAt.getTime() >= 60_000) {
        await this.prisma.userSession.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        });
      }
      return existing;
    }

    return this.register(userId, token, payload, context);
  }

  async revokeByToken(token: string) {
    const accessTokenId = this.tokens.fingerprint(token);
    const existing = await this.prisma.userSession.findUnique({
      where: { accessTokenId },
      select: { id: true },
    });
    if (!existing) return false;

    await this.prisma.userSession.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(), lastSeenAt: new Date() },
    });
    return true;
  }
}

function normalizeHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(', ') : value?.trim() ?? '';
}

function describeClient(userAgent: string) {
  if (/android|iphone|ipad|mobile/i.test(userAgent)) {
    return {
      appName: /wms|logoff/i.test(userAgent) ? 'LOGOff WMS Mobile' : 'Мобильный браузер',
      browserName: browserName(userAgent),
    };
  }

  return { appName: 'WMS', browserName: browserName(userAgent) };
}

function browserName(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
  if (/opr\/|opera/i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent)) return 'Google Chrome';
  if (/firefox\//i.test(userAgent)) return 'Mozilla Firefox';
  if (/safari\//i.test(userAgent)) return 'Safari';
  return userAgent ? 'Другой клиент' : 'Не определён';
}
