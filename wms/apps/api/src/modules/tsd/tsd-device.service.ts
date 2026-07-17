import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ClientStatus, TsdDeviceStatus, UserStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from '../auth/access-token.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PasswordService } from '../auth/password.service';
import { CreateTsdDeviceDto } from './dto/create-tsd-device.dto';
import { LoginTsdDeviceDto } from './dto/login-tsd-device.dto';

@Injectable()
export class TsdDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: AccessTokenService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  listDevices() {
    return this.prisma.tsdDevice.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        lastLoginAt: true,
        lastSeenAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
          },
        },
      },
    });
  }

  async createDevice(dto: CreateTsdDeviceDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Для ТСД нужен активный пользователь-оператор.');
    }

    const permissionCodes = user.roles.flatMap((item) =>
      item.role.permissions.map((permission) => permission.permission.code),
    );
    if (!permissionCodes.includes('stock:write') && !permissionCodes.includes('system:admin')) {
      throw new BadRequestException('Пользователь ТСД должен иметь право stock:write.');
    }

    const secret = this.generateSecret();
    const device = await this.prisma.tsdDevice.create({
      data: {
        code: this.normalizeCode(dto.code),
        name: dto.name.trim(),
        userId: user.id,
        secretHash: await this.passwords.hash(secret),
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        userId: true,
        createdAt: true,
      },
    });

    // Русский комментарий: секрет показываем только один раз при создании устройства; в базе остается только hash.
    return {
      ...device,
      deviceSecret: secret,
    };
  }

  async listClientsForDevice(user: AuthUser) {
    await this.touchActiveDevice(user.deviceId);
    const clientFilter = this.clientScopes.resolveClientFilter(user);

    return this.prisma.client.findMany({
      where: {
        ...(clientFilter === undefined ? {} : { id: clientFilter }),
        status: { not: ClientStatus.ARCHIVED },
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        storesWithoutBoxes: true,
      },
    });
  }

  async login(dto: LoginTsdDeviceDto) {
    if (dto.login !== undefined || dto.password !== undefined) {
      return this.loginByUserCredentials(dto);
    }

    if (dto.code !== undefined || dto.secret !== undefined) {
      return this.loginByDeviceSecret(dto);
    }

    throw new UnauthorizedException('Укажите логин/пароль или код/секрет ТСД.');
  }

  private async loginByUserCredentials(dto: LoginTsdDeviceDto) {
    const login = dto.login?.trim();
    const password = dto.password ?? '';
    if (!login || !password) {
      throw new UnauthorizedException('Неверный логин или пароль.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeLogin(login) },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !(await this.passwords.verify(password, user.passwordHash))) {
      throw new UnauthorizedException('Неверный логин или пароль.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Пользователь заблокирован.');
    }

    const permissionCodes = [
      ...new Set(
        user.roles.flatMap((item) => item.role.permissions.map((permission) => permission.permission.code)),
      ),
    ];
    if (!permissionCodes.includes('stock:write') && !permissionCodes.includes('system:admin')) {
      throw new UnauthorizedException('У пользователя ТСД нет права stock:write.');
    }

    const device = await this.prisma.tsdDevice.findFirst({
      where: { userId: user.id, status: TsdDeviceStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, name: true },
    });

    if (device) {
      await this.prisma.tsdDevice.update({
        where: { id: device.id },
        data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
      });
    }

    const deviceCode = device?.code ?? this.loginDeviceCode(user.email);

    return {
      accessToken: this.tokens.sign(user.id, {
        ...(device ? { deviceId: device.id } : {}),
        deviceCode,
      }),
      tokenType: 'Bearer',
      device: {
        id: device?.id ?? user.id,
        code: deviceCode,
        name: device?.name ?? user.name,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        permissionCodes,
      },
    };
  }

  private async loginByDeviceSecret(dto: LoginTsdDeviceDto) {
    const code = dto.code?.trim();
    const secret = dto.secret ?? '';
    if (!code || !secret) {
      throw new UnauthorizedException('Неверный код или секрет ТСД.');
    }

    const device = await this.prisma.tsdDevice.findUnique({
      where: { code: this.normalizeCode(code) },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!device || !(await this.passwords.verify(secret, device.secretHash))) {
      throw new UnauthorizedException('Неверный код или секрет ТСД.');
    }

    if (device.status !== TsdDeviceStatus.ACTIVE) {
      throw new UnauthorizedException('ТСД заблокирован.');
    }

    if (device.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Пользователь ТСД заблокирован.');
    }

    const permissionCodes = [
      ...new Set(
        device.user.roles.flatMap((item) => item.role.permissions.map((permission) => permission.permission.code)),
      ),
    ];
    if (!permissionCodes.includes('stock:write') && !permissionCodes.includes('system:admin')) {
      throw new UnauthorizedException('У пользователя ТСД нет права stock:write.');
    }

    await this.prisma.tsdDevice.update({
      where: { id: device.id },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
    });

    return {
      accessToken: this.tokens.sign(device.user.id, {
        deviceId: device.id,
        deviceCode: device.code,
      }),
      tokenType: 'Bearer',
      device: {
        id: device.id,
        code: device.code,
        name: device.name,
      },
      user: {
        id: device.user.id,
        email: device.user.email,
        name: device.user.name,
        permissionCodes,
      },
    };
  }

  async touchActiveDevice(deviceId?: string) {
    if (!deviceId) {
      return undefined;
    }

    const device = await this.prisma.tsdDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, status: true },
    });

    if (!device || device.status !== TsdDeviceStatus.ACTIVE) {
      throw new UnauthorizedException('ТСД заблокирован или удален.');
    }

    return this.prisma.tsdDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
    });
  }

  private generateSecret() {
    return randomBytes(24).toString('base64url');
  }

  private normalizeCode(code: string) {
    return code.trim().toUpperCase();
  }

  private normalizeLogin(login: string) {
    return login.trim().toLowerCase();
  }

  private loginDeviceCode(login: string) {
    return `USER:${login.trim().toLowerCase()}`;
  }
}
