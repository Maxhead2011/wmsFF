import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, StockStatus } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

const CONTROLLED_STATUSES = [StockStatus.PACKING, StockStatus.SHIPPING] as const;

type ShippedMarkEvidence = {
  markId: string;
  maskedKiz: string;
  requestId: string;
  requestNumber: number;
  orderId: string | null;
  shippedAt: string;
};

type ClosedRequestEvidence = {
  requestId: string;
  requestNumber: number;
  movementId: string;
  quantity: number;
  createdAt: string;
};

export type PhantomStockFinding = {
  balanceId: string;
  balanceUpdatedAt: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  boxId: string;
  boxCode: string;
  skuId: string;
  internalSku: string;
  skuName: string;
  barcode: string | null;
  status: 'PACKING' | 'SHIPPING';
  currentQuantity: number;
  suspectQuantity: number;
  reasonCode: 'SHIPPED_KIZ_IN_BALANCE' | 'CLOSED_REQUEST_RESERVE';
  reason: string;
  shippedMarks: ShippedMarkEvidence[];
  closedRequests: ClosedRequestEvidence[];
};

@Injectable()
export class PhantomStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryLock: InventoryLockService,
    private readonly audit: AuditLogService,
  ) {}

  async overview() {
    const checkedAt = new Date();
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        boxId: { not: null },
        status: { in: [...CONTROLLED_STATUSES] },
        box: { status: { notIn: ['deleted', 'archived'] } },
      },
      select: {
        id: true,
        clientId: true,
        skuId: true,
        boxId: true,
        status: true,
        quantity: true,
        updatedAt: true,
        box: {
          select: {
            code: true,
            client: { select: { code: true, name: true } },
          },
        },
        sku: {
          select: {
            internalSku: true,
            name: true,
            barcodes: {
              select: { value: true, isPrimary: true },
              orderBy: [{ isPrimary: 'desc' }],
              take: 1,
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'asc' }],
    });

    const boxIds = unique(balances.map((row) => row.boxId).filter(isString));
    const skuIds = unique(balances.map((row) => row.skuId));
    const [marks, reserveMovements] =
      boxIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.productMark.findMany({
              where: {
                boxId: { in: boxIds },
                skuId: { in: skuIds },
                status: { in: [...CONTROLLED_STATUSES] },
              },
              select: { id: true, boxId: true, skuId: true, status: true, value: true },
            }),
            this.prisma.stockMovement.findMany({
              where: {
                boxId: { in: boxIds },
                skuId: { in: skuIds },
                status: { in: [...CONTROLLED_STATUSES] },
                quantity: { gt: 0 },
                sourceDocument: { not: null },
                OR: [
                  { idempotencyKey: { contains: ':fbs-reconciled:' } },
                  { idempotencyKey: { contains: ':fbs-reserved:' } },
                ],
              },
              select: {
                id: true,
                boxId: true,
                skuId: true,
                status: true,
                quantity: true,
                sourceDocument: true,
                createdAt: true,
                idempotencyKey: true,
              },
            }),
          ]);

    const markValues = unique(marks.map((mark) => mark.value));
    const requestIds = unique(reserveMovements.map((row) => row.sourceDocument).filter(isString));
    const [histories, doneRequests] = await Promise.all([
      markValues.length
        ? this.prisma.shippedKizHistory.findMany({
            where: { kiz: { in: markValues } },
            select: {
              kiz: true,
              requestId: true,
              requestNumber: true,
              orderId: true,
              shippedAt: true,
            },
          })
        : Promise.resolve([]),
      requestIds.length
        ? this.prisma.clientRequest.findMany({
            where: { id: { in: requestIds }, status: 'DONE' },
            select: { id: true, number: true },
          })
        : Promise.resolve([]),
    ]);

    const historyByKiz = new Map(histories.map((row) => [row.kiz, row]));
    const doneRequestById = new Map(doneRequests.map((row) => [row.id, row]));
    const findings: PhantomStockFinding[] = [];

    for (const balance of balances) {
      if (!balance.boxId || !balance.box) continue;
      const shippedMarks = marks
        .filter(
          (mark) =>
            mark.boxId === balance.boxId &&
            mark.skuId === balance.skuId &&
            mark.status === balance.status &&
            historyByKiz.has(mark.value),
        )
        .map((mark) => {
          const history = historyByKiz.get(mark.value)!;
          return {
            markId: mark.id,
            maskedKiz: maskKiz(mark.value),
            requestId: history.requestId,
            requestNumber: history.requestNumber,
            orderId: history.orderId,
            shippedAt: history.shippedAt.toISOString(),
          };
        });

      const closedRequests = reserveMovements
        .filter((movement) => {
          if (
            movement.boxId !== balance.boxId ||
            movement.skuId !== balance.skuId ||
            movement.status !== balance.status ||
            !movement.sourceDocument ||
            !doneRequestById.has(movement.sourceDocument)
          ) {
            return false;
          }
          // A balance whose timestamp still matches the restoring movement was never
          // consumed or changed afterwards. This is the exact stale-reserve pattern.
          return Math.abs(balance.updatedAt.getTime() - movement.createdAt.getTime()) <= 15_000;
        })
        .map((movement) => ({
          requestId: movement.sourceDocument!,
          requestNumber: doneRequestById.get(movement.sourceDocument!)!.number,
          movementId: movement.id,
          quantity: movement.quantity,
          createdAt: movement.createdAt.toISOString(),
        }));

      const shippedQuantity = shippedMarks.length;
      const closedRequestQuantity = closedRequests.reduce((sum, row) => sum + row.quantity, 0);
      const suspectQuantity = Math.min(
        balance.quantity,
        Math.max(shippedQuantity, closedRequestQuantity),
      );
      if (suspectQuantity <= 0) continue;

      const hasShippedKiz = shippedQuantity > 0;
      findings.push({
        balanceId: balance.id,
        balanceUpdatedAt: balance.updatedAt.toISOString(),
        clientId: balance.clientId,
        clientCode: balance.box.client.code,
        clientName: balance.box.client.name,
        boxId: balance.boxId,
        boxCode: balance.box.code,
        skuId: balance.skuId,
        internalSku: balance.sku.internalSku,
        skuName: balance.sku.name,
        barcode: balance.sku.barcodes[0]?.value ?? null,
        status: balance.status as 'PACKING' | 'SHIPPING',
        currentQuantity: balance.quantity,
        suspectQuantity,
        reasonCode: hasShippedKiz ? 'SHIPPED_KIZ_IN_BALANCE' : 'CLOSED_REQUEST_RESERVE',
        reason: hasShippedKiz
          ? 'КИЗ уже записан в историю отгрузки, но единица всё ещё числится в коробе.'
          : 'Резерв восстановлен по уже закрытой заявке и после этого не был списан.',
        shippedMarks,
        closedRequests,
      });
    }

    findings.sort(
      (left, right) =>
        right.suspectQuantity - left.suspectQuantity ||
        left.boxCode.localeCompare(right.boxCode, 'ru-RU'),
    );
    return {
      checkedAt: checkedAt.toISOString(),
      health: findings.length > 0 ? ('DANGER' as const) : ('OK' as const),
      summary: {
        balancesChecked: balances.length,
        findings: findings.length,
        suspectUnits: findings.reduce((sum, row) => sum + row.suspectQuantity, 0),
        boxes: unique(findings.map((row) => row.boxId)).length,
        clients: unique(findings.map((row) => row.clientId)).length,
      },
      rows: findings,
    };
  }

  async fix(balanceId: string, user: AuthUser) {
    this.assertMutationAllowed(user);
    await this.inventoryLock.assertStockMovementsAllowed();
    const snapshot = await this.overview();
    const finding = snapshot.rows.find((row) => row.balanceId === balanceId);
    if (!finding) {
      throw new NotFoundException('Фантомный остаток уже исправлен или доказательства больше не подтверждаются.');
    }
    const result = await this.applyFinding(finding, user);
    await this.audit.write({
      userId: user.id,
      action: 'administration.phantom-stock.fix',
      entity: 'StockBalance',
      entityId: finding.balanceId,
      payload: result,
    });
    return { ...result, overview: await this.overview() };
  }

  async fixAll(user: AuthUser) {
    this.assertMutationAllowed(user);
    await this.inventoryLock.assertStockMovementsAllowed();
    const snapshot = await this.overview();
    const results = [];
    for (const finding of snapshot.rows) {
      results.push(await this.applyFinding(finding, user));
    }
    await this.audit.write({
      userId: user.id,
      action: 'administration.phantom-stock.fix-all',
      entity: 'StockBalance',
      payload: {
        findings: results.length,
        removedUnits: results.reduce((sum, row) => sum + row.removedQuantity, 0),
        balanceIds: results.map((row) => row.balanceId),
      },
    });
    return {
      fixed: results.length,
      removedUnits: results.reduce((sum, row) => sum + row.removedQuantity, 0),
      rows: results,
      overview: await this.overview(),
    };
  }

  private assertMutationAllowed(user: AuthUser) {
    if (user.isDemo) {
      throw new ForbiddenException('Исправление фантомных остатков недоступно в демо-режиме');
    }
  }

  private async applyFinding(finding: PhantomStockFinding, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.findUnique({ where: { id: finding.balanceId } });
      if (!balance || balance.quantity <= 0 || balance.updatedAt.toISOString() !== finding.balanceUpdatedAt) {
        throw new BadRequestException(
          `Остаток в коробе ${finding.boxCode} изменился после проверки. Обновите список и повторите.`,
        );
      }
      const removedQuantity = Math.min(balance.quantity, finding.suspectQuantity);
      if (removedQuantity <= 0) throw new BadRequestException('Фантомный остаток уже отсутствует.');

      if (removedQuantity === balance.quantity) {
        await tx.stockBalance.delete({ where: { id: balance.id } });
      } else {
        await tx.stockBalance.update({
          where: { id: balance.id },
          data: { quantity: { decrement: removedQuantity } },
        });
      }

      const movement = await tx.stockMovement.create({
        data: {
          clientId: balance.clientId,
          skuId: balance.skuId,
          boxId: balance.boxId,
          palletId: balance.palletId,
          type: MovementType.INVENTORY_ADJUSTMENT,
          status: balance.status,
          quantity: -removedQuantity,
          sourceDocument: 'Контроль фантомных остатков',
          idempotencyKey: `admin-phantom-stock:${balance.id}:${balance.updatedAt.getTime()}`,
          comment: `Администратор ${user.name} удалил ${removedQuantity} фантомн. ед. из короба ${finding.boxCode}: ${finding.reason}`,
        },
      });

      const shippedMarkIds = finding.shippedMarks
        .slice(0, removedQuantity)
        .map((mark) => mark.markId);
      if (shippedMarkIds.length > 0) {
        await tx.productMark.updateMany({
          where: { id: { in: shippedMarkIds } },
          data: {
            status: StockStatus.BLOCKED,
            boxId: null,
            sourceDocument: 'Снят с остатка автоматическим контролем: КИЗ уже отгружен',
          },
        });
      }

      const requestIds = unique([
        ...finding.shippedMarks.map((mark) => mark.requestId),
        ...finding.closedRequests.map((request) => request.requestId),
      ]);
      if (requestIds.length > 0 && balance.boxId) {
        await tx.fbsTsdAssembly.updateMany({
          where: {
            requestId: { in: requestIds },
            boxId: balance.boxId,
            skuId: balance.skuId,
            status: 'IN_PROGRESS',
          },
          data: {
            status: 'RELEASED',
            errorMessage: 'Зависшее задание освобождено контролем фантомных остатков.',
          },
        });
      }

      return {
        balanceId: balance.id,
        movementId: movement.id,
        boxCode: finding.boxCode,
        internalSku: finding.internalSku,
        status: balance.status,
        beforeQuantity: balance.quantity,
        removedQuantity,
        afterQuantity: balance.quantity - removedQuantity,
        blockedShippedMarks: shippedMarkIds.length,
      };
    });
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0;
}

function maskKiz(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
