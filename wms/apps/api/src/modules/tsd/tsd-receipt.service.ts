import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ClientStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { TsdDeviceService } from './tsd-device.service';
import { ScanOperationDto } from './dto/scan-operation.dto';
import { TsdOperationResult } from './tsd-operation.types';

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

  // FIX: finalize only this box after every scan in its durable close packet
  // has a matching committed receipt. No stock changes or other-box waits.
  async closeBox(operation: ScanOperationDto, user: AuthUser): Promise<TsdOperationResult> {
    const clientId = stringValue(operation.payload.clientId, 'clientId');
    const boxCode = requireFflBoxCode(stringValue(operation.payload.boxCode, 'boxCode'));
    const sourceDocument = stringValue(operation.payload.sourceDocument, 'sourceDocument');
    const keys = receiptCloseKeys(operation.payload.receiptOperationKeys);
    if (keys.includes(operation.operationKey)) throw new BadRequestException('Закрытие не может зависеть от самого себя.');
    if (!user.deviceCode || operation.deviceId !== user.deviceCode) {
      throw new ForbiddenException('Закрытие пришло не от устройства из access token.');
    }
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const warehouseId = this.resolveWritableWarehouseId(user);
    if (!warehouseId) throw new BadRequestException('Выберите филиал для закрытия приемки на ТСД.');

    const reply = (status: TsdOperationResult['status'], message: string): TsdOperationResult => ({
      operationKey: operation.operationKey, operationType: operation.operationType,
      status, message, serverTime: new Date().toISOString(),
    });

    return this.prisma.$transaction(async (tx) => {
      // Cross-process lock: a retry must observe the first committed close log.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Box"
        WHERE "code" = ${boxCode} AND "clientId" = ${clientId} AND "warehouseId" = ${warehouseId}
        FOR UPDATE
      `);
      const box = await tx.box.findUnique({ where: { code: boxCode }, select: { id: true, clientId: true, warehouseId: true, status: true } });
      if (!box || box.clientId !== clientId || box.warehouseId !== warehouseId) {
        throw new ForbiddenException('Короб не найден в выбранном клиенте и филиале.');
      }
      const previous = await tx.tsdOperation.findUnique({ where: { operationKey: operation.operationKey } });
      if (previous) {
        const previousPayload = receiptJsonObject(previous.payload);
        if (previous.operationType !== 'receipt_close' || previous.deviceId !== operation.deviceId ||
            previous.status !== 'ACCEPTED' || previousPayload.clientId !== clientId ||
            previousPayload.boxCode !== boxCode || previousPayload.warehouseId !== warehouseId ||
            previousPayload.sourceDocument !== sourceDocument ||
            JSON.stringify(receiptCloseKeys(previousPayload.receiptOperationKeys).sort()) !== JSON.stringify([...keys].sort())) {
          throw new BadRequestException('Ключ закрытия уже использован для другой операции.');
        }
        // A later archival/reuse must not be undone by an old close retry.
        return reply('ALREADY_APPLIED', `Закрытие короба ${boxCode} уже подтверждено WMS.`);
      }
      if (box.status !== 'receiving') {
        throw new BadRequestException(`Короб ${boxCode} не открыт для приемки. Его статус не изменён.`);
      }

      const scans = await tx.tsdOperation.findMany({ where: { operationKey: { in: keys } } });
      for (const scan of scans) {
        const scanPayload = receiptJsonObject(scan.payload);
        if (scan.operationType !== 'receipt_scan' || scan.deviceId !== operation.deviceId ||
            scanPayload.clientId !== clientId || scanPayload.boxCode !== boxCode || scanPayload.sourceDocument !== sourceDocument) {
          throw new BadRequestException('Закрытие содержит скан другого устройства, клиента, короба или приемки.');
        }
      }
      if (scans.length !== keys.length || scans.some((scan) => scan.status !== 'ACCEPTED')) {
        return reply('RETRY', `Короб ${boxCode} ожидает подтверждения своих сканов. Не сканируйте товар повторно; проверьте очередь приемки.`);
      }
      // FIX: accepted historical scans are not proof for a later reuse of the
      // same physical box. A normal resume does not start a new generation.
      const openingWhere: Prisma.TsdOperationWhereInput = {
        operationType: 'receipt_open_box', status: 'ACCEPTED',
        AND: [
          { payload: { path: ['clientId'], equals: clientId } },
          { payload: { path: ['warehouseId'], equals: warehouseId } },
          { payload: { path: ['boxCode'], equals: boxCode } },
        ],
      };
      const latestOpening = await tx.tsdOperation.findFirst({ where: openingWhere, orderBy: { createdAt: 'desc' } });
      if (!latestOpening) return reply('RETRY', `Открытие приемки короба ${boxCode} ещё не подтверждено. Закрытие ожидает синхронизации.`);
      const latestPayload = receiptJsonObject(latestOpening.payload);
      if (latestOpening.deviceId !== operation.deviceId || latestPayload.sourceDocument !== sourceDocument) {
        throw new BadRequestException('Короб уже открыт другой приемкой или устройством. Старое закрытие не применено.');
      }
      const generation = latestPayload.reopened === false || latestPayload.reusedEmpty === true
        ? latestOpening
        : await tx.tsdOperation.findFirst({
            where: { ...openingWhere, OR: [
              { payload: { path: ['reopened'], equals: false } },
              { payload: { path: ['reusedEmpty'], equals: true } },
            ] },
            orderBy: { createdAt: 'desc' },
          });
      if (!generation) return reply('RETRY', `Не подтверждено начало текущей приемки короба ${boxCode}. Закрытие не выполнено.`);
      if (scans.some((scan) => scan.createdAt < generation.createdAt)) {
        throw new BadRequestException('Сканы относятся к предыдущему заполнению короба. Старое закрытие не применено.');
      }
      const quantities = new Map(scans.map((scan) => [scan.operationKey, Number(receiptJsonObject(scan.payload).quantity)]));
      const movements = await tx.stockMovement.findMany({
        where: { idempotencyKey: { in: keys } },
        select: { idempotencyKey: true, clientId: true, warehouseId: true, boxId: true, sourceDocument: true, type: true, quantity: true },
      });
      for (const movement of movements) {
        if (movement.type !== 'RECEIPT' || movement.quantity <= 0 ||
            movement.quantity !== quantities.get(movement.idempotencyKey ?? '') || movement.clientId !== clientId ||
            movement.warehouseId !== warehouseId || movement.boxId !== box.id || movement.sourceDocument !== sourceDocument) {
          throw new BadRequestException('Движение по скану не соответствует закрываемому коробу и филиалу.');
        }
      }
      if (movements.length !== keys.length) {
        return reply('RETRY', `Приход короба ${boxCode} ещё не подтверждён полностью. Закрытие будет повторено без повторного прихода.`);
      }
      const updated = await tx.box.updateMany({ where: { id: box.id, status: 'receiving' }, data: { status: 'active' } });
      if (updated.count !== 1) throw new Error('Статус короба изменился во время закрытия.');
      const closedPayload = {
        clientId, warehouseId, boxCode, sourceDocument,
        receiptOperationKeys: JSON.stringify(keys), status: 'active', actorUserId: user.id,
      };
      const message = `Короб ${boxCode} закрыт и готов к размещению.`;
      await tx.tsdOperation.create({ data: {
        deviceId: operation.deviceId, operationKey: operation.operationKey, operationType: 'receipt_close',
        payload: closedPayload, status: 'ACCEPTED', serverMessage: message,
      } });
      // Preserve the existing receipt-history contract without replaying receipt_scan.
      await tx.tsdOperation.create({ data: {
        deviceId: operation.deviceId, operationKey: `receipt-close-status:${operation.operationKey}`,
        operationType: 'receipt_box_status', payload: { ...closedPayload, closeOperationKey: operation.operationKey },
        status: 'ACCEPTED', serverMessage: message,
      } });
      return reply('APPLIED', message);
    });
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

function receiptJsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function receiptCloseKeys(value: unknown): string[] {
  let keys: unknown;
  try {
    keys = typeof value === 'string' && value.length <= 512_000 ? JSON.parse(value) : null;
  } catch {
    throw new BadRequestException('Неверный список сканов закрываемого короба.');
  }
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 5000 ||
      keys.some((key) => typeof key !== 'string' || !key.trim() || key.length > 200) || new Set(keys).size !== keys.length) {
    throw new BadRequestException('Для закрытия нужен непустой список уникальных ключей сканов короба.');
  }
  return keys as string[];
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
