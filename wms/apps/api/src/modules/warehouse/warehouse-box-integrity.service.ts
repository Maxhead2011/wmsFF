import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MovementType,
  Prisma,
  StockStatus,
  WarehouseBoxCheckDecision,
  WarehouseBoxCheckSeverity,
} from '@prisma/client';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockBalancesService } from '../stock/stock-balances.service';

type CheckRunInput = {
  periodFrom?: unknown;
  periodTo?: unknown;
  clientId?: unknown;
};

type CheckDecisionInput = {
  action?: unknown;
  quantity?: unknown;
  comment?: unknown;
};

type EvidenceCounter = {
  relabelQuantity: number;
  restoredQuantity: number;
  fbsPickedQuantity: number;
  relabelOrders: Set<string>;
  restoredDocuments: Set<string>;
};

@Injectable()
export class WarehouseBoxIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly balances: StockBalancesService,
    private readonly inventoryLock: InventoryLockService,
    private readonly archivedEmptyBoxDetach?: ArchivedEmptyBoxPalletDetachService,
  ) {}

  async listChecks(user: AuthUser, clientIdValue?: string) {
    const clientId = cleanText(clientIdValue);
    const clientFilter = this.clientScopes.resolveClientFilter(user, clientId || undefined);
    const warehouseId = resolveScopedWarehouseId(user, 'read');
    return this.prisma.warehouseBoxCheck.findMany({
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(clientId
          ? {
              OR: [
                { clientId },
                { rows: { some: { clientId } } },
              ],
            }
          : clientFilter === undefined
            ? {}
            : {
                OR: [
                  { clientId: clientFilter },
                  { rows: { some: { clientId: clientFilter } } },
                ],
              }),
      },
      include: {
        rows: {
          where: {
            clientId: clientFilter,
            ...(warehouseId ? { warehouseId } : {}),
          },
          orderBy: [{ severity: 'asc' }, { boxCode: 'asc' }, { skuName: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async getCheck(id: string, user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const warehouseId = resolveScopedWarehouseId(user, 'read');
    const check = await this.prisma.warehouseBoxCheck.findFirst({
      where: { id, ...(warehouseId ? { warehouseId } : {}) },
      include: {
        rows: {
          where: {
            clientId: clientFilter,
            ...(warehouseId ? { warehouseId } : {}),
          },
          orderBy: [{ severity: 'asc' }, { boxCode: 'asc' }, { skuName: 'asc' }],
        },
      },
    });
    if (!check) throw new NotFoundException('Проверка коробов не найдена.');
    if (clientFilter !== undefined && check.rows.length === 0) {
      if (!check.clientId) throw new NotFoundException('Проверка коробов не найдена.');
      this.clientScopes.requireClientAccess(user, check.clientId, 'read');
    }
    return check;
  }

  async runCheck(input: CheckRunInput, user: AuthUser) {
    const periodFrom = parsePeriodDate(input.periodFrom, 'начала');
    const periodTo = endOfDay(parsePeriodDate(input.periodTo, 'окончания'));
    if (periodFrom > periodTo) {
      throw new BadRequestException('Дата начала периода должна быть раньше даты окончания.');
    }
    const maximumPeriodMs = 366 * 24 * 60 * 60 * 1000;
    if (periodTo.getTime() - periodFrom.getTime() > maximumPeriodMs) {
      throw new BadRequestException('За одну проверку можно выбрать период не более 366 дней.');
    }
    const requestedClientId = cleanText(input.clientId);
    const clientFilter = this.clientScopes.resolveClientFilter(user, requestedClientId || undefined);
    const warehouseId = resolveScopedWarehouseId(user, 'write');
    const boxWhere: Prisma.BoxWhereInput = {
      clientId: clientFilter,
      ...(warehouseId ? { warehouseId } : {}),
      status: { notIn: ['deleted', 'archived'] },
    };

    const [boxesChecked, availableBalances] = await Promise.all([
      this.prisma.box.count({ where: boxWhere }),
      this.prisma.stockBalance.findMany({
        where: {
          clientId: clientFilter,
          ...(warehouseId ? { warehouseId } : {}),
          box: { status: { notIn: ['deleted', 'archived'] } },
          boxId: { not: null },
          status: StockStatus.AVAILABLE,
          quantity: { gt: 0 },
        },
        select: {
          id: true,
          warehouseId: true,
          clientId: true,
          skuId: true,
          boxId: true,
          quantity: true,
          box: {
            select: {
              id: true,
              code: true,
              warehouseId: true,
              client: { select: { name: true } },
            },
          },
          sku: {
            select: {
              internalSku: true,
              name: true,
              barcodes: {
                select: { value: true, isPrimary: true },
                orderBy: [{ isPrimary: 'desc' }],
              },
            },
          },
        },
      }),
    ]);

    const balanceGroups = new Map<
      string,
      {
        clientId: string;
        warehouseId: string | null;
        skuId: string;
        boxId: string;
        boxCode: string;
        clientName: string;
        internalSku: string;
        skuName: string;
        barcode: string | null;
        quantity: number;
      }
    >();
    for (const balance of availableBalances) {
      if (!balance.boxId || !balance.box) continue;
      const key = boxSkuKey(balance.boxId, balance.skuId);
      const current = balanceGroups.get(key);
      if (current) {
        current.quantity += balance.quantity;
      } else {
        balanceGroups.set(key, {
          clientId: balance.clientId,
          warehouseId: balance.warehouseId ?? balance.box.warehouseId,
          skuId: balance.skuId,
          boxId: balance.boxId,
          boxCode: balance.box.code,
          clientName: balance.box.client.name,
          internalSku: balance.sku.internalSku,
          skuName: balance.sku.name,
          barcode: balance.sku.barcodes[0]?.value ?? null,
          quantity: balance.quantity,
        });
      }
    }

    const boxIds = [...new Set([...balanceGroups.values()].map((row) => row.boxId))];
    const activityWhere = { gte: periodFrom, lte: periodTo };
    const [movements, assemblies, markGroups] =
      boxIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            this.prisma.stockMovement.findMany({
              where: {
                clientId: clientFilter,
                ...(warehouseId ? { warehouseId } : {}),
                boxId: { in: boxIds },
                createdAt: activityWhere,
                OR: [
                  { idempotencyKey: { startsWith: 'fbs-relabel:' } },
                  { idempotencyKey: { startsWith: 'relabel-reconcile:' } },
                  { idempotencyKey: { contains: ':fbs-reconciled:' } },
                ],
              },
              select: {
                boxId: true,
                skuId: true,
                quantity: true,
                status: true,
                sourceDocument: true,
                idempotencyKey: true,
              },
            }),
            this.prisma.fbsTsdAssembly.findMany({
              where: {
                clientId: clientFilter,
                boxId: { in: boxIds },
                completedAt: activityWhere,
                status: 'COMPLETED',
              },
              select: {
                boxId: true,
                skuId: true,
                sourceSkuId: true,
                relabelRequired: true,
                itemCount: true,
                orderId: true,
              },
            }),
            this.prisma.productMark.groupBy({
              by: ['boxId', 'skuId'],
              where: {
                clientId: clientFilter,
                boxId: { in: boxIds },
                status: StockStatus.AVAILABLE,
              },
              _count: { _all: true },
            }),
          ]);

    const counters = new Map<string, EvidenceCounter>();
    const counterFor = (boxId: string, skuId: string) => {
      const key = boxSkuKey(boxId, skuId);
      const current = counters.get(key);
      if (current) return current;
      const created: EvidenceCounter = {
        relabelQuantity: 0,
        restoredQuantity: 0,
        fbsPickedQuantity: 0,
        relabelOrders: new Set<string>(),
        restoredDocuments: new Set<string>(),
      };
      counters.set(key, created);
      return created;
    };

    for (const movement of movements) {
      if (!movement.boxId) continue;
      const key = movement.idempotencyKey ?? '';
      const counter = counterFor(movement.boxId, movement.skuId);
      if (
        movement.status === StockStatus.AVAILABLE &&
        movement.quantity < 0 &&
        ((key.startsWith('fbs-relabel:') && key.endsWith(':source')) ||
          (key.startsWith('relabel-reconcile:') && key.endsWith(':source')))
      ) {
        counter.relabelQuantity += Math.abs(movement.quantity);
        if (movement.sourceDocument) counter.relabelOrders.add(movement.sourceDocument);
      }
      if (key.includes(':fbs-reconciled:') && movement.quantity > 0) {
        counter.restoredQuantity += movement.quantity;
        if (movement.sourceDocument) counter.restoredDocuments.add(movement.sourceDocument);
      }
    }

    for (const assembly of assemblies) {
      if (!assembly.boxId) continue;
      const stockSkuId =
        assembly.relabelRequired && assembly.sourceSkuId ? assembly.sourceSkuId : assembly.skuId;
      const counter = counterFor(assembly.boxId, stockSkuId);
      counter.fbsPickedQuantity += Math.max(1, assembly.itemCount);
      counter.relabelOrders.add(`WB №${assembly.orderId}`);
    }

    const marksByKey = new Map(
      markGroups
        .filter((row) => row.boxId)
        .map((row) => [boxSkuKey(row.boxId!, row.skuId), row._count._all]),
    );
    const rows: Prisma.WarehouseBoxCheckRowCreateWithoutCheckInput[] = [];
    const rowWarehouseIds = new Set<string>();
    for (const [key, balance] of balanceGroups) {
      const counter = counters.get(key);
      const markCount = marksByKey.get(key) ?? 0;
      const excessMarkCount = Math.max(0, markCount - balance.quantity);
      const relabelQuantity = counter?.relabelQuantity ?? 0;
      const restoredQuantity = counter?.restoredQuantity ?? 0;
      const fbsPickedQuantity = counter?.fbsPickedQuantity ?? 0;

      let severity: WarehouseBoxCheckSeverity | null = null;
      let reasonCode = '';
      let reasonLabel = '';
      let suspectQuantity = 0;
      if (relabelQuantity > 0 && restoredQuantity > 0) {
        severity = WarehouseBoxCheckSeverity.HIGH;
        reasonCode = 'FBS_RELABEL_FALSE_RESTORE';
        suspectQuantity = Math.min(balance.quantity, restoredQuantity);
        reasonLabel =
          'После переклейки FBS остаток был ошибочно восстановлен при закрытии заявки.';
      } else if (restoredQuantity > 0) {
        severity = WarehouseBoxCheckSeverity.MEDIUM;
        reasonCode = 'FBS_RESTORE_REQUIRES_RECOUNT';
        suspectQuantity = Math.min(balance.quantity, restoredQuantity);
        reasonLabel =
          'После сборки FBS выполнялось восстановление остатка. Нужна физическая перепроверка.';
      } else if (excessMarkCount > 0 && fbsPickedQuantity > 0) {
        severity = WarehouseBoxCheckSeverity.LOW;
        reasonCode = 'AVAILABLE_MARK_DRIFT';
        suspectQuantity = Math.min(balance.quantity, excessMarkCount);
        reasonLabel =
          'Число доступных КИЗ больше остатка, при этом из короба собирали FBS-заказы.';
      }
      if (!severity || suspectQuantity <= 0) continue;

      if (balance.warehouseId) rowWarehouseIds.add(balance.warehouseId);
      rows.push({
        boxId: balance.boxId,
        boxCode: balance.boxCode,
        clientId: balance.clientId,
        warehouse: balance.warehouseId
          ? { connect: { id: balance.warehouseId } }
          : undefined,
        clientName: balance.clientName,
        skuId: balance.skuId,
        internalSku: balance.internalSku,
        skuName: balance.skuName,
        barcode: balance.barcode,
        currentQuantity: balance.quantity,
        suspectQuantity,
        relabelQuantity,
        fbsPickedQuantity,
        restoredQuantity,
        markCount,
        excessMarkCount,
        severity,
        reasonCode,
        reasonLabel,
        evidence: {
          relabelOrders: [...(counter?.relabelOrders ?? [])].slice(0, 100),
          restoredDocuments: [...(counter?.restoredDocuments ?? [])].slice(0, 100),
          periodFrom: periodFrom.toISOString(),
          periodTo: periodTo.toISOString(),
        },
      });
    }

    const scopedRowWarehouseIds = [...rowWarehouseIds];
    const checkWarehouseId =
      warehouseId ?? (scopedRowWarehouseIds.length === 1 ? scopedRowWarehouseIds[0] : null);
    const check = await this.prisma.warehouseBoxCheck.create({
      data: {
        periodFrom,
        periodTo,
        clientId: requestedClientId || null,
        warehouseId: checkWarehouseId,
        boxesChecked,
        findingsCount: rows.length,
        probableUnits: rows.reduce((sum, row) => sum + row.suspectQuantity, 0),
        highConfidenceRows: rows.filter(
          (row) => row.severity === WarehouseBoxCheckSeverity.HIGH,
        ).length,
        createdByUserId: user.id,
        createdByName: user.name,
        rows: { create: rows },
      },
      include: {
        rows: {
          orderBy: [{ severity: 'asc' }, { boxCode: 'asc' }, { skuName: 'asc' }],
        },
      },
    });
    return check;
  }

  async decideRow(rowId: string, input: CheckDecisionInput, user: AuthUser) {
    const action = cleanText(input.action).toUpperCase() as WarehouseBoxCheckDecision;
    if (
      action !== WarehouseBoxCheckDecision.WRITE_OFF &&
      action !== WarehouseBoxCheckDecision.KEEP_AS_IS &&
      action !== WarehouseBoxCheckDecision.SET_QUANTITY
    ) {
      throw new BadRequestException('Выберите действие: списать, оставить как есть или изменить количество.');
    }
    const row = await this.prisma.warehouseBoxCheckRow.findUnique({
      where: { id: rowId },
      include: { check: true },
    });
    if (!row) throw new NotFoundException('Строка проверки не найдена.');
    if (!row.boxId || !row.skuId) {
      throw new BadRequestException('Короб или товар уже удалён из WMS.');
    }
    const scopedWarehouseId = resolveScopedWarehouseId(user, 'write');
    if (scopedWarehouseId && row.warehouseId !== scopedWarehouseId) {
      throw new NotFoundException('Строка проверки не найдена в активном филиале.');
    }
    this.clientScopes.requireClientAccess(user, row.clientId, 'write');
    if (row.decision !== WarehouseBoxCheckDecision.PENDING) {
      throw new BadRequestException('По этой строке решение уже принято и сохранено в истории.');
    }
    const comment = cleanText(input.comment) || null;
    const currentBox = await this.prisma.box.findUnique({
      where: { id: row.boxId },
      select: { id: true, warehouseId: true },
    });
    if (!currentBox) throw new NotFoundException('Короб больше не найден в WMS.');
    if (!currentBox.warehouseId) {
      throw new BadRequestException('Короб не привязан к филиалу. Сначала исправьте размещение короба.');
    }
    if (row.warehouseId && row.warehouseId !== currentBox.warehouseId) {
      throw new BadRequestException('Филиал строки проверки не совпадает с филиалом короба.');
    }
    if (scopedWarehouseId && currentBox.warehouseId !== scopedWarehouseId) {
      throw new NotFoundException('Короб не найден в активном филиале.');
    }
    const warehouseId = currentBox.warehouseId;

    if (action === WarehouseBoxCheckDecision.KEEP_AS_IS) {
      const currentQuantity = await this.currentAvailableQuantity(
        row.clientId,
        row.boxId,
        row.skuId,
        warehouseId,
      );
      await this.prisma.warehouseBoxCheckRow.update({
        where: { id: row.id },
        data: {
          decision: action,
          warehouseId,
          beforeQuantity: currentQuantity,
          afterQuantity: currentQuantity,
          decisionComment: comment,
          decidedByUserId: user.id,
          decidedByName: user.name,
          decidedAt: new Date(),
        },
      });
      return this.getCheck(row.checkId, user);
    }

    const targetQuantity =
      action === WarehouseBoxCheckDecision.WRITE_OFF
        ? 0
        : parseNonNegativeInteger(input.quantity);
    await this.inventoryLock.assertStockMovementsAllowed();

    await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.warehouseBoxCheckRow.findUnique({ where: { id: row.id } });
        if (!fresh || fresh.decision !== WarehouseBoxCheckDecision.PENDING) {
          throw new BadRequestException('По этой строке решение уже принято.');
        }
        if (fresh.warehouseId && fresh.warehouseId !== warehouseId) {
          throw new BadRequestException(
            'Филиал строки проверки был изменён. Обновите проверку.',
          );
        }
        const box = await tx.box.findUnique({
          where: { id: row.boxId! },
          select: { id: true, code: true, palletId: true, warehouseId: true },
        });
        if (!box) throw new NotFoundException('Короб больше не найден в WMS.');
        if (box.warehouseId !== warehouseId) {
          throw new BadRequestException(
            'Короб был перемещён в другой филиал. Обновите проверку.',
          );
        }
        const balances = await tx.stockBalance.findMany({
          where: {
            clientId: row.clientId,
            warehouseId,
            boxId: row.boxId!,
            skuId: row.skuId!,
            status: StockStatus.AVAILABLE,
          },
          orderBy: { updatedAt: 'asc' },
        });
        const beforeQuantity = balances.reduce((sum, balance) => sum + balance.quantity, 0);
        const delta = targetQuantity - beforeQuantity;

        if (delta < 0) {
          let remaining = Math.abs(delta);
          for (const balance of balances) {
            if (remaining <= 0) break;
            const removed = Math.min(remaining, balance.quantity);
            const nextQuantity = balance.quantity - removed;
            if (nextQuantity === 0) {
              await tx.stockBalance.delete({ where: { id: balance.id } });
            } else {
              await tx.stockBalance.update({
                where: { id: balance.id },
                data: { quantity: nextQuantity },
              });
            }
            remaining -= removed;
          }
        } else if (delta > 0) {
          const firstBalance = balances[0];
          if (firstBalance) {
            await tx.stockBalance.update({
              where: { id: firstBalance.id },
              data: { quantity: { increment: delta } },
            });
          } else {
            await tx.stockBalance.create({
              data: {
                balanceKey: this.balances.balanceKey({
                  clientId: row.clientId,
                  skuId: row.skuId!,
                  warehouseId,
                  boxId: box.id,
                  palletId: box.palletId,
                  status: StockStatus.AVAILABLE,
                }),
                clientId: row.clientId,
                skuId: row.skuId!,
                warehouseId,
                boxId: box.id,
                palletId: box.palletId,
                status: StockStatus.AVAILABLE,
                quantity: delta,
              },
            });
          }
        }

        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              clientId: row.clientId,
              skuId: row.skuId!,
              warehouseId,
              boxId: box.id,
              palletId: box.palletId,
              type: MovementType.INVENTORY_ADJUSTMENT,
              status: StockStatus.AVAILABLE,
              quantity: delta,
              sourceDocument: `Проверка фантомных коробов ${row.checkId}`,
              idempotencyKey: `warehouse-box-check:${row.id}`,
              comment:
                comment ??
                `${action === WarehouseBoxCheckDecision.WRITE_OFF ? 'Списание' : 'Изменение количества'} по проверке коробов; ${beforeQuantity} → ${targetQuantity}.`,
            },
          });
        }

        const marks = await tx.productMark.findMany({
          where: {
            clientId: row.clientId,
            boxId: box.id,
            skuId: row.skuId!,
            status: StockStatus.AVAILABLE,
          },
          select: { id: true },
          orderBy: { updatedAt: 'desc' },
        });
        const excessMarks = Math.max(0, marks.length - targetQuantity);
        if (excessMarks > 0) {
          await tx.productMark.updateMany({
            where: { id: { in: marks.slice(0, excessMarks).map((mark) => mark.id) } },
            data: {
              status: StockStatus.BLOCKED,
              boxId: null,
              sourceDocument: `Снято с доступного остатка проверкой коробов ${row.checkId}`,
            },
          });
        }

        const positiveBalances = await tx.stockBalance.count({
          where: { warehouseId, boxId: box.id, quantity: { gt: 0 } },
        });
        if (positiveBalances === 0) {
          await tx.box.update({
            where: { id: box.id },
            data: { status: 'archived', palletId: null, zoneId: null },
          });
          // FIX: the canonical rule performs the guarded, audited detach.
          await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
            { boxId: box.id, userId: user.id, reason: 'warehouse-box-integrity' },
            tx,
          );
        }

        await tx.warehouseBoxCheckRow.update({
          where: { id: row.id },
          data: {
            warehouseId,
            decision: action,
            decidedQuantity: targetQuantity,
            beforeQuantity,
            afterQuantity: targetQuantity,
            decisionComment: comment,
            decidedByUserId: user.id,
            decidedByName: user.name,
            decidedAt: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getCheck(row.checkId, user);
  }

  private async currentAvailableQuantity(
    clientId: string,
    boxId: string,
    skuId: string,
    warehouseId: string,
  ) {
    const result = await this.prisma.stockBalance.aggregate({
      where: { clientId, warehouseId, boxId, skuId, status: StockStatus.AVAILABLE },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }
}

function resolveScopedWarehouseId(user: AuthUser, access: 'read' | 'write') {
  if (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.includes('CLIENT') ||
    (!user.roleCodes.includes('BRANCH_MANAGER') && (user.warehouseIds?.length ?? 0) === 0)
  ) {
    return null;
  }
  const warehouseId = user.activeWarehouseId?.trim() || null;
  const allowedWarehouseIds = access === 'write' ? user.writableWarehouseIds : user.warehouseIds;
  if (!warehouseId || !(allowedWarehouseIds ?? []).includes(warehouseId)) {
    throw new ForbiddenException(
      access === 'write'
        ? 'Выберите доступный для изменения активный филиал.'
        : 'Выберите доступный активный филиал.',
    );
  }
  return warehouseId;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePeriodDate(value: unknown, label: string) {
  const normalized = cleanText(value);
  if (!normalized) throw new BadRequestException(`Укажите дату ${label} периода.`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Некорректная дата ${label} периода.`);
  }
  return parsed;
}

function endOfDay(value: Date) {
  const result = new Date(value);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function parseNonNegativeInteger(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException('Новое количество должно быть целым числом от 0.');
  }
  return parsed;
}

function boxSkuKey(boxId: string, skuId: string) {
  return `${boxId}:${skuId}`;
}
