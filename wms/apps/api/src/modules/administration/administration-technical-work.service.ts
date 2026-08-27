import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  FbsSyncConflictResolutionAction,
} from '../marketplace-connections/dto/resolve-fbs-sync-conflict.dto';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import {
  FbsRequestBoxAuditService,
  type FbsRequestBoxAudit,
  type FbsRequestBoxAuditState,
} from '../stock/fbs-request-box-audit.service';
import { PickInstructionService } from '../stock/pick-instruction.service';

export type TechnicalWorkCategory =
  | 'REQUESTS'
  | 'PALLET_SORTS'
  | 'BOXES'
  | 'MARKETPLACE_STATUS';

export type TechnicalWorkActionId =
  | 'REPAIR_REQUEST_ROUTE'
  | 'RETURN_TO_STOCK'
  | 'MANAGER_CONFIRMED';

type TechnicalWorkAction = {
  id: TechnicalWorkActionId;
  label: string;
  tone: 'PRIMARY' | 'DANGER';
  confirmation: string;
  requiresComment: boolean;
};

export type TechnicalWorkIssue = {
  id: string;
  category: TechnicalWorkCategory;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  explanation: string;
  recommendation: string;
  request: {
    id: string;
    number: number;
    title: string;
    status: string;
    client: { id: string; code: string; name: string };
  } | null;
  orderId: string | null;
  objectCode: string | null;
  state: string;
  evidence: string[];
  actions: TechnicalWorkAction[];
};

const OPEN_REQUEST_STATUSES = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

const BOX_STATES = new Set<FbsRequestBoxAuditState>([
  'NO_REMAINING_DEMAND',
  'BLOCKED_BY_RESERVATIONS',
  'SKU_OR_QUANTITY_MISMATCH',
  'EMPTY',
  'ARCHIVED',
  'MISSING',
]);

const ROUTE_REPAIR_ACTION: TechnicalWorkAction = {
  id: 'REPAIR_REQUEST_ROUTE',
  label: 'Пересчитать маршрут заявки',
  tone: 'PRIMARY',
  confirmation: 'ИСПРАВИТЬ',
  requiresComment: false,
};

@Injectable()
export class AdministrationTechnicalWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly marketplaceConnections: MarketplaceConnectionsService,
    private readonly fbsRequestBoxAudits: FbsRequestBoxAuditService,
    private readonly pickInstructions: PickInstructionService,
  ) {}

  // ADDED: Cheap tile counters. Expensive route analysis runs only when the owner opens a category.
  async overview(user: AuthUser) {
    this.assertOwner(user);
    const [activeRequests, statusProblems] = await Promise.all([
      this.prisma.clientRequest.count({
        where: {
          type: ClientRequestType.OUTBOUND,
          status: { in: OPEN_REQUEST_STATUSES },
          fbsOrderLinks: { some: {} },
          client: { isDemo: Boolean(user.isDemo) },
        },
      }),
      this.prisma.fbsTsdAssembly.count({
        where: {
          OR: [
            { status: 'RETURN_REQUIRED' },
            { marketplaceSubmitError: { not: null } },
          ],
          requestId: {
            in: await this.visibleOpenRequestIds(user),
          },
        },
      }),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      activeRequests,
      statusProblems,
    };
  }

  // ADDED: Every diagnosis returns evidence and only actions that call a real server repair.
  async diagnose(categoryValue: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const category = this.category(categoryValue);
    const issues = category === 'MARKETPLACE_STATUS'
      ? await this.marketplaceStatusIssues(user)
      : await this.routeIssues(category, user);
    return {
      category,
      checkedAt: new Date().toISOString(),
      summary: {
        issues: issues.length,
        // FIX: One physical box can occur in several requests; expose the real object count.
        uniqueObjects: new Set(issues.map((issue) => issue.objectCode).filter(Boolean)).size,
        critical: issues.filter((issue) => issue.severity === 'CRITICAL').length,
        actionable: issues.filter((issue) => issue.actions.length > 0).length,
      },
      issues,
    };
  }

  // ADDED: Preview uses only the codes physically scanned now; historical pallet data is never applied.
  async previewPalletSortScan(
    body: { palletCode?: string; boxCodes?: unknown },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const palletCode = normalizeWarehouseCode(body.palletCode);
    const boxCodes = normalizeWarehouseCodes(body.boxCodes);
    if (!palletCode) throw new BadRequestException('Отсканируйте палет-сорт.');
    if (boxCodes.length === 0) throw new BadRequestException('Отсканируйте хотя бы один короб.');
    if (boxCodes.length > 200) throw new BadRequestException('За один запуск можно разместить не более 200 коробов.');

    const boxes = await this.prisma.box.findMany({
      where: {
        OR: boxCodes.map((code) => ({ code: { equals: code, mode: 'insensitive' as const } })),
      },
      select: {
        id: true,
        code: true,
        status: true,
        clientId: true,
        warehouseId: true,
        client: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        storagePlacement: {
          select: { palletId: true, pallet: { select: { code: true } } },
        },
      },
    });
    const boxByCode = new Map(boxes.map((box) => [normalizeWarehouseCode(box.code), box]));
    const errors: Array<{ code: string; message: string }> = [];
    for (const code of boxCodes) {
      const box = boxByCode.get(code);
      if (!box) errors.push({ code, message: 'Короб не найден в WMS.' });
      else if (['deleted', 'archived'].includes(box.status.toLocaleLowerCase('ru-RU'))) {
        errors.push({ code: box.code, message: 'Короб удалён или находится в архиве.' });
      } else if (!box.warehouseId || !box.warehouse) {
        errors.push({ code: box.code, message: 'У короба не указан склад.' });
      }
    }
    const validBoxes = boxes.filter((box) =>
      !['deleted', 'archived'].includes(box.status.toLocaleLowerCase('ru-RU')) &&
      Boolean(box.warehouseId && box.warehouse),
    );
    const scopes = new Set(validBoxes.map((box) => `${box.clientId}:${box.warehouseId}`));
    if (scopes.size > 1) {
      errors.push({ code: palletCode, message: 'В одном запуске нельзя смешивать короба разных клиентов или складов.' });
    }
    const scope = scopes.size === 1 ? validBoxes[0] : null;
    if (scope) {
      const writableClients = user.clientScopeMode === 'ALL' || user.writableClientIds.includes(scope.clientId);
      const writableWarehouses = !user.writableWarehouseIds?.length || user.writableWarehouseIds.includes(scope.warehouseId!);
      if (!writableClients || !writableWarehouses) {
        errors.push({ code: palletCode, message: 'Нет прав на изменение этого клиента или склада.' });
      }
    }

    const target = scope
      ? await this.prisma.storagePallet.findUnique({
          where: { warehouseId_code: { warehouseId: scope.warehouseId!, code: palletCode } },
          select: { id: true, code: true, clientId: true, warehouseId: true },
        })
      : null;
    if (target && scope && target.clientId !== scope.clientId) {
      errors.push({ code: palletCode, message: 'Этот палет-сорт принадлежит другому клиенту.' });
    }

    const affectedRequests = scope
      ? await this.requestsAffectedByBoxes(scope.clientId, validBoxes.map((box) => box.code))
      : [];
    const rows = boxCodes.map((code) => {
      const box = boxByCode.get(code);
      const currentPalletCode = box?.storagePlacement?.pallet.code ?? null;
      return {
        code: box?.code ?? code,
        boxId: box?.id ?? null,
        currentPalletCode,
        action: !box
          ? 'ERROR' as const
          : currentPalletCode === palletCode
            ? 'UNCHANGED' as const
            : currentPalletCode
              ? 'MOVE' as const
              : 'PLACE' as const,
      };
    });
    return {
      checkedAt: new Date().toISOString(),
      pallet: {
        id: target?.id ?? null,
        code: palletCode,
        exists: Boolean(target),
        willCreate: Boolean(scope && !target),
        client: scope?.client ?? null,
        warehouse: scope?.warehouse ?? null,
      },
      boxes: rows,
      affectedRequests,
      errors,
      summary: {
        requested: boxCodes.length,
        place: rows.filter((row) => row.action === 'PLACE').length,
        move: rows.filter((row) => row.action === 'MOVE').length,
        unchanged: rows.filter((row) => row.action === 'UNCHANGED').length,
        affectedRequests: affectedRequests.length,
      },
      canApply: errors.length === 0 && validBoxes.length > 0,
      confirmation: 'РАЗМЕСТИТЬ',
    };
  }

  // ADDED: The current physical scan is revalidated and written atomically without touching stock or marks.
  async applyPalletSortScan(
    body: { palletCode?: string; boxCodes?: unknown; confirmation?: string },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    if (user.isDemo) throw new ForbiddenException('Технические исправления недоступны в демо-режиме.');
    if (String(body.confirmation ?? '').trim().toLocaleUpperCase('ru-RU') !== 'РАЗМЕСТИТЬ') {
      throw new BadRequestException('Подтвердите действие словом «РАЗМЕСТИТЬ».');
    }
    const preview = await this.previewPalletSortScan(body, user);
    if (!preview.canApply || !preview.pallet.client || !preview.pallet.warehouse) {
      throw new BadRequestException(preview.errors[0]?.message ?? 'Набор коробов нельзя безопасно разместить.');
    }
    const changedAt = new Date();
    const canonicalBoxes = preview.boxes.filter((box): box is typeof box & { boxId: string } => Boolean(box.boxId));
    const pallet = await this.prisma.$transaction(async (tx) => {
      // FIX: serialize technical placement with administrative box retirement.
      const boxIds = canonicalBoxes.map((box) => box.boxId).sort();
      if (boxIds.length > 0) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Box" WHERE "id" IN (${Prisma.join(boxIds)}) ORDER BY "id" FOR UPDATE`,
        );
      }
      const currentBoxes = await tx.box.findMany({
        where: { id: { in: canonicalBoxes.map((box) => box.boxId) } },
        select: { id: true, status: true, clientId: true, warehouseId: true },
      });
      const stillValid = currentBoxes.length === canonicalBoxes.length && currentBoxes.every((box) =>
        !['deleted', 'archived'].includes(box.status.toLocaleLowerCase('ru-RU')) &&
        box.clientId === preview.pallet.client!.id &&
        box.warehouseId === preview.pallet.warehouse!.id,
      );
      if (!stillValid) {
        throw new BadRequestException('Один из коробов изменился после проверки. Выполните предварительную проверку ещё раз.');
      }
      // FIX: Recreate only the pallet code scanned now, never a pallet from stale history.
      const target = await tx.storagePallet.upsert({
        where: {
          warehouseId_code: {
            warehouseId: preview.pallet.warehouse!.id,
            code: preview.pallet.code,
          },
        },
        create: {
          warehouseId: preview.pallet.warehouse!.id,
          clientId: preview.pallet.client!.id,
          code: preview.pallet.code,
          status: 'CLOSED',
          source: 'TECHNICAL_SCAN',
          workerUserId: user.id,
          workerName: user.name,
          lastSyncedAt: changedAt,
          closedAt: changedAt,
        },
        update: {
          source: 'TECHNICAL_SCAN',
          workerUserId: user.id,
          workerName: user.name,
          lastSyncedAt: changedAt,
        },
        select: { id: true, code: true, clientId: true, warehouseId: true },
      });
      if (target.clientId !== preview.pallet.client!.id) {
        throw new BadRequestException('Этот палет-сорт принадлежит другому клиенту.');
      }
      for (const box of canonicalBoxes) {
        await tx.storagePalletBox.upsert({
          where: { boxCode: box.code },
          create: {
            palletId: target.id,
            boxId: box.boxId,
            boxCode: box.code,
            source: 'TECHNICAL_SCAN',
            scannedAt: changedAt,
          },
          update: {
            palletId: target.id,
            boxId: box.boxId,
            source: 'TECHNICAL_SCAN',
            scannedAt: changedAt,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'administration.technical-work.pallet-sort-scan',
          entity: 'StoragePallet',
          entityId: target.id,
          payload: {
            palletCode: target.code,
            boxCodes: canonicalBoxes.map((box) => box.code),
            placed: preview.summary.place,
            moved: preview.summary.move,
            unchanged: preview.summary.unchanged,
            requestIds: preview.affectedRequests.map((request) => request.id),
            changedAt: changedAt.toISOString(),
          },
        },
      });
      return target;
    });

    const routeResults: Array<{ requestId: string; number: number; repaired: boolean; message: string }> = [];
    for (const request of preview.affectedRequests) {
      try {
        await this.marketplaceConnections.repairFbsRequestSelection(request.id, user);
        await this.pickInstructions.refreshRequestInstruction(request.id, user);
        routeResults.push({ requestId: request.id, number: request.number, repaired: true, message: 'Маршрут пересчитан.' });
      } catch (caught) {
        routeResults.push({ requestId: request.id, number: request.number, repaired: false, message: errorMessage(caught) });
      } finally {
        this.pickInstructions.invalidateRequestInstruction(request.id);
      }
    }
    const failedRoutes = routeResults.filter((result) => !result.repaired);
    return {
      applied: true,
      pallet: { id: pallet.id, code: pallet.code },
      placed: preview.summary.place,
      moved: preview.summary.move,
      unchanged: preview.summary.unchanged,
      affectedRequests: preview.affectedRequests.length,
      repairedRequests: routeResults.length - failedRoutes.length,
      failedRoutes,
      message: failedRoutes.length
        ? `Размещение сохранено. Не удалось пересчитать заявок: ${failedRoutes.length}; повторное сканирование коробов не требуется.`
        : `Палет-сорт ${pallet.code} сохранён, связанные заявки пересчитаны.`,
    };
  }

  // ADDED: Re-check the target immediately before applying a whitelisted repair.
  async apply(
    body: {
      issueId?: string;
      action?: string;
      confirmation?: string;
      comment?: string;
    },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    if (user.isDemo) throw new ForbiddenException('Технические исправления недоступны в демо-режиме.');
    const issueId = String(body.issueId ?? '').trim();
    const action = String(body.action ?? '').trim() as TechnicalWorkActionId;
    if (!issueId || !action) throw new BadRequestException('Не выбраны проблема или действие.');

    if (action === 'REPAIR_REQUEST_ROUTE') {
      if (String(body.confirmation ?? '').trim().toLocaleUpperCase('ru-RU') !== 'ИСПРАВИТЬ') {
        throw new BadRequestException('Подтвердите действие словом «ИСПРАВИТЬ».');
      }
      const parsed = parseRouteIssueId(issueId);
      if (!parsed) throw new BadRequestException('Эта проблема не относится к маршруту заявки.');
      const before = await this.fbsRequestBoxAudits.auditRequest(parsed.requestId, user);
      const stillPresent = routeAuditHasIssue(before, parsed.category, parsed.objectCode);
      if (!stillPresent) {
        throw new BadRequestException('Проблема уже исчезла или изменилась. Обновите анализ.');
      }
      const selection = await this.marketplaceConnections.repairFbsRequestSelection(parsed.requestId, user);
      // FIX: Once the real repair returned success, a failed refresh must not invite a destructive retry.
      let after: FbsRequestBoxAudit | null = null;
      let postCheckWarning = '';
      try {
        await this.pickInstructions.refreshRequestInstruction(parsed.requestId, user);
        after = await this.fbsRequestBoxAudits.auditRequest(parsed.requestId, user);
      } catch (caught) {
        postCheckWarning = ` Повторная проверка не завершена: ${errorMessage(caught)}`;
      } finally {
        this.pickInstructions.invalidateRequestInstruction(parsed.requestId);
      }
      try {
        await this.auditLog.write({
          userId: user.id,
          action: 'administration.technical-work.repair-route',
          entity: 'ClientRequest',
          entityId: parsed.requestId,
          payload: {
            issueId,
            category: parsed.category,
            objectCode: parsed.objectCode,
            issuesBefore: before.summary.issues,
            issuesAfter: after?.summary.issues ?? null,
            repairedTasks: selection.repairedTasks,
            postCheckWarning: postCheckWarning || null,
          },
        });
      } catch (caught) {
        postCheckWarning += ` Запись дополнительного журнала не завершена: ${errorMessage(caught)}`;
      }
      const issueRemains = after ? routeAuditHasIssue(after, parsed.category, parsed.objectCode) : true;
      return {
        applied: true,
        issueId,
        action,
        verified: Boolean(after) && !issueRemains,
        message: !after
          ? `Маршрут заявки пересчитан.${postCheckWarning}`
          : issueRemains
            ? `Маршрут заявки №${String(after.request.number).padStart(6, '0')} пересчитан, но эта проблема требует физической проверки склада.${postCheckWarning}`
            : `Проблема заявки №${String(after.request.number).padStart(6, '0')} устранена и повторной проверкой не обнаружена.${postCheckWarning}`,
      };
    }

    if (action === 'RETURN_TO_STOCK' || action === 'MANAGER_CONFIRMED') {
      const parsed = parseStatusIssueId(issueId);
      if (!parsed) throw new BadRequestException('Эта проблема не относится к статусу маркетплейса.');
      // FIX: Confirmation is a server-side safety boundary, not only a disabled web button.
      const expectedConfirmation = action === 'RETURN_TO_STOCK' ? 'ВЕРНУТЬ' : 'ПОДТВЕРДИТЬ';
      if (String(body.confirmation ?? '').trim().toLocaleUpperCase('ru-RU') !== expectedConfirmation) {
        throw new BadRequestException(`Подтвердите действие словом «${expectedConfirmation}».`);
      }
      const task = await this.prisma.fbsTsdAssembly.findUnique({ where: { id: parsed.taskId } });
      if (!task || task.requestId !== parsed.requestId || task.status !== 'RETURN_REQUIRED') {
        throw new BadRequestException('Проблема уже исчезла или изменилась. Обновите анализ.');
      }
      const comment = String(body.comment ?? '').trim();
      if (action === 'MANAGER_CONFIRMED' && !comment) {
        throw new BadRequestException('Для подтверждения решения менеджера нужен комментарий.');
      }
      const result = await this.marketplaceConnections.resolveFbsSyncConflict(
        parsed.requestId,
        parsed.taskId,
        {
          action: action === 'RETURN_TO_STOCK'
            ? FbsSyncConflictResolutionAction.RETURN_TO_STOCK
            : FbsSyncConflictResolutionAction.MANAGER_CONFIRMED,
          comment: comment || undefined,
        },
        user,
      );
      let after: { status: string } | null = null;
      let postCheckWarning = '';
      try {
        after = await this.prisma.fbsTsdAssembly.findUnique({
          where: { id: parsed.taskId },
          select: { status: true },
        });
        await this.auditLog.write({
          userId: user.id,
          action: `administration.technical-work.${action.toLowerCase()}`,
          entity: 'FbsTsdAssembly',
          entityId: parsed.taskId,
          payload: { issueId, requestId: parsed.requestId, comment: comment || null },
        });
      } catch (caught) {
        // resolveFbsSyncConflict writes its own audit inside the stock transaction.
        postCheckWarning = ` Повторная проверка раздела не завершена: ${errorMessage(caught)}`;
      }
      return {
        applied: true,
        issueId,
        action,
        verified: Boolean(after) && after?.status !== 'RETURN_REQUIRED',
        message: `${String((result as { message?: string }).message ?? 'Решение применено. ')}${postCheckWarning}`.trim(),
      };
    }

    throw new BadRequestException('Это действие не разрешено в разделе технических работ.');
  }

  // ADDED: Bulk repair reuses the same guarded single-item operation and groups route work by request.
  async applyBulk(
    body: {
      category?: string;
      issueIds?: unknown;
      action?: string;
      confirmation?: string;
      comment?: string;
    },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    if (user.isDemo) throw new ForbiddenException('Технические исправления недоступны в демо-режиме.');
    const category = this.category(body.category);
    const issueIds = [...new Set(
      (Array.isArray(body.issueIds) ? body.issueIds : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    )];
    if (issueIds.length === 0) throw new BadRequestException('Не выбраны проблемы для массового исправления.');
    if (issueIds.length > 200) throw new BadRequestException('За один запуск можно исправить не более 200 проблем.');
    const action = String(body.action ?? '').trim() as TechnicalWorkActionId;
    const expectedConfirmation = confirmationForAction(action);
    if (!expectedConfirmation) throw new BadRequestException('Это действие не разрешено для массового исправления.');
    if (String(body.confirmation ?? '').trim().toLocaleUpperCase('ru-RU') !== expectedConfirmation) {
      throw new BadRequestException(`Подтвердите действие словом «${expectedConfirmation}».`);
    }

    // FIX: Preflight uses a fresh diagnosis, so stale selections never reach a mutation.
    const before = await this.diagnose(category, user);
    const currentById = new Map(before.issues.map((issue) => [issue.id, issue]));
    const preliminaryResults: Array<{
      issueIds: string[];
      applied: boolean;
      verified: boolean;
      message: string;
    }> = [];
    const eligible: TechnicalWorkIssue[] = [];
    for (const issueId of issueIds) {
      const issue = currentById.get(issueId);
      if (!issue) {
        preliminaryResults.push({
          issueIds: [issueId],
          applied: false,
          verified: true,
          message: 'Проблема уже исчезла или изменилась до запуска.',
        });
      } else if (!issue.actions.some((candidate) => candidate.id === action)) {
        preliminaryResults.push({
          issueIds: [issueId],
          applied: false,
          verified: false,
          message: 'Выбранное действие недоступно для этой проблемы.',
        });
      } else {
        eligible.push(issue);
      }
    }

    const groups = groupBulkIssues(eligible);
    const operationResults: typeof preliminaryResults = [];
    for (const issues of groups.values()) {
      const representative = issues[0]!;
      try {
        const result = await this.apply({
          issueId: representative.id,
          action,
          confirmation: expectedConfirmation,
          comment: body.comment,
        }, user);
        operationResults.push({
          issueIds: issues.map((issue) => issue.id),
          applied: result.applied,
          verified: result.verified,
          message: result.message,
        });
      } catch (caught) {
        operationResults.push({
          issueIds: issues.map((issue) => issue.id),
          applied: false,
          verified: false,
          message: errorMessage(caught),
        });
      }
    }

    let after: Awaited<ReturnType<AdministrationTechnicalWorkService['diagnose']>> | null = null;
    let verificationWarning = '';
    try {
      after = await this.diagnose(category, user);
    } catch (caught) {
      verificationWarning = `Повторный анализ не завершён: ${errorMessage(caught)}`;
    }
    const remainingIds = new Set(after?.issues.map((issue) => issue.id) ?? []);
    const results = [...preliminaryResults, ...operationResults].map((result) => ({
      ...result,
      verified: after
        ? result.issueIds.every((issueId) => !remainingIds.has(issueId))
        : result.verified,
    }));
    const appliedOperations = operationResults.filter((result) => result.applied).length;
    const failedIssues = results.reduce(
      (total, result) => total + (!result.verified ? result.issueIds.length : 0),
      0,
    );
    const verifiedIssues = results.reduce(
      (total, result) => total + (result.verified ? result.issueIds.length : 0),
      0,
    );
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.technical-work.bulk',
      entity: 'TechnicalWork',
      entityId: category,
      payload: {
        action,
        requestedIssues: issueIds.length,
        operations: groups.size,
        appliedOperations,
        failedIssues,
        verifiedIssues,
        verificationWarning: verificationWarning || null,
      },
    }).catch(() => undefined);
    return {
      category,
      action,
      requestedIssues: issueIds.length,
      operations: groups.size,
      applied: appliedOperations,
      failed: failedIssues,
      verified: verifiedIssues,
      verificationWarning: verificationWarning || null,
      results,
      diagnosis: after,
    };
  }

  private async routeIssues(category: Exclude<TechnicalWorkCategory, 'MARKETPLACE_STATUS'>, user: AuthUser) {
    const requests = await this.fbsRequestBoxAudits.listActiveRequests(user);
    const audits: FbsRequestBoxAudit[] = [];
    // Bound concurrency protects the API and database while still checking the whole active queue.
    for (let offset = 0; offset < requests.length; offset += 4) {
      const batch = requests.slice(offset, offset + 4);
      const settled = await Promise.allSettled(
        batch.map((request) => this.fbsRequestBoxAudits.auditRequest(request.id, user)),
      );
      // FIX: Never turn a failed audit into a false “no problems found” result.
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
      settled.forEach((result) => {
        if (result.status === 'fulfilled') audits.push(result.value);
      });
    }
    return audits.flatMap((audit) => routeIssuesFromAudit(audit, category));
  }

  private async marketplaceStatusIssues(user: AuthUser): Promise<TechnicalWorkIssue[]> {
    const requestIds = await this.visibleOpenRequestIds(user);
    if (requestIds.length === 0) return [];
    const tasks = await this.prisma.fbsTsdAssembly.findMany({
      where: {
        requestId: { in: requestIds },
        OR: [
          { status: 'RETURN_REQUIRED' },
          { marketplaceSubmitError: { not: null } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const requests = await this.prisma.clientRequest.findMany({
      where: { id: { in: [...new Set(tasks.map((task) => task.requestId))] } },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        client: { select: { id: true, code: true, name: true } },
      },
    });
    const requestById = new Map(requests.map((request) => [request.id, request]));
    return tasks.map((task) => {
      const returnRequired = task.status === 'RETURN_REQUIRED';
      return {
        id: `STATUS:${task.requestId}:${task.id}`,
        category: 'MARKETPLACE_STATUS',
        severity: returnRequired ? 'CRITICAL' : 'WARNING',
        title: returnRequired
          ? `Заказ ${task.orderId} требует решения менеджера`
          : `Заказ ${task.orderId} не передан в маркетплейс`,
        explanation: task.marketplaceSubmitError || task.errorMessage || 'Маркетплейс не подтвердил следующий статус заказа.',
        recommendation: returnRequired
          ? 'Сверьте физический товар и выберите: вернуть его в остаток либо подтвердить решение менеджера.'
          : 'Повторите штатное действие в заявке после устранения причины. Автоматического безопасного ремонта для этого ответа маркетплейса нет.',
        request: requestById.get(task.requestId) ?? null,
        orderId: task.orderId,
        objectCode: null,
        state: task.status,
        evidence: [
          `Статус задания: ${task.status}`,
          `Маркетплейс: ${task.marketplace}`,
          task.marketplaceSubmitError ? `Ответ маркетплейса: ${task.marketplaceSubmitError}` : '',
        ].filter(Boolean),
        actions: returnRequired
          ? [
              {
                id: 'RETURN_TO_STOCK',
                label: 'Вернуть товар на склад',
                tone: 'PRIMARY',
                confirmation: 'ВЕРНУТЬ',
                requiresComment: false,
              },
              {
                id: 'MANAGER_CONFIRMED',
                label: 'Подтвердить решение менеджера',
                tone: 'DANGER',
                confirmation: 'ПОДТВЕРДИТЬ',
                requiresComment: true,
              },
            ] as TechnicalWorkAction[]
          : [],
      };
    });
  }

  private async requestsAffectedByBoxes(clientId: string, boxCodes: string[]) {
    const normalized = new Set(boxCodes.map(normalizeWarehouseCode));
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId,
        type: ClientRequestType.OUTBOUND,
        status: { in: OPEN_REQUEST_STATUSES },
        fbsOrderLinks: { some: {} },
      },
      select: { id: true, number: true },
    });
    if (requests.length === 0) return [];
    const tasks = await this.prisma.fbsTsdAssembly.findMany({
      where: { requestId: { in: requests.map((request) => request.id) } },
      select: {
        requestId: true,
        boxCode: true,
        reservedBoxCode: true,
        storageBoxes: true,
      },
    });
    const affectedIds = new Set<string>();
    for (const task of tasks) {
      const taskCodes = [
        task.boxCode,
        task.reservedBoxCode,
        ...jsonStorageBoxCodes(task.storageBoxes),
      ].map(normalizeWarehouseCode);
      if (taskCodes.some((code) => normalized.has(code))) affectedIds.add(task.requestId);
    }
    return requests.filter((request) => affectedIds.has(request.id)).sort((left, right) => left.number - right.number);
  }

  private async visibleOpenRequestIds(user: AuthUser) {
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        type: ClientRequestType.OUTBOUND,
        status: { in: OPEN_REQUEST_STATUSES },
        client: { isDemo: Boolean(user.isDemo) },
      },
      select: { id: true },
    });
    return requests.map((request) => request.id);
  }

  private category(value: string | undefined): TechnicalWorkCategory {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (['REQUESTS', 'PALLET_SORTS', 'BOXES', 'MARKETPLACE_STATUS'].includes(normalized)) {
      return normalized as TechnicalWorkCategory;
    }
    throw new BadRequestException('Неизвестная категория технических работ.');
  }

  private assertOwner(user: AuthUser) {
    if (!user.administrationEnabled) {
      throw new ForbiddenException('Раздел технических работ доступен только владельцу WMS.');
    }
  }
}

function routeIssuesFromAudit(
  audit: FbsRequestBoxAudit,
  category: Exclude<TechnicalWorkCategory, 'MARKETPLACE_STATUS'>,
): TechnicalWorkIssue[] {
  if (category === 'REQUESTS') {
    const issues: TechnicalWorkIssue[] = [];
    if (audit.taskSummary.total === 0 || audit.taskSummary.outstanding === 0 && audit.taskSummary.completed === 0) {
      issues.push({
        id: `ROUTE:REQUESTS:${audit.request.id}:NO_TSD_TASKS`,
        category,
        severity: 'CRITICAL',
        title: `Заявка №${String(audit.request.number).padStart(6, '0')} не имеет готовой очереди ТСД`,
        explanation: 'У активной FBS-заявки нет созданных или доступных заданий сборки.',
        recommendation: 'Пересчитать состав, живые остатки и очередь заданий этой заявки.',
        request: audit.request,
        orderId: null,
        objectCode: null,
        state: 'NO_TSD_TASKS',
        evidence: [
          `Всего заданий: ${audit.taskSummary.total}`,
          `Ожидают сборки: ${audit.taskSummary.outstanding}`,
          `Завершено: ${audit.taskSummary.completed}`,
        ],
        actions: [ROUTE_REPAIR_ACTION],
      });
    }
    if (audit.summary.issues > 0) {
      issues.push({
        id: `ROUTE:REQUESTS:${audit.request.id}:ROUTE_MISMATCH`,
        category,
        severity: 'WARNING',
        title: `Маршрут заявки №${String(audit.request.number).padStart(6, '0')} содержит ошибки`,
        explanation: `Проблемных источников: ${audit.summary.issues} из ${audit.summary.planBoxes}.`,
        recommendation: 'Пересчитать подсказки ТСД по живым остаткам и актуальным резервам.',
        request: audit.request,
        orderId: null,
        objectCode: null,
        state: 'ROUTE_MISMATCH',
        evidence: routeSummaryEvidence(audit),
        actions: [ROUTE_REPAIR_ACTION],
      });
    }
    return deduplicateIssues(issues);
  }

  return audit.rows
    .filter((row) => category === 'PALLET_SORTS' ? row.state === 'NOT_ON_PALLET_SORT' : BOX_STATES.has(row.state))
    .map((row): TechnicalWorkIssue => ({
      id: `ROUTE:${category}:${audit.request.id}:${encodeURIComponent(row.code)}`,
      category,
      severity: ['MISSING', 'ARCHIVED'].includes(row.state) ? 'CRITICAL' : 'WARNING',
      title: category === 'PALLET_SORTS'
        ? `Короб ${row.code} не установлен на паллет-сорт`
        : `Короб ${row.code}: ${row.stateLabel}`,
      explanation: row.recommendation,
      recommendation: 'Сначала пересчитайте маршрут. Если проблема останется, выполните указанную физическую проверку короба.',
      request: audit.request,
      orderId: null,
      objectCode: row.code,
      state: row.state,
      evidence: [
        `Паллет-сорт: ${row.palletCode ?? 'не указан'}`,
        `Доступно: ${row.availableUnits}; зарезервировано: ${row.reservedUnits}; свободно: ${row.freeUnits}; нужно: ${row.requiredUnits}`,
        row.externalOrdersCount > 0 ? `Чужих резервов: ${row.externalOrdersCount}` : '',
      ].filter(Boolean),
      actions: [ROUTE_REPAIR_ACTION],
    }));
}

function routeSummaryEvidence(audit: FbsRequestBoxAudit) {
  return [
    audit.summary.notOnPalletSort ? `Без паллет-сорта: ${audit.summary.notOnPalletSort}` : '',
    audit.summary.blockedByReservations ? `Заблокировано резервами: ${audit.summary.blockedByReservations}` : '',
    audit.summary.skuOrQuantityMismatch ? `Не совпадает SKU/количество: ${audit.summary.skuOrQuantityMismatch}` : '',
    audit.summary.empty ? `Пустых коробов: ${audit.summary.empty}` : '',
    audit.summary.archived ? `Архивных коробов: ${audit.summary.archived}` : '',
    audit.summary.missing ? `Отсутствующих коробов: ${audit.summary.missing}` : '',
  ].filter(Boolean);
}

function routeAuditHasIssue(
  audit: FbsRequestBoxAudit,
  category: Exclude<TechnicalWorkCategory, 'MARKETPLACE_STATUS'>,
  objectCode: string | null,
) {
  if (category === 'REQUESTS') {
    return audit.summary.issues > 0 ||
      audit.taskSummary.total === 0 ||
      audit.taskSummary.outstanding === 0 && audit.taskSummary.completed === 0;
  }
  return audit.rows.some((row) =>
    row.code === objectCode &&
    (category === 'PALLET_SORTS' ? row.state === 'NOT_ON_PALLET_SORT' : BOX_STATES.has(row.state)),
  );
}

function parseRouteIssueId(value: string) {
  const match = /^ROUTE:(REQUESTS|PALLET_SORTS|BOXES):([^:]+):(.*)$/.exec(value);
  if (!match) return null;
  return {
    category: match[1] as Exclude<TechnicalWorkCategory, 'MARKETPLACE_STATUS'>,
    requestId: match[2]!,
    objectCode: match[3] && match[3] !== '-' ? decodeURIComponent(match[3]) : null,
  };
}

function parseStatusIssueId(value: string) {
  const match = /^STATUS:([^:]+):([^:]+)$/.exec(value);
  return match ? { requestId: match[1]!, taskId: match[2]! } : null;
}

function deduplicateIssues(rows: TechnicalWorkIssue[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : 'неизвестная ошибка';
}

function normalizeWarehouseCode(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru-RU');
}

function normalizeWarehouseCodes(value: unknown) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\r\n,;]+/);
  return [...new Set(source.map(normalizeWarehouseCode).filter(Boolean))];
}

function jsonStorageBoxCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object' || !('code' in row)) return [];
    const code = normalizeWarehouseCode((row as { code?: unknown }).code);
    return code ? [code] : [];
  });
}

function confirmationForAction(action: TechnicalWorkActionId) {
  if (action === 'REPAIR_REQUEST_ROUTE') return 'ИСПРАВИТЬ';
  if (action === 'RETURN_TO_STOCK') return 'ВЕРНУТЬ';
  if (action === 'MANAGER_CONFIRMED') return 'ПОДТВЕРДИТЬ';
  return null;
}

function groupBulkIssues(issues: TechnicalWorkIssue[]) {
  const groups = new Map<string, TechnicalWorkIssue[]>();
  for (const issue of issues) {
    const route = parseRouteIssueId(issue.id);
    const status = parseStatusIssueId(issue.id);
    const key = route ? `ROUTE:${route.requestId}` : status ? `STATUS:${status.taskId}` : issue.id;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return groups;
}
