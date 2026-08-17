import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType } from '@prisma/client';
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
        critical: issues.filter((issue) => issue.severity === 'CRITICAL').length,
        actionable: issues.filter((issue) => issue.actions.length > 0).length,
      },
      issues,
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
