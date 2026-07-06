import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { TsdDeviceService } from './tsd-device.service';

@Injectable()
export class TsdReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly devices: TsdDeviceService,
  ) {}

  async openBox(payload: Record<string, unknown>, user: AuthUser) {
    await this.devices.touchActiveDevice(user.deviceId);

    const clientId = stringValue(payload.clientId, 'clientId');
    const boxCode = normalizeBoxCode(stringValue(payload.boxCode, 'boxCode'));
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, status: { not: ClientStatus.ARCHIVED } },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new BadRequestException('Клиент не найден или отправлен в архив.');
    }

    const existingBox = await this.prisma.box.findUnique({
      where: { clientId_code: { clientId, code: boxCode } },
      select: { id: true, code: true },
    });
    if (existingBox) {
      throw new BadRequestException(`Короб ${boxCode} уже есть в WMS. Для новой приемки нужен новый ШК короба.`);
    }

    return {
      client,
      boxCode,
      canOpen: true,
      message: `Короб ${boxCode} открыт для приемки.`,
    };
  }
}

function stringValue(payloadValue: unknown, field: string) {
  if (typeof payloadValue !== 'string' || !payloadValue.trim()) {
    throw new BadRequestException(`Поле ${field} обязательно для приемки ТСД.`);
  }

  return payloadValue.trim();
}

function normalizeBoxCode(value: string) {
  return value.trim();
}
