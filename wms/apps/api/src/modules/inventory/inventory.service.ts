import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryBoxStatus,
  InventoryLineDecision,
  InventorySessionStatus,
  InventorySessionType,
  Prisma,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import {
  CountInventoryItemDto,
  InventoryDecisionDto,
  InventoryResolutionAction,
  ResolveInventoryBoxDto,
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
    private readonly archivedEmptyBoxDetach?: ArchivedEmptyBoxPalletDetachService,
  ) {}

  async dashboard(user: AuthUser, hideResolvedBoxes = false) {
    const globalAccess = hasGlobalInventoryAccess(user);
    const warehouseId = this.resolveScopedWarehouseId(user, 'read');
    const warehouseWhere = warehouseId ? { warehouseId } : {};
    const [activeFull, activeSessions, reviewSessions, historySessions, pendingRescanRequests] = await Promise.all([
      this.prisma.inventorySession.findFirst({
        where: {
          type: InventorySessionType.FULL,
          status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
          ...warehouseWhere,
        },
        include: sessionInclude,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.inventorySession.findMany({
        where: { status: InventorySessionStatus.ACTIVE, ...warehouseWhere },
        include: sessionInclude,
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
      this.prisma.inventorySession.findMany({
        where: {
          type: { in: [InventorySessionType.FULL, InventorySessionType.PARTIAL, InventorySessionType.BOX_CHECK] },
          status: InventorySessionStatus.REVIEW,
          ...warehouseWhere,
        },
        include: sessionInclude,
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      this.prisma.inventorySession.findMany({
        where: { boxes: { some: {} }, ...warehouseWhere },
        include: sessionInclude,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      canApproveInventoryRescan(user)
        ? this.prisma.inventoryBoxRescanRequest.findMany({
            where: { status: 'PENDING', ...warehouseWhere },
            orderBy: { createdAt: 'asc' },
            take: 100,
          })
        : Promise.resolve([]),
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
      activeFull: activeFull && globalAccess ? this.decorateSession(activeFull, totalBoxes, hideResolvedBoxes) : null,
      activeSessions: activeSessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session, undefined, hideResolvedBoxes)),
      reviewSessions: reviewSessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session, undefined, hideResolvedBoxes)),
      historySessions: historySessions
        .filter((session) => canSeeInventorySession(user, session.clientId))
        .map((session) => this.decorateSession(session, undefined, hideResolvedBoxes)),
      pendingRescanRequests: pendingRescanRequests.filter((request) =>
        canSeeInventorySession(user, request.clientId),
      ),
      canApproveRescan: canApproveInventoryRescan(user),
      canManage: canManageInventory(user),
    };
  }

  async listSessions(type: string | undefined, user: AuthUser) {
    const parsedType = Object.values(InventorySessionType).includes(type as InventorySessionType)
      ? (type as InventorySessionType)
      : undefined;
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const warehouseId = this.resolveScopedWarehouseId(user, 'read');
    return this.prisma.inventorySession.findMany({
      where: {
        type: parsedType,
        ...(clientFilter ? { clientId: clientFilter } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: sessionInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getSession(id: string, user: AuthUser, hideResolvedBoxes = false) {
    const session = await this.prisma.inventorySession.findUnique({ where: { id }, include: sessionInclude });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    this.requireSessionWarehouse(user, session.warehouseId, 'read');
    if (session.clientId) {
      this.clientScopes.requireClientAccess(user, session.clientId, 'read');
    } else {
      this.clientScopes.requireGlobalClientAccess(user);
    }
    const totalBoxes =
      session.type === InventorySessionType.FULL
        ? await this.prisma.box.count({ where: { status: { notIn: ['deleted', 'archived'] } } })
        : undefined;
    return this.decorateSession(session, totalBoxes, hideResolvedBoxes);
  }

  async startSession(dto: StartInventoryDto, user: AuthUser) {
    const warehouseId =
      dto.type === InventorySessionType.FULL ? null : this.resolveScopedWarehouseId(user, 'write');
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
    const requestedTitle = dto.title?.trim() || defaultTitle;
    const requestedComment = dto.comment?.trim() || null;
    // ADDED: both FBS-generated checks are real inventory tasks. Keep the
    // mandatory flow's old ACTIVE-only behavior, while a missing-pallet-box
    // signal stays deduplicated until its manager review is resolved.
    const fbsCheckMarker = requestedComment?.includes('[FBS_MANDATORY_BOX_CHECK]')
      ? '[FBS_MANDATORY_BOX_CHECK]'
      : requestedComment?.includes('[FBS_MISSING_PALLET_BOX]')
        ? '[FBS_MISSING_PALLET_BOX]'
        : null;
    if (
      dto.type === InventorySessionType.BOX_CHECK &&
      fbsCheckMarker
    ) {
      const existingFbsCheck = await this.prisma.inventorySession.findFirst({
        where: {
          type: InventorySessionType.BOX_CHECK,
          status: fbsCheckMarker === '[FBS_MISSING_PALLET_BOX]'
            ? { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] }
            : InventorySessionStatus.ACTIVE,
          clientId: dto.clientId,
          title: requestedTitle,
          comment: { contains: fbsCheckMarker },
          ...(warehouseId ? { warehouseId } : {}),
        },
        include: sessionInclude,
        orderBy: { createdAt: 'desc' },
      });
      if (existingFbsCheck) {
        return existingFbsCheck;
      }
    }
    return this.prisma.inventorySession.create({
      data: {
        type: dto.type,
        clientId: dto.type === InventorySessionType.FULL ? null : dto.clientId,
        warehouseId,
        title: requestedTitle,
        comment: requestedComment,
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
    const session = await this.requireActiveSession(sessionId, user, 'write');
    const warehouseId = this.resolveScopedWarehouseId(user, 'write');
    let box = await this.prisma.box.findUnique({
      where: { code: boxCode },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!box) {
      const normalizedBoxCode = normalizeInventoryBoxCode(boxCode);
      const matchingBoxes = normalizedBoxCode
        ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "Box"
            WHERE regexp_replace(upper("code"), '[^A-ZА-ЯЁ0-9]', '', 'g') = ${normalizedBoxCode}
              AND "status" NOT IN ('deleted', 'archived')
              ${session.clientId ? Prisma.sql`AND "clientId" = ${session.clientId}` : Prisma.empty}
              ${warehouseId ? Prisma.sql`AND "warehouseId" = ${warehouseId}` : Prisma.empty}
            LIMIT 2
          `)
        : [];
      if (matchingBoxes.length > 1) {
        throw new BadRequestException(
          `Найдено несколько коробов с номером ${boxCode}. Отсканируйте полный ШК с разделителями.`,
        );
      }
      if (matchingBoxes.length === 1) {
        box = await this.prisma.box.findUnique({
          where: { id: matchingBoxes[0].id },
          include: { client: { select: { id: true, name: true } } },
        });
      }
    }
    if (!box || ['deleted', 'archived'].includes(box.status)) {
      throw new NotFoundException(`Короб ${boxCode} не найден.`);
    }
    this.requirePhysicalBoxWarehouse(user, box.warehouseId, 'write');
    if (session.warehouseId && session.warehouseId !== box.warehouseId) {
      throw new ForbiddenException('Короб относится к другому филиалу инвентаризации.');
    }
    if (session.clientId && session.clientId !== box.clientId) {
      throw new BadRequestException(`Короб ${boxCode} относится к другому клиенту.`);
    }
    this.clientScopes.requireClientAccess(user, box.clientId, 'write');

    const existing = await this.prisma.inventoryAuditBox.findUnique({
      where: { sessionId_boxId: { sessionId, boxId: box.id } },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
    const forcedFbsBoxCheck =
      Boolean(user.deviceCode) &&
      (session.comment?.includes('[FBS_MANDATORY_BOX_CHECK]') ?? false);
    const autoApproveRescan = canApproveInventoryRescan(user) || forcedFbsBoxCheck;
    const rescanRequest = await this.prisma.inventoryBoxRescanRequest.findFirst({
      where: {
        boxId: box.id,
        sessionId,
        status: autoApproveRescan ? { in: ['PENDING', 'APPROVED'] } : 'APPROVED',
        consumedAt: null,
        ...(session.warehouseId ? { warehouseId: session.warehouseId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const rescanAllowed = autoApproveRescan || rescanRequest?.status === 'APPROVED';
    if (existing) {
      if (existing.status === InventoryBoxStatus.COUNTING) {
        return existing;
      }
      // FIX: never delete decisions that already produced inventory movements.
      // A fresh session preserves the old web-inventory audit and idempotency keys.
      const hasAppliedDecisions = existing.lines.some(
        (line) => line.decision !== InventoryLineDecision.PENDING || line.decidedAt != null,
      );
      if (hasAppliedDecisions) {
        throw new ConflictException(
          `Короб ${boxCode} уже содержит применённые решения этой проверки. Для повторной проверки создайте новую сессию инвентаризации.`,
        );
      }
      if (!rescanAllowed) {
        await this.ensureRescanRequest(session, box, user);
        throw new ConflictException(
          `Короб ${boxCode} уже проверен. Запрос на повторную проверку отправлен администратору.`,
        );
      }
    }
    const previousCheck = await this.prisma.inventoryAuditBox.findFirst({
      where: { boxId: box.id },
      select: { id: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (previousCheck && !rescanAllowed) {
      await this.ensureRescanRequest(session, box, user);
      throw new ConflictException(
        previousCheck.status === InventoryBoxStatus.COUNTING
          ? `Короб ${boxCode} уже находится на проверке. Запрос на повторную проверку отправлен администратору.`
          : `Короб ${boxCode} уже проверен. Запрос на повторную проверку отправлен администратору.`,
      );
    }

    const stock = await this.prisma.stockBalance.findMany({
      where: {
        boxId: box.id,
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
        ...(box.warehouseId ? { warehouseId: box.warehouseId } : {}),
      },
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
    const lineData = [...expected.values()].map((item) => ({
      skuId: item.skuId,
      skuName: item.sku.name,
      internalSku: item.sku.internalSku,
      barcode: item.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? item.sku.barcodes[0]?.value ?? null,
      expectedQuantity: item.total,
      difference: -item.total,
    }));

    if (existing && rescanAllowed) {
      return this.prisma.$transaction(async (tx) => {
        await tx.inventoryAuditLine.deleteMany({ where: { auditBoxId: existing.id } });
        const reopened = await tx.inventoryAuditBox.update({
          where: { id: existing.id },
          data: {
            status: InventoryBoxStatus.COUNTING,
            countedByUserId: user.id,
            countedByName: user.name,
            startedAt: new Date(),
            completedAt: null,
            resolvedAt: null,
            resolvedByName: null,
            comment: autoApproveRescan
              ? forcedFbsBoxCheck
                ? `Обязательная повторная проверка после FBS автоматически открыта для ${user.name}`
                : `Повторная проверка автоматически разрешена администратору ${user.name}`
              : `Повторная проверка разрешена администратором ${rescanRequest?.approvedByName ?? ''}`.trim(),
            lines: { create: lineData },
          },
          include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
        });
        if (rescanRequest) {
          await tx.inventoryBoxRescanRequest.update({
            where: { id: rescanRequest.id },
            data: {
              status: 'CONSUMED',
              approvedByUserId: rescanRequest.approvedByUserId ?? user.id,
              approvedByName: rescanRequest.approvedByName ?? user.name,
              approvedAt: rescanRequest.approvedAt ?? new Date(),
              consumedAt: new Date(),
            },
          });
        }
        return reopened;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryAuditBox.create({
        data: {
          sessionId,
          boxId: box.id,
          boxCode: box.code,
          clientId: box.clientId,
          clientName: box.client.name,
          countedByUserId: user.id,
          countedByName: user.name,
          lines: { create: lineData },
        },
        include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
      });
      if (rescanRequest) {
        await tx.inventoryBoxRescanRequest.update({
          where: { id: rescanRequest.id },
          data: {
            status: 'CONSUMED',
            approvedByUserId: rescanRequest.approvedByUserId ?? user.id,
            approvedByName: rescanRequest.approvedByName ?? user.name,
            approvedAt: rescanRequest.approvedAt ?? new Date(),
            consumedAt: new Date(),
          },
        });
      }
      return created;
    });
  }

  async approveRescanRequest(id: string, user: AuthUser) {
    if (!canApproveInventoryRescan(user)) {
      throw new ForbiddenException('Повторную проверку короба может разрешить только администратор или владелец.');
    }
    const request = await this.prisma.inventoryBoxRescanRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Запрос на повторную проверку не найден.');
    }
    this.requireSessionWarehouse(user, request.warehouseId, 'write');
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Этот запрос уже обработан.');
    }
    return this.prisma.inventoryBoxRescanRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedByUserId: user.id,
        approvedByName: user.name,
        approvedAt: new Date(),
      },
    });
  }

  async scanItem(auditBoxId: string, dto: CountInventoryItemDto, user: AuthUser) {
    const auditBox = await this.requireCountingBox(auditBoxId, user);
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
    if (dto.requireKiz && sku.needsChestnyZnak && !sku.isUnmarked) {
      const kiz = dto.kiz?.trim();
      if (!kiz) {
        throw new ConflictException(
          'Для этого маркированного товара обязательно отсканируйте КИЗ после ШК.',
        );
      }
      const mark = await this.prisma.productMark.findFirst({
        where: {
          clientId: auditBox.clientId,
          skuId: sku.id,
          boxId: auditBox.boxId,
          value: kiz,
          status: StockStatus.AVAILABLE,
        },
        select: { id: true },
      });
      if (!mark) {
        throw new BadRequestException(
          `КИЗ не зарегистрирован за товаром ${sku.internalSku} в коробе ${auditBox.boxCode}. Проверьте физический товар и повторите сканирование.`,
        );
      }
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
    const auditBox = await this.requireCountingBox(auditBoxId, user);
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
    const auditBox = await this.requireCountingBox(auditBoxId, user);
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
      ...(!mismatch
        ? [
            // FIX: keep MATCHED and receiving -> active atomic, while isolating
            // the physical stock by client and, when present, warehouse.
            this.prisma.box.updateMany({
              where: {
                id: auditBox.boxId,
                clientId: auditBox.clientId,
                status: 'receiving',
                ...(auditBox.session.warehouseId
                  ? { warehouseId: auditBox.session.warehouseId }
                  : {}),
                balances: {
                  some: {
                    clientId: auditBox.clientId,
                    status: StockStatus.AVAILABLE,
                    quantity: { gt: 0 },
                    ...(auditBox.session.warehouseId
                      ? { warehouseId: auditBox.session.warehouseId }
                      : {}),
                  },
                },
              },
              data: { status: 'active' },
            }),
          ]
        : []),
    ]);
    if (!mismatch) {
      await this.completeMandatoryFbsSessionIfReady(auditBox.sessionId, user);
    }
    return this.prisma.inventoryAuditBox.findUnique({
      where: { id: auditBoxId },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  async sendToReview(id: string, user: AuthUser) {
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    this.requireSessionWarehouse(user, session.warehouseId, 'write');
    if (isMandatoryFbsBoxCheck(session)) {
      const completed = await this.completeMandatoryFbsSessionIfReady(id, user);
      if (completed) {
        return this.prisma.inventorySession.findUnique({ where: { id }, include: sessionInclude });
      }
    }
    if (session.status !== InventorySessionStatus.ACTIVE) {
      throw new BadRequestException('Добавлять подсчёты можно только в активную инвентаризацию.');
    }
    const [counting, auditedBoxes] = await Promise.all([
      this.prisma.inventoryAuditBox.count({ where: { sessionId: id, status: InventoryBoxStatus.COUNTING } }),
      this.prisma.inventoryAuditBox.count({ where: { sessionId: id } }),
    ]);
    if (counting > 0) {
      throw new BadRequestException('Сначала завершите подсчёт во всех открытых коробах.');
    }
    if (session.type !== InventorySessionType.FULL && auditedBoxes === 0) {
      return this.prisma.inventorySession.delete({
        where: { id },
        include: sessionInclude,
      });
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
    this.requireSessionWarehouse(user, line.auditBox.session.warehouseId, 'write');
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

    // FIX: an applied decision is immutable. An exact retry is a read-only
    // idempotent response; changing APPLY/DELETE/ACCEPT (including to LEAVE)
    // would break movement audit and allow a later rescan to erase history.
    if (isFinalInventoryDecision(line)) {
      const appliedAction = resolutionActionFromComment(line.decisionComment, line.decision);
      if (appliedAction === action) {
        // FIX: the final decision may have committed before the follow-up
        // RESOLVED/activation transaction failed. Retry that safe phase only.
        await this.refreshBoxResolution(line.auditBoxId, user);
        return this.prisma.inventoryAuditBox.findUnique({
          where: { id: line.auditBoxId },
          include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
        });
      }
      throw new ConflictException(
        `Решение по позиции уже применено (${appliedAction}). Изменить его на ${action} нельзя.`,
      );
    }

    if (action === InventoryResolutionAction.LEAVE_FOR_LATER) {
      // FIX: LEAVE participates in the same pending-row write race as final
      // actions, so a concurrent final action cannot be cleared afterwards.
      await this.runSerializableInventoryDecision(async (tx) => {
        const pending = await tx.inventoryAuditLine.updateMany({
          where: {
            id: line.id,
            decision: InventoryLineDecision.PENDING,
            decidedAt: null,
          },
          data: {
            decision: InventoryLineDecision.PENDING,
            decisionComment: resolutionComment(action, dto.comment),
            decidedByUserId: null,
            decidedByName: null,
            decidedAt: null,
          },
        });
        if (pending.count !== 1) {
          throw concurrentInventoryDecisionConflict();
        }
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
    const decisionData = {
      decision:
        action === InventoryResolutionAction.ACCEPT_AS_IS
          ? InventoryLineDecision.KEEP_SYSTEM
          : InventoryLineDecision.APPLY_ACTUAL,
      decisionComment: resolutionComment(action, dto.comment),
      decidedByUserId: user.id,
      decidedByName: user.name,
      decidedAt: new Date(),
    };

    if (shouldAdjustStock) {
      const box = await this.prisma.box.findUnique({ where: { id: line.auditBox.boxId } });
      if (!box) {
        throw new NotFoundException('Исходный короб не найден.');
      }
      // FIX: an old inventory line must not restore stock in a box that was
      // archived or deleted after counting (for example, after a transfer).
      if (box.status === 'archived' || box.status === 'deleted') {
        throw new ConflictException(
          `Короб ${line.auditBox.boxCode} уже архивирован или удалён. Остаток не изменён. Создайте новую проверку актуального короба.`,
        );
      }
      this.requirePhysicalBoxWarehouse(user, box.warehouseId, 'write');
      if (line.auditBox.session.warehouseId && line.auditBox.session.warehouseId !== box.warehouseId) {
        throw new ForbiddenException('Короб относится к другому филиалу инвентаризации.');
      }
      const claimed = await this.runSerializableInventoryDecision(async (tx) => {
        // FIX: claim the still-pending line before any balance mutation. A
        // later error rolls this claim and every stock write back together.
        const decisionClaimed = await this.claimFinalInventoryDecision(
          tx,
          line.id,
          action,
          decisionData,
        );
        if (!decisionClaimed) {
          return false;
        }
        // FIX: close the transfer race by checking the physical box again
        // inside the same serializable transaction as balance and decision.
        const freshBox = await tx.box.findUnique({
          where: { id: box.id },
          select: { id: true, clientId: true, warehouseId: true, palletId: true, status: true },
        });
        if (!freshBox) {
          throw new NotFoundException('Исходный короб не найден.');
        }
        if (freshBox.status === 'archived' || freshBox.status === 'deleted') {
          throw new ConflictException(
            `Короб ${line.auditBox.boxCode} уже архивирован или удалён. Остаток не изменён. Создайте новую проверку актуального короба.`,
          );
        }
        if (freshBox.clientId !== line.auditBox.clientId) {
          throw new ConflictException(
            `Короб ${line.auditBox.boxCode} относится к другому клиенту. Остаток не изменён.`,
          );
        }
        this.requirePhysicalBoxWarehouse(user, freshBox.warehouseId, 'write');
        if (
          line.auditBox.session.warehouseId &&
          line.auditBox.session.warehouseId !== freshBox.warehouseId
        ) {
          throw new ForbiddenException('Короб относится к другому филиалу инвентаризации.');
        }
        const balance = await tx.stockBalance.findFirst({
          where: {
            clientId: line.auditBox.clientId,
            skuId: line.skuId,
            boxId: freshBox.id,
            status: StockStatus.AVAILABLE,
            ...(freshBox.warehouseId ? { warehouseId: freshBox.warehouseId } : {}),
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
                warehouseId: freshBox.warehouseId,
                clientId: line.auditBox.clientId,
                skuId: line.skuId,
                boxId: freshBox.id,
                palletId: freshBox.palletId,
                status: StockStatus.AVAILABLE,
              }),
              clientId: line.auditBox.clientId,
              warehouseId: freshBox.warehouseId,
              skuId: line.skuId,
              boxId: freshBox.id,
              palletId: freshBox.palletId,
              status: StockStatus.AVAILABLE,
              quantity: targetQuantity,
            },
          });
        }
        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              clientId: line.auditBox.clientId,
              warehouseId: freshBox.warehouseId,
              skuId: line.skuId,
              boxId: freshBox.id,
              palletId: freshBox.palletId,
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
        // FIX: inventory may be the operation that makes an already archived box empty.
        await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
          { boxId: freshBox.id, userId: user.id, reason: 'inventory-stock-adjustment' },
          tx,
        );
        return true;
      });
      if (!claimed) {
        // FIX: a concurrent same-action winner may still need the idempotent
        // audit resolution and receiving-box activation phase.
        await this.refreshBoxResolution(line.auditBoxId, user);
        return this.prisma.inventoryAuditBox.findUnique({
          where: { id: line.auditBoxId },
          include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
        });
      }
    } else {
      const claimed = await this.runSerializableInventoryDecision((tx) =>
        this.claimFinalInventoryDecision(tx, line.id, action, decisionData),
      );
      if (!claimed) {
        // FIX: ACCEPT retries recover a previously failed resolution phase
        // without changing the already final decision.
        await this.refreshBoxResolution(line.auditBoxId, user);
        return this.prisma.inventoryAuditBox.findUnique({
          where: { id: line.auditBoxId },
          include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
        });
      }
    }
    await this.refreshBoxResolution(line.auditBoxId, user);
    return this.prisma.inventoryAuditBox.findUnique({
      where: { id: line.auditBoxId },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  // ADDED: compare-and-set makes final decisions immutable under concurrent
  // manager actions while preserving idempotent retries of the same action.
  private async claimFinalInventoryDecision(
    tx: Prisma.TransactionClient,
    lineId: string,
    action: InventoryResolutionAction,
    decisionData: {
      decision: InventoryLineDecision;
      decisionComment: string;
      decidedByUserId: string;
      decidedByName: string;
      decidedAt: Date;
    },
  ) {
    const claimed = await tx.inventoryAuditLine.updateMany({
      where: {
        id: lineId,
        decision: InventoryLineDecision.PENDING,
        decidedAt: null,
      },
      data: decisionData,
    });
    if (claimed.count === 1) {
      return true;
    }
    const current = await tx.inventoryAuditLine.findUnique({
      where: { id: lineId },
      select: { decision: true, decisionComment: true, decidedAt: true },
    });
    if (
      current &&
      isFinalInventoryDecision(current) &&
      resolutionActionFromComment(current.decisionComment, current.decision) === action
    ) {
      return false;
    }
    throw concurrentInventoryDecisionConflict();
  }

  // ADDED: PostgreSQL serializable write collisions are safe business
  // conflicts, not opaque HTTP 500 responses.
  private async runSerializableInventoryDecision<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isPrismaSerializableConflict(error)) {
        throw concurrentInventoryDecisionConflict();
      }
      throw error;
    }
  }

  async resolveBox(auditBoxId: string, dto: ResolveInventoryBoxDto, user: AuthUser) {
    this.requireManager(user);
    const auditBox = await this.prisma.inventoryAuditBox.findUnique({
      where: { id: auditBoxId },
      include: { session: true, lines: true },
    });
    if (!auditBox) {
      throw new NotFoundException('Проверка короба не найдена.');
    }
    this.requireSessionWarehouse(user, auditBox.session.warehouseId, 'write');
    this.clientScopes.requireClientAccess(user, auditBox.clientId, 'write');
    if (auditBox.status === InventoryBoxStatus.COUNTING) {
      throw new BadRequestException('Сначала завершите подсчёт короба.');
    }

    const pendingLines = auditBox.lines.filter(
      (line) => line.difference !== 0 && line.decision === InventoryLineDecision.PENDING,
    );
    for (const line of pendingLines) {
      await this.decideLine(
        line.id,
        { action: dto.action, comment: dto.comment },
        user,
      );
    }

    if (pendingLines.length === 0) {
      // FIX: MATCHED and repeated resolution use the same atomic boundary as
      // line-by-line actualization.
      await this.resolveAuditBoxAndReactivateIfReady(auditBox.id, user);
    }

    return this.prisma.inventoryAuditBox.findUnique({
      where: { id: auditBox.id },
      include: { lines: { orderBy: [{ skuName: 'asc' }, { internalSku: 'asc' }] } },
    });
  }

  async completeSession(id: string, comment: string | undefined, user: AuthUser) {
    this.requireManager(user);
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    this.requireSessionWarehouse(user, session.warehouseId, 'write');
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
    this.requireSessionWarehouse(user, session.warehouseId, 'write');
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

  private async ensureRescanRequest(
    session: { id: string; title: string; warehouseId: string | null },
    box: { id: string; code: string; clientId: string; warehouseId: string | null; client: { name: string } },
    user: AuthUser,
  ) {
    const pending = await this.prisma.inventoryBoxRescanRequest.findFirst({
      where: {
        boxId: box.id,
        sessionId: session.id,
        status: 'PENDING',
      },
    });
    if (pending) {
      return pending;
    }
    return this.prisma.inventoryBoxRescanRequest.create({
      data: {
        boxId: box.id,
        boxCode: box.code,
        clientId: box.clientId,
        warehouseId: session.warehouseId ?? box.warehouseId,
        clientName: box.client.name,
        sessionId: session.id,
        sessionTitle: session.title,
        requestedByUserId: user.id,
        requestedByName: user.name,
      },
    });
  }

  private async requireActiveSession(id: string, user: AuthUser, access: 'read' | 'write') {
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Инвентаризация не найдена.');
    }
    if (session.status !== InventorySessionStatus.ACTIVE) {
      throw new BadRequestException('Добавлять подсчёты можно только в активную инвентаризацию.');
    }
    this.requireSessionWarehouse(user, session.warehouseId, access);
    return session;
  }

  private async requireCountingBox(id: string, user: AuthUser) {
    const auditBox = await this.prisma.inventoryAuditBox.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!auditBox) {
      throw new NotFoundException('Проверка короба не найдена.');
    }
    this.requireSessionWarehouse(user, auditBox.session.warehouseId, 'write');
    if (auditBox.session.status !== InventorySessionStatus.ACTIVE || auditBox.status !== InventoryBoxStatus.COUNTING) {
      throw new BadRequestException('Подсчёт этого короба уже завершён.');
    }
    return auditBox;
  }

  private requireSessionWarehouse(
    user: AuthUser,
    warehouseId: string | null,
    access: 'read' | 'write',
  ) {
    const scopedWarehouseId = this.resolveScopedWarehouseId(user, access);
    if (scopedWarehouseId && warehouseId !== scopedWarehouseId) {
      throw new ForbiddenException('Инвентаризация относится к другому филиалу.');
    }
  }

  private requirePhysicalBoxWarehouse(
    user: AuthUser,
    warehouseId: string | null,
    access: 'read' | 'write',
  ) {
    const scopedWarehouseId = this.resolveScopedWarehouseId(user, access);
    if (scopedWarehouseId && warehouseId !== scopedWarehouseId) {
      throw new NotFoundException('Короб не найден в активном филиале.');
    }
  }

  private resolveScopedWarehouseId(user: AuthUser, access: 'read' | 'write') {
    if (!isWarehouseScopedInventoryUser(user)) {
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

  private async refreshBoxResolution(auditBoxId: string, user: AuthUser) {
    await this.resolveAuditBoxAndReactivateIfReady(auditBoxId, user);
  }

  // ADDED: resolving the audit and making its usable receiving box active are
  // one serializable operation; a failed activation rolls the RESOLVED write back.
  private async resolveAuditBoxAndReactivateIfReady(auditBoxId: string, user: AuthUser) {
    const resolved = await this.prisma.$transaction(async (tx) => {
      const auditBox = await tx.inventoryAuditBox.findUnique({
        where: { id: auditBoxId },
        select: {
          id: true,
          boxId: true,
          clientId: true,
          sessionId: true,
          status: true,
          session: { select: { warehouseId: true } },
        },
      });
      if (!auditBox) {
        throw new NotFoundException('Проверка короба не найдена.');
      }
      const pending = await tx.inventoryAuditLine.count({
        where: { auditBoxId, difference: { not: 0 }, decision: InventoryLineDecision.PENDING },
      });
      if (pending > 0) {
        return null;
      }
      const current =
        auditBox.status === InventoryBoxStatus.RESOLVED
          ? auditBox
          : await tx.inventoryAuditBox.update({
              where: { id: auditBoxId },
              data: {
                status: InventoryBoxStatus.RESOLVED,
                resolvedAt: new Date(),
                resolvedByName: user.name,
              },
              select: {
                id: true,
                boxId: true,
                clientId: true,
                sessionId: true,
                status: true,
                session: { select: { warehouseId: true } },
              },
            });
      await this.reactivateReceivingBoxIfUsable(tx, {
        boxId: current.boxId,
        clientId: current.clientId,
        warehouseId: current.session.warehouseId,
      });
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (resolved) {
      await this.completeMandatoryFbsSessionIfReady(resolved.sessionId, user);
    }
    return resolved;
  }

  // ADDED: one scoped rule prevents another client or branch balance from
  // activating this inventory box.
  private async reactivateReceivingBoxIfUsable(
    db: Pick<Prisma.TransactionClient, 'box'>,
    scope: { boxId: string; clientId: string; warehouseId: string | null },
  ) {
    await db.box.updateMany({
      where: {
        id: scope.boxId,
        clientId: scope.clientId,
        ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}),
        status: 'receiving',
        balances: {
          some: {
            clientId: scope.clientId,
            ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}),
            status: StockStatus.AVAILABLE,
            quantity: { gt: 0 },
          },
        },
      },
      data: { status: 'active' },
    });
  }

  private async completeMandatoryFbsSessionIfReady(sessionId: string, user: AuthUser) {
    const session = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
      select: { id: true, type: true, status: true, comment: true },
    });
    if (!session || !isMandatoryFbsBoxCheck(session)) return false;
    if (session.status === InventorySessionStatus.COMPLETED) return true;
    if (
      session.status !== InventorySessionStatus.ACTIVE &&
      session.status !== InventorySessionStatus.REVIEW
    ) {
      return false;
    }
    const [unresolvedBoxes, auditedBoxes, pendingDifferences] = await Promise.all([
      this.prisma.inventoryAuditBox.count({
        where: {
          sessionId,
          status: { notIn: [InventoryBoxStatus.MATCHED, InventoryBoxStatus.RESOLVED] },
        },
      }),
      this.prisma.inventoryAuditBox.count({ where: { sessionId } }),
      this.prisma.inventoryAuditLine.count({
        where: {
          auditBox: { sessionId },
          difference: { not: 0 },
          decision: InventoryLineDecision.PENDING,
        },
      }),
    ]);
    if (unresolvedBoxes > 0 || auditedBoxes === 0 || pendingDifferences > 0) return false;
    const completed = await this.prisma.inventorySession.updateMany({
      where: {
        id: sessionId,
        status: { in: [InventorySessionStatus.ACTIVE, InventorySessionStatus.REVIEW] },
      },
      data: {
        status: InventorySessionStatus.COMPLETED,
        completedAt: new Date(),
        completedByUserId: user.id,
        completedByName: user.name,
      },
    });
    if (completed.count === 1) return true;
    const current = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    return current?.status === InventorySessionStatus.COMPLETED;
  }

  private requireManager(user: AuthUser) {
    if (!canManageInventory(user)) {
      throw new ForbiddenException('Действие доступно менеджеру, администратору или владельцу.');
    }
  }

  private decorateSession<T extends { boxes: Array<{ status: InventoryBoxStatus; lines: Array<{ difference: number; decision: InventoryLineDecision; decisionComment?: string | null }> }> }>(
    session: T,
    totalBoxes?: number,
    hideResolvedBoxes = false,
  ) {
    const mismatchBoxes = session.boxes.filter((box) => box.status === InventoryBoxStatus.MISMATCH).length;
    const unresolvedLines = session.boxes.reduce(
      (sum, box) => sum + box.lines.filter((line) => line.difference !== 0 && line.decision === InventoryLineDecision.PENDING).length,
      0,
    );
    return {
      ...session,
      boxes: session.boxes
        .filter((box) => !hideResolvedBoxes || box.status !== InventoryBoxStatus.RESOLVED)
        .map((box) => ({
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

function normalizeInventoryBoxCode(value: string) {
  return value
    .trim()
    .toLocaleUpperCase('ru-RU')
    .replace(/[^A-ZА-ЯЁ0-9]/g, '');
}

function isMandatoryFbsBoxCheck(session: {
  type: InventorySessionType;
  comment?: string | null;
}) {
  return (
    session.type === InventorySessionType.BOX_CHECK &&
    (session.comment?.includes('[FBS_MANDATORY_BOX_CHECK]') ?? false)
  );
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

// ADDED: decidedAt is included because legacy/concurrent rows may have reached
// a final state before their enum value was persisted.
function isFinalInventoryDecision(line: {
  decision: InventoryLineDecision;
  decidedAt?: Date | null;
}) {
  return line.decision !== InventoryLineDecision.PENDING || line.decidedAt != null;
}

function isPrismaSerializableConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
}

function concurrentInventoryDecisionConflict() {
  return new ConflictException(
    'Решение по позиции было изменено параллельно: обновите данные и повторите действие.',
  );
}

function canManageInventory(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) =>
      ['ADMIN', 'OWNER', 'MANAGER', 'BRANCH_MANAGER', 'WAREHOUSE_KEEPER'].includes(role),
    )
  );
}

function canApproveInventoryRescan(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'WAREHOUSE_KEEPER'].includes(role))
  );
}

function hasGlobalInventoryAccess(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
}

function isWarehouseScopedInventoryUser(user: AuthUser) {
  return (
    !user.permissionCodes.includes('system:admin') &&
    !user.roleCodes.includes('CLIENT') &&
    (user.roleCodes.includes('BRANCH_MANAGER') || (user.warehouseIds?.length ?? 0) > 0)
  );
}

function canSeeInventorySession(user: AuthUser, clientId: string | null) {
  if (clientId == null) {
    return hasGlobalInventoryAccess(user);
  }
  return hasGlobalInventoryAccess(user) || user.clientIds.includes(clientId);
}
