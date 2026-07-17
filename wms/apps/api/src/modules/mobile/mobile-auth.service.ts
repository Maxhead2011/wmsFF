import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from '../auth/access-token.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { MobileLoginDto } from './dto/mobile-login.dto';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SECONDS = 8 * 60 * 60;

@Injectable()
export class MobileAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditLogService,
  ) {}

  async login(dto: MobileLoginDto, context: { ip?: string; userAgent?: string | string[] }) {
    const authenticated = await this.auth.login(
      { email: dto.login, password: dto.password },
      context,
    );

    const device = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.mobileDevice.findUnique({ where: { installationId: dto.installationId } });
      if (existing && existing.userId !== authenticated.user.id) {
        await tx.mobileSession.updateMany({
          where: { deviceId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.mobileDevice.upsert({
        where: { installationId: dto.installationId },
        create: {
          userId: authenticated.user.id,
          installationId: dto.installationId,
          name: clean(dto.deviceName),
          appVersion: clean(dto.appVersion),
        },
        update: {
          userId: authenticated.user.id,
          name: clean(dto.deviceName),
          appVersion: clean(dto.appVersion),
          isActive: true,
          lastSeenAt: new Date(),
        },
      });
    });

    const refresh = await this.createRefreshSession(authenticated.user.id, device.id);
    await this.audit.write({
      userId: authenticated.user.id,
      action: 'mobile.auth.login',
      entity: 'mobile-device',
      entityId: device.id,
      payload: { installationId: dto.installationId, appVersion: dto.appVersion, ip: context.ip },
    });

    return {
      accessToken: this.tokens.sign(authenticated.user.id, { deviceId: device.id }),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      expiresInSeconds: ACCESS_TTL_SECONDS,
      tokenType: 'Bearer' as const,
      deviceId: device.id,
      user: authenticated.user,
    };
  }

  async refresh(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.mobileSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true, device: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.device.isActive) {
      throw new UnauthorizedException('Мобильная сессия истекла. Войдите снова.');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Пользователь заблокирован.');
    }

    const user = await this.loadAuthUser(session.userId);
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.mobileSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      });
      await tx.mobileDevice.update({
        where: { id: session.deviceId },
        data: { lastSeenAt: new Date() },
      });
      return this.createRefreshSession(session.userId, session.deviceId, tx);
    });

    return {
      accessToken: this.tokens.sign(session.userId, { deviceId: session.deviceId }),
      refreshToken: next.token,
      refreshExpiresAt: next.expiresAt,
      expiresInSeconds: ACCESS_TTL_SECONDS,
      tokenType: 'Bearer' as const,
      deviceId: session.deviceId,
      user,
    };
  }

  async logout(user: AuthUser, allDevices: boolean) {
    const where = allDevices ? { userId: user.id, revokedAt: null } : { userId: user.id, deviceId: user.deviceId, revokedAt: null };
    const result = await this.prisma.mobileSession.updateMany({ where, data: { revokedAt: new Date() } });
    if (allDevices) {
      await this.prisma.mobileDevice.updateMany({ where: { userId: user.id }, data: { isActive: false } });
    }
    await this.audit.write({
      userId: user.id,
      action: allDevices ? 'mobile.auth.logout-all' : 'mobile.auth.logout',
      entity: 'mobile-device',
      entityId: user.deviceId,
      payload: { revokedSessions: result.count },
    });
    return { success: true, revokedSessions: result.count };
  }

  listSessions(user: AuthUser) {
    return this.prisma.mobileSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceId: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        device: { select: { name: true, platform: true, appVersion: true, lastSeenAt: true, installationId: true } },
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    const result = await this.prisma.mobileSession.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: result.count > 0 };
  }

  private async createRefreshSession(
    userId: string,
    deviceId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const raw = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await tx.mobileSession.create({
      data: { userId, deviceId, refreshTokenHash: hashToken(raw), expiresAt },
    });
    return { token: raw, expiresAt };
  }

  private async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        clientScopes: true,
        printerScopes: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    const roleCodes = user.roles.map((item) => item.role.code);
    const permissionCodes = [...new Set(user.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.code)))];
    const all = permissionCodes.includes('system:admin') || (!roleCodes.includes('CLIENT') && user.clientScopes.length === 0);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleCodes,
      permissionCodes,
      clientScopeMode: all ? 'ALL' : 'LIMITED',
      clientIds: user.clientScopes.filter((scope) => scope.canRead).map((scope) => scope.clientId),
      writableClientIds: user.clientScopes.filter((scope) => scope.canWrite).map((scope) => scope.clientId),
      printerGroups: user.printerScopes.map((scope) => ({ groupCode: scope.groupCode, canPrint: scope.canPrint, canManage: scope.canManage })),
    };
  }
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value?: string) {
  const result = value?.trim();
  return result || undefined;
}
