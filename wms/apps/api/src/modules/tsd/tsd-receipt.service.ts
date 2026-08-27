import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ClientStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { TsdDeviceService } from './tsd-device.service';

@Injectable()
export class TsdReceiptService {
  private readonly logger = new Logger(TsdReceiptService.name);

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
    const warehouseId = this.resolveWritableWarehouseId(user);

    const duplicate = await this.prisma.productMark.findFirst({
      where: {
        clientId,
        value: { equals: kiz, mode: Prisma.QueryMode.insensitive },
      },
      select: {
        value: true,
        box: { select: { code: true, warehouseId: true } },
        stockMovement: { select: { warehouseId: true } },
        sku: { select: { name: true } },
      },
    });
    const duplicateWarehouseId = duplicate?.box?.warehouseId ?? duplicate?.stockMovement?.warehouseId ?? null;
    const canRevealDuplicate = !warehouseId || duplicateWarehouseId === warehouseId;
    const boxCode = canRevealDuplicate ? duplicate?.box?.code ?? null : null;

    return {
      duplicate: Boolean(duplicate),
      kiz,
      boxCode,
      skuName: canRevealDuplicate ? duplicate?.sku.name ?? null : null,
      message: duplicate
        ? canRevealDuplicate
          ? duplicateKizMessage(boxCode)
          : 'КИЗ уже зарегистрирован в другом филиале. Передайте товар менеджеру.'
        : 'КИЗ свободен.',
    };
  }

  async openBox(payload: Record<string, unknown>, user: AuthUser) {
    await this.devices.touchActiveDevice(user.deviceId);

    const clientId = stringValue(payload.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringValue(payload.boxCode, 'boxCode'));
    const sourceDocument = optionalStringValue(payload.sourceDocument);
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const warehouseId = this.resolveWritableWarehouseId(user, optionalStringValue(payload.warehouseId));
    if (!warehouseId) {
      throw new BadRequestException('Выберите филиал для приемки на ТСД.');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, status: { not: ClientStatus.ARCHIVED } },
      select: { id: true, code: true, name: true },
    });
    if (!client) {
      throw new BadRequestException('Клиент не найден или отправлен в архив.');
    }

    const existingBox = await this.prisma.box.findUnique({
      where: { code: boxCode },
      select: {
        id: true,
        clientId: true,
        warehouseId: true,
        zoneId: true,
        palletId: true,
        code: true,
        status: true,
        balances: { where: { quantity: { gt: 0 } }, select: { quantity: true }, take: 1 },
        storagePlacement: { select: { id: true } },
      },
    });
    if (existingBox && existingBox.clientId !== clientId) {
      throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
    }
    if (existingBox && existingBox.warehouseId !== warehouseId) {
      throw new ForbiddenException(
        `Короб ${boxCode} относится к другому филиалу или не имеет безопасной привязки.`,
      );
    }
    const reopenReceivingBox = existingBox?.status === 'receiving';
    const reuseEmptyBox = Boolean(
      existingBox &&
        existingBox.status !== 'receiving' &&
        existingBox.status !== 'deleted' &&
        existingBox.balances.length === 0 &&
        !existingBox.palletId &&
        !existingBox.storagePlacement,
    );
    if (existingBox?.status === 'deleted') {
      await this.prisma.$transaction((tx) => removeDeletedReceiptBoxData(tx, existingBox.id));
    } else if (existingBox && !reopenReceivingBox && !reuseEmptyBox) {
      this.logger.warn(
        `Receipt box rejected: box=${boxCode}, status=${existingBox.status}, ` +
          `hasStock=${existingBox.balances.length > 0}, placed=${Boolean(
            existingBox.palletId || existingBox.storagePlacement,
          )}, clientId=${clientId}, warehouseId=${warehouseId}`,
      );
      throw new BadRequestException(`Короб ${boxCode} уже есть в WMS. Для новой приемки нужен новый ШК короба.`);
    }

    // FIX: an existing physical box may be reused for receipt only when WMS
    // confirms that it has no stock and is not placed on a pallet.
    if (reuseEmptyBox && existingBox) {
      await this.prisma.box.update({
        where: { id: existingBox.id },
        data: { status: 'receiving', zoneId: null },
      });
    } else if (!reopenReceivingBox) {
      await this.prisma.box.create({
        data: {
          clientId,
          warehouseId,
          code: boxCode,
          status: 'receiving',
        },
      });
    }

    await this.prisma.tsdOperation.create({
      data: {
        deviceId: user.deviceCode || user.deviceId || `USER:${user.email}`,
        operationKey: `receipt-open-box:${clientId}:${boxCode}:${Date.now()}`,
        operationType: 'receipt_open_box',
        payload: compactJson({
          clientId,
          warehouseId,
          boxCode,
          sourceDocument,
          status: 'receiving',
          reopened: reopenReceivingBox || reuseEmptyBox,
          reusedEmpty: reuseEmptyBox,
        }),
        status: 'ACCEPTED',
        serverMessage: `РљРѕСЂРѕР± ${boxCode} РѕС‚РєСЂС‹С‚ РґР»СЏ РїСЂРёРµРјРєРё.`,
      },
    });

    return {
      client,
      boxCode,
      canOpen: true,
      reopened: reopenReceivingBox || reuseEmptyBox,
      message: reopenReceivingBox || reuseEmptyBox
        ? `Короб ${boxCode} повторно открыт. Продолжайте приемку.`
        : `Короб ${boxCode} открыт для приемки.`,
    };
  }

  private resolveWritableWarehouseId(user: AuthUser, requestedWarehouseId?: string) {
    const activeWarehouseId = optionalStringValue(user.activeWarehouseId);
    if (user.roleCodes.includes('CLIENT')) {
      return requestedWarehouseId || activeWarehouseId;
    }
    if (user.permissionCodes.includes('system:admin')) {
      return requestedWarehouseId || activeWarehouseId;
    }
    if (!activeWarehouseId || !user.writableWarehouseIds?.includes(activeWarehouseId)) {
      throw new ForbiddenException('Выберите доступный для изменения филиал.');
    }
    if (requestedWarehouseId && requestedWarehouseId !== activeWarehouseId) {
      throw new ForbiddenException('Приемка относится к другому филиалу. Переключите город работы.');
    }
    return activeWarehouseId;
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
