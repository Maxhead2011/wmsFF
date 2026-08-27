import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  ClientRequestStatus,
  ClientStockBalanceMode,
  InventoryBoxStatus,
  InventoryLineDecision,
  InventorySessionStatus,
  MovementType,
  PickWaveStatus,
  Prisma,
  StockStatus,
  WarehouseBoxCheckDecision,
} from '@prisma/client';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { InventoryService } from '../inventory/inventory.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';

export const UNPALLETED_WRITEOFF_TARGET_CLIENT_ID = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
export const UNPALLETED_WRITEOFF_CONFIRMATION = 'СПИСАТЬ И АРХИВИРОВАТЬ';
export const UNPALLETED_BLOCKER_RECHECK_CONFIRMATION = 'ПЕРЕПРОВЕРИТЬ БЛОКИРОВКИ';
export const ADMIN_UNPALLETED_WRITEOFF_SOURCE = 'admin-unpalleted-writeoff';

// FIX: nullable legacy movements stay visible; only this internal administrative source is hidden.
export function excludeAdminUnpalletedWriteoffMovement(): Prisma.StockMovementWhereInput {
  return {
    OR: [
      { sourceDocument: null },
      { sourceDocument: { not: ADMIN_UNPALLETED_WRITEOFF_SOURCE } },
    ],
  };
}

// FIX: the target client's externally visible stock is authoritative only while its box is on a pallet-sort.
export function targetClientPlacedBalanceVisibility(): Prisma.StockBalanceWhereInput {
  return {
    OR: [
      { clientId: { not: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID } },
      {
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        boxId: { not: null },
        box: {
          status: { notIn: ['deleted', 'archived'] },
          storagePlacement: { isNot: null },
        },
      },
    ],
  };
}

// FIX: The approved bounded batch size is 25 boxes; larger destructive batches
// still require a new preview/apply cycle.
const MAX_BOXES_PER_APPLY = 25;
const OPEN_INVENTORY_STATUSES = [
  InventorySessionStatus.ACTIVE,
  InventorySessionStatus.REVIEW,
] as const;
const TERMINAL_CLIENT_REQUEST_STATUSES = [
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
] as const;
const TERMINAL_PICK_WAVE_STATUSES = [
  PickWaveStatus.DONE,
  PickWaveStatus.CANCELLED,
] as const;
// FIX: orphan PACKING is not sellable stock and can be written off atomically by
// this ADMIN-only flow. SHIPPING remains protected as shipment history.
const WRITEOFF_BALANCE_STATUSES = new Set<StockStatus>([
  StockStatus.AVAILABLE,
  StockStatus.PACKING,
]);

export type UnpalletedWriteoffBlocker =
  | 'NON_AVAILABLE_BALANCE'
  | 'ACTIVE_CLIENT_REQUEST'
  | 'ACTIVE_FBS_ASSEMBLY'
  | 'OPEN_INVENTORY'
  | 'FOREIGN_CLIENT_DATA'
  | 'ACTIVE_PICK_WAVE'
  | 'PENDING_BOX_CHECK'
  | 'FULL_INVENTORY_LOCK';

export type UnpalletedWriteoffWarning = 'KIZ_COUNT_MISMATCH';

type PreviewBalance = {
  id: string;
  warehouseId: string | null;
  clientId: string;
  skuId: string;
  boxId: string | null;
  palletId: string | null;
  status: StockStatus;
  quantity: number;
  updatedAt: Date;
  sku: {
    clientId: string;
    needsChestnyZnak: boolean;
    isUnmarked: boolean;
  };
};

type PreviewMark = {
  boxId: string | null;
  clientId: string;
  skuId: string;
  status: StockStatus;
  sku: { clientId: string };
};

type PreviewBox = {
  id: string;
  code: string;
  clientId: string;
  warehouseId: string | null;
  status: string;
  balances: PreviewBalance[];
};

type ApplyBoxResult = {
  boxId: string;
  boxCode: string | null;
  outcome: 'ARCHIVED' | 'SKIPPED' | 'ERROR';
  reason: string | null;
  unitsWrittenOff: number;
  marksBlocked: number;
  movementIds: string[];
};

@Injectable()
export class AdministrationUnpalletedWriteoffService {
  private readonly logger = new Logger(AdministrationUnpalletedWriteoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryLock: InventoryLockService,
    @Optional() private readonly marketplaceConnections?: MarketplaceConnectionsService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  async preview(user: AuthUser) {
    // FIX: authorization is repeated in the service so direct/internal calls cannot bypass the guard.
    this.assertSystemAdmin(user);
    const client = await this.requireTargetClient();
    const boxes = (await this.prisma.box.findMany({
      where: {
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        status: 'active',
        balances: { some: { quantity: { gt: 0 } } },
      },
      select: {
        id: true,
        code: true,
        clientId: true,
        warehouseId: true,
        status: true,
        balances: {
          where: { quantity: { gt: 0 } },
          select: {
            id: true,
            warehouseId: true,
            clientId: true,
            skuId: true,
            boxId: true,
            palletId: true,
            status: true,
            quantity: true,
            updatedAt: true,
            sku: {
              select: { clientId: true, needsChestnyZnak: true, isUnmarked: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    })) as PreviewBox[];

    if (boxes.length === 0) {
      return this.emptyPreview(client);
    }

    const boxIds = boxes.map((box) => box.id);
    const boxCodes = boxes.map((box) => box.code);
    const balanceIds = boxes.flatMap((box) => box.balances.map((balance) => balance.id));
    const [
      placements,
      requestSelections,
      assemblies,
      inventoryBoxes,
      marks,
      pickWaveLines,
      pendingChecks,
    ] = await Promise.all([
      this.prisma.storagePalletBox.findMany({
        where: {
          OR: [
            { boxId: { in: boxIds } },
            { boxCode: { in: boxCodes, mode: 'insensitive' } },
          ],
        },
        select: { boxId: true, boxCode: true },
      }),
      this.prisma.clientRequestBoxSelection.findMany({
        where: {
          boxId: { in: boxIds },
          requestItem: { request: { status: { notIn: [...TERMINAL_CLIENT_REQUEST_STATUSES] } } },
        },
        select: {
          boxId: true,
          requestItem: {
            select: { request: { select: { id: true, number: true, status: true } } },
          },
        },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: {
          status: { not: 'COMPLETED' },
          OR: [
            { reservedBoxId: { in: boxIds } },
            { boxId: { in: boxIds } },
            { reservedBoxCode: { in: boxCodes, mode: 'insensitive' } },
            { boxCode: { in: boxCodes, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          clientId: true,
          status: true,
          requestId: true,
          reservedBoxId: true,
          reservedBoxCode: true,
          boxId: true,
          boxCode: true,
        },
      }),
      this.prisma.inventoryAuditBox.findMany({
        where: {
          boxId: { in: boxIds },
          session: { status: { in: [...OPEN_INVENTORY_STATUSES] } },
          // FIX: another unfinished box must not keep this already resolved box locked.
          OR: [
            { status: { notIn: [InventoryBoxStatus.MATCHED, InventoryBoxStatus.RESOLVED] } },
            {
              lines: {
                some: {
                  difference: { not: 0 },
                  decision: InventoryLineDecision.PENDING,
                },
              },
            },
          ],
        },
        select: { boxId: true, sessionId: true },
      }),
      this.prisma.productMark.findMany({
        where: { boxId: { in: boxIds } },
        select: {
          boxId: true,
          clientId: true,
          skuId: true,
          status: true,
          sku: { select: { clientId: true } },
        },
      }),
      this.prisma.pickWaveBalanceLine.findMany({
        where: {
          wave: { status: { notIn: [...TERMINAL_PICK_WAVE_STATUSES] } },
          OR: [
            { balanceId: { in: balanceIds } },
            { sourceBoxId: { in: boxIds } },
            { sourceBoxCode: { in: boxCodes, mode: 'insensitive' } },
          ],
        },
        select: { balanceId: true, sourceBoxId: true, sourceBoxCode: true },
      }),
      this.prisma.warehouseBoxCheckRow.findMany({
        where: {
          decision: WarehouseBoxCheckDecision.PENDING,
          OR: [
            { boxId: { in: boxIds } },
            { boxCode: { in: boxCodes, mode: 'insensitive' } },
          ],
        },
        select: { boxId: true, boxCode: true },
      }),
    ]);

    const placedBoxIds = new Set(placements.map((placement) => placement.boxId).filter(isString));
    const placedBoxCodes = new Set(placements.map((placement) => normalizeCode(placement.boxCode)));
    const candidates = boxes.filter(
      (box) => !placedBoxIds.has(box.id) && !placedBoxCodes.has(normalizeCode(box.code)),
    );
    const requestBoxIds = new Set(requestSelections.map((selection) => selection.boxId));
    const inventoryBoxIds = new Set(inventoryBoxes.map((inventoryBox) => inventoryBox.boxId));
    const balanceBoxIds = new Map(
      boxes.flatMap((box) => box.balances.map((balance) => [balance.id, box.id] as const)),
    );
    const pickWaveBoxIds = new Set<string>();
    const pickWaveBoxCodes = new Set<string>();
    for (const line of pickWaveLines) {
      const balanceBoxId = balanceBoxIds.get(line.balanceId);
      if (balanceBoxId) pickWaveBoxIds.add(balanceBoxId);
      if (line.sourceBoxId) pickWaveBoxIds.add(line.sourceBoxId);
      if (line.sourceBoxCode) pickWaveBoxCodes.add(normalizeCode(line.sourceBoxCode));
    }
    const pendingCheckBoxIds = new Set(pendingChecks.map((row) => row.boxId).filter(isString));
    const pendingCheckBoxCodes = new Set(pendingChecks.map((row) => normalizeCode(row.boxCode)));
    const marksByBoxId = groupMarksByBoxId(marks as PreviewMark[]);
    const assemblyBoxIds = new Set<string>();
    const assemblyBoxCodes = new Set<string>();
    const foreignAssemblyBoxIds = new Set<string>();
    const foreignAssemblyBoxCodes = new Set<string>();
    for (const assembly of assemblies) {
      const idSet = assembly.clientId === UNPALLETED_WRITEOFF_TARGET_CLIENT_ID
        ? assemblyBoxIds
        : foreignAssemblyBoxIds;
      const codeSet = assembly.clientId === UNPALLETED_WRITEOFF_TARGET_CLIENT_ID
        ? assemblyBoxCodes
        : foreignAssemblyBoxCodes;
      if (assembly.reservedBoxId) idSet.add(assembly.reservedBoxId);
      if (assembly.boxId) idSet.add(assembly.boxId);
      if (assembly.reservedBoxCode) codeSet.add(normalizeCode(assembly.reservedBoxCode));
      if (assembly.boxCode) codeSet.add(normalizeCode(assembly.boxCode));
    }

    const rows = candidates
      .map((box) => {
        const blockers: UnpalletedWriteoffBlocker[] = [];
        const warnings: UnpalletedWriteoffWarning[] = [];
        if (box.balances.some((balance) => !WRITEOFF_BALANCE_STATUSES.has(balance.status))) {
          blockers.push('NON_AVAILABLE_BALANCE');
        }
        if (requestBoxIds.has(box.id)) blockers.push('ACTIVE_CLIENT_REQUEST');
        if (assemblyBoxIds.has(box.id) || assemblyBoxCodes.has(normalizeCode(box.code))) {
          blockers.push('ACTIVE_FBS_ASSEMBLY');
        }
        if (inventoryBoxIds.has(box.id)) blockers.push('OPEN_INVENTORY');
        const boxMarks = marksByBoxId.get(box.id) ?? [];
        if (
          hasForeignClientData(box, boxMarks) ||
          foreignAssemblyBoxIds.has(box.id) ||
          foreignAssemblyBoxCodes.has(normalizeCode(box.code))
        ) {
          blockers.push('FOREIGN_CLIENT_DATA');
        }
        // FIX: the dedicated admin cleanup writes off AVAILABLE and orphan PACKING balances.
        // A count mismatch is visible for audit, but historical SHIPPING marks are preserved.
        if (hasKizCountMismatch(box.balances, boxMarks)) warnings.push('KIZ_COUNT_MISMATCH');
        if (pickWaveBoxIds.has(box.id) || pickWaveBoxCodes.has(normalizeCode(box.code))) {
          blockers.push('ACTIVE_PICK_WAVE');
        }
        if (pendingCheckBoxIds.has(box.id) || pendingCheckBoxCodes.has(normalizeCode(box.code))) {
          blockers.push('PENDING_BOX_CHECK');
        }
        return {
          boxId: box.id,
          boxCode: box.code,
          warehouseId: box.warehouseId,
          quantity: sumQuantity(box.balances),
          statuses: unique(box.balances.map((balance) => balance.status)),
          safe: blockers.length === 0,
          blockers,
          warnings,
        };
      })
      .sort(
        (left, right) =>
          Number(left.safe) - Number(right.safe) || left.boxCode.localeCompare(right.boxCode, 'ru-RU'),
      );

    const blockerSummary = summarizeReasons(rows, 'blockers', 'blocker');
    const warningSummary = summarizeReasons(rows, 'warnings', 'warning');
    return {
      checkedAt: new Date().toISOString(),
      client,
      summary: {
        scanned: boxes.length,
        candidates: rows.length,
        safe: rows.filter((row) => row.safe).length,
        blocked: rows.filter((row) => !row.safe).length,
        units: rows.reduce((sum, row) => sum + row.quantity, 0),
        safeUnits: rows.filter((row) => row.safe).reduce((sum, row) => sum + row.quantity, 0),
        warnings: rows.filter((row) => row.warnings.length > 0).length,
      },
      blockerSummary,
      warningSummary,
      rows,
    };
  }

  async recheck(body: { confirmation?: string }, user: AuthUser) {
    // FIX: this route may synchronize marketplace state and complete already-finished inventory
    // sessions, so it repeats authorization and requires an explicit server-side phrase.
    this.assertSystemAdmin(user);
    if (body.confirmation !== UNPALLETED_BLOCKER_RECHECK_CONFIRMATION) {
      throw new BadRequestException(
        `Введите точное подтверждение: ${UNPALLETED_BLOCKER_RECHECK_CONFIRMATION}`,
      );
    }
    await this.requireTargetClient();
    if (!this.marketplaceConnections || !this.inventory) {
      throw new BadRequestException('Сервисы перепроверки временно недоступны.');
    }

    const before = await this.preview(user);
    const boxIds = before.rows.map((row) => row.boxId);
    let fbsError: string | null = null;
    try {
      // FIX: reuse the existing WB refresh/synchronization path; do not infer order states locally.
      await this.marketplaceConnections.listFbsOrders(
        UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        user,
        true,
      );
    } catch (caught) {
      fbsError = publicRecheckError(caught);
    }

    // FIX: InventoryService owns the strict MATCHED/RESOLVED completion invariant.
    const inventory = await this.inventory.completeResolvedSessionsForBoxes(boxIds, user);
    const preview = await this.preview(user);
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'administration.unpalleted-box.blockers_rechecked',
          entity: 'Client',
          entityId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          payload: {
            candidatesBefore: before.summary.candidates,
            blockedBefore: before.summary.blocked,
            blockedAfter: preview.summary.blocked,
            fbsRefreshed: fbsError === null,
            fbsError,
            inventory,
          },
        },
      });
    } catch (caught) {
      this.logger.error(`Unable to audit unpalleted blocker recheck: ${failureErrorCode(caught)}`);
    }
    return {
      fbs: { refreshed: fbsError === null, error: fbsError },
      inventory,
      preview,
    };
  }

  async apply(
    body: { boxIds?: unknown; confirmation?: string },
    user: AuthUser,
  ) {
    // FIX: destructive execution has service-level auth, an exact phrase and a bounded batch.
    this.assertSystemAdmin(user);
    if (body.confirmation !== UNPALLETED_WRITEOFF_CONFIRMATION) {
      throw new BadRequestException(`Введите точное подтверждение: ${UNPALLETED_WRITEOFF_CONFIRMATION}`);
    }
    const boxIds = parseBoxIds(body.boxIds);
    await this.requireTargetClient();
    // FIX: the first lock check happens before any transaction, preserving all-or-nothing startup safety.
    await this.inventoryLock.assertStockMovementsAllowed();
    const results: ApplyBoxResult[] = [];
    for (const boxId of boxIds) {
      try {
        // FIX: after the first box, recheck before every later box so a newly opened inventory stops writes.
        if (results.length > 0) await this.inventoryLock.assertStockMovementsAllowed();
        results.push(
          await this.prisma.$transaction(
            (tx) => this.applyOneBox(tx, boxId, user),
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              maxWait: 10_000,
              timeout: 10_000,
            },
          ),
        );
      } catch (caught) {
        // FIX: each box has its own transaction; one database failure cannot erase prior successes.
        const reason = publicFailureReason(caught);
        await this.recordFailure(boxId, user, caught, reason);
        results.push(failed(boxId, reason));
      }
    }

    const archivedRows = results.filter((row) => row.outcome === 'ARCHIVED');
    const skippedRows = results.filter((row) => row.outcome === 'SKIPPED');
    const failedRows = results.filter((row) => row.outcome === 'ERROR');
    return {
      processed: results.length,
      archived: archivedRows.length,
      skipped: skippedRows.length,
      failed: failedRows.length,
      unitsWrittenOff: archivedRows.reduce((sum, row) => sum + row.unitsWrittenOff, 0),
      results,
    };
  }

  private async applyOneBox(tx: Prisma.TransactionClient, boxId: string, user: AuthUser) {
    // FIX: SHARE blocks a concurrent InventorySession INSERT until this short box transaction ends.
    await tx.$executeRaw(Prisma.sql`LOCK TABLE "InventorySession" IN SHARE MODE`);
    const fullInventory = await tx.inventorySession.findFirst({
      where: {
        type: 'FULL',
        status: { in: [...OPEN_INVENTORY_STATUSES] },
      },
      select: { id: true },
    });
    if (fullInventory) return skipped(boxId, null, 'FULL_INVENTORY_LOCK');
    // FIX: placement and cleanup share this row lock. Whichever starts second must re-read final state.
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Box" WHERE "id" = ${boxId} FOR UPDATE`,
    );
    // FIX: the authoritative state is reloaded inside the Serializable transaction after the lock.
    const box = (await tx.box.findFirst({
      where: {
        id: boxId,
        clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
        status: 'active',
        balances: { some: { quantity: { gt: 0 } } },
      },
      select: {
        id: true,
        code: true,
        clientId: true,
        warehouseId: true,
        status: true,
        balances: {
          where: { quantity: { gt: 0 } },
          select: {
            id: true,
            warehouseId: true,
            clientId: true,
            skuId: true,
            boxId: true,
            palletId: true,
            status: true,
            quantity: true,
            updatedAt: true,
            sku: {
              select: { clientId: true, needsChestnyZnak: true, isUnmarked: true },
            },
          },
        },
      },
    })) as PreviewBox | null;

    if (!box) return skipped(boxId, null, 'BOX_NOT_ACTIVE_OR_EMPTY');

    const placement = await tx.storagePalletBox.findFirst({
      where: {
        OR: [
          { boxId: box.id },
          { boxCode: { equals: box.code, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (placement) return skipped(box.id, box.code, 'PALLET_PLACEMENT_FOUND');
    if (box.balances.some((balance) => !WRITEOFF_BALANCE_STATUSES.has(balance.status))) {
      return skipped(box.id, box.code, 'NON_AVAILABLE_BALANCE');
    }

    const [requestSelection, assembly, inventoryBox, marks, pickWaveLine, pendingCheck] = await Promise.all([
      tx.clientRequestBoxSelection.findFirst({
        where: {
          boxId: box.id,
          requestItem: { request: { status: { notIn: [...TERMINAL_CLIENT_REQUEST_STATUSES] } } },
        },
        select: { id: true },
      }),
      tx.fbsTsdAssembly.findFirst({
        where: {
          status: { not: 'COMPLETED' },
          OR: [
            { reservedBoxId: box.id },
            { boxId: box.id },
            { reservedBoxCode: { equals: box.code, mode: 'insensitive' } },
            { boxCode: { equals: box.code, mode: 'insensitive' } },
          ],
        },
        select: { id: true, clientId: true },
      }),
      tx.inventoryAuditBox.findFirst({
        where: {
          boxId: box.id,
          session: { status: { in: [...OPEN_INVENTORY_STATUSES] } },
          // FIX: only an unresolved state of this exact box blocks the cleanup.
          OR: [
            { status: { notIn: [InventoryBoxStatus.MATCHED, InventoryBoxStatus.RESOLVED] } },
            {
              lines: {
                some: {
                  difference: { not: 0 },
                  decision: InventoryLineDecision.PENDING,
                },
              },
            },
          ],
        },
        select: { id: true },
      }),
      tx.productMark.findMany({
        where: { boxId: box.id },
        select: {
          boxId: true,
          clientId: true,
          skuId: true,
          status: true,
          sku: { select: { clientId: true } },
        },
      }),
      tx.pickWaveBalanceLine.findFirst({
        where: {
          wave: { status: { notIn: [...TERMINAL_PICK_WAVE_STATUSES] } },
          OR: [
            { balanceId: { in: box.balances.map((balance) => balance.id) } },
            { sourceBoxId: box.id },
            { sourceBoxCode: { equals: box.code, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
      tx.warehouseBoxCheckRow.findFirst({
        where: {
          decision: WarehouseBoxCheckDecision.PENDING,
          OR: [
            { boxId: box.id },
            { boxCode: { equals: box.code, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (requestSelection) return skipped(box.id, box.code, 'ACTIVE_CLIENT_REQUEST');
    if (assembly?.clientId !== undefined && assembly.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID) {
      return skipped(box.id, box.code, 'FOREIGN_CLIENT_DATA');
    }
    if (assembly) return skipped(box.id, box.code, 'ACTIVE_FBS_ASSEMBLY');
    if (inventoryBox) return skipped(box.id, box.code, 'OPEN_INVENTORY');
    if (hasForeignClientData(box, marks as PreviewMark[])) {
      return skipped(box.id, box.code, 'FOREIGN_CLIENT_DATA');
    }
    const kizCountMismatch = hasKizCountMismatch(box.balances, marks as PreviewMark[]);
    if (pickWaveLine) return skipped(box.id, box.code, 'ACTIVE_PICK_WAVE');
    if (pendingCheck) return skipped(box.id, box.code, 'PENDING_BOX_CHECK');

    let unitsWrittenOff = 0;
    let marksBlocked = 0;
    const movementIds: string[] = [];
    for (const balance of box.balances) {
      const movement = await tx.stockMovement.create({
        data: {
          warehouseId: balance.warehouseId,
          clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          skuId: balance.skuId,
          boxId: box.id,
          palletId: balance.palletId,
          type: MovementType.INVENTORY_ADJUSTMENT,
          status: balance.status,
          quantity: -balance.quantity,
          sourceDocument: ADMIN_UNPALLETED_WRITEOFF_SOURCE,
          idempotencyKey: `${ADMIN_UNPALLETED_WRITEOFF_SOURCE}:${box.id}:${balance.id}`,
          comment: `Администратор ${user.name} списал остаток короба ${box.code}, не размещённого на паллет-сорте.`,
        },
      });
      const markResult = await tx.productMark.updateMany({
        where: {
          clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          boxId: box.id,
          skuId: balance.skuId,
          status: balance.status,
        },
        data: {
          status: StockStatus.BLOCKED,
          boxId: null,
          stockMovementId: movement.id,
          sourceDocument: ADMIN_UNPALLETED_WRITEOFF_SOURCE,
        },
      });
      await tx.stockBalance.delete({ where: { id: balance.id } });
      movementIds.push(movement.id);
      unitsWrittenOff += balance.quantity;
      marksBlocked += markResult.count;
    }

    await tx.box.update({
      where: { id: box.id },
      data: { status: 'archived', palletId: null, zoneId: null },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'administration.unpalleted-box.writeoff',
        entity: 'Box',
        entityId: box.id,
        payload: {
          source: ADMIN_UNPALLETED_WRITEOFF_SOURCE,
          clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
          boxCode: box.code,
          unitsWrittenOff,
          marksBlocked,
          kizCountMismatch,
          movementIds,
        },
      },
    });

    return {
      boxId: box.id,
      boxCode: box.code,
      outcome: 'ARCHIVED' as const,
      reason: null,
      unitsWrittenOff,
      marksBlocked,
      movementIds,
    };
  }

  private async recordFailure(
    boxId: string,
    user: AuthUser,
    caught: unknown,
    publicReason: string,
  ) {
    const errorCode = failureErrorCode(caught);
    this.logger.error(`Unpalleted box cleanup failed for ${boxId}: ${errorCode}`);
    try {
      // FIX: failed attempts are also traceable, while the raw database message stays internal.
      await this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'administration.unpalleted-box.writeoff_failed',
          entity: 'Box',
          entityId: boxId,
          payload: {
            source: ADMIN_UNPALLETED_WRITEOFF_SOURCE,
            clientId: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
            errorCode,
            publicReason,
          },
        },
      });
    } catch (auditError) {
      this.logger.error(
        `Unable to audit unpalleted box cleanup failure for ${boxId}: ${failureErrorCode(auditError)}`,
      );
    }
  }

  private assertSystemAdmin(user: AuthUser) {
    if (
      user.isDemo ||
      !user.roleCodes?.includes('ADMIN') ||
      !user.permissionCodes?.includes('system:admin')
    ) {
      throw new ForbiddenException('Списание коробов без паллет-сорта доступно только администратору.');
    }
  }

  private async requireTargetClient() {
    const client = await this.prisma.client.findUnique({
      where: { id: UNPALLETED_WRITEOFF_TARGET_CLIENT_ID },
      select: { id: true, code: true, name: true, stockBalanceMode: true, storesWithoutBoxes: true },
    });
    if (!client) throw new NotFoundException('Клиент ИП Лукин Илья Ильич не найден.');
    if (
      client.storesWithoutBoxes ||
      client.stockBalanceMode !== ClientStockBalanceMode.PALLET_SORT
    ) {
      throw new BadRequestException(
        'Механизм разрешён только когда остатки клиента учитываются по паллет-сортам.',
      );
    }
    return client;
  }

  private emptyPreview(client: Awaited<ReturnType<AdministrationUnpalletedWriteoffService['requireTargetClient']>>) {
    return {
      checkedAt: new Date().toISOString(),
      client,
      summary: { scanned: 0, candidates: 0, safe: 0, blocked: 0, units: 0, safeUnits: 0, warnings: 0 },
      blockerSummary: [],
      warningSummary: [],
      rows: [],
    };
  }
}

function summarizeReasons<
  TRow extends { quantity: number; blockers: UnpalletedWriteoffBlocker[]; warnings: UnpalletedWriteoffWarning[] },
  TList extends 'blockers' | 'warnings',
  TName extends 'blocker' | 'warning',
>(rows: TRow[], listName: TList, valueName: TName) {
  const totals = new Map<string, { boxes: number; units: number }>();
  for (const row of rows) {
    for (const reason of row[listName]) {
      const current = totals.get(reason) ?? { boxes: 0, units: 0 };
      current.boxes += 1;
      current.units += row.quantity;
      totals.set(reason, current);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, totalsForReason]) => ({ [valueName]: reason, ...totalsForReason }));
}

function publicRecheckError(caught: unknown) {
  if (caught instanceof Error && caught.message.trim()) return caught.message.trim().slice(0, 500);
  return 'WB не подтвердил обновление заказов.';
}

function parseBoxIds(value: unknown) {
  if (!Array.isArray(value)) throw new BadRequestException('Передайте список коробов для списания.');
  if (value.some((item) => typeof item !== 'string')) {
    throw new BadRequestException('Идентификаторы коробов должны быть строками.');
  }
  const boxIds = unique(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (boxIds.length === 0) throw new BadRequestException('Не выбран ни один короб.');
  if (boxIds.some((boxId) => !/^[a-zA-Z0-9-]{1,64}$/.test(boxId))) {
    throw new BadRequestException('Передан некорректный идентификатор короба.');
  }
  if (boxIds.length > MAX_BOXES_PER_APPLY) {
    throw new BadRequestException(`За один запуск можно обработать не более ${MAX_BOXES_PER_APPLY} коробов.`);
  }
  return boxIds;
}

function skipped(boxId: string, boxCode: string | null, reason: string) {
  return {
    boxId,
    boxCode,
    outcome: 'SKIPPED' as const,
    reason,
    unitsWrittenOff: 0,
    marksBlocked: 0,
    movementIds: [] as string[],
  };
}

function failed(boxId: string, reason = 'TRANSACTION_FAILED'): ApplyBoxResult {
  return {
    boxId,
    boxCode: null,
    outcome: 'ERROR',
    reason,
    unitsWrittenOff: 0,
    marksBlocked: 0,
    movementIds: [],
  };
}

function normalizeCode(value: string) {
  return value.toLocaleLowerCase('ru-RU');
}

function sumQuantity(balances: PreviewBalance[]) {
  return balances.reduce((sum, balance) => sum + balance.quantity, 0);
}

function groupMarksByBoxId(marks: PreviewMark[]) {
  const grouped = new Map<string, PreviewMark[]>();
  for (const mark of marks) {
    if (!mark.boxId) continue;
    const rows = grouped.get(mark.boxId) ?? [];
    rows.push(mark);
    grouped.set(mark.boxId, rows);
  }
  return grouped;
}

function hasForeignClientData(box: Pick<PreviewBox, 'balances'>, marks: PreviewMark[]) {
  return (
    box.balances.some(
      (balance) =>
        balance.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID ||
        balance.sku.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
    ) ||
    marks.some(
      (mark) =>
        mark.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID ||
        mark.sku.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID,
    )
  );
}

function hasKizCountMismatch(balances: PreviewBalance[], marks: PreviewMark[]) {
  const expectedBySku = new Map<string, number>();
  for (const balance of balances) {
    if (!balance.sku.needsChestnyZnak || balance.sku.isUnmarked) continue;
    expectedBySku.set(balance.skuId, (expectedBySku.get(balance.skuId) ?? 0) + balance.quantity);
  }
  const actualBySku = new Map<string, number>();
  for (const mark of marks) {
    if (
      mark.clientId !== UNPALLETED_WRITEOFF_TARGET_CLIENT_ID ||
      !WRITEOFF_BALANCE_STATUSES.has(mark.status)
    ) continue;
    actualBySku.set(mark.skuId, (actualBySku.get(mark.skuId) ?? 0) + 1);
  }
  if ([...actualBySku.keys()].some((skuId) => !expectedBySku.has(skuId))) return true;
  return [...expectedBySku].some(([skuId, quantity]) => (actualBySku.get(skuId) ?? 0) !== quantity);
}

function failureErrorCode(caught: unknown) {
  if (caught instanceof Prisma.PrismaClientKnownRequestError) return caught.code;
  if (caught instanceof Error) return caught.name || 'Error';
  return 'UnknownError';
}

function publicFailureReason(caught: unknown) {
  if (
    caught &&
    typeof caught === 'object' &&
    'getResponse' in caught &&
    typeof caught.getResponse === 'function'
  ) {
    const response = caught.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      // FIX: expose only the stable application code, never a raw database message.
      return response.code;
    }
  }
  return 'TRANSACTION_FAILED';
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0;
}
