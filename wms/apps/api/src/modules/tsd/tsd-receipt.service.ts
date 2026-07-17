import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientStatus, Prisma } from '@prisma/client';
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

  async checkKiz(clientIdValue: unknown, kizValue: unknown, user: AuthUser) {
    await this.devices.touchActiveDevice(user.deviceId);

    const clientId = stringValue(clientIdValue, 'clientId');
    const kiz = stringValue(kizValue, 'kiz');
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const duplicate = await this.prisma.productMark.findFirst({
      where: {
        clientId,
        value: { equals: kiz, mode: Prisma.QueryMode.insensitive },
      },
      select: {
        value: true,
        box: { select: { code: true } },
        sku: { select: { name: true } },
      },
    });
    const boxCode = duplicate?.box?.code ?? null;

    return {
      duplicate: Boolean(duplicate),
      kiz,
      boxCode,
      skuName: duplicate?.sku.name ?? null,
      message: duplicate ? duplicateKizMessage(boxCode) : 'КИЗ свободен.',
    };
  }

  async openBox(payload: Record<string, unknown>, user: AuthUser) {
    await this.devices.touchActiveDevice(user.deviceId);

    const clientId = stringValue(payload.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringValue(payload.boxCode, 'boxCode'));
    const sourceDocument = optionalStringValue(payload.sourceDocument);
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
      select: { id: true, code: true, status: true },
    });
    if (existingBox?.status === 'deleted') {
      await this.prisma.$transaction((tx) => removeDeletedReceiptBoxData(tx, existingBox.id));
    } else if (existingBox) {
      throw new BadRequestException(`Короб ${boxCode} уже есть в WMS. Для новой приемки нужен новый ШК короба.`);
    }

    await this.prisma.box.create({
      data: {
        clientId,
        code: boxCode,
        status: 'receiving',
      },
    });

    await this.prisma.tsdOperation.create({
      data: {
        deviceId: user.deviceCode || user.deviceId || `USER:${user.email}`,
        operationKey: `receipt-open-box:${clientId}:${boxCode}:${Date.now()}`,
        operationType: 'receipt_open_box',
        payload: compactJson({
          clientId,
          boxCode,
          sourceDocument,
          status: 'receiving',
        }),
        status: 'ACCEPTED',
        serverMessage: `РљРѕСЂРѕР± ${boxCode} РѕС‚РєСЂС‹С‚ РґР»СЏ РїСЂРёРµРјРєРё.`,
      },
    });

    return {
      client,
      boxCode,
      canOpen: true,
      message: `Короб ${boxCode} открыт для приемки.`,
    };
  }
}

async function removeDeletedReceiptBoxData(tx: Prisma.TransactionClient, boxId: string) {
  await tx.productMark.deleteMany({ where: { boxId } });
  await tx.stockBalance.deleteMany({ where: { boxId } });
  await tx.stockMovement.deleteMany({ where: { boxId } });
  await tx.box.delete({ where: { id: boxId } });
}
function stringValue(payloadValue: unknown, field: string) {
  if (typeof payloadValue !== 'string' || !payloadValue.trim()) {
    throw new BadRequestException(`Поле ${field} обязательно для приемки ТСД.`);
  }

  return payloadValue.trim();
}

function optionalStringValue(payloadValue: unknown) {
  return typeof payloadValue === 'string' && payloadValue.trim() ? payloadValue.trim() : undefined;
}

function normalizeBoxCode(value: string) {
  return value.trim();
}

function requireFflBoxCode(value: string) {
  const boxCode = normalizeBoxCode(value);
  if (!boxCode.toLocaleUpperCase('ru-RU').startsWith('FFL')) {
    throw new BadRequestException('Номер короба должен начинаться с FFL. Отсканируйте корректный ШК короба.');
  }
  return boxCode;
}

function compactJson(payload: Record<string, unknown>) {
  const result: Record<string, Prisma.InputJsonValue> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      result[key] = value as Prisma.InputJsonValue;
    }
  });
  return result as Prisma.InputJsonValue;
}

function duplicateKizMessage(boxCode?: string | null) {
  return boxCode
    ? `ДУБЛЬ КИЗ. Этот КИЗ уже находится в коробе ${boxCode}.`
    : 'ДУБЛЬ КИЗ. Этот КИЗ уже есть в WMS без привязки к коробу.';
}
