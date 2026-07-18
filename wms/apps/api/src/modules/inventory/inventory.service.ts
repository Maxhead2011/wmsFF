import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryBoxStatus,
  InventoryLineDecision,
  InventorySessionStatus,
  InventorySessionType,
  Prisma,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import {
  CountInventoryItemDto,
  InventoryDecisionDto,
  InventoryResolutionAction,
  SetInventoryCountDto,
  StartInventoryDto,
} from './dto/inventory.dto';

const sessionInclude = {
  boxes: {
    include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    orderBy: { startedAt: 'desc' },
  },
} satisfies Prisma.InventorySessionInclude;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly balances: StockBalancesService,
  ) {}

  async dashboard(user: AuthUser) {
    const globalAccess = hasGlobalInventoryAccess(user);
    const [activeFull, activeSessions, reviewSessions, historySessions] = await Promise.all([
      this.prisma.inventorySession.findFirst({
        where: {
          type: InventorySessionType.FULL,
          status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
        },
        include: sessionInclude,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.inventorySession.findMany({
        where: { status: InventorySessionStatus.ACTIVE },
        include: sessionInclude,
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
      this.prisma.inventorySession.findMany({
        where: {
          type: { in: [InventorySessionType.FULL, InventorySessionType.PARTIAL, InventorySessionType.BOX_CHECK] },
          status: InventorySessionStatus.REVIEW,
        },
        include: sessionInclude,
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      this.prisma.inventorySession.findMany({
        where: {},
        include: sessionInclude,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);

    const totalBoxes = activeFull
      ? await this.prisma.box.count({ where: { status: { notIn: ['deleted', 'archived'] } } })
      : 0;
    return {
      movementLock: activeFull
        ? {
            active: true,
            sessionId: activeFull.id,
            title: activeFull.title,
            startedAt: activeFull.startedAt,
            createdByName: activeFull.createdByName,
          }
        : { active: false },
      activeFull: activeFull && globalAccess ? this.decorateSession(activeFull, totalBoxes) : null,
      activeSessions: activeSessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session)),
      reviewSessions: reviewSessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session)),
      historySessions: historySessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session)),
      canManage: canManageInventory(user),
    };
  }

  async listSessions(type: string | undefined, user: AuthUser) {
    const parsedType = Object.values(InventorySessionType).includes(type as InventorySessionType)
      ? (type as InventorySessionType)
      : undefined;
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    return this.prisma.inventorySession.findMany({
      where: {
        type: parsedType,
        ...(clientFilter ? { clientId: clientFilter } : {}),
      },
      include: sessionInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getSession(id: string, user: AuthUser) {
    const session = await this.prisma.inventorySession.findUnique({ where: { id }, include: sessionInclude });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    if (session.clientId) {
      this.clientScopes.requireClientAccess(user, session.clientId, 'read');
    } else {
      this.clientScopes.requireGlobalClientAccess(user);
    }
    const totalBoxes =
      session.type === InventorySessionType.FULL
        ? await this.prisma.box.count({ where: { status: { notIn: ['deleted', 'archived'] } } })
        : undefined;
    return this.decorateSession(session, totalBoxes);
  }

  async startSession(dto: StartInventoryDto, user: AuthUser) {
    if (dto.type === InventorySessionType.FULL) {
      this.requireManager(user);
      this.clientScopes.requireGlobalClientAccess(user);
      const existing = await this.prisma.inventorySession.findFirst({
        where: {
          type: InventorySessionType.FULL,
          status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
        },
      });
      if (existing) {
        throw new BadRequestException('Полная инвентаризация уже выполняется. Сначала завершите или отмените её.');
      }
    } else {
      if (!dto.clientId) {
        throw new BadRequestException('Для частичной инвентаризации и проверки короба выберите клиента.');
      }
      this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    }

    const defaultTitle =
      dto.type === InventorySessionType.FULL
        ? `Полная инвентаризация ${new Date().toLocaleDateString('ru-RU')}`
        : dto.type === InventorySessionType.PARTIAL
          ? `Частичная инвентаризация ${new Date().toLocaleDateString('ru-RU')}`
          : `Проверка коробов ${new Date().toLocaleDateString('ru-RU')}`;
    return this.prisma.inventorySession.create({
      data: {
        type: dto.type,
        clientId: dto.type === InventorySessionType.FULL ? null : dto.clientId,
        title: dto.title?.trim() || defaultTitle,
        comment: dto.comment?.trim() || null,
        createdByUserId: user.id,
        createdByName: user.name,
      },
      include: sessionInclude,
    });
  }

  async openBox(sessionId: string, rawBoxCode: string, user: AuthUser) {
    const boxCode = rawBoxCode.trim();
    if (!boxCode) {
      throw new BadRequestException('Укажите номер короба.');
    }
    const session = await this.requireActiveSession(sessionId);
    const box = await this.prisma.box.findUnique({
      where: { code: boxCode },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!box || ['deleted', 'archived'].includes(box.status)) {
      throw new NotFoundException(`Короб ${boxCode} не найден.`);
    }
    if (session.clientId && session.clientId !== box.clientId) {
      throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
    }
    this.clientScopes.requireClientAccess(user, box.clientId, 'write');

    const existing = await this.prisma.inventoryAuditBox.findUnique({
      where: { sessionId_boxId: { sessionId, boxId: box.id } },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
    if (existing) {
      if (existing.status !== InventoryBoxStatus.COUNTING) {
        throw new BadRequestException(
          `Короб ${boxCode} уже проверен. Повторная проверка запрещена.`,
        );
      }
      return existing;
    }
    const previousCheck = await this.prisma.inventoryAuditBox.findFirst({
      where: { boxId: box.id },
      select: { id: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (previousCheck) {
      throw new BadRequestException(
        previousCheck.status === InventoryBoxStatus.COUNTING
          ? `Короб ${boxCode} уже находится на проверке. Повторно открыть его нельзя.`
          : `Короб ${boxCode} уже проверен. Повторная проверка запрещена.`,
      );
    }

    const stock = await this.prisma.stockBalance.findMany({
      where: { boxId: box.id, status: StockStatus.AVAILABLE, quantity: { gt: 0 } },
      include: { sku: { include: { barcodes: true } } },
    });
    const expected = new Map<string, (typeof stock)[number] & { total: number }>();
    for (const balance of stock) {
      const current = expected.get(balance.skuId);
      if (current) {
        current.total += balance.quantity;
      } else {
        expected.set(balance.skuId, { ...balance, total: balance.quantity });
      }
    }

    return this.prisma.inventoryAuditBox.create({
      data: {
        sessionId,
        boxId: box.id,
        boxCode: box.code,
        clientId: box.clientId,
        clientName: box.client.name,
        countedByUserId: user.id,
        countedByName: user.name,
        lines: {
          create: [...expected.values()].map((item) => ({
            skuId: item.skuId,
            skuName: item.sku.name,
            internalSku: item.sku.internalSku,
            barcode: item.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? item.sku.barcodes[0]?.value ?? null,
            expectedQuantity: item.total,
          })),
        },
      },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  async scanItem(auditBoxId: string, dto: CountInventoryItemDto, user: AuthUser) {
    const auditBox = await this.requireCountingBox(auditBoxId);
    this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');
    const value = dto.barcode.trim();
    const sku = await this.prisma.sku.findFirst({
      where: {
        clientId: auditBox.clientId,
        barcodes: { some: { value } },
      },
      include: { barcodes: true },
    });
    if (!sku) {
      throw new NotFoundException(
        `ШК товара ${value} не найден у клиента ${auditBox.clientName}. При инвентаризации сканируйте только ШК товара, не КИЗ и не внутренний SKU.`,
      );
    }
    const quantity = dto.quantity ?? 1;
    const existing = await this.prisma.inventoryAuditLine.findUnique({
      where: { auditBoxId_skuId: { auditBoxId, skuId: sku.id } },
    });
    if (existing) {
      return this.prisma.inventoryAuditLine.update({
        where: { id: existing.id },
        data: {
          countedQuantity: { increment: quantity },
          difference: existing.countedQuantity + quantity - existing.expectedQuantity,
        },
      });
    }
    return this.prisma.inventoryAuditLine.create({
      data: {
        auditBoxId,
        skuId: sku.id,
        skuName: sku.name,
        internalSku: sku.internalSku,
        barcode: sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? value,
        expectedQuantity: 0,
        countedQuantity: quantity,
        difference: quantity,
      },
    });
  }

  async setCount(auditBoxId: string, dto: SetInventoryCountDto, user: AuthUser) {
    const auditBox = await this.requireCountingBox(auditBoxId);
    this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');
    const line = await this.prisma.inventoryAuditLine.findFirst({ where: { id: dto.lineId, auditBoxId } });
    if (!line) {
      throw new NotFoundException('Позиция инвентаризации не найдена.');
    }
    return this.prisma.inventoryAuditLine.update({
      where: { id: line.id },
      data: {
        countedQuantity: dto.countedQuantity,
        difference: dto.countedQuantity - line.expectedQuantity,
      },
    });
  }

  async finishBox(auditBoxId: string, user: AuthUser) {
    const auditBox = await this.requireCountingBox(auditBoxId);
    this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');
    const lines = await this.prisma.inventoryAuditLine.findMany({ where: { auditBoxId } });
    const mismatch = lines.some((line) => line.countedQuantity !== line.expectedQuantity);
    await this.prisma.$transaction([
      ...lines.map((line) =>
        this.prisma.inventoryAuditLine.update({
          where: { id: line.id },
          data: {
            difference: line.countedQuantity - line.expectedQuantity,
            decision:
              line.countedQuantity === line.expectedQuantity ? InventoryLineDecision.KEEP_SYSTEM : InventoryLineDecision.PENDING,
          },
        }),
      ),
      this.prisma.inventoryAuditBox.update({
        where: { id: auditBoxId },
        data: {
          status: mismatch ? InventoryBoxStatus.MISMATCH : InventoryBoxStatus.MATCHED,
          completedAt: new Date(),
          countedByUserId: user.id,
          countedByName: user.name,
        },
      }),
    ]);
    return this.prisma.inventoryAuditBox.findUnique({
      where: { id: auditBoxId },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  async sendToReview(id: string, user: AuthUser) {
    const session = await this.requireActiveSession(id);
    const counting = await this.prisma.inventoryAuditBox.count({ where: { sessionId: id, status: InventoryBoxStatus.COUNTING } });
    if (counting > 0) {
      throw new BadRequestException('Сначала завершите подсчёт во всех открытых коробах.');
    }
    if (session.type === InventorySessionType.BOX_CHECK) {
      const unresolved = await this.prisma.inventoryAuditLine.count({
        where: { auditBox: { sessionId: id }, difference: { not: 0 }, decision: InventoryLineDecision.PENDING },
      });
      return this.prisma.inventorySession.update({
        where: { id },
        data: {
          status: unresolved > 0 ? InventorySessionStatus.REVIEW : InventorySessionStatus.COMPLETED,
          completedAt: unresolved > 0 ? null : new Date(),
          completedByUserId: unresolved > 0 ? null : user.id,
          completedByName: unresolved > 0 ? null : user.name,
        },
        include: sessionInclude,
      });
    }
    if (session.type === InventorySessionType.FULL) {
      const [totalBoxes, checkedBoxes] = await Promise.all([
        this.prisma.box.count({ where: { status: { notIn: ['deleted', 'archived'] } } }),
        this.prisma.inventoryAuditBox.count({
          where: { sessionId: id, status: { not: InventoryBoxStatus.COUNTING } },
        }),
      ]);
      if (checkedBoxes < totalBoxes) {
        throw new BadRequestException(
          `Полная инвентаризация ещё не завершена: проверено ${checkedBoxes} из ${totalBoxes} коробов.`,
        );
      }
    }
    return this.prisma.inventorySession.update({
      where: { id },
      data: { status: InventorySessionStatus.REVIEW },
      include: sessionInclude,
    });
  }

  async decideLine(lineId: string, dto: InventoryDecisionDto, user: AuthUser) {
    this.requireManager(user);
    const action =
      dto.action ??
      (dto.decision === InventoryLineDecision.APPLY_ACTUAL
        ? InventoryResolutionAction.APPLY_ACTUAL
        : dto.decision === InventoryLineDecision.KEEP_SYSTEM
          ? InventoryResolutionAction.ACCEPT_AS_IS
          : undefined);
    if (!action) {
      throw new BadRequestException('Выберите действие по расхождению.');
    }
    const line = await this.prisma.inventoryAuditLine.findUnique({
      where: { id: lineId },
      include: { auditBox: { include: { session: true } } },
    });
    if (!line) {
      throw new NotFoundException('Позиция инвентаризации не найдена.');
    }
    const canResolveCompletedBoxCheck =
      line.auditBox.session.type === InventorySessionType.BOX_CHECK &&
      line.auditBox.session.status === InventorySessionStatus.COMPLETED;
    if (
      line.auditBox.session.status !== InventorySessionStatus.ACTIVE &&
      line.auditBox.session.status !== InventorySessionStatus.REVIEW &&
      !canResolveCompletedBoxCheck
    ) {
      throw new BadRequestException('Эта инвентаризация уже закрыта.');
    }
    this.clientScopes.requireClientAccess(user, line.auditBox.clientId, 'write');

    if (action === InventoryResolutionAction.LEAVE_FOR_LATER) {
      await this.prisma.inventoryAuditLine.update({
        where: { id: line.id },
        data: {
          decision: InventoryLineDecision.PENDING,
          decisionComment: resolutionComment(action, dto.comment),
          decidedByUserId: null,
          decidedByName: null,
          decidedAt: null,
        },
      });
      return this.prisma.inventoryAuditBox.findUnique({
        where: { id: line.auditBoxId },
        include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
      });
    }

    const shouldAdjustStock =
      action === InventoryResolutionAction.APPLY_ACTUAL ||
      action === InventoryResolutionAction.DELETE_FROM_BOX;
    const targetQuantity =
      action === InventoryResolutionAction.DELETE_FROM_BOX ? 0 : line.countedQuantity;

    if (shouldAdjustStock) {
      const box = await this.prisma.box.findUnique({ where: { id: line.auditBox.boxId } });
      if (!box) {
        throw new NotFoundException('Исходный короб не найден.');
      }
      await this.prisma.$transaction(async (tx) => {
        const balance = await tx.stockBalance.findFirst({
          where: {
            clientId: line.auditBox.clientId,
            skuId: line.skuId,
            boxId: box.id,
            status: StockStatus.AVAILABLE,
          },
        });
        const current = balance?.quantity ?? 0;
        const delta = targetQuantity - current;
        if (balance && targetQuantity === 0) {
          await tx.stockBalance.delete({ where: { id: balance.id } });
        } else if (balance) {
          await tx.stockBalance.update({ where: { id: balance.id }, data: { quantity: targetQuantity } });
        } else if (targetQuantity > 0) {
          await tx.stockBalance.create({
            data: {
              balanceKey: this.balances.balanceKey({
                clientId: line.auditBox.clientId,
                skuId: line.skuId,
                boxId: box.id,
                palletId: box.palletId,
                status: StockStatus.AVAILABLE,
              }),
              clientId: line.auditBox.clientId,
              skuId: line.skuId,
              boxId: box.id,
              palletId: box.palletId,
              status: StockStatus.AVAILABLE,
              quantity: targetQuantity,
            },
          });
        }
        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              clientId: line.auditBox.clientId,
              skuId: line.skuId,
              boxId: box.id,
              palletId: box.palletId,
              type: 'INVENTORY_ADJUSTMENT',
              status: StockStatus.AVAILABLE,
              quantity: delta,
              idempotencyKey: `web-inventory:${line.id}`,
              sourceDocument: line.auditBox.session.title,
              comment:
                dto.comment?.trim() ||
                (action === InventoryResolutionAction.DELETE_FROM_BOX
                  ? `Удаление позиции из короба ${line.auditBox.boxCode} по инвентаризации`
                  : `Актуализация по коробу ${line.auditBox.boxCode}`),
            },
          });
        }
      });
    }

    await this.prisma.inventoryAuditLine.update({
      where: { id: line.id },
      data: {
        decision:
          action === InventoryResolutionAction.ACCEPT_AS_IS
            ? InventoryLineDecision.KEEP_SYSTEM
            : InventoryLineDecision.APPLY_ACTUAL,
        decisionComment: resolutionComment(action, dto.comment),
        decidedByUserId: user.id,
        decidedByName: user.name,
        decidedAt: new Date(),
      },
    });
    await this.refreshBoxResolution(line.auditBoxId, user.name);
    return this.prisma.inventoryAuditBox.findUnique({
      where: { id: line.auditBoxId },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  async completeSession(id: string, comment: string | undefined, user: AuthUser) {
    this.requireManager(user);
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    const unresolved = await this.prisma.inventoryAuditLine.count({
      where: {
        auditBox: { sessionId: id, status: InventoryBoxStatus.MISMATCH },
        decision: InventoryLineDecision.PENDING,
      },
    });
    if (unresolved > 0) {
      throw new BadRequestException(`Остались неразобранные расхождения: ${unresolved}.`);
    }
    return this.prisma.inventorySession.update({
      where: { id },
      data: {
        status: InventorySessionStatus.COMPLETED,
        completedAt: new Date(),
        completedByUserId: user.id,
        completedByName: user.name,
        comment: comment?.trim() || session.comment,
      },
      include: sessionInclude,
    });
  }

  async cancelSession(id: string, comment: string | undefined, user: AuthUser) {
    this.requireManager(user);
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    if (
      session.status === InventorySessionStatus.COMPLETED ||
      session.status === InventorySessionStatus.CANCELLED
    ) {
      throw new BadRequestException('Инвентаризация уже закрыта.');
    }
    return this.prisma.inventorySession.update({
      where: { id },
      data: {
        status: InventorySessionStatus.CANCELLED,
        completedAt: new Date(),
        completedByUserId: user.id,
        completedByName: user.name,
        comment: comment?.trim() || session.comment,
      },
      include: sessionInclude,
    });
  }

  private async requireActiveSession(id: string) {
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    if (session.status !== InventorySessionStatus.ACTIVE) {
      throw new BadRequestException('Добавлять подсчёты можно только в активную инвентаризацию.');
    }
    return session;
  }

  private async requireCountingBox(id: string) {
    const auditBox = await this.prisma.inventoryAuditBox.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!auditBox) {
      throw new NotFoundException('Проверка короба не найдена.');
    }
    if (auditBox.session.status !== InventorySessionStatus.ACTIVE || auditBox.status !== InventoryBoxStatus.COUNTING) {
      throw new BadRequestException('Подсчёт этого короба уже завершён.');
    }
    return auditBox;
  }

  private async refreshBoxResolution(auditBoxId: string, resolvedByName: string) {
    const pending = await this.prisma.inventoryAuditLine.count({
      where: { auditBoxId, difference: { not: 0 }, decision: InventoryLineDecision.PENDING },
    });
    if (pending === 0) {
      await this.prisma.inventoryAuditBox.update({
        where: { id: auditBoxId },
        data: { status: InventoryBoxStatus.RESOLVED, resolvedAt: new Date(), resolvedByName },
      });
    }
  }

  private requireManager(user: AuthUser) {
    if (!canManageInventory(user)) {
      throw new ForbiddenException('Действие доступно менеджеру, администратору или владельцу.');
    }
  }

  private decorateSession<T extends { boxes: Array<{ status: InventoryBoxStatus; lines: Array<{ difference: number; decision: InventoryLineDecision; decisionComment?: string | null }> }> }>(
    session: T,
    totalBoxes?: number,
  ) {
    const mismatchBoxes = session.boxes.filter((box) => box.status === InventoryBoxStatus.MISMATCH).length;
    const unresolvedLines = session.boxes.reduce(
      (sum, box) => sum + box.lines.filter((line) => line.difference !== 0 && line.decision === InventoryLineDecision.PENDING).length,
      0,
    );
    return {
      ...session,
      boxes: session.boxes.map((box) => ({
        ...box,
        lines: box.lines.map((line) => ({
          ...line,
          resolutionAction: resolutionActionFromComment(line.decisionComment, line.decision),
        })),
      })),
      progress: {
        totalBoxes: totalBoxes ?? null,
        checkedBoxes: session.boxes.filter((box) => box.status !== InventoryBoxStatus.COUNTING).length,
        mismatchBoxes,
        unresolvedLines,
      },
    };
  }
}

function resolutionComment(action: InventoryResolutionAction, comment?: string) {
  const text = comment?.trim();
  return `[${action}]${text ? ` ${text}` : ''}`;
}

function resolutionActionFromComment(comment: string | null | undefined, decision: InventoryLineDecision) {
  const match = comment?.match(/^\[(APPLY_ACTUAL|DELETE_FROM_BOX|ACCEPT_AS_IS|LEAVE_FOR_LATER)\]/);
  if (match) {
    return match[1] as InventoryResolutionAction;
  }
  if (decision === InventoryLineDecision.APPLY_ACTUAL) {
    return InventoryResolutionAction.APPLY_ACTUAL;
  }
  if (decision === InventoryLineDecision.KEEP_SYSTEM) {
    return InventoryResolutionAction.ACCEPT_AS_IS;
  }
  return InventoryResolutionAction.LEAVE_FOR_LATER;
}

function canManageInventory(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER'].includes(role))
  );
}

function hasGlobalInventoryAccess(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
}

function canSeeInventorySession(user: AuthUser, clientId: string | null) {
  if (clientId == null) {
    return hasGlobalInventoryAccess(user);
  }
  return hasGlobalInventoryAccess(user) || user.clientIds.includes(clientId);
}
