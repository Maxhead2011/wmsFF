import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, StockStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BoxCodePolicyService } from '../../common/boxes/box-code-policy.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import { StockBalancesService } from '../stock/stock-balances.service';

const GOOGLE_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/103bMP_DBQmB7if17WEfi9DQMvIcAsxgV24gTSXnDKcw/export?format=csv&gid=0';
const GOOGLE_SYNC_TTL_MS = 5 * 60 * 1000;
const GOOGLE_LAYOUT_WAREHOUSE_CODE = process.env.STORAGE_LAYOUT_GOOGLE_WAREHOUSE_CODE || 'MSK';
const DELETED_STORAGE_PALLET_STATUS = 'deleted';
const MAX_BULK_DELETE_PALLETS = 500;

type ParsedPallet = {
  code: string;
  boxes: string[];
};

@Injectable()
export class StorageLocationsService {
  private lastSyncAttemptAt = 0;
  private lastSyncError: string | null = null;
  private syncPromise: Promise<unknown> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly boxCodes: BoxCodePolicyService,
    private readonly balances: StockBalancesService,
    private readonly archivedEmptyBoxDetach?: ArchivedEmptyBoxPalletDetachService,
  ) {}

  async listLayout(
    warehouseId: string | undefined,
    query: string | undefined,
    sync: boolean,
    user: AuthUser,
  ) {
    const scopedWarehouseId = this.requireWarehouseScope(user, warehouseId, 'read');
    const warehouse = await this.resolveWarehouse(scopedWarehouseId);
    // FIX: Google was a one-time migration source. Reading the layout must never
    // recreate pallets or placements that warehouse staff deleted afterwards.
    void sync;

    const normalizedQuery = String(query ?? '').trim();
    const codePolicy = await this.boxCodes.getPolicy();
    const pallets = await this.prisma.storagePallet.findMany({
      where: {
        warehouseId: warehouse.id,
        status: { not: DELETED_STORAGE_PALLET_STATUS },
        ...this.clientWhere(user, 'read'),
        ...(normalizedQuery
          ? {
              OR: [
                { code: { contains: normalizedQuery, mode: 'insensitive' as const } },
                { boxes: { some: { boxCode: { contains: normalizedQuery, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        zone: { select: { id: true, code: true, name: true } },
        boxes: {
          where: this.boxPlacementWhere(user, 'read'),
          include: {
            box: {
              select: {
                id: true,
                status: true,
                client: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: { boxCode: 'asc' },
        },
      },
      orderBy: [{ zoneId: 'asc' }, { code: 'asc' }],
    });
    const zones = await this.prisma.zone.findMany({
      where: { warehouseId: warehouse.id },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    const lastSyncedAt = pallets.reduce<Date | null>(
      (latest, pallet) =>
        pallet.lastSyncedAt && (!latest || pallet.lastSyncedAt > latest) ? pallet.lastSyncedAt : latest,
      null,
    );

    const zoneStatistics = zones.map((zone) => {
      const zonePallets = pallets.filter((pallet) => pallet.zoneId === zone.id);
      return {
        ...zone,
        palletCount: zonePallets.length,
        boxCount: zonePallets.reduce((sum, pallet) => sum + pallet.boxes.length, 0),
      };
    });

    return {
      warehouse,
      codePrefixes: {
        pallet: codePolicy.palletPrefix,
        storageCell: codePolicy.storageCellPrefix,
        rackSlot: codePolicy.rackSlotPrefix,
        rack: codePolicy.rackPrefix,
        storageBox: codePolicy.storageBoxPrefix,
      },
      zones: zoneStatistics,
      pallets,
      summary: {
        zones: zones.length,
        pallets: pallets.length,
        boxes: pallets.reduce((sum, pallet) => sum + pallet.boxes.length, 0),
        unassignedPallets: pallets.filter((pallet) => !pallet.zoneId).length,
        boxesMissingInWms: pallets.reduce(
          (sum, pallet) => sum + pallet.boxes.filter((placement) => !placement.boxId).length,
          0,
        ),
      },
      googleSync: {
        sourceUrl: GOOGLE_SHEET_CSV_URL,
        lastSyncedAt,
        lastAttemptAt: this.lastSyncAttemptAt ? new Date(this.lastSyncAttemptAt) : null,
        error: this.lastSyncError,
      },
    };
  }

  async createZone(body: Record<string, unknown>, user: AuthUser) {
    const warehouseId = this.requireWarehouseScope(user, this.text(body.warehouseId), 'write');
    const warehouse = await this.resolveWarehouse(warehouseId);
    const name = this.requiredText(body.name, 'Введите название зоны.');
    const requestedCode = this.text(body.code);
    const code = requestedCode || (await this.nextZoneCode(warehouse.id));

    return this.prisma.zone.create({
      data: { warehouseId: warehouse.id, code: code.toUpperCase(), name },
    });
  }

  async createPallet(body: Record<string, unknown>, user: AuthUser) {
    const warehouseId = this.requireWarehouseScope(user, this.text(body.warehouseId), 'write');
    const warehouse = await this.resolveWarehouse(warehouseId);
    const clientId = await this.resolveClientId(this.text(body.clientId), false, user, 'write');
    const code = this.normalizeCode(this.requiredText(body.code, 'Отсканируйте или введите номер паллеты.'));
    const zoneId = await this.validateZone(warehouse.id, this.text(body.zoneId));
    await this.assertPalletClient(warehouse.id, code, clientId);
    return this.prisma.storagePallet.upsert({
      where: { warehouseId_code: { warehouseId: warehouse.id, code } },
      create: {
        warehouseId: warehouse.id,
        clientId,
        zoneId,
        code,
        source: 'MANUAL',
        status: 'CLOSED',
        workerUserId: user.id,
        workerName: user.name,
      },
      update: {
        clientId,
        zoneId,
        source: 'MANUAL',
        workerUserId: user.id,
        workerName: user.name,
      },
      include: { zone: true, boxes: true },
    });
  }

  async updatePallet(id: string, body: Record<string, unknown>, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({ where: { id } });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    const hasZone = Object.prototype.hasOwnProperty.call(body, 'zoneId');
    const zoneId = hasZone ? await this.validateZone(pallet.warehouseId, this.text(body.zoneId)) : undefined;
    return this.prisma.storagePallet.update({
      where: { id },
      data: {
        ...(hasZone ? { zoneId: zoneId || null } : {}),
        ...(this.text(body.status) ? { status: this.text(body.status).toUpperCase() } : {}),
      },
      include: { zone: true, boxes: true },
    });
  }

  async deletePallet(id: string, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({
      where: { id },
      include: { boxes: { select: { boxCode: true } } },
    });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    const detachedBoxCount = await this.prisma.$transaction(async (tx) => {
      const detached = await tx.storagePalletBox.deleteMany({ where: { palletId: pallet.id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'STORAGE_PALLET_DELETED',
          entity: 'StoragePallet',
          entityId: pallet.id,
          payload: {
            palletCode: pallet.code,
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            zoneId: pallet.zoneId,
            source: pallet.source,
            status: pallet.status,
            detachedBoxCount: detached.count,
            boxCodes: pallet.boxes.map((box) => box.boxCode),
            deletionMode: pallet.source === 'GOOGLE_SHEETS' ? 'HIDDEN_FROM_SYNC' : 'HARD_DELETE',
          },
        },
      });
      if (pallet.source === 'GOOGLE_SHEETS') {
        await tx.storagePallet.update({
          where: { id: pallet.id },
          data: {
            status: DELETED_STORAGE_PALLET_STATUS,
            zoneId: null,
            deviceCode: null,
            workerUserId: null,
            workerName: null,
          },
        });
      } else {
        await tx.storagePallet.delete({ where: { id: pallet.id } });
      }
      return detached.count;
    }, { isolationLevel: 'Serializable' });

    return {
      id: pallet.id,
      code: pallet.code,
      deleted: true as const,
      detachedBoxCount,
    };
  }

  async clearPallet(id: string, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({
      where: { id },
      include: { boxes: { select: { boxCode: true } } },
    });
    if (!pallet || pallet.status === DELETED_STORAGE_PALLET_STATUS) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');

    const clearedCount = await this.prisma.$transaction(async (tx) => {
      const cleared = await tx.storagePalletBox.deleteMany({ where: { palletId: pallet.id } });
      await tx.storagePallet.update({
        where: { id: pallet.id },
        data: { source: 'MANUAL' },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'STORAGE_PALLET_CLEARED',
          entity: 'StoragePallet',
          entityId: pallet.id,
          payload: {
            palletCode: pallet.code,
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            zoneId: pallet.zoneId,
            source: pallet.source,
            clearedCount: cleared.count,
            boxCodes: pallet.boxes.map((box) => box.boxCode),
          },
        },
      });
      return cleared.count;
    }, { isolationLevel: 'Serializable' });

    return { id: pallet.id, code: pallet.code, cleared: true as const, clearedCount };
  }

  async deletePallets(body: Record<string, unknown>, user: AuthUser) {
    const ids = [...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    )];
    if (!ids.length) {
      throw new BadRequestException('Выберите хотя бы одну паллету для удаления.');
    }
    if (ids.length > MAX_BULK_DELETE_PALLETS) {
      throw new BadRequestException(`За один раз можно удалить не более ${MAX_BULK_DELETE_PALLETS} паллет.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.storagePallet.findMany({
        where: { id: { in: ids } },
        include: { boxes: { select: { boxCode: true } } },
      });
      if (found.length !== ids.length) {
        throw new NotFoundException(
          'Одна или несколько выбранных паллет больше не существуют. Обновите список и повторите удаление.',
        );
      }

      const byId = new Map(found.map((pallet) => [pallet.id, pallet]));
      const pallets = ids.map((id) => byId.get(id)!);
      for (const pallet of pallets) {
        this.requirePalletAccess(user, pallet, 'write');
      }
      const googleIds = pallets
        .filter((pallet) => pallet.source === 'GOOGLE_SHEETS')
        .map((pallet) => pallet.id);
      const hardDeleteIds = pallets
        .filter((pallet) => pallet.source !== 'GOOGLE_SHEETS')
        .map((pallet) => pallet.id);

      const detached = await tx.storagePalletBox.deleteMany({
        where: { palletId: { in: ids } },
      });

      await tx.auditLog.createMany({
        data: pallets.map((pallet) => ({
          userId: user.id,
          action: 'STORAGE_PALLET_DELETED',
          entity: 'StoragePallet',
          entityId: pallet.id,
          payload: {
            palletCode: pallet.code,
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            zoneId: pallet.zoneId,
            source: pallet.source,
            status: pallet.status,
            detachedBoxCount: pallet.boxes.length,
            boxCodes: pallet.boxes.map((box) => box.boxCode),
            mode: 'BULK',
            deletionMode: pallet.source === 'GOOGLE_SHEETS' ? 'HIDDEN_FROM_SYNC' : 'HARD_DELETE',
          },
        })),
      });

      if (googleIds.length) {
        const hidden = await tx.storagePallet.updateMany({
          where: { id: { in: googleIds } },
          data: {
            status: DELETED_STORAGE_PALLET_STATUS,
            zoneId: null,
            deviceCode: null,
            workerUserId: null,
            workerName: null,
          },
        });
        if (hidden.count !== googleIds.length) {
          throw new BadRequestException('Состав выбранных паллет изменился. Ничего не удалено; обновите список.');
        }
      }
      if (hardDeleteIds.length) {
        const deleted = await tx.storagePallet.deleteMany({
          where: { id: { in: hardDeleteIds } },
        });
        if (deleted.count !== hardDeleteIds.length) {
          throw new BadRequestException('Состав выбранных паллет изменился. Ничего не удалено; обновите список.');
        }
      }

      return {
        deleted: pallets.map((pallet) => ({ id: pallet.id, code: pallet.code })),
        deletedCount: pallets.length,
        detachedBoxCount: detached.count,
      };
    }, { isolationLevel: 'Serializable' });
  }

  async addBox(palletId: string, body: Record<string, unknown>, user: AuthUser) {
    const code = this.normalizeCode(this.requiredText(body.boxCode, 'Отсканируйте или введите номер короба.'));
    const pallet = await this.prisma.storagePallet.findUnique({ where: { id: palletId } });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    return this.placeBox(pallet, code, 'MANUAL', user);
  }

  async removeBox(palletId: string, boxCode: string, user: AuthUser) {
    const code = this.normalizeCode(boxCode);
    const placement = await this.prisma.storagePalletBox.findUnique({
      where: { boxCode: code },
      include: { pallet: true },
    });
    if (!placement || placement.palletId !== palletId) {
      throw new NotFoundException(`Короб ${code} не найден на этой паллете.`);
    }
    this.requirePalletAccess(user, placement.pallet, 'write');
    await this.prisma.storagePalletBox.delete({ where: { id: placement.id } });
    return { removed: true, boxCode: code, palletCode: placement.pallet.code };
  }

  async relocateBox(body: Record<string, unknown>, user: AuthUser) {
    const boxCode = this.normalizeCode(this.requiredText(body.boxCode, 'Укажите короб для исправления.'));
    const targetPalletId = this.requiredText(body.targetPalletId, 'Выберите паллету, куда нужно переместить короб.');
    const swapBoxCode = this.normalizeCode(this.text(body.swapBoxCode));
    if (swapBoxCode && swapBoxCode === boxCode) {
      throw new BadRequestException('Нельзя поменять короб местами с самим собой.');
    }

    const [sourcePlacement, targetPallet, swapPlacement] = await Promise.all([
      this.prisma.storagePalletBox.findUnique({
        where: { boxCode },
        include: { pallet: { select: { id: true, code: true, clientId: true, warehouseId: true } } },
      }),
      this.prisma.storagePallet.findUnique({
        where: { id: targetPalletId },
        select: { id: true, code: true, clientId: true, warehouseId: true },
      }),
      swapBoxCode
        ? this.prisma.storagePalletBox.findUnique({
            where: { boxCode: swapBoxCode },
            include: { pallet: { select: { id: true, code: true, clientId: true, warehouseId: true } } },
          })
        : Promise.resolve(null),
    ]);
    if (!sourcePlacement) {
      throw new NotFoundException(`Короб ${boxCode} не найден ни на одной паллете.`);
    }
    if (!targetPallet) {
      throw new NotFoundException('Целевая паллета не найдена.');
    }
    this.requirePalletAccess(user, sourcePlacement.pallet, 'write');
    this.requirePalletAccess(user, targetPallet, 'write');
    if (swapPlacement) {
      this.requirePalletAccess(user, swapPlacement.pallet, 'write');
    }
    if (sourcePlacement.palletId === targetPallet.id) {
      throw new BadRequestException(`Короб ${boxCode} уже находится на паллете ${targetPallet.code}.`);
    }
    if (
      sourcePlacement.pallet.clientId !== targetPallet.clientId ||
      sourcePlacement.pallet.warehouseId !== targetPallet.warehouseId
    ) {
      throw new BadRequestException('Короба можно переносить только между паллетами одного клиента и одного склада.');
    }
    if (swapBoxCode && (!swapPlacement || swapPlacement.palletId !== targetPallet.id)) {
      throw new BadRequestException(`Короб ${swapBoxCode} не найден на паллете ${targetPallet.code}.`);
    }

    const changedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.storagePalletBox.update({
        where: { id: sourcePlacement.id },
        data: {
          palletId: targetPallet.id,
          source: 'MANUAL',
          scannedAt: changedAt,
        },
      });
      if (swapPlacement) {
        await tx.storagePalletBox.update({
          where: { id: swapPlacement.id },
          data: {
            palletId: sourcePlacement.palletId,
            source: 'MANUAL',
            scannedAt: changedAt,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: swapPlacement ? 'STORAGE_PALLET_BOXES_SWAPPED' : 'STORAGE_PALLET_BOX_RELOCATED',
          entity: 'StoragePalletBox',
          entityId: sourcePlacement.id,
          payload: {
            boxCode,
            fromPalletId: sourcePlacement.palletId,
            fromPalletCode: sourcePlacement.pallet.code,
            toPalletId: targetPallet.id,
            toPalletCode: targetPallet.code,
            swapBoxCode: swapPlacement?.boxCode ?? null,
            swapFromPalletId: swapPlacement?.palletId ?? null,
            swapToPalletId: swapPlacement ? sourcePlacement.palletId : null,
            changedAt: changedAt.toISOString(),
          },
        },
      });
      return {
        mode: swapPlacement ? ('SWAPPED' as const) : ('MOVED' as const),
        boxCode,
        fromPallet: {
          id: sourcePlacement.palletId,
          code: sourcePlacement.pallet.code,
        },
        toPallet: {
          id: targetPallet.id,
          code: targetPallet.code,
        },
        swappedBoxCode: swapPlacement?.boxCode ?? null,
        changedAt: changedAt.toISOString(),
      };
    });

    return {
      ...result,
      message:
        result.mode === 'SWAPPED'
          ? `Короба ${boxCode} и ${result.swappedBoxCode} поменяны местами: ${sourcePlacement.pallet.code} ↔ ${targetPallet.code}.`
          : `Короб ${boxCode} перемещён с паллеты ${sourcePlacement.pallet.code} на ${targetPallet.code}.`,
    };
  }

  async syncGoogleSheet(
    warehouseId: string | undefined,
    force: boolean,
    requestedClientId: string | undefined,
    user: AuthUser,
  ) {
    // FIX: retain the permission check without resolving/creating a warehouse;
    // a disabled integration endpoint must be completely read/write-free.
    this.requireWarehouseScope(user, warehouseId, 'write');
    void force;
    void requestedClientId;

    // FIX: keep the legacy endpoint safe for old clients, but stop before any
    // external request or Prisma mutation. Current placement is managed in WMS.
    throw new BadRequestException(
      'Синхронизация с Google отключена: перенос был одноразовой миграцией. Используйте ТСД или ручное размещение в WMS.',
    );
  }

  async getCurrentTsdPallet(deviceCode: string | undefined, user: AuthUser) {
    const normalizedDevice = this.requiredText(deviceCode, 'Не указан код ТСД.');
    const warehouseId = this.requireWarehouseScope(user, undefined, 'write');
    const pallet = await this.prisma.storagePallet.findFirst({
      where: {
        deviceCode: normalizedDevice,
        status: 'OPEN',
        ...(warehouseId ? { warehouseId } : {}),
        ...this.clientWhere(user, 'write'),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!pallet) {
      return { state: 'SCAN_PALLET', message: 'Отсканируйте номер паллеты.', pallet: null };
    }
    return this.tsdPalletResponse(pallet.id, 'Продолжайте сканировать короба.');
  }

  async openTsdPallet(body: Record<string, unknown>, user: AuthUser) {
    const deviceCode = this.requiredText(body.deviceCode || user.deviceCode, 'Не указан код ТСД.');
    const code = this.normalizeCode(this.requiredText(body.palletCode, 'Отсканируйте номер паллеты.'));
    await this.assertPalletCodeIsNotBoxCode(code);
    const warehouseId = this.requireWarehouseScope(user, this.text(body.warehouseId), 'write');
    const warehouse = await this.resolveWarehouse(warehouseId);
    const clientId = await this.resolveClientId(this.text(body.clientId), false, user, 'write');
    await this.assertPalletClient(warehouse.id, code, clientId);
    const current = await this.prisma.storagePallet.findFirst({
      where: { deviceCode, status: 'OPEN', warehouseId: warehouse.id, clientId },
      orderBy: { updatedAt: 'desc' },
    });
    if (current && current.code !== code) {
      throw new BadRequestException(
        `Сначала завершите паллету ${current.code} кнопкой «Следующая паллета».`,
      );
    }
    const pallet = await this.prisma.storagePallet.upsert({
      where: { warehouseId_code: { warehouseId: warehouse.id, code } },
      create: {
        warehouseId: warehouse.id,
        clientId,
        code,
        status: 'OPEN',
        source: 'TSD',
        deviceCode,
        workerUserId: user.id,
        workerName: user.name,
      },
      update: {
        clientId,
        status: 'OPEN',
        source: 'TSD',
        deviceCode,
        workerUserId: user.id,
        workerName: user.name,
        closedAt: null,
      },
    });
    return this.tsdPalletResponse(pallet.id, `Паллета ${code} открыта. Сканируйте короба.`);
  }

  async scanTsdPalletBox(id: string, body: Record<string, unknown>, user: AuthUser) {
    const boxCode = await this.boxCodes.requireAllowed(
      this.requiredText(body.boxCode, 'Отсканируйте номер короба.'),
    );
    const pallet = await this.prisma.storagePallet.findUnique({ where: { id } });
    if (!pallet || pallet.status !== 'OPEN') {
      throw new BadRequestException('Сначала откройте паллету.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    await this.requireBoxPlacementAccess(user, boxCode, 'write');
    const box = await this.prisma.box.findUnique({
      where: { code: boxCode },
      include: {
        balances: {
          where: { warehouseId: pallet.warehouseId, quantity: { gt: 0 } },
          select: { quantity: true },
        },
      },
    });
    if (box && box.clientId !== pallet.clientId) {
      throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
    }
    this.assertBoxWarehouse(box, pallet.warehouseId, boxCode);
    if (!box) {
      return this.tsdPalletResponse(
        pallet.id,
        `Короб ${boxCode} не найден в WMS. Пропикайте всё содержимое короба по ШК товара.`,
        false,
        {
          boxCode,
          reason: 'MISSING',
          reasonLabel: 'Короб отсутствует в WMS',
        },
      );
    }
    if (['deleted', 'archived'].includes(box.status)) {
      const positiveQuantity = box.balances.reduce((sum, balance) => sum + balance.quantity, 0);
      if (positiveQuantity > 0) {
        throw new BadRequestException(
          `Короб ${boxCode} находится в архиве, но в WMS у него числится ${positiveQuantity} шт. Передайте короб менеджеру.`,
        );
      }
      return this.tsdPalletResponse(
        pallet.id,
        `Короб ${boxCode} находится в архиве и числится пустым. Пропикайте всё содержимое по ШК товара.`,
        false,
        {
          boxCode,
          reason: 'ARCHIVED_EMPTY',
          reasonLabel: 'Пустой архивный короб',
        },
      );
    }
    const current = await this.prisma.storagePalletBox.findUnique({
      where: { boxCode },
      include: { pallet: true },
    });
    if (current?.palletId === pallet.id) {
      return this.tsdPalletResponse(pallet.id, `Короб ${boxCode} уже добавлен. Повтор не засчитан.`, true);
    }
    const movedFrom = current?.pallet.code ?? null;
    await this.placeBox(pallet, boxCode, 'TSD', user);
    return this.tsdPalletResponse(
      pallet.id,
      movedFrom
        ? `Короб ${boxCode} перенесён с паллеты ${movedFrom}.`
        : `Короб ${boxCode} добавлен.`,
    );
  }

  async restoreTsdPalletBox(id: string, body: Record<string, unknown>, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({ where: { id } });
    if (!pallet || pallet.status !== 'OPEN') {
      throw new BadRequestException('Сначала откройте паллетсорт.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    const boxCode = await this.boxCodes.requireAllowed(
      this.requiredText(body.boxCode, 'Не указан восстанавливаемый короб.'),
    );
    await this.requireBoxPlacementAccess(user, boxCode, 'write');
    const idempotencyKey = this.requiredText(
      body.idempotencyKey,
      'Не указан идентификатор восстановления короба.',
    ).slice(0, 160);
    const items = this.parseRestoreItems(body.items);

    const priorMovement = await this.prisma.stockMovement.findFirst({
      where: {
        warehouseId: pallet.warehouseId,
        idempotencyKey: { startsWith: `${idempotencyKey}:` },
      },
      select: { id: true },
    });
    if (priorMovement) {
      await this.placeBox(pallet, boxCode, 'TSD', user);
      return this.tsdPalletResponse(
        pallet.id,
        `Короб ${boxCode} уже восстановлен. Повторное сохранение не выполнено.`,
        true,
      );
    }

    const existingBox = await this.prisma.box.findUnique({
      where: { code: boxCode },
      include: {
        balances: {
          where: { warehouseId: pallet.warehouseId, quantity: { gt: 0 } },
          select: { quantity: true },
        },
      },
    });
    if (existingBox && existingBox.clientId !== pallet.clientId) {
      throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
    }
    this.assertBoxWarehouse(existingBox, pallet.warehouseId, boxCode);
    const currentQuantity =
      existingBox?.balances.reduce((sum, balance) => sum + balance.quantity, 0) ?? 0;
    if (currentQuantity > 0) {
      throw new BadRequestException(
        `В коробе ${boxCode} уже числится ${currentQuantity} шт. Автоматическое восстановление отменено.`,
      );
    }

    const skuIds = items.map((item) => item.skuId);
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds }, clientId: pallet.clientId },
      include: { barcodes: { select: { value: true } } },
    });
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    if (skuById.size !== skuIds.length) {
      throw new BadRequestException('Один или несколько товаров не относятся к клиенту паллетсорта.');
    }
    for (const item of items) {
      const sku = skuById.get(item.skuId)!;
      if (!sku.barcodes.some((barcode) => barcode.value === item.barcode)) {
        throw new BadRequestException(
          `ШК ${item.barcode} не соответствует товару ${sku.internalSku}. Пропикайте товар заново.`,
        );
      }
    }

    const restoredBox = await this.prisma.$transaction(async (tx) => {
      const box = existingBox
        ? await tx.box.update({
            where: { id: existingBox.id },
            data: { status: 'active', warehouseId: pallet.warehouseId },
          })
        : await tx.box.create({
            data: {
              clientId: pallet.clientId,
              warehouseId: pallet.warehouseId,
              code: boxCode,
              status: 'active',
            },
          });

      await tx.stockBalance.deleteMany({ where: { boxId: box.id } });
      for (const item of items) {
        await tx.stockBalance.create({
          data: {
            balanceKey: this.balances.balanceKey({
              warehouseId: pallet.warehouseId,
              clientId: pallet.clientId,
              skuId: item.skuId,
              boxId: box.id,
              palletId: null,
              status: StockStatus.AVAILABLE,
            }),
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            skuId: item.skuId,
            boxId: box.id,
            palletId: null,
            status: StockStatus.AVAILABLE,
            quantity: item.quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: pallet.warehouseId,
            clientId: pallet.clientId,
            skuId: item.skuId,
            boxId: box.id,
            palletId: null,
            type: MovementType.INVENTORY_ADJUSTMENT,
            status: StockStatus.AVAILABLE,
            quantity: item.quantity,
            sourceDocument: `TSD паллетсорт ${pallet.code}`,
            idempotencyKey: `${idempotencyKey}:${item.skuId}`,
            comment: `Короб ${boxCode} создан или восстановлен по фактическому пересчёту содержимого.`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: existingBox ? 'TSD_EMPTY_BOX_RESTORED' : 'TSD_MISSING_BOX_CREATED',
          entity: 'Box',
          entityId: box.id,
          payload: {
            boxCode,
            palletId: pallet.id,
            palletCode: pallet.code,
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            previousStatus: existingBox?.status ?? null,
            items,
            totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          },
        },
      });
      return box;
    });

    await this.placeBox(pallet, restoredBox.code, 'TSD', user);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return this.tsdPalletResponse(
      pallet.id,
      `Короб ${boxCode} восстановлен и добавлен на ${pallet.code}: ${totalQuantity} шт.`,
    );
  }

  async closeTsdPallet(id: string, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({
      where: { id },
      include: { boxes: true },
    });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    await this.prisma.storagePallet.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        workerUserId: user.id,
        workerName: user.name,
      },
    });
    return {
      state: 'SCAN_PALLET',
      message: `Паллета ${pallet.code} завершена: ${pallet.boxes.length} коробов. Отсканируйте следующую паллету.`,
      pallet: null,
    };
  }

  async deleteTsdPallet(id: string, user: AuthUser) {
    const pallet = await this.prisma.storagePallet.findUnique({
      where: { id },
      include: { boxes: { select: { boxCode: true } } },
    });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    this.requirePalletAccess(user, pallet, 'write');
    if (pallet.source !== 'TSD') {
      throw new BadRequestException('С ТСД можно удалить только паллету, созданную в разделе «Сборка паллетов».');
    }
    if (pallet.status !== 'OPEN') {
      throw new BadRequestException('Удалить можно только открытую паллету. Закрытую исправьте в веб-разделе «Зоны хранения».');
    }
    const deviceCode = this.text(user.deviceCode);
    if (deviceCode && pallet.deviceCode && pallet.deviceCode !== deviceCode) {
      throw new BadRequestException('Эта паллета открыта на другом ТСД.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'TSD_STORAGE_PALLET_DELETED',
          entity: 'StoragePallet',
          entityId: pallet.id,
          payload: {
            palletCode: pallet.code,
            clientId: pallet.clientId,
            warehouseId: pallet.warehouseId,
            boxCodes: pallet.boxes.map((box) => box.boxCode),
            boxCount: pallet.boxes.length,
          },
        },
      });
      await tx.storagePallet.delete({ where: { id: pallet.id } });
    });

    return {
      state: 'SCAN_PALLET',
      message: `Паллета ${pallet.code} удалена. Все ${pallet.boxes.length} коробов отвязаны. Теперь можно отсканировать эту паллету заново.`,
      pallet: null,
    };
  }

  async locationsByBoxCodes(boxCodes: string[], user: AuthUser) {
    const normalized = [...new Set(boxCodes.map((code) => this.normalizeCode(code)).filter(Boolean))];
    if (!normalized.length) {
      return new Map<string, { palletId: string; palletCode: string; zoneId: string | null; zoneCode: string | null; zoneName: string | null; source: string }>();
    }
    const placements = await this.prisma.storagePalletBox.findMany({
      where: {
        boxCode: { in: normalized },
        ...this.palletRelationWhere(user, 'read'),
      },
      include: { pallet: { include: { zone: true } } },
    });
    return new Map(
      placements.map((placement) => [
        placement.boxCode,
        {
          palletId: placement.palletId,
          palletCode: placement.pallet.code,
          zoneId: placement.pallet.zoneId,
          zoneCode: placement.pallet.zone?.code ?? null,
          zoneName: placement.pallet.zone?.name ?? null,
          source: placement.source,
        },
      ]),
    );
  }

  private async performGoogleSync(warehouseId: string, clientId: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(process.env.STORAGE_LAYOUT_GOOGLE_CSV_URL || GOOGLE_SHEET_CSV_URL, {
        signal: controller.signal,
        headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Google-таблица вернула HTTP ${response.status}.`);
    }
    const pallets = this.parseGoogleCsv(await response.text());
    if (!pallets.length) {
      throw new Error('В Google-таблице не найдено ни одной паллеты.');
    }

    const syncedAt = new Date();
    const incomingBoxCodes = [...new Set(pallets.flatMap((pallet) => pallet.boxes))];
    const boxes = await this.prisma.box.findMany({
      where: { code: { in: incomingBoxCodes }, clientId, warehouseId },
      select: { id: true, code: true, status: true },
    });
    const boxIds = new Map(boxes.map((box) => [this.normalizeCode(box.code), box.id]));
    const existingPlacements = await this.prisma.storagePalletBox.findMany({
      where: { boxCode: { in: incomingBoxCodes } },
      select: {
        boxCode: true,
        source: true,
        pallet: { select: { warehouseId: true, clientId: true } },
      },
    });
    const protectedBoxes = new Set(
      existingPlacements
        .filter(
          (placement) =>
            placement.source !== 'GOOGLE_SHEETS' ||
            placement.pallet.warehouseId !== warehouseId ||
            placement.pallet.clientId !== clientId,
        )
        .map((placement) => placement.boxCode),
    );

    await this.prisma.storagePalletBox.deleteMany({
      where: {
        source: 'GOOGLE_SHEETS',
        pallet: { warehouseId, clientId },
        ...(incomingBoxCodes.length ? { boxCode: { notIn: incomingBoxCodes } } : {}),
      },
    });

    for (const entry of pallets) {
      await this.assertPalletClient(warehouseId, entry.code, clientId);
      const pallet = await this.prisma.storagePallet.upsert({
        where: { warehouseId_code: { warehouseId, code: entry.code } },
        create: {
          warehouseId,
          clientId,
          code: entry.code,
          source: 'GOOGLE_SHEETS',
          status: 'CLOSED',
          lastSyncedAt: syncedAt,
        },
        update: {
          clientId,
          lastSyncedAt: syncedAt,
        },
      });
      // FIX: a physical TSD/manual actualization owns the pallet contents from this point on.
      // Google may keep the pallet row visible, but must never restore boxes removed by workers.
      if (pallet.source !== 'GOOGLE_SHEETS' || pallet.status === DELETED_STORAGE_PALLET_STATUS) {
        continue;
      }
      const writableBoxes = entry.boxes.filter((boxCode) => !protectedBoxes.has(boxCode));
      for (let offset = 0; offset < writableBoxes.length; offset += 100) {
        const batch = writableBoxes.slice(offset, offset + 100);
        await this.prisma.$transaction(async (tx) => {
          await Promise.all(batch.map((boxCode) =>
            tx.storagePalletBox.upsert({
              where: { boxCode },
              create: {
                palletId: pallet.id,
                boxId: boxIds.get(boxCode),
                boxCode,
                source: 'GOOGLE_SHEETS',
                scannedAt: syncedAt,
              },
              update: {
                palletId: pallet.id,
                boxId: boxIds.get(boxCode),
                source: 'GOOGLE_SHEETS',
                scannedAt: syncedAt,
              },
            }),
          ));
          const batchBoxIds = [...new Set(
            batch.map((boxCode) => boxIds.get(boxCode)).filter((boxId): boxId is string => Boolean(boxId)),
          )];
          // FIX: re-read archive state inside the transaction to catch concurrent archiving.
          const archivedBoxes = batchBoxIds.length
            ? await tx.box.findMany({
                where: { id: { in: batchBoxIds }, status: 'archived' },
                select: { id: true },
              })
            : [];
          // FIX: sync placement and archived-empty cleanup commit or roll back together.
          for (const archivedBox of archivedBoxes) {
            await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
              { boxId: archivedBox.id, reason: 'google-storage-layout-sync' },
              tx,
            );
          }
        }, { isolationLevel: 'Serializable' });
      }
    }
  }

  private parseGoogleCsv(csv: string): ParsedPallet[] {
    const rows = csv
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((row) => this.firstCsvCell(row).trim())
      .filter(Boolean);
    const byCode = new Map<string, Set<string>>();
    let currentPallet = '';
    for (const row of rows) {
      const value = this.normalizeCode(row);
      if (/^PAL+(?:ET|LET)?(?:_|-|\s)/i.test(value) || /^PALETSORT/i.test(value)) {
        currentPallet = value;
        if (!byCode.has(currentPallet)) {
          byCode.set(currentPallet, new Set());
        }
        continue;
      }
      if (currentPallet) {
        byCode.get(currentPallet)?.add(value);
      }
    }
    const globallySeen = new Set<string>();
    return [...byCode.entries()].map(([code, boxSet]) => ({
      code,
      boxes: [...boxSet].filter((boxCode) => {
        if (globallySeen.has(boxCode)) {
          return false;
        }
        globallySeen.add(boxCode);
        return true;
      }),
    }));
  }

  private firstCsvCell(row: string) {
    if (!row.startsWith('"')) {
      return row.split(',')[0] ?? '';
    }
    let value = '';
    for (let index = 1; index < row.length; index += 1) {
      if (row[index] === '"' && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (row[index] === '"') {
        break;
      } else {
        value += row[index];
      }
    }
    return value;
  }

  private async placeBox(
    pallet: { id: string; code: string; clientId: string; warehouseId: string },
    boxCode: string,
    source: 'MANUAL' | 'TSD',
    user: AuthUser,
  ) {
    this.requirePalletAccess(user, pallet, 'write');
    return this.prisma.$transaction(async (tx) => {
      // FIX: the cleanup service locks the same Box row before archiving it.
      const lockedBoxes = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        clientId: string;
        warehouseId: string | null;
      }>>(
        Prisma.sql`SELECT "id", "status", "clientId", "warehouseId" FROM "Box" WHERE "code" = ${boxCode} FOR UPDATE`,
      );
      const box = lockedBoxes[0] ?? null;
      if (box?.status !== undefined && box.status !== 'active') {
        throw new BadRequestException(
          `Короб ${boxCode} находится в архиве или неактивен. Сначала восстановите его через актуализацию.`,
        );
      }
      const existingPlacement = await tx.storagePalletBox.findUnique({
        where: { boxCode },
        include: { pallet: true },
      });
      if (existingPlacement && existingPlacement.palletId !== pallet.id) {
        this.requirePalletAccess(user, existingPlacement.pallet, 'write');
      }
      if (box && box.clientId !== pallet.clientId) {
        throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
      }
      this.assertBoxWarehouse(box, pallet.warehouseId, boxCode);
      const placement = await tx.storagePalletBox.upsert({
        where: { boxCode },
        create: {
          palletId: pallet.id,
          boxId: box?.id,
          boxCode,
          source,
        },
        update: {
          palletId: pallet.id,
          boxId: box?.id,
          source,
          scannedAt: new Date(),
        },
        include: { box: { select: { id: true, status: true } }, pallet: true },
      });
      await tx.storagePallet.update({
        where: { id: pallet.id },
        data: {
          source,
          workerUserId: user.id,
          workerName: user.name,
        },
      });
      return {
        ...placement,
        warning: box ? null : `Короб ${boxCode} сохранён в размещении, но пока не найден в WMS.`,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 10_000,
    });
  }

  private async tsdPalletResponse(
    id: string,
    message: string,
    duplicate = false,
    recovery: {
      boxCode: string;
      reason: 'MISSING' | 'ARCHIVED_EMPTY';
      reasonLabel: string;
    } | null = null,
  ) {
    const pallet = await this.prisma.storagePallet.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true } },
        zone: { select: { id: true, code: true, name: true } },
        boxes: {
          include: {
            box: { select: { id: true, client: { select: { code: true, name: true } } } },
          },
          orderBy: { scannedAt: 'desc' },
        },
      },
    });
    if (!pallet) {
      throw new NotFoundException('Паллета не найдена.');
    }
    return {
      state: recovery ? 'SCAN_BOX_CONTENTS' : 'SCAN_BOX',
      message,
      duplicate,
      recovery,
      pallet: {
        id: pallet.id,
        code: pallet.code,
        status: pallet.status,
        client: pallet.client,
        zone: pallet.zone,
        boxCount: pallet.boxes.length,
        boxes: pallet.boxes.map((placement) => ({
          boxCode: placement.boxCode,
          existsInWms: Boolean(placement.boxId),
          clientName: placement.box?.client.name ?? null,
          scannedAt: placement.scannedAt,
        })),
      },
    };
  }

  private parseRestoreItems(value: unknown) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('Пропикайте хотя бы один ШК товара из короба.');
    }
    if (value.length > 500) {
      throw new BadRequestException('В одном восстановлении можно передать не более 500 товарных строк.');
    }
    const merged = new Map<string, { skuId: string; barcode: string; quantity: number }>();
    for (const raw of value) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException('Некорректная строка содержимого короба.');
      }
      const row = raw as Record<string, unknown>;
      const skuId = this.requiredText(row.skuId, 'Не указан товар в строке содержимого.');
      const barcode = this.requiredText(row.barcode, 'Не указан ШК товара.');
      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000) {
        throw new BadRequestException(`Некорректное количество для ШК ${barcode}.`);
      }
      const current = merged.get(skuId);
      if (current && current.barcode !== barcode) {
        throw new BadRequestException('Один товар передан с разными ШК. Повторите пересчёт.');
      }
      merged.set(skuId, {
        skuId,
        barcode,
        quantity: (current?.quantity ?? 0) + quantity,
      });
    }
    return [...merged.values()];
  }

  private async resolveWarehouse(id?: string) {
    if (id) {
      const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
      if (!warehouse) {
        throw new NotFoundException('Склад не найден.');
      }
      return warehouse;
    }
    const existing =
      (await this.prisma.warehouse.findUnique({
        where: { code: GOOGLE_LAYOUT_WAREHOUSE_CODE },
      })) ||
      (await this.prisma.warehouse.findFirst({ orderBy: { createdAt: 'asc' } }));
    if (existing) {
      return existing;
    }
    return this.prisma.warehouse.create({
      data: { code: 'LOGOFF', name: 'Основной склад LOGOff' },
    });
  }

  private async resolveClientId(
    id?: string,
    preferLukin = false,
    user?: AuthUser,
    mode: 'read' | 'write' = 'read',
  ) {
    if (id) {
      const client = await this.prisma.client.findUnique({ where: { id }, select: { id: true } });
      if (!client) {
        throw new NotFoundException('Клиент не найден.');
      }
      if (user) this.requireClientAccess(user, client.id, mode);
      return client.id;
    }
    if (preferLukin) {
      const lukin = await this.prisma.client.findFirst({
        where: {
          ...(user ? this.clientIdWhere(user, mode) : {}),
          OR: [
            { name: { contains: 'Лукин', mode: 'insensitive' } },
            { legalName: { contains: 'Лукин', mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (lukin) {
        if (user) this.requireClientAccess(user, lukin.id, mode);
        return lukin.id;
      }
    }
    throw new BadRequestException('Выберите клиента, для которого собирается паллет-сорт.');
  }

  private requireWarehouseScope(
    user: AuthUser,
    requestedWarehouseId: string | undefined,
    mode: 'read' | 'write',
  ) {
    if (!this.enforceInternalBranchScope(user)) {
      return requestedWarehouseId || undefined;
    }
    const activeWarehouseId = this.text(user.activeWarehouseId);
    const allowedWarehouseIds =
      mode === 'write' ? user.writableWarehouseIds ?? [] : user.warehouseIds ?? [];
    if (!activeWarehouseId || !allowedWarehouseIds.includes(activeWarehouseId)) {
      throw new ForbiddenException(
        mode === 'write'
          ? 'Выберите доступный для изменения филиал.'
          : 'Выберите доступный филиал.',
      );
    }
    if (requestedWarehouseId && requestedWarehouseId !== activeWarehouseId) {
      throw new ForbiddenException('Данные другого филиала недоступны.');
    }
    return activeWarehouseId;
  }

  private requireClientAccess(user: AuthUser, clientId: string, mode: 'read' | 'write') {
    if (!this.enforceInternalBranchScope(user) || user.clientScopeMode === 'ALL') return;
    const allowedClientIds = mode === 'write' ? user.writableClientIds : user.clientIds;
    if (!allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Клиент не относится к выбранному филиалу или недоступен сотруднику.');
    }
  }

  private requirePalletAccess(
    user: AuthUser,
    pallet: { warehouseId: string; clientId: string },
    mode: 'read' | 'write',
  ) {
    this.requireWarehouseScope(user, pallet.warehouseId, mode);
    this.requireClientAccess(user, pallet.clientId, mode);
  }

  private assertBoxWarehouse(
    box: { warehouseId?: string | null } | null,
    warehouseId: string,
    boxCode: string,
  ) {
    if (box && box.warehouseId !== warehouseId) {
      throw new ForbiddenException(
        `Короб ${boxCode} относится к другому филиалу или не имеет безопасной привязки к филиалу.`,
      );
    }
  }

  private async requireBoxPlacementAccess(
    user: AuthUser,
    boxCode: string,
    mode: 'read' | 'write',
  ) {
    const placement = await this.prisma.storagePalletBox.findUnique({
      where: { boxCode },
      include: { pallet: true },
    });
    if (placement) this.requirePalletAccess(user, placement.pallet, mode);
    return placement;
  }

  private clientIdWhere(user: AuthUser, mode: 'read' | 'write') {
    if (!this.enforceInternalBranchScope(user) || user.clientScopeMode === 'ALL') return {};
    const ids = mode === 'write' ? user.writableClientIds : user.clientIds;
    return { id: { in: ids } };
  }

  private clientWhere(user: AuthUser, mode: 'read' | 'write') {
    if (!this.enforceInternalBranchScope(user) || user.clientScopeMode === 'ALL') return {};
    const ids = mode === 'write' ? user.writableClientIds : user.clientIds;
    return { clientId: { in: ids } };
  }

  private boxPlacementWhere(user: AuthUser, mode: 'read' | 'write') {
    if (!this.enforceInternalBranchScope(user) || user.clientScopeMode === 'ALL') return {};
    const ids = mode === 'write' ? user.writableClientIds : user.clientIds;
    return {
      OR: [
        { boxId: null },
        { box: { clientId: { in: ids } } },
      ],
    };
  }

  private palletRelationWhere(user: AuthUser, mode: 'read' | 'write') {
    const warehouseId = this.requireWarehouseScope(user, undefined, mode);
    if (!this.enforceInternalBranchScope(user)) return {};
    return {
      pallet: {
        warehouseId,
        ...this.clientWhere(user, mode),
      },
    };
  }

  private enforceInternalBranchScope(user: AuthUser) {
    return !user.permissionCodes.includes('system:admin') && !user.roleCodes.includes('CLIENT');
  }

  private async assertPalletClient(warehouseId: string, code: string, clientId: string) {
    const existing = await this.prisma.storagePallet.findUnique({
      where: { warehouseId_code: { warehouseId, code } },
      select: { clientId: true, client: { select: { name: true } }, _count: { select: { boxes: true } } },
    });
    if (existing && existing.clientId !== clientId && existing._count.boxes > 0) {
      throw new BadRequestException(
        `Паллета ${code} уже собрана для клиента ${existing.client.name}. Используйте другую паллету.`,
      );
    }
  }

  private async assertPalletCodeIsNotBoxCode(code: string) {
    const [policy, existingBox] = await Promise.all([
      this.boxCodes.getPolicy(),
      this.prisma.box.findFirst({
        where: { code: { equals: code, mode: 'insensitive' } },
        select: { code: true },
      }),
    ]);
    const normalizedAsBox = await this.boxCodes.normalize(code);
    const hasBoxPrefix = policy.allowedPrefixes.some((prefix) => normalizedAsBox.startsWith(prefix));
    if (existingBox || hasBoxPrefix) {
      throw new BadRequestException(
        `Отсканирован номер короба ${existingBox?.code ?? code}. Сейчас требуется QR или ШК паллетсорта. Короб можно сканировать только после открытия паллетсорта.`,
      );
    }
  }

  private async validateZone(warehouseId: string, zoneId?: string) {
    if (!zoneId) {
      return null;
    }
    const zone = await this.prisma.zone.findFirst({ where: { id: zoneId, warehouseId } });
    if (!zone) {
      throw new BadRequestException('Выбранная зона относится к другому складу или удалена.');
    }
    return zone.id;
  }

  private async nextZoneCode(warehouseId: string) {
    const count = await this.prisma.zone.count({ where: { warehouseId } });
    for (let index = count + 1; index < count + 1000; index += 1) {
      const code = `ZONE-${String(index).padStart(3, '0')}`;
      const exists = await this.prisma.zone.findUnique({ where: { warehouseId_code: { warehouseId, code } } });
      if (!exists) {
        return code;
      }
    }
    return `ZONE-${Date.now()}`;
  }

  private requiredText(value: unknown, message: string) {
    const text = this.text(value);
    if (!text) {
      throw new BadRequestException(message);
    }
    return text;
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeCode(value: string) {
    const normalized = value.trim().toUpperCase();
    return normalized.startsWith('FL_') ? `F${normalized}` : normalized;
  }
}
