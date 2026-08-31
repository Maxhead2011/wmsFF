import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ClientRequestStatus,
  ClientStatus,
  Prisma,
  TsdDeviceStatus,
  TsdOperationStatus,
  UserStatus,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenService } from '../auth/access-token.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PasswordService } from '../auth/password.service';
import { CreateTsdDeviceDto } from './dto/create-tsd-device.dto';
import { LoginTsdDeviceDto } from './dto/login-tsd-device.dto';

const FBS_TSD_RESERVED_STATUS = 'RESERVED';
const FBS_TSD_AUTO_RESERVATION_DEVICE = 'AUTO:FBS:PALLET_SORT';
const TSD_PHYSICAL_INSTALLATION_PREFIX = 'TSD-INSTALL-';
const TSD_CLOSED_REQUEST_STATUSES = [
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
];

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

  async recordMonitorHeartbeat(body: Record<string, unknown>, user: AuthUser) {
    const reportedDeviceCode = monitorText(body.deviceCode) || user.deviceCode;
    const deviceCode = this.monitorDeviceCode(
      monitorText(body.installationCode),
      reportedDeviceCode,
      user.id,
    );
    if (!deviceCode) {
      throw new BadRequestException('Не удалось определить код ТСД для мониторинга.');
    }
    await this.touchActiveDevice(user.deviceId);
    const payload = monitorPayload(body, deviceCode, user.name, user.id);
    await this.prisma.tsdOperation.upsert({
      where: { operationKey: `monitor-heartbeat:${deviceCode}` },
      update: {
        payload: payload as Prisma.InputJsonValue,
        status: TsdOperationStatus.ACCEPTED,
        serverMessage: monitorText(body.lastAction) || null,
      },
      create: {
        deviceId: deviceCode,
        operationKey: `monitor-heartbeat:${deviceCode}`,
        operationType: 'monitor_heartbeat',
        payload: payload as Prisma.InputJsonValue,
        status: TsdOperationStatus.ACCEPTED,
        serverMessage: monitorText(body.lastAction) || null,
      },
    });
      const command = await this.prisma.tsdOperation.findFirst({
        where: {
          deviceId: deviceCode,
          operationType: 'monitor_command',
          status: TsdOperationStatus.NEEDS_REVIEW,
        },
        orderBy: { createdAt: 'asc' },
      });
    if (command) {
      await this.prisma.tsdOperation.update({
        where: { id: command.id },
        data: { status: TsdOperationStatus.ACCEPTED, serverMessage: 'Команда доставлена на ТСД.' },
      });
    }
    return {
      accepted: true,
      serverTime: new Date().toISOString(),
      command: command
        ? {
            id: command.id,
            action: monitorText(administrationPayloadValue(command.payload, 'action')),
          }
        : null,
    };
  }

  async recordMonitorError(body: Record<string, unknown>, user: AuthUser) {
    const reportedDeviceCode = monitorText(body.deviceCode) || user.deviceCode;
    const deviceCode = this.monitorDeviceCode(
      monitorText(body.installationCode),
      reportedDeviceCode,
      user.id,
    );
    const message = monitorText(body.message);
    if (!deviceCode || !message) {
      throw new BadRequestException('Для журнала ошибки нужны код ТСД и текст ошибки.');
    }
    await this.touchActiveDevice(user.deviceId);
    await this.prisma.tsdOperation.create({
      data: {
        deviceId: deviceCode,
        operationKey: `monitor-error:${deviceCode}:${Date.now()}:${randomUUID()}`,
        operationType: 'monitor_error',
        payload: monitorPayload(body, deviceCode, user.name, user.id) as Prisma.InputJsonValue,
        status: TsdOperationStatus.REJECTED,
        serverMessage: message,
      },
    });
    return { accepted: true, serverTime: new Date().toISOString() };
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
    const roleCodes = [...new Set(user.roles.map((item) => item.role.code))];
    if (!permissionCodes.includes('stock:write') && !permissionCodes.includes('system:admin')) {
      throw new UnauthorizedException('У пользователя ТСД нет права stock:write.');
    }

    const installationCode = dto.installationCode?.trim();
    if (!installationCode) {
      throw new UnauthorizedException({
        code: 'TSD_UPDATE_REQUIRED',
        message: 'Обновите приложение ТСД и войдите заново: старая версия не передаёт код физического устройства.',
      });
    }
    const deviceCode = this.normalizeCode(installationCode);
    let device = await this.prisma.tsdDevice.findUnique({
      where: { code: deviceCode },
      select: { id: true, code: true, name: true, userId: true, status: true },
    });
    if (!device) {
      try {
        device = await this.prisma.tsdDevice.create({
          data: {
            code: deviceCode,
            name: `${user.name} · ${deviceCode.slice(-8)}`,
            userId: user.id,
            secretHash: await this.passwords.hash(randomBytes(32).toString('hex')),
            lastLoginAt: new Date(),
            lastSeenAt: new Date(),
          },
          select: { id: true, code: true, name: true, userId: true, status: true },
        });
      } catch (caught) {
        if (!(caught instanceof Prisma.PrismaClientKnownRequestError) || caught.code !== 'P2002') {
          throw caught;
        }
        device = await this.prisma.tsdDevice.findUnique({
          where: { code: deviceCode },
          select: { id: true, code: true, name: true, userId: true, status: true },
        });
      }
    }
    if (!device) {
      throw new UnauthorizedException('Не удалось зарегистрировать физический ТСД. Повторите вход.');
    }
    if (device.status !== TsdDeviceStatus.ACTIVE) {
      throw new UnauthorizedException('Этот физический ТСД заблокирован администратором.');
    }
    if (device.userId !== user.id) {
      device = await this.rebindSharedInstallation(device, user);
    } else {
      await this.prisma.tsdDevice.update({
        where: { id: device.id },
        data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
      });
    }
    await this.releaseUntouchedLegacyFbsLeases(user.id, user.name, deviceCode);

    return {
      accessToken: this.tokens.sign(user.id, {
        deviceId: device.id,
        deviceCode,
      }),
      tokenType: 'Bearer',
      device: {
        id: device.id,
        code: deviceCode,
        name: device.name,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleCodes,
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
    const roleCodes = [...new Set(device.user.roles.map((item) => item.role.code))];
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
        roleCodes,
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

  /**
   * Credential login identifies the employee while installationCode identifies
   * the physical handheld. Shared handhelds can move between employees, but the
   * device code stays stable while its display name follows the employee who
   * actually signed in. The current on-device FBS task moves in the same
   * serializable transaction, so the old token loses its lease immediately
   * and cannot write after the new employee signs in.
   * Device-secret login deliberately remains pinned to its configured user.
   */
  private async rebindSharedInstallation(
    device: { id: string; code: string; name: string; userId: string; status: TsdDeviceStatus },
    user: { id: string; name: string },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.tsdDevice.findUnique({
          where: { id: device.id },
          select: { id: true, code: true, name: true, userId: true, status: true },
        });
        if (!current || current.status !== TsdDeviceStatus.ACTIVE) {
          throw new UnauthorizedException('Этот физический ТСД заблокирован или удалён.');
        }
        // FIX: the original device name contains the first employee's name.
        // Keep the physical suffix but always display the current employee.
        const currentEmployeeDeviceName = `${user.name} · ${current.code.slice(-8)}`;
        // FIX: a closed/deleted request must never follow the physical TSD to
        // every employee who signs in later. Preserve its scan evidence for
        // manager review, but remove the stale lease from the handheld.
        const assignedTasks = await tx.fbsTsdAssembly.findMany({
          where: {
            deviceCode: current.code,
            workerUserId: current.userId,
            status: 'IN_PROGRESS',
          },
          select: { id: true, requestId: true },
        });
        const assignedRequestIds = [...new Set(assignedTasks.map((task) => task.requestId))];
        const openRequests = assignedRequestIds.length
          ? await tx.clientRequest.findMany({
              where: {
                id: { in: assignedRequestIds },
                status: { notIn: TSD_CLOSED_REQUEST_STATUSES },
              },
              select: { id: true },
            })
          : [];
        const openRequestIds = new Set(openRequests.map((request) => request.id));
        const liveTaskIds = assignedTasks
          .filter((task) => openRequestIds.has(task.requestId))
          .map((task) => task.id);
        const staleTaskIds = assignedTasks
          .filter((task) => !openRequestIds.has(task.requestId))
          .map((task) => task.id);
        const parkedStaleTasks = staleTaskIds.length
          ? await tx.fbsTsdAssembly.updateMany({
              where: {
                id: { in: staleTaskIds },
                deviceCode: current.code,
                workerUserId: current.userId,
                status: 'IN_PROGRESS',
              },
              data: {
                status: 'RETURN_REQUIRED',
                deviceCode: FBS_TSD_AUTO_RESERVATION_DEVICE,
                workerUserId: null,
                workerName: null,
                errorMessage:
                  'Задание снято с ТСД: исходная FBS-заявка уже закрыта или удалена.',
              },
            })
          : { count: 0 };
        if (parkedStaleTasks.count > 0) {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'TSD_STALE_FBS_TASKS_PARKED',
              entity: 'TsdDevice',
              entityId: current.id,
              payload: {
                deviceCode: current.code,
                previousUserId: current.userId,
                staleTaskIds,
                parkedTasks: parkedStaleTasks.count,
              },
            },
          });
        }
        if (current.userId !== user.id) {
          const rebound = await tx.tsdDevice.updateMany({
            where: { id: current.id, userId: current.userId, status: TsdDeviceStatus.ACTIVE },
            data: {
              userId: user.id,
              name: currentEmployeeDeviceName,
              lastLoginAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
          if (rebound.count !== 1) {
            throw new UnauthorizedException('Сотрудник на этом ТСД уже изменился. Повторите вход.');
          }
          const movedTasks = liveTaskIds.length
            ? await tx.fbsTsdAssembly.updateMany({
                where: {
                  id: { in: liveTaskIds },
                  deviceCode: current.code,
                  workerUserId: current.userId,
                  status: 'IN_PROGRESS',
                },
                data: {
                  workerUserId: user.id,
                  workerName: user.name,
                  errorMessage: null,
                },
              })
            : { count: 0 };
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'TSD_SHARED_INSTALLATION_REBOUND',
              entity: 'TsdDevice',
              entityId: current.id,
              payload: {
                deviceCode: current.code,
                previousUserId: current.userId,
                nextUserId: user.id,
                movedFbsTasks: movedTasks.count,
                parkedStaleFbsTasks: parkedStaleTasks.count,
              },
            },
          });
        } else {
          await tx.tsdDevice.update({
            where: { id: current.id },
            data: {
              name: currentEmployeeDeviceName,
              lastLoginAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        }
        const reboundDevice = await tx.tsdDevice.findUnique({
          where: { id: current.id },
          select: { id: true, code: true, name: true, userId: true, status: true },
        });
        if (!reboundDevice || reboundDevice.userId !== user.id) {
          throw new UnauthorizedException('Не удалось перепривязать общий ТСД. Повторите вход.');
        }
        return reboundDevice;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (caught) {
      if (caught instanceof UnauthorizedException) throw caught;
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2034') {
        throw new UnauthorizedException('Сотрудник на этом ТСД уже изменился. Повторите вход.');
      }
      throw caught;
    }
  }

  /**
   * Versions before physical installation identity assigned FBS tasks to
   * shared codes such as USER:<login> or TSD-01. Once the same employee has
   * successfully logged in with TSD-INSTALL-*, return only completely
   * untouched legacy leases to the automatic reservation queue. Reserved box
   * fields are intentionally not changed. Any physical/WB/label/finalization
   * marker makes the row ineligible and leaves it for explicit review.
   */
  private async releaseUntouchedLegacyFbsLeases(
    userId: string,
    userName: string,
    physicalDeviceCode: string,
  ) {
    if (!physicalDeviceCode.startsWith(TSD_PHYSICAL_INSTALLATION_PREFIX)) {
      return 0;
    }
    return this.prisma.$transaction(async (tx) => {
      const released = await tx.fbsTsdAssembly.updateMany({
        where: {
          status: 'IN_PROGRESS',
          workerUserId: userId,
          deviceCode: {
            not: { startsWith: TSD_PHYSICAL_INSTALLATION_PREFIX },
          },
          boxId: null,
          boxCode: null,
          sourceBarcode: null,
          barcode: null,
          kiz: null,
          relabelConfirmedAt: null,
          wbMetaStatus: { in: ['PENDING', 'NOT_REQUIRED'] },
          marketplaceSubmittedAt: null,
          marketplaceLabelBase64: null,
          marketplaceLabelContentType: null,
          marketplaceSubmitError: null,
          stickerPartA: null,
          stickerPartB: null,
          stickerBarcode: null,
          sourceBoxPending: false,
          cargoPackingId: null,
          cargoPackedAt: null,
          cargoPackedByUserId: null,
          cargoPackedByName: null,
          completedAt: null,
        },
        data: {
          status: FBS_TSD_RESERVED_STATUS,
          deviceCode: FBS_TSD_AUTO_RESERVATION_DEVICE,
          workerUserId: null,
          workerName: null,
          startedAt: null,
          errorMessage:
            `Нетронутое задание старой сессии ${userName} возвращено в автоматический резерв после входа с ${physicalDeviceCode}.`,
        },
      });
      if (released.count > 0) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'TSD_LEGACY_FBS_LEASES_RELEASED',
            entity: 'User',
            entityId: userId,
            payload: {
              physicalDeviceCode,
              releasedTasks: released.count,
              predicateVersion: 1,
              preservedReservation: true,
            },
          },
        });
      }
      return released.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  private monitorDeviceCode(installationCode: string, reportedDeviceCode: string | undefined, userId: string) {
    const installation = installationCode.trim();
    if (installation) return this.normalizeCode(installation);

    const reported = (reportedDeviceCode ?? '').trim();
    if (!reported) return '';
    if (/^FFU-TSD-/i.test(reported)) return this.normalizeCode(reported);

    return `${this.normalizeCode(reported)}@${userId.slice(0, 8).toUpperCase()}`;
  }
}

function monitorPayload(body: Record<string, unknown>, deviceCode: string, workerName: string, workerUserId: string) {
  return {
    deviceCode,
    workerName,
    workerUserId,
    screen: monitorText(body.screen),
    screenLabel: monitorText(body.screenLabel),
    stage: monitorText(body.stage),
    state: monitorText(body.state),
    requestId: monitorText(body.requestId),
    requestNumber: monitorNumber(body.requestNumber),
    clientName: monitorText(body.clientName),
    orderId: monitorText(body.orderId),
    productName: monitorText(body.productName),
    boxCode: monitorText(body.boxCode),
    total: monitorNumber(body.total),
    completed: monitorNumber(body.completed),
    remaining: monitorNumber(body.remaining),
    accepted: monitorNumber(body.accepted),
    lastAction: monitorText(body.lastAction),
    message: monitorText(body.message),
    appVersion: monitorText(body.appVersion),
    reportedAt: new Date().toISOString(),
  };
}

function monitorText(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

function monitorNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function administrationPayloadValue(payload: Prisma.JsonValue, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return (payload as Prisma.JsonObject)[key];
}
