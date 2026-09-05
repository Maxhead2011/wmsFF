import { appendFbsAttemptHistory } from '../../common/shipment-history/fbs-attempt-history';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientRequestEventType,
  InventorySessionStatus,
  InventorySessionType,
  MarketplaceType,
  Prisma,
  TsdOperationStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { AuditLogService } from '../../common/audit/audit-log.service';
import {
  BOX_CODE_POLICY_SETTING,
  BoxCodePolicyService,
  DEFAULT_BOX_CODE_POLICY,
  normalizeBoxCodePolicy,
  type BoxCodePolicy,
} from '../../common/boxes/box-code-policy.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SystemSettingsService } from '../../common/settings/system-settings.service';
import type { AuthUser } from '../auth/auth.types';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { FbsRequestBoxAuditService } from '../stock/fbs-request-box-audit.service';
import { PickInstructionService } from '../stock/pick-instruction.service';
import { parseWbStockFile } from './wb-stock-comparison';

export const ADMINISTRATION_OWNER_IDS_SETTING = 'administration.ownerUserIds';
export const WORKSPACE_VISIBILITY_SETTING = 'ui.workspaceVisibility';
export const ADMINISTRATION_AI_SETTING = 'administration.ai';

const WORKSPACE_IDS = [
  'overview',
  'cabinet',
  'analytics',
  'access',
  'directories',
  'imports',
  'logistics',
  'warehouse',
  'storage-zones',
  'inventory',
  'turnover',
  'requests',
  'contracts',
  'fbs',
  'monitoring',
  'relabeling',
  'catalog',
  'billing',
  'services',
  'own-companies',
  'print',
  'service',
  'debug',
  'data',
  'administration',
] as const;

type WorkspaceId = (typeof WORKSPACE_IDS)[number];

type SettingDefinition = {
  key: string;
  group: string;
  title: string;
  description: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  defaultValue: unknown;
  editable: boolean;
  secret?: boolean;
};

type AdministrationPerformanceSnapshot = {
  sizeMb: number;
  liveRows: number;
  deadRows: number;
};

type AdministrationPerformanceOptimization = {
  status: 'COMPLETED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  cleanup: {
    expiredMobileCommands: number;
    expiredMobileSessions: number;
  };
  runtime: {
    expiredCacheEntries: number;
    retainedCacheEntries: number;
    memoryBeforeMb: number;
    memoryAfterMb: number;
  };
  files: {
    roots: string[];
    scanned: number;
    deleted: number;
    freedBytes: number;
    freedMb: number;
  };
  database: {
    statisticsUpdated: true;
    before: AdministrationPerformanceSnapshot;
    after: AdministrationPerformanceSnapshot;
  };
};

const AI_DEFAULTS = {
  enabled: false,
  provider: 'OPENAI',
  model: 'gpt-5.6-sol',
  approvalMode: 'ALWAYS',
  allowAutomatedSettings: true,
  allowCodeChanges: false,
  locations: ['ADMINISTRATION'],
  systemPrompt:
    'Сначала анализируй запрос владельца WMS, затем возвращай структурированный план, риски, проверку и план отката. Не выполняй произвольный код и разрушительные действия.',
};

const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: BOX_CODE_POLICY_SETTING,
    group: 'Склад',
    title: 'Префиксы коробов и видов поставки',
    description:
      'Префиксы коробов, белого и серого прихода, паллетов, ячеек, мест на стеллажах, стеллажей и боксов хранения.',
    risk: 'HIGH',
    defaultValue: DEFAULT_BOX_CODE_POLICY,
    editable: true,
  },
  {
    key: 'operations.autoRefreshSeconds',
    group: 'Производительность',
    title: 'Интервал фонового обновления',
    description: 'Общий рекомендуемый интервал обновления оперативных экранов.',
    risk: 'MEDIUM',
    defaultValue: 10,
    editable: true,
  },
  {
    key: 'inventory.reviewRefreshSeconds',
    group: 'Инвентаризация',
    title: 'Обновление актуализации',
    description: 'Интервал тихого обновления экрана актуализации коробов.',
    risk: 'LOW',
    defaultValue: 5,
    editable: true,
  },
  {
    key: 'marketplace.diagnostics',
    group: 'Маркетплейсы',
    title: 'Автодиагностика API',
    description: 'Периодичность и параметры проверки подключений WB и Ozon.',
    risk: 'MEDIUM',
    defaultValue: { enabled: true, intervalMinutes: 15, notifyOwners: true },
    editable: true,
  },
  {
    key: ADMINISTRATION_AI_SETTING,
    group: 'ИИ',
    title: 'Встроенный ИИ-помощник',
    description:
      'Провайдер, модель, места использования и политика подтверждения изменений.',
    risk: 'HIGH',
    defaultValue: AI_DEFAULTS,
    editable: true,
    secret: false,
  },
  {
    key: WORKSPACE_VISIBILITY_SETTING,
    group: 'Интерфейс',
    title: 'Видимость разделов',
    description: 'Индивидуальные скрытия плиток и разделов для пользователей.',
    risk: 'MEDIUM',
    defaultValue: {},
    editable: false,
  },
];

@Injectable()
export class AdministrationService {
  private performanceOptimization: Promise<AdministrationPerformanceOptimization> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly boxCodes: BoxCodePolicyService,
    private readonly auditLog: AuditLogService,
    private readonly marketplaceConnections: MarketplaceConnectionsService,
    private readonly pickInstructions: PickInstructionService,
    private readonly fbsRequestBoxAudits: FbsRequestBoxAuditService,
  ) {}

  async listFbsRequestErrors(user: AuthUser) {
    this.assertOwner(user);
    return this.fbsRequestBoxAudits.listActiveRequests(user);
  }

  async checkFbsRequestErrors(requestId: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const normalizedRequestId = requestId?.trim();
    if (!normalizedRequestId) throw new BadRequestException('Выберите FBS-заявку для проверки.');
    return this.fbsRequestBoxAudits.auditRequest(normalizedRequestId, user);
  }

  async repairFbsRequestErrors(
    requestId: string | undefined,
    confirmation: string | undefined,
    user: AuthUser,
  ) {
    this.assertOwner(user);
    if (user.isDemo) throw new ForbiddenException('Исправление рабочих FBS-заявок недоступно в демо-режиме.');
    const normalizedRequestId = requestId?.trim();
    if (!normalizedRequestId) throw new BadRequestException('Выберите FBS-заявку для исправления.');
    if (confirmation?.trim().toLocaleUpperCase('ru-RU') !== 'ИСПРАВИТЬ') {
      throw new BadRequestException('Подтвердите действие словом «ИСПРАВИТЬ».');
    }

    const before = await this.fbsRequestBoxAudits.auditRequest(normalizedRequestId, user);
    const selection = await this.marketplaceConnections.repairFbsRequestSelection(normalizedRequestId, user);
    await this.pickInstructions.refreshRequestInstruction(normalizedRequestId, user);
    this.pickInstructions.invalidateRequestInstruction(normalizedRequestId);
    const after = await this.fbsRequestBoxAudits.auditRequest(normalizedRequestId, user);

    await this.auditLog.write({
      userId: user.id,
      action: 'administration.fbs-request-errors.repair',
      entity: 'ClientRequest',
      entityId: normalizedRequestId,
      payload: {
        requestNumber: before.request.number,
        issuesBefore: before.summary.issues,
        issuesAfter: after.summary.issues,
        repairedTasks: selection.repairedTasks,
        preservedStartedTasks: selection.preservedStartedTasks,
      },
    });

    return {
      repairedAt: new Date().toISOString(),
      selection,
      before,
      after,
      message:
        after.summary.issues === 0
          ? `Заявка №${String(after.request.number).padStart(6, '0')} исправлена: список коробов полностью актуален.`
          : `Заявка №${String(after.request.number).padStart(6, '0')} пересчитана. Автоматически исправлено: ${Math.max(0, before.summary.issues - after.summary.issues)}; осталось расхождений: ${after.summary.issues}.`,
    };
  }

  async optimizePerformance(user: AuthUser) {
    this.assertOwner(user);
    if (user.isDemo) {
      throw new ForbiddenException('Оптимизация сервера недоступна в демонстрационном режиме.');
    }
    if (this.performanceOptimization) {
      throw new ConflictException('Оптимизация WMS уже выполняется. Дождитесь её завершения.');
    }

    this.performanceOptimization = this.runPerformanceOptimization(user);
    try {
      return await this.performanceOptimization;
    } finally {
      this.performanceOptimization = null;
    }
  }

  async listTsdWorkloads(user: AuthUser) {
    this.assertOwner(user);
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const [devices, fbsTasks, operations] = await Promise.all([
      this.prisma.tsdDevice.findMany({
        where: { user: { isDemo: Boolean(user.isDemo) } },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.fbsTsdAssembly.findMany({
        where: { status: 'IN_PROGRESS' },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.tsdOperation.findMany({
        where: {
          status: TsdOperationStatus.ACCEPTED,
          operationType: { in: ['assembly_stage', 'box_search_scan', 'move_scan', 'administration_release'] },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 1500,
      }),
    ]);

    const requestIds = new Set<string>();
    for (const task of fbsTasks) requestIds.add(task.requestId);
    for (const operation of operations) {
      const requestId = administrationOperationRequestId(operation.operationKey, operation.operationType, administrationJsonRecord(operation.payload));
      if (requestId) requestIds.add(requestId);
    }
    const requests = requestIds.size
      ? await this.prisma.clientRequest.findMany({
          where: { id: { in: [...requestIds] }, client: { isDemo: Boolean(user.isDemo) } },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            clientId: true,
            client: { select: { id: true, code: true, name: true } },
          },
        })
      : [];
    const requestsById = new Map(requests.map((request) => [request.id, request]));
    const rowsByDevice = new Map<string, Array<Record<string, unknown>>>();
    const pushWorkload = (deviceCode: string, workload: Record<string, unknown>) => {
      const canonicalDeviceCode = administrationCanonicalTsdDeviceCode(deviceCode);
      const rows = rowsByDevice.get(canonicalDeviceCode) ?? [];
      rows.push(workload);
      rowsByDevice.set(canonicalDeviceCode, rows);
    };

    for (const task of fbsTasks) {
      const request = requestsById.get(task.requestId);
      if (!request) continue;
      const protectedReason = administrationProtectedFbsReason(task);
      pushWorkload(task.deviceCode, {
        id: task.id,
        kind: 'FBS_ORDER',
        request: administrationRequestSummary(request),
        orderId: task.orderId,
        stage: 'fbs-assembly',
        stageLabel: 'Сборка FBS',
        productName: task.productName,
        article: task.article,
        sourceBoxCode: task.boxCode ?? task.reservedBoxCode,
        workerName: task.workerName,
        updatedAt: task.updatedAt.toISOString(),
        hasScans: Boolean(task.boxId || task.boxCode || task.sourceBarcode || task.barcode || task.kiz),
        protected: Boolean(protectedReason),
        protectedReason,
      });
    }

    const latestOperationByWorker = new Map<string, (typeof operations)[number]>();
    for (const operation of operations) {
      const payload = administrationJsonRecord(operation.payload);
      const requestId = administrationOperationRequestId(operation.operationKey, operation.operationType, payload);
      if (!requestId || !requestsById.has(requestId)) continue;
      const deviceCode = administrationText(payload, 'deviceCode') ?? operation.deviceId;
      const key = `${requestId}|${deviceCode}`;
      if (!latestOperationByWorker.has(key)) latestOperationByWorker.set(key, operation);
    }
    for (const operation of latestOperationByWorker.values()) {
      if (operation.operationType === 'administration_release') continue;
      const payload = administrationJsonRecord(operation.payload);
      const requestId = administrationOperationRequestId(operation.operationKey, operation.operationType, payload);
      const request = requestId ? requestsById.get(requestId) : null;
      if (!request) continue;
      const deviceCode = administrationText(payload, 'deviceCode') ?? operation.deviceId;
      const stage = administrationOperationStage(operation.operationType, payload);
      pushWorkload(deviceCode, {
        id: `${request.id}:${deviceCode}`,
        kind: 'REQUEST_SESSION',
        request: administrationRequestSummary(request),
        orderId: null,
        stage,
        stageLabel: administrationStageLabel(stage),
        productName: null,
        article: null,
        sourceBoxCode: administrationText(payload, 'boxCode') ?? administrationText(payload, 'normalizedBoxCode'),
        workerName: administrationText(payload, 'workerName') ?? administrationText(payload, 'operatorName'),
        updatedAt: operation.updatedAt.toISOString(),
        hasScans: operation.operationType !== 'assembly_stage' || stage !== 'open',
        protected: false,
        protectedReason: null,
      });
    }

    const devicesByCode = new Map<string, (typeof devices)[number]>();
    for (const device of devices) {
      const canonicalDeviceCode = administrationCanonicalTsdDeviceCode(device.code);
      const current = devicesByCode.get(canonicalDeviceCode);
      const deviceSeenAt = device.lastSeenAt?.getTime() ?? 0;
      const currentSeenAt = current?.lastSeenAt?.getTime() ?? 0;
      const preferBaseCode = !device.code.includes('@') && Boolean(current?.code.includes('@'));
      if (!current || deviceSeenAt > currentSeenAt || (deviceSeenAt === currentSeenAt && preferBaseCode)) {
        devicesByCode.set(canonicalDeviceCode, device);
      }
    }
    const allDeviceCodes = new Set([...devicesByCode.keys(), ...rowsByDevice.keys()]);
    const onlineCutoff = Date.now() - 10 * 60 * 1000;
    const resultDevices = [...allDeviceCodes]
      .map((deviceCode) => {
        const device = devicesByCode.get(deviceCode);
        const workloads = (rowsByDevice.get(deviceCode) ?? []).sort((a, b) =>
          String(b.updatedAt).localeCompare(String(a.updatedAt)),
        );
        return {
          deviceCode,
          deviceId: device?.id ?? null,
          deviceName: device?.name ?? null,
          status: device?.status ?? null,
          user: device?.user ?? null,
          lastSeenAt: device?.lastSeenAt?.toISOString() ?? null,
          online: Boolean(device?.lastSeenAt && device.lastSeenAt.getTime() >= onlineCutoff),
          workloads,
        };
      })
      .sort((a, b) => Number(b.workloads.length > 0) - Number(a.workloads.length > 0) || a.deviceCode.localeCompare(b.deviceCode));
    const busyDevices = resultDevices.filter((device) => device.workloads.length > 0);
    const workloads = busyDevices.flatMap((device) => device.workloads);
    return {
      checkedAt: new Date().toISOString(),
      summary: {
        registeredDevices: devicesByCode.size,
        onlineDevices: resultDevices.filter((device) => device.online).length,
        busyDevices: busyDevices.length,
        tasks: workloads.length,
        protectedTasks: workloads.filter((item) => item.protected).length,
      },
      devices: resultDevices,
    };
  }

  async listTsdMonitor(user: AuthUser, statisticsDate?: string) {
    const base = await this.listTsdWorkloads(user);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const statisticsPeriod = administrationMoscowDayRange(statisticsDate);
    const requestIds = [...new Set(
      base.devices.flatMap((device) => device.workloads.map((workload) => String(workload.request && (workload.request as { id?: string }).id || ''))),
    )].filter(Boolean);
    const [heartbeats, errors, activity, fbsTasks, completedFbsTasks] = await Promise.all([
      this.prisma.tsdOperation.findMany({
        where: { operationType: 'monitor_heartbeat' },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
      this.prisma.tsdOperation.findMany({
        where: {
          createdAt: { gte: since },
          AND: [
            { operationType: { not: 'monitor_command' } },
            {
              OR: [
                { operationType: 'monitor_error' },
                { status: { in: [TsdOperationStatus.REJECTED, TsdOperationStatus.NEEDS_REVIEW] } },
              ],
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.tsdOperation.findMany({
        where: {
          createdAt: { gte: since },
          operationType: { notIn: ['monitor_heartbeat', 'monitor_command'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      requestIds.length
        ? this.prisma.fbsTsdAssembly.findMany({
            where: { requestId: { in: requestIds } },
            select: { requestId: true, status: true, itemCount: true },
          })
        : Promise.resolve([]),
      this.prisma.fbsTsdAssembly.findMany({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: statisticsPeriod.from, lt: statisticsPeriod.to },
          workerUserId: { not: null },
        },
        select: {
          id: true,
          requestId: true,
          orderId: true,
          productName: true,
          article: true,
          itemCount: true,
          deviceCode: true,
          workerUserId: true,
          workerName: true,
          startedAt: true,
          completedAt: true,
        },
        orderBy: { completedAt: 'desc' },
        take: 5000,
      }),
    ]);

    // FIX: keep both physical attempts in their original day/worker statistics.
    await appendFbsAttemptHistory(this.prisma, completedFbsTasks, {
      completedAt: { gte: statisticsPeriod.from, lt: statisticsPeriod.to }, workerUserId: { not: null },
    });
    const statisticRequestIds = [...new Set(completedFbsTasks.map((task) => task.requestId))];
    const statisticRequests = statisticRequestIds.length
      ? await this.prisma.clientRequest.findMany({
          where: {
            id: { in: statisticRequestIds },
            client: { isDemo: Boolean(user.isDemo) },
          },
          select: {
            id: true,
            number: true,
            client: { select: { name: true } },
          },
        })
      : [];
    const statisticRequestsById = new Map(statisticRequests.map((request) => [request.id, request]));
    const pickerStatisticsByWorker = new Map<string, {
      workerId: string | null;
      workerName: string;
      deviceCodes: Set<string>;
      orders: number;
      units: number;
      measuredOrders: number;
      totalDurationSeconds: number;
      orderDetails: Array<Record<string, unknown>>;
    }>();
    for (const task of completedFbsTasks) {
      const request = statisticRequestsById.get(task.requestId);
      if (!request || !task.completedAt) continue;
      const workerName = task.workerName?.trim() || 'Сотрудник не определён';
      const workerKey = task.workerUserId || workerName.toLocaleLowerCase('ru-RU');
      const row = pickerStatisticsByWorker.get(workerKey) ?? {
        workerId: task.workerUserId,
        workerName,
        deviceCodes: new Set<string>(),
        orders: 0,
        units: 0,
        measuredOrders: 0,
        totalDurationSeconds: 0,
        orderDetails: [],
      };
      const durationSeconds = task.startedAt
        ? Math.max(0, Math.round((task.completedAt.getTime() - task.startedAt.getTime()) / 1000))
        : null;
      row.deviceCodes.add(task.deviceCode);
      row.orders += 1;
      row.units += Math.max(1, task.itemCount);
      if (durationSeconds !== null) {
        row.measuredOrders += 1;
        row.totalDurationSeconds += durationSeconds;
      }
      row.orderDetails.push({
        taskId: task.id,
        orderId: task.orderId,
        requestId: task.requestId,
        requestNumber: request.number,
        clientName: request.client.name,
        productName: task.productName,
        article: task.article,
        units: Math.max(1, task.itemCount),
        deviceCode: task.deviceCode,
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt.toISOString(),
        durationSeconds,
      });
      pickerStatisticsByWorker.set(workerKey, row);
    }
    const pickerWorkers = [...pickerStatisticsByWorker.values()]
      .map((row) => ({
        ...row,
        deviceCodes: [...row.deviceCodes].sort((left, right) => left.localeCompare(right, 'ru-RU')),
        averageDurationSeconds: row.measuredOrders > 0
          ? Math.round(row.totalDurationSeconds / row.measuredOrders)
          : null,
      }))
      .sort((left, right) => right.units - left.units || right.orders - left.orders || left.workerName.localeCompare(right.workerName, 'ru-RU'));

    const heartbeatByDevice = new Map<string, (typeof heartbeats)[number]>();
    for (const heartbeat of heartbeats) {
      const payload = administrationJsonRecord(heartbeat.payload);
      const deviceCode = administrationCanonicalTsdDeviceCode(
        administrationText(payload, 'deviceCode') ?? heartbeat.deviceId,
      );
      if (!heartbeatByDevice.has(deviceCode)) heartbeatByDevice.set(deviceCode, heartbeat);
    }
    const knownDeviceCodes = new Set(
      base.devices.map((device) => administrationCanonicalTsdDeviceCode(device.deviceCode)),
    );
    const heartbeatUserLogins = [...heartbeatByDevice.values()]
      .map((heartbeat) => administrationVirtualTsdLogin(heartbeat.deviceId))
      .filter((login): login is string => Boolean(login));
    const heartbeatUsers = heartbeatUserLogins.length
      ? await this.prisma.user.findMany({
          where: {
            OR: [...new Set(heartbeatUserLogins)].map((email) => ({
              email: { equals: email, mode: 'insensitive' as const },
            })),
          },
          select: { id: true, name: true, email: true, isDemo: true },
        })
      : [];
    const heartbeatUsersByLogin = new Map(
      heartbeatUsers.map((heartbeatUser) => [heartbeatUser.email.trim().toLowerCase(), heartbeatUser]),
    );
    const discoveredDevices = [...heartbeatByDevice.entries()].flatMap(([deviceCode, heartbeat]) => {
      if (knownDeviceCodes.has(deviceCode)) return [];
      const login = administrationVirtualTsdLogin(heartbeat.deviceId);
      const heartbeatUser = login ? heartbeatUsersByLogin.get(login) : null;
      if (login && (!heartbeatUser || Boolean(heartbeatUser.isDemo) !== Boolean(user.isDemo))) return [];
      if (!login && Boolean(user.isDemo)) return [];
      const state = administrationJsonRecord(heartbeat.payload);
      const heartbeatWorkerId = administrationText(state, 'workerUserId');
      const heartbeatWorkerName = administrationText(state, 'workerName');
      return [{
        deviceCode,
        deviceId: null,
        deviceName: administrationText(state, 'deviceName')
          || administrationText(state, 'workerName')
          || deviceCode.replace(/^USER:/i, ''),
        status: null,
        user: heartbeatUser
          ? { id: heartbeatUser.id, name: heartbeatUser.name, email: heartbeatUser.email }
          : heartbeatWorkerId && heartbeatWorkerName
            ? { id: heartbeatWorkerId, name: heartbeatWorkerName, email: '' }
            : null,
        lastSeenAt: heartbeat.updatedAt.toISOString(),
        online: false,
        workloads: [],
      }];
    });
    const errorsByDevice = new Map<string, Array<Record<string, unknown>>>();
    for (const error of errors) {
      const payload = administrationJsonRecord(error.payload);
      const deviceCode = administrationCanonicalTsdDeviceCode(
        administrationText(payload, 'deviceCode') ?? error.deviceId,
      );
      const rows = errorsByDevice.get(deviceCode) ?? [];
      if (rows.length < 20) {
        rows.push({
          id: error.id,
          message: error.serverMessage || administrationText(payload, 'message') || 'Ошибка ТСД без описания',
          screen: administrationText(payload, 'screenLabel') || administrationText(payload, 'screen'),
          requestId: administrationText(payload, 'requestId'),
          requestNumber: administrationNumber(payload, 'requestNumber'),
          orderId: administrationText(payload, 'orderId'),
          workerName: administrationText(payload, 'workerName'),
          clientName: administrationText(payload, 'clientName'),
          createdAt: error.createdAt.toISOString(),
          status: error.status,
        });
      }
      errorsByDevice.set(deviceCode, rows);
    }
    const activityByDevice = new Map<string, Array<Record<string, unknown>>>();
    for (const operation of activity) {
      const payload = administrationJsonRecord(operation.payload);
      const deviceCode = administrationCanonicalTsdDeviceCode(
        administrationText(payload, 'deviceCode') ?? operation.deviceId,
      );
      const rows = activityByDevice.get(deviceCode) ?? [];
      if (rows.length < 100) {
        rows.push({
          id: operation.id,
          type: operation.operationType,
          status: operation.status,
          message: operation.serverMessage,
          stage: administrationText(payload, 'stageLabel') || administrationText(payload, 'stage'),
          screen: administrationText(payload, 'screenLabel') || administrationText(payload, 'screen'),
          requestId: administrationText(payload, 'requestId'),
          requestNumber: administrationNumber(payload, 'requestNumber'),
          orderId: administrationText(payload, 'orderId'),
          workerName: administrationText(payload, 'workerName'),
          clientName: administrationText(payload, 'clientName'),
          boxCode: administrationText(payload, 'boxCode') || administrationText(payload, 'normalizedBoxCode'),
          barcode: administrationText(payload, 'barcode'),
          createdAt: operation.createdAt.toISOString(),
        });
      }
      activityByDevice.set(deviceCode, rows);
    }
    const progressByRequest = new Map<string, { total: number; completed: number; remaining: number }>();
    for (const task of fbsTasks) {
      const progress = progressByRequest.get(task.requestId) ?? { total: 0, completed: 0, remaining: 0 };
      const units = Math.max(1, task.itemCount);
      progress.total += units;
      if (task.status === 'COMPLETED') progress.completed += units;
      else progress.remaining += units;
      progressByRequest.set(task.requestId, progress);
    }
    // A short Wi-Fi handover or a busy scan request must not make a physical
    // terminal disappear from the wall between two heartbeats.
    const onlineCutoff = Date.now() - 90_000;
    const devices = [...base.devices, ...discoveredDevices].map((device) => {
      const canonicalDeviceCode = administrationCanonicalTsdDeviceCode(device.deviceCode);
      const heartbeat = heartbeatByDevice.get(canonicalDeviceCode);
      const state = heartbeat ? administrationJsonRecord(heartbeat.payload) : null;
      const workloadRequest = administrationJsonRecord(device.workloads[0]?.request as Prisma.JsonValue);
      const currentRequestId = state && administrationText(state, 'requestId')
        || administrationText(workloadRequest, 'id')
        || null;
      return {
        ...device,
        online: heartbeat
          ? heartbeat.updatedAt.getTime() >= onlineCutoff
          : device.online,
        lastSeenAt: heartbeat?.updatedAt.toISOString() ?? device.lastSeenAt,
        liveState: state,
        progress: currentRequestId ? progressByRequest.get(currentRequestId) ?? null : null,
        errors: errorsByDevice.get(canonicalDeviceCode) ?? [],
        activity: activityByDevice.get(canonicalDeviceCode) ?? [],
      };
    }).sort((left, right) => left.deviceCode.localeCompare(
      right.deviceCode,
      'ru-RU',
      { numeric: true, sensitivity: 'base' },
    ));
    return {
      ...base,
      checkedAt: new Date().toISOString(),
      summary: {
        ...base.summary,
        registeredDevices: devices.length,
        onlineDevices: devices.filter((device) => device.online).length,
        errors24h: devices.reduce((sum, device) => sum + device.errors.length, 0),
      },
      devices,
      pickerStatistics: {
        period: {
          date: statisticsPeriod.date,
          from: statisticsPeriod.from.toISOString(),
          to: statisticsPeriod.to.toISOString(),
          label: statisticsPeriod.label,
        },
        summary: {
          workers: pickerWorkers.length,
          orders: pickerWorkers.reduce((sum, row) => sum + row.orders, 0),
          units: pickerWorkers.reduce((sum, row) => sum + row.units, 0),
        },
        workers: pickerWorkers,
      },
    };
  }

  async issueTsdMonitorAction(deviceCodeValue: string, actionValue: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const deviceCode = String(deviceCodeValue ?? '').trim();
    const action = String(actionValue ?? '').trim().toUpperCase();
    if (!['RELOAD_REQUEST', 'UPDATE_APP', 'LOGOUT', 'UNLOCK_INVENTORY'].includes(action)) {
      throw new BadRequestException('Доступны команды RELOAD_REQUEST, UPDATE_APP, UNLOCK_INVENTORY и LOGOUT.');
    }
    const device = await this.prisma.tsdDevice.findFirst({
      where: { code: { equals: deviceCode, mode: 'insensitive' } },
      select: {
        id: true,
        code: true,
        name: true,
        userId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    const registeredMonitorCode = device
      ? `${device.code}@${device.userId.slice(0, 8).toUpperCase()}`
      : null;
    const heartbeat = await this.prisma.tsdOperation.findFirst({
      where: {
        operationType: 'monitor_heartbeat',
        OR: [
          ...(device
            ? [
                { deviceId: device.id },
                { deviceId: device.code },
                { deviceId: registeredMonitorCode! },
                { operationKey: `monitor-heartbeat:${device.code}` },
                { operationKey: `monitor-heartbeat:${registeredMonitorCode}` },
                { operationKey: { startsWith: `monitor-heartbeat:${device.code}@` } },
              ]
            : []),
          { operationKey: `monitor-heartbeat:${deviceCode}` },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: { deviceId: true, payload: true, updatedAt: true },
    });
    if (!heartbeat) throw new NotFoundException('ТСД не подключен к мониторингу.');

    const heartbeatState = administrationJsonRecord(heartbeat?.payload ?? null);
    const inventoryRelease = action === 'UNLOCK_INVENTORY'
      ? await this.unlockTsdInventory(device, heartbeatState, user)
      : null;
    const installedVersion = administrationText(heartbeatState, 'appVersion');
    const deliveredAction = action === 'UNLOCK_INVENTORY' && !administrationVersionAtLeast(installedVersion, '0.1.120')
      ? 'LOGOUT'
      : action;
    const operation = await this.prisma.tsdOperation.create({
      data: {
        // Route the command by the exact key used by the live heartbeat poll.
        // It may include a worker suffix even when the registered TsdDevice
        // has a raw TSD-INSTALL-* code.
        deviceId: heartbeat.deviceId,
        operationKey: `monitor-command:${device?.code ?? deviceCode}:${Date.now()}:${randomUUID()}`,
        operationType: 'monitor_command',
        payload: {
          action: deliveredAction,
          requestedAction: action,
          issuedBy: user.id,
          issuedAt: new Date().toISOString(),
          inventoryRelease,
        },
        status: TsdOperationStatus.NEEDS_REVIEW,
        serverMessage: action === 'UNLOCK_INVENTORY'
          ? deliveredAction === 'LOGOUT'
            ? 'Инвентаризация освобождена. Старой версии ТСД отправлен безопасный выход из аккаунта.'
            : 'Инвентаризация освобождена. ТСД вернётся в главное меню.'
          : action === 'LOGOUT'
          ? 'Ожидает принудительного выхода из аккаунта.'
          : action === 'UPDATE_APP'
            ? 'Ожидает тихого обновления приложения ТСД.'
            : 'Ожидает перезагрузки текущей заявки.',
      },
    });
    return {
      accepted: true,
      commandId: operation.id,
      deviceCode: device?.code ?? deviceCode,
      action,
      inventoryRelease,
      message: action === 'UNLOCK_INVENTORY'
        ? deliveredAction === 'LOGOUT'
          ? `${inventoryRelease?.message ?? 'Сессия инвентаризации освобождена.'} На ТСД установлена старая версия: устройство выйдет из аккаунта, после чего сотрудник сможет войти снова.`
          : inventoryRelease?.message ?? 'Сессия инвентаризации освобождена. ТСД вернётся в главное меню.'
        : action === 'LOGOUT'
        ? 'Команда выхода будет выполнена при ближайшем подключении ТСД.'
        : action === 'UPDATE_APP'
          ? 'ТСД скачает и установит актуальную версию при ближайшем подключении.'
          : 'Команда перезагрузки заявки будет выполнена при ближайшем подключении ТСД.',
    };
  }

  private async unlockTsdInventory(
    device: {
      id: string;
      code: string;
      name: string;
      userId: string;
      user: { id: string; name: string; email: string };
    } | null,
    heartbeatState: Record<string, unknown>,
    user: AuthUser,
  ) {
    const screen = administrationText(heartbeatState, 'screen') ?? '';
    const exactSessionId = administrationText(heartbeatState, 'inventorySessionId');
    if (!screen.startsWith('INVENTORY_') && !exactSessionId) {
      throw new ConflictException('ТСД сейчас не находится в инвентаризации. Обновите мониторинг и повторите только для зависшей карточки.');
    }
    if (!device?.userId) {
      return {
        released: false,
        sessionId: null,
        message: 'Экран инвентаризации будет сброшен. Серверная сессия не найдена у незарегистрированного ТСД.',
      };
    }

    const ownership = {
      OR: [
        { createdByUserId: device.userId },
        { boxes: { some: { countedByUserId: device.userId } } },
      ],
    };
    const include = {
      boxes: {
        where: { status: 'COUNTING' as const, countedByUserId: device.userId },
        select: { id: true, boxCode: true, countedByName: true, startedAt: true },
        orderBy: { startedAt: 'desc' as const },
      },
    };
    const session = exactSessionId
      ? await this.prisma.inventorySession.findFirst({
          where: { id: exactSessionId, status: InventorySessionStatus.ACTIVE, ...ownership },
          include,
        })
      : await this.prisma.inventorySession.findFirst({
          where: { status: InventorySessionStatus.ACTIVE, ...ownership },
          include,
          orderBy: { updatedAt: 'desc' },
        });

    if (!session) {
      const result = {
        released: false,
        sessionId: null,
        message: `Экран инвентаризации ${device.code} будет сброшен. Активная серверная проверка пользователя ${device.user.name} уже отсутствует.`,
      };
      await this.auditLog.write({
        userId: user.id,
        action: 'administration.tsd-inventory.unlock',
        entity: 'TsdDevice',
        entityId: device.id,
        payload: { deviceCode: device.code, operatorUserId: device.userId, screen, ...result },
      });
      return result;
    }

    const preserveFullInventory = session.type === InventorySessionType.FULL;
    let released = false;
    if (!preserveFullInventory) {
      const currentComment = session.comment?.trim();
      const unlockComment = `Разблокировано из мониторинга ТСД ${device.code} администратором ${user.name}.`;
      const update = await this.prisma.inventorySession.updateMany({
        where: { id: session.id, status: InventorySessionStatus.ACTIVE },
        data: {
          status: InventorySessionStatus.CANCELLED,
          completedAt: new Date(),
          completedByUserId: user.id,
          completedByName: user.name,
          comment: currentComment ? `${currentComment}\n${unlockComment}` : unlockComment,
        },
      });
      released = update.count === 1;
    }

    const boxCodes = session.boxes.map((box) => box.boxCode);
    const message = preserveFullInventory
      ? `ТСД ${device.code} отсоединён от полной инвентаризации. Общая инвентаризация «${session.title}» сохранена.`
      : released
        ? `Зависшая инвентаризация «${session.title}» освобождена${boxCodes.length ? `; короб: ${boxCodes.join(', ')}` : ''}. ТСД вернётся в главное меню.`
        : 'Сессия уже изменилась. Экран ТСД всё равно будет безопасно сброшен.';
    const result = {
      released,
      sessionId: session.id,
      sessionType: session.type,
      sessionTitle: session.title,
      preserved: preserveFullInventory,
      boxCodes,
      message,
    };
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.tsd-inventory.unlock',
      entity: 'InventorySession',
      entityId: session.id,
      payload: { deviceCode: device.code, operatorUserId: device.userId, screen, ...result },
    });
    return result;
  }

  async releaseTsdWorkload(
    body: { kind?: string; workloadId?: string; requestId?: string; deviceCode?: string },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const kind = String(body.kind ?? '').trim();
    if (kind === 'FBS_ORDER') {
      const taskId = String(body.workloadId ?? '').trim();
      if (!taskId) throw new BadRequestException('Не передан идентификатор задания FBS.');
      return this.releaseAdministrationFbsTasks({ taskIds: [taskId] }, user);
    }
    if (kind === 'REQUEST_SESSION') {
      const requestId = String(body.requestId ?? '').trim();
      const deviceCode = String(body.deviceCode ?? '').trim();
      if (!requestId || !deviceCode) throw new BadRequestException('Не указаны заявка или ТСД.');
      await this.createAdministrationReleaseOperation(requestId, deviceCode, user);
      return { released: 1, message: 'Сессия ТСД освобождена. Заявка снова доступна сотрудникам.' };
    }
    throw new BadRequestException('Неизвестный тип задачи ТСД.');
  }

  async disconnectTsdRequest(body: { requestId?: string; deviceCode?: string }, user: AuthUser) {
    this.assertOwner(user);
    const requestId = String(body.requestId ?? '').trim();
    const deviceCode = String(body.deviceCode ?? '').trim();
    if (!requestId || !deviceCode) throw new BadRequestException('Не указаны заявка или ТСД.');
    const device = await this.prisma.tsdDevice.findFirst({
      where: { code: { equals: deviceCode, mode: 'insensitive' } },
      select: { id: true, code: true, userId: true },
    });
    const heartbeat = await this.prisma.tsdOperation.findFirst({
      where: {
        operationType: 'monitor_heartbeat',
        OR: [
          { deviceId: deviceCode },
          ...(device ? [{ deviceId: device.id }, { deviceId: device.code }] : []),
          { operationKey: `monitor-heartbeat:${deviceCode}` },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: { payload: true },
    });
    const heartbeatPayload = administrationJsonRecord(heartbeat?.payload ?? null);
    const heartbeatUserId = administrationText(heartbeatPayload, 'userId');
    const workerUserIds = [...new Set([device?.userId, heartbeatUserId].filter(Boolean))] as string[];
    const deviceCodes = [...new Set([deviceCode, device?.code].filter(Boolean))] as string[];
    const tasks = await this.prisma.fbsTsdAssembly.findMany({
      where: {
        status: 'IN_PROGRESS',
        OR: [
          ...deviceCodes.map((code) => ({ deviceCode: { equals: code, mode: 'insensitive' as const } })),
          ...(workerUserIds.length ? [{ workerUserId: { in: workerUserIds } }] : []),
        ],
      },
      orderBy: { updatedAt: 'asc' },
    });
    const protectedTasks = tasks.filter((task) => administrationProtectedFbsReason(task));
    if (protectedTasks.length > 0) {
      throw new BadRequestException(
        `Нельзя отключить ТСД: защищены заказы ${protectedTasks.map((task) => task.orderId).join(', ')}. ` +
          'Для них КИЗ уже принят маркетплейсом или подтверждена переклейка.',
      );
    }
    const release = await this.releaseAdministrationFbsTasks({ taskIds: tasks.map((task) => task.id), skipOperation: true }, user);
    const remaining = await this.prisma.fbsTsdAssembly.count({
      where: {
        status: 'IN_PROGRESS',
        OR: [
          ...deviceCodes.map((code) => ({ deviceCode: { equals: code, mode: 'insensitive' as const } })),
          ...(workerUserIds.length ? [{ workerUserId: { in: workerUserIds } }] : []),
        ],
      },
    });
    if (remaining > 0) {
      throw new ConflictException(`Не удалось снять все задания: осталось ${remaining}. Обновите мониторинг и повторите.`);
    }
    await this.createAdministrationReleaseOperation(requestId, deviceCode, user);
    return {
      released: release.released + 1,
      releasedOrders: release.released,
      message: `ТСД отключён от заявки. Освобождено заказов FBS: ${release.released}.`,
    };
  }

  private async releaseAdministrationFbsTasks(
    options: { taskIds: string[]; skipOperation?: boolean },
    user: AuthUser,
  ) {
    const taskIds = [...new Set(options.taskIds.filter(Boolean))];
    if (taskIds.length === 0) return { released: 0, message: 'Активных заказов FBS на этом ТСД нет.' };
    const tasks = await this.prisma.fbsTsdAssembly.findMany({ where: { id: { in: taskIds } } });
    if (tasks.length !== taskIds.length) throw new NotFoundException('Одна из задач ТСД уже не найдена. Обновите список.');
    const requestIds = [...new Set(tasks.map((task) => task.requestId))];
    const visibleRequests = await this.prisma.clientRequest.count({
      where: { id: { in: requestIds }, client: { isDemo: Boolean(user.isDemo) } },
    });
    if (visibleRequests !== requestIds.length) {
      throw new NotFoundException('Одна из задач недоступна в текущем контуре администрирования.');
    }
    const inactive = tasks.find((task) => task.status !== 'IN_PROGRESS');
    if (inactive) throw new ConflictException(`Заказ ${inactive.orderId} уже не занят этим ТСД. Обновите список.`);
    const protectedTask = tasks.find((task) => administrationProtectedFbsReason(task));
    if (protectedTask) throw new BadRequestException(administrationProtectedFbsReason(protectedTask));

    await this.prisma.$transaction(async (tx) => {
      for (const task of tasks) {
        const result = await tx.fbsTsdAssembly.updateMany({
          where: { id: task.id, status: 'IN_PROGRESS', updatedAt: task.updatedAt },
          data: {
            status: task.reservedBoxId ? 'RESERVED' : 'RELEASED',
            deviceCode: task.reservedBoxId ? 'AUTO:FBS:PALLET_SORT' : task.deviceCode,
            workerUserId: null,
            workerName: null,
            boxId: null,
            boxCode: null,
            sourceBarcode: null,
            barcode: null,
            errorMessage: `Задача освобождена администратором ${user.name}.`,
          },
        });
        if (result.count !== 1) throw new ConflictException(`Заказ ${task.orderId} изменился. Обновите список и повторите.`);
      }
    });
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.tsd-workload.release',
      entity: 'FbsTsdAssembly',
      payload: { taskIds, orderIds: tasks.map((task) => task.orderId), deviceCodes: [...new Set(tasks.map((task) => task.deviceCode))] },
    });
    return { released: tasks.length, message: `Освобождено задач FBS: ${tasks.length}.` };
  }

  private async createAdministrationReleaseOperation(requestId: string, deviceCode: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findFirst({
      where: { id: requestId, client: { isDemo: Boolean(user.isDemo) } },
      select: { id: true, number: true, clientId: true },
    });
    if (!request) throw new NotFoundException('Заявка не найдена.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.tsdOperation.create({
        data: {
          deviceId: deviceCode,
          operationKey: `admin-release:${requestId}:${deviceCode}:${randomUUID()}`,
          operationType: 'administration_release',
          payload: {
            requestId,
            deviceCode,
            stage: 'released',
            action: 'release',
            userId: user.id,
            workerName: user.name,
            releasedAt: now.toISOString(),
          },
          status: TsdOperationStatus.ACCEPTED,
          serverMessage: 'Сессия заявки освобождена администратором.',
        },
      }),
      this.prisma.clientRequestEvent.create({
        data: {
          requestId,
          clientId: request.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: 'ТСД отключён от заявки',
          body: `${user.name} освободил устройство ${deviceCode}. Заявка снова доступна для работы.`,
          createdByUserId: user.id,
        },
      }),
    ]);
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.tsd-request.disconnect',
      entity: 'ClientRequest',
      entityId: requestId,
      payload: { requestNumber: request.number, deviceCode },
    });
  }

  private async runPerformanceOptimization(user: AuthUser): Promise<AdministrationPerformanceOptimization> {
    const startedAt = new Date();
    const memoryBeforeMb = memoryUsageMb();
    const databaseBefore = await this.databasePerformanceSnapshot();
    const now = new Date();
    const revokedBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const expiredMobileCommands = await this.prisma.mobileCommand.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const expiredMobileSessions = await this.prisma.mobileSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { not: null, lt: revokedBefore } },
        ],
      },
    });
    const runtimeCache = this.marketplaceConnections.pruneExpiredRuntimeCaches(now.getTime());
    const files = await cleanupTemporaryFiles(now.getTime());

    await this.prisma.$executeRawUnsafe(
      'ANALYZE "Box", "StockBalance", "StockMovement", "ProductMark", "ClientRequest", "ClientRequestItem", "FbsOrderRequestLink", "FbsTsdAssembly", "AuditLog"',
    );

    const databaseAfter = await this.databasePerformanceSnapshot();
    const completedAt = new Date();
    const result: AdministrationPerformanceOptimization = {
      status: 'COMPLETED',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      cleanup: {
        expiredMobileCommands: expiredMobileCommands.count,
        expiredMobileSessions: expiredMobileSessions.count,
      },
      runtime: {
        expiredCacheEntries: runtimeCache.removed,
        retainedCacheEntries: runtimeCache.retained,
        memoryBeforeMb,
        memoryAfterMb: memoryUsageMb(),
      },
      files,
      database: {
        statisticsUpdated: true,
        before: databaseBefore,
        after: databaseAfter,
      },
    };

    await this.auditLog.write({
      userId: user.id,
      action: 'administration.performance.optimize',
      entity: 'SystemPerformance',
      payload: result,
    });
    return result;
  }

  private async databasePerformanceSnapshot() {
    const [row] = await this.prisma.$queryRaw<
      Array<{ databaseSizeBytes: string; liveRows: string; deadRows: string }>
    >(Prisma.sql`
      SELECT
        pg_database_size(current_database())::text AS "databaseSizeBytes",
        COALESCE(SUM(n_live_tup), 0)::bigint::text AS "liveRows",
        COALESCE(SUM(n_dead_tup), 0)::bigint::text AS "deadRows"
      FROM pg_stat_user_tables
    `);
    return {
      sizeMb: Math.round(Number(row?.databaseSizeBytes ?? 0) / 1024 / 1024),
      liveRows: Number(row?.liveRows ?? 0),
      deadRows: Number(row?.deadRows ?? 0),
    };
  }

  private async resolveWbStockComparisonTargets(
    clientId: string,
    warehouse: { id: string; code: string; name: string; city: string },
    connectionId: string,
    marketplaceWarehouseId: string,
    user: AuthUser,
  ) {
    const allSelected = connectionId === 'ALL';
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: {
        ...(allSelected ? {} : { id: connectionId }),
        clientId,
        marketplace: MarketplaceType.WILDBERRIES,
        isActive: true,
      },
      select: {
        id: true,
        accountName: true,
        fbsWarehouseId: true,
        fbsWarehouseName: true,
        fbsExecutionWarehouseId: true,
      },
      orderBy: [{ accountName: 'asc' }, { createdAt: 'asc' }],
    });
    if (!connections.length) {
      throw new BadRequestException('У клиента нет активного подключения Wildberries.');
    }

    const isMoscow = warehouse.code === 'MSK' || /москв/iu.test(`${warehouse.city} ${warehouse.name}`);
    const groups = await Promise.all(connections.map(async (connection) => {
      const routes = await this.marketplaceConnections.listFbsWarehouseRoutes(connection.id, user);
      const targets = new Map<string, {
        connection: typeof connection;
        marketplaceWarehouseId: string;
        marketplaceWarehouseName: string;
      }>();
      const addTarget = (
        id: string | null,
        name: string | null,
        effectiveExecutionWarehouseId: string | null,
        legacyMoscowFallback: boolean,
      ) => {
        if (!id) return;
        if (effectiveExecutionWarehouseId !== warehouse.id && !(legacyMoscowFallback && isMoscow)) return;
        targets.set(id, {
          connection,
          marketplaceWarehouseId: id,
          marketplaceWarehouseName: name || `Склад WB ${id}`,
        });
      };

      addTarget(
        connection.fbsWarehouseId,
        connection.fbsWarehouseName,
        connection.fbsExecutionWarehouseId,
        !connection.fbsExecutionWarehouseId,
      );
      routes.warehouses.forEach((route) => {
        if (route.mode === 'EXCLUDED') {
          targets.delete(route.marketplaceWarehouseId);
          return;
        }
        const isPrimary = route.marketplaceWarehouseId === connection.fbsWarehouseId;
        addTarget(
          route.marketplaceWarehouseId,
          route.marketplaceWarehouseName,
          route.effectiveExecutionWarehouseId
            ?? (isPrimary ? connection.fbsExecutionWarehouseId : null),
          isPrimary && !route.effectiveExecutionWarehouseId && !connection.fbsExecutionWarehouseId,
        );
      });
      return [...targets.values()];
    }));

    let targets = groups.flat();
    if (!allSelected) {
      const requestedWarehouseId = marketplaceWarehouseId || connections[0]?.fbsWarehouseId || '';
      targets = targets.filter((target) => target.marketplaceWarehouseId === requestedWarehouseId);
    }
    if (!targets.length) {
      throw new BadRequestException(
        allSelected
          ? 'Для выбранного филиала не настроены склады Wildberries.'
          : 'Выбранный склад Wildberries не направлен на этот филиал исполнения.',
      );
    }
    return { allSelected, targets };
  }

  async compareWbStockFile(
    file: Express.Multer.File | undefined,
    clientIdValue: string | undefined,
    warehouseIdValue: string | undefined,
    connectionIdValue: string | undefined,
    marketplaceWarehouseIdValue: string | undefined,
    user: AuthUser,
  ) {
    this.assertOwner(user);
    if (!file?.buffer?.length) throw new BadRequestException('Выберите файл XLSX с остатками Wildberries.');
    const clientId = String(clientIdValue ?? '').trim();
    const warehouseId = String(warehouseIdValue ?? '').trim();
    const connectionId = String(connectionIdValue ?? '').trim();
    const marketplaceWarehouseId = String(marketplaceWarehouseIdValue ?? '').trim();
    if (!clientId) throw new BadRequestException('Выберите клиента.');
    if (!warehouseId) throw new BadRequestException('Выберите филиал WMS.');
    if (!connectionId) throw new BadRequestException('Выберите кабинет Wildberries.');

    const [client, warehouse] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, code: true, name: true, city: true },
      }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');
    if (!warehouse) throw new NotFoundException('Филиал не найден.');
    const selection = await this.resolveWbStockComparisonTargets(
      clientId,
      warehouse,
      connectionId,
      marketplaceWarehouseId,
      user,
    );
    const target = selection.targets[0]!;

    const parsed = parseWbStockFile(file.buffer);
    const barcodes = parsed.rows.map((row) => row.barcode);
    const skuRows = await this.prisma.sku.findMany({
      where: { clientId, barcodes: { some: { value: { in: barcodes } } } },
      select: {
        id: true,
        internalSku: true,
        article: true,
        name: true,
        size: true,
        barcodes: { where: { value: { in: barcodes } }, select: { value: true } },
      },
    });
    const quantities = await this.marketplaceConnections.calculateFbsStockQuantities(
      clientId,
      skuRows.map((sku) => sku.id),
      warehouseId,
      selection.allSelected ? undefined : target.connection.id,
    );
    const skuByBarcode = new Map(
      skuRows.flatMap((sku) => sku.barcodes.map((barcode) => [barcode.value, sku] as const)),
    );

    const rows = parsed.rows.map((source) => {
      const sku = skuByBarcode.get(source.barcode);
      const quantity = sku ? quantities.get(sku.id) : null;
      const wmsQuantity = quantity?.sellable ?? 0;
      const difference = source.quantity - wmsQuantity;
      const status = !sku
        ? 'NOT_FOUND'
        : difference > 0
          ? 'WB_EXCESS'
          : difference < 0
            ? 'WMS_GREATER'
            : 'MATCH';
      return {
        ...source,
        sku: sku
          ? { id: sku.id, internalSku: sku.internalSku, article: sku.article, name: sku.name, size: sku.size }
          : null,
        wmsAvailable: quantity?.available ?? 0,
        wmsReserved: quantity?.reserved ?? 0,
        wmsQuantity,
        difference,
        status,
      };
    });
    const excessRows = rows.filter((row) => row.status === 'WB_EXCESS' || (row.status === 'NOT_FOUND' && row.quantity > 0));

    return {
      checkedAt: new Date().toISOString(),
      source: 'FILE',
      file: { name: file.originalname, sheetName: parsed.sheetName, sourceRows: parsed.sourceRows, duplicateRows: parsed.duplicateRows },
      client,
      warehouse,
      fixContext: {
        connectionId: selection.allSelected ? null : target.connection.id,
        warehouseId: selection.allSelected ? null : target.marketplaceWarehouseId,
        warehouseName: selection.allSelected ? 'Все склады WB' : target.marketplaceWarehouseName,
        accountName: selection.allSelected ? 'Все кабинеты Wildberries' : target.connection.accountName,
      },
      wildberriesWarehouses: selection.targets.map((item) => ({
        connectionId: item.connection.id,
        warehouseId: item.marketplaceWarehouseId,
        warehouseName: item.marketplaceWarehouseName,
        accountName: item.connection.accountName,
      })),
      health: excessRows.length ? 'DANGER' : 'OK',
      summary: {
        products: rows.length,
        matched: rows.filter((row) => row.status !== 'NOT_FOUND').length,
        exact: rows.filter((row) => row.status === 'MATCH').length,
        differences: rows.filter((row) => row.difference !== 0).length,
        excessProducts: excessRows.length,
        excessUnits: excessRows.reduce((sum, row) => sum + Math.max(0, row.difference), 0),
        wmsGreaterProducts: rows.filter((row) => row.status === 'WMS_GREATER').length,
        notFound: rows.filter((row) => row.status === 'NOT_FOUND').length,
      },
      rows,
    };
  }

  async compareWbStockApi(
    clientIdValue: string | undefined,
    warehouseIdValue: string | undefined,
    connectionIdValue: string | undefined,
    marketplaceWarehouseIdValue: string | undefined,
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const clientId = String(clientIdValue ?? '').trim();
    const warehouseId = String(warehouseIdValue ?? '').trim();
    const connectionId = String(connectionIdValue ?? '').trim();
    const marketplaceWarehouseId = String(marketplaceWarehouseIdValue ?? '').trim();
    if (!clientId) throw new BadRequestException('Выберите клиента.');
    if (!warehouseId) throw new BadRequestException('Выберите филиал WMS.');
    if (!connectionId) throw new BadRequestException('Выберите кабинет Wildberries.');

    const [client, warehouse] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, code: true, name: true, city: true },
      }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');
    if (!warehouse) throw new NotFoundException('Филиал не найден.');
    const selection = await this.resolveWbStockComparisonTargets(
      clientId,
      warehouse,
      connectionId,
      marketplaceWarehouseId,
      user,
    );

    const liveResults = await Promise.all(
      selection.targets.map((target) =>
        this.marketplaceConnections.listFbsStocks(
          clientId,
          target.connection.id,
          target.marketplaceWarehouseId,
          user,
          false,
        ),
      ),
    );
    const aggregatedItems = new Map<string, (typeof liveResults)[number]['items'][number]>();
    for (const live of liveResults) {
      for (const item of live.items) {
        const current = aggregatedItems.get(item.skuId);
        if (!current) {
          aggregatedItems.set(item.skuId, { ...item });
          continue;
        }
        current.wbAmount += item.wbAmount;
        current.requestedAmount = (current.requestedAmount ?? 0) + (item.requestedAmount ?? 0);
        current.targetAmount = (current.targetAmount ?? 0) + (item.targetAmount ?? 0);
      }
    }
    if (selection.allSelected && aggregatedItems.size) {
      const quantities = await this.marketplaceConnections.calculateFbsStockQuantities(
        clientId,
        [...aggregatedItems.keys()],
        warehouseId,
      );
      for (const [skuId, item] of aggregatedItems) {
        const quantity = quantities.get(skuId);
        item.wmsAvailable = quantity?.available ?? 0;
        item.reserved = quantity?.reserved ?? 0;
        item.sellable = quantity?.sellable ?? 0;
      }
    }
    const rows = [...aggregatedItems.values()].map((item) => {
      const difference = item.wbAmount - item.sellable;
      return {
        barcode: item.barcode,
        quantity: item.wbAmount,
        product: null,
        brand: null,
        name: item.name,
        size: item.size,
        sellerArticle: item.article,
        sourceRows: [],
        sku: {
          id: item.skuId,
          internalSku: item.internalSku,
          article: item.article,
          name: item.name,
          size: item.size,
        },
        wmsAvailable: item.wmsAvailable,
        wmsReserved: item.reserved,
        wmsQuantity: item.sellable,
        difference,
        status: difference > 0 ? 'WB_EXCESS' : difference < 0 ? 'WMS_GREATER' : 'MATCH',
      };
    });
    const excessRows = rows.filter((row) => row.status === 'WB_EXCESS');
    const primaryTarget = selection.targets[0]!;
    return {
      checkedAt: liveResults
        .map((item) => item.fetchedAt)
        .sort()
        .at(-1) ?? new Date().toISOString(),
      source: 'API',
      file: {
        name: 'Wildberries API',
        sheetName: selection.allSelected
          ? 'Все склады WB'
          : primaryTarget.marketplaceWarehouseName,
        sourceRows: rows.length,
        duplicateRows: 0,
      },
      client,
      warehouse,
      fixContext: {
        connectionId: selection.allSelected ? null : primaryTarget.connection.id,
        warehouseId: selection.allSelected ? null : primaryTarget.marketplaceWarehouseId,
        warehouseName: selection.allSelected ? 'Все склады WB' : primaryTarget.marketplaceWarehouseName,
        accountName: selection.allSelected ? 'Все кабинеты Wildberries' : primaryTarget.connection.accountName,
      },
      wildberriesWarehouses: selection.targets.map((item) => ({
        connectionId: item.connection.id,
        warehouseId: item.marketplaceWarehouseId,
        warehouseName: item.marketplaceWarehouseName,
        accountName: item.connection.accountName,
      })),
      health: excessRows.length ? 'DANGER' : 'OK',
      summary: {
        products: rows.length,
        matched: rows.length,
        exact: rows.filter((row) => row.status === 'MATCH').length,
        differences: rows.filter((row) => row.difference !== 0).length,
        excessProducts: excessRows.length,
        excessUnits: excessRows.reduce((sum, row) => sum + Math.max(0, row.difference), 0),
        wmsGreaterProducts: rows.filter((row) => row.status === 'WMS_GREATER').length,
        notFound: 0,
      },
      rows,
    };
  }

  async overview(user: AuthUser) {
    this.assertOwner(user);
    const demoClientFilter = { isDemo: Boolean(user.isDemo) };
    const demoUserFilter = { isDemo: Boolean(user.isDemo) };
    const [
      users,
      clients,
      skus,
      activeBoxes,
      requests,
      connections,
      pendingInventory,
      recentChanges,
      boxCodePolicy,
      aiSettings,
    ] = await Promise.all([
      this.prisma.user.count({ where: demoUserFilter }),
      this.prisma.client.count({ where: demoClientFilter }),
      this.prisma.sku.count({ where: { client: demoClientFilter } }),
      this.prisma.box.count({
        where: {
          status: { notIn: ['deleted', 'archived'] },
          client: demoClientFilter,
        },
      }),
      this.prisma.clientRequest.count({ where: { client: demoClientFilter } }),
      this.prisma.clientMarketplaceConnection.count({
        where: { isActive: true, client: demoClientFilter },
      }),
      this.prisma.inventoryAuditLine.count({
        where: {
          decision: 'PENDING',
          ...(user.isDemo ? { auditBox: { clientId: { in: user.clientIds } } } : {}),
        },
      }),
      this.prisma.auditLog.count({
        where: {
          action: { startsWith: 'administration.' },
          user: demoUserFilter,
        },
      }),
      user.isDemo
        ? this.settings.get(this.demoSettingKey(user, BOX_CODE_POLICY_SETTING), DEFAULT_BOX_CODE_POLICY)
        : this.boxCodes.getPolicy(),
      this.settings.get(
        user.isDemo ? this.demoSettingKey(user, ADMINISTRATION_AI_SETTING) : ADMINISTRATION_AI_SETTING,
        AI_DEFAULTS,
      ),
    ]);

    return {
      owner: { id: user.id, name: user.name, email: user.email },
      metrics: {
        users,
        clients,
        skus,
        activeBoxes,
        requests,
        connections,
        pendingInventory,
        recentChanges,
      },
      system: {
        apiUptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'unknown',
      },
      boxCodePolicy,
      ai: {
        settings: aiSettings,
        apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        liveProviderAvailable: Boolean(process.env.OPENAI_API_KEY),
        mode: process.env.OPENAI_API_KEY ? 'STRUCTURED_PLAN' : 'LOCAL_RULES',
      },
      safeguards: {
        previewRequired: true,
        confirmationRequired: true,
        auditEnabled: true,
        arbitraryShellDisabled: true,
        arbitrarySqlDisabled: true,
      },
    };
  }

  async listSettings(user: AuthUser) {
    this.assertOwner(user);
    const rows = await this.settings.getMany(
      SETTING_DEFINITIONS.map((item) =>
        user.isDemo ? this.demoSettingKey(user, item.key) : item.key,
      ),
    );
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return SETTING_DEFINITIONS.map((definition) => {
      const row = byKey.get(
        user.isDemo ? this.demoSettingKey(user, definition.key) : definition.key,
      );
      return {
        ...definition,
        value: row?.value ?? definition.defaultValue,
        updatedAt: row?.updatedAt ?? null,
        updatedByUserId: row?.updatedByUserId ?? null,
      };
    });
  }

  async updateSetting(keyValue: string, value: unknown, reasonValue: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const key = decodeURIComponent(keyValue).trim();
    const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
    if (!definition || !definition.editable) {
      throw new BadRequestException('Эта настройка не поддерживает прямое изменение.');
    }
    const reason = requiredReason(reasonValue);
    const storageKey = user.isDemo ? this.demoSettingKey(user, key) : key;
    const before = await this.settings.get<unknown>(storageKey, definition.defaultValue);
    const normalized =
      key === BOX_CODE_POLICY_SETTING
        ? user.isDemo
          ? normalizeBoxCodePolicy(value)
          : await this.boxCodes.updatePolicy(value, user.id)
        : key === ADMINISTRATION_AI_SETTING
          ? normalizeAiSettings(value)
          : normalizeSettingValue(key, value);

    if (key !== BOX_CODE_POLICY_SETTING || user.isDemo) {
      await this.settings.set(storageKey, normalized as Prisma.InputJsonValue, user.id);
    }
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.setting.update',
      entity: 'SystemSetting',
      entityId: key,
      payload: { key, reason, before, after: normalized, risk: definition.risk },
    });
    return { key, value: normalized, updatedAt: new Date().toISOString() };
  }

  async listWorkspaceVisibility(user: AuthUser) {
    this.assertOwner(user);
    const [users, visibility] = await Promise.all([
      this.prisma.user.findMany({
        where: { isDemo: Boolean(user.isDemo) },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          roles: { select: { role: { select: { code: true } } } },
        },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      }),
      this.settings.get<Record<string, Record<string, boolean>>>(
        WORKSPACE_VISIBILITY_SETTING,
        {},
      ),
    ]);
    return {
      workspaces: WORKSPACE_IDS,
      users: users.map((item) => ({
        id: item.id,
        email: item.email,
        name: item.name,
        status: item.status,
        roleCodes: item.roles.map((role) => role.role.code),
        overrides: normalizeWorkspaceOverrides(visibility[item.id]),
      })),
      note:
        'Видимость скрывает раздел интерфейса. Для доступа к API и действиям по-прежнему нужны соответствующие роли и разрешения.',
    };
  }

  async updateWorkspaceVisibility(
    userId: string,
    overridesValue: Record<string, boolean> | undefined,
    reasonValue: string | undefined,
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, isDemo: true },
    });
    if (!target || target.isDemo !== Boolean(user.isDemo)) {
      throw new NotFoundException('Пользователь не найден.');
    }
    const reason = requiredReason(reasonValue);
    const overrides = normalizeWorkspaceOverrides(overridesValue);
    const visibility = await this.settings.get<Record<string, Record<string, boolean>>>(
      WORKSPACE_VISIBILITY_SETTING,
      {},
    );
    const before = normalizeWorkspaceOverrides(visibility[userId]);
    const next = { ...visibility };
    if (Object.keys(overrides).length > 0) next[userId] = overrides;
    else delete next[userId];
    await this.settings.set(
      WORKSPACE_VISIBILITY_SETTING,
      next as Prisma.InputJsonValue,
      user.id,
    );
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.workspace-visibility.update',
      entity: 'User',
      entityId: userId,
      payload: { target, reason, before, after: overrides },
    });
    return { user: target, overrides };
  }

  async diagnoseMarketplaceConnections(
    filter: { clientId?: string; connectionId?: string },
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const connections = await this.prisma.clientMarketplaceConnection.findMany({
      where: {
        isActive: true,
        client: { isDemo: Boolean(user.isDemo) },
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.connectionId ? { id: filter.connectionId } : {}),
      },
      include: { client: { select: { id: true, code: true, name: true } } },
      orderBy: [{ client: { name: 'asc' } }, { marketplace: 'asc' }],
    });
    const results = [];
    for (const connection of connections) {
      results.push(
        connection.marketplace === MarketplaceType.WILDBERRIES
          ? await diagnoseWildberries(connection)
          : await diagnoseOzon(connection),
      );
    }
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.marketplace.diagnostics',
      entity: 'ClientMarketplaceConnection',
      payload: {
        filter,
        checked: results.length,
        healthy: results.filter((item) => item.healthy).length,
        failed: results.filter((item) => !item.healthy).length,
      },
    });
    return {
      checkedAt: new Date().toISOString(),
      summary: {
        checked: results.length,
        healthy: results.filter((item) => item.healthy).length,
        failed: results.filter((item) => !item.healthy).length,
      },
      results,
    };
  }

  async listAudit(searchValue: string | undefined, takeValue: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const search = searchValue?.trim();
    const take = Math.min(200, Math.max(10, Number(takeValue) || 80));
    return this.prisma.auditLog.findMany({
      where: {
        user: { isDemo: Boolean(user.isDemo) },
        ...(search
          ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' } },
              { entity: { contains: search, mode: 'insensitive' } },
              { entityId: { contains: search, mode: 'insensitive' } },
            ],
          }
          : {}),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async previewAssistantChange(promptValue: string | undefined, user: AuthUser) {
    this.assertOwner(user);
    const prompt = promptValue?.trim() ?? '';
    if (prompt.length < 5 || prompt.length > 4000) {
      throw new BadRequestException('Опишите изменение текстом длиной от 5 до 4000 символов.');
    }
    const previewId = randomUUID();
    const plan = await this.buildLocalAssistantPlan(prompt);
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.ai.preview',
      entity: 'AdministrationChangePreview',
      entityId: previewId,
      payload: { prompt, plan, provider: 'LOCAL_RULES' },
    });
    return {
      previewId,
      prompt,
      provider: 'LOCAL_RULES',
      liveModelConfigured: Boolean(process.env.OPENAI_API_KEY),
      ...plan,
    };
  }

  async applyAssistantChange(
    previewIdValue: string | undefined,
    confirmation: string | undefined,
    user: AuthUser,
  ) {
    this.assertOwner(user);
    const previewId = previewIdValue?.trim();
    if (!previewId) throw new BadRequestException('Не найден идентификатор предварительного плана.');
    if (confirmation !== 'ПРИМЕНИТЬ') {
      throw new BadRequestException('Для выполнения введите подтверждение: ПРИМЕНИТЬ.');
    }
    const preview = await this.prisma.auditLog.findFirst({
      where: {
        action: 'administration.ai.preview',
        entity: 'AdministrationChangePreview',
        entityId: previewId,
        userId: user.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!preview) throw new NotFoundException('Предварительный план не найден.');
    const payload = asRecord(preview.payload);
    const plan = asRecord(payload.plan);
    const actions = Array.isArray(plan.actions) ? plan.actions.map(asRecord) : [];
    if (actions.length === 0 || actions.some((action) => action.executable !== true)) {
      throw new BadRequestException(
        'Этот запрос затрагивает программную логику и не может быть применён автоматически. Используйте рекомендации плана.',
      );
    }

    const results = [];
    for (const action of actions) {
      if (action.type === 'UPDATE_BOX_PREFIX') {
        const prefix = String(action.prefix ?? '').trim().toLocaleUpperCase('ru-RU');
        const current = user.isDemo
          ? await this.settings.get(
              this.demoSettingKey(user, BOX_CODE_POLICY_SETTING),
              DEFAULT_BOX_CODE_POLICY,
            )
          : await this.boxCodes.getPolicy(true);
        const next: BoxCodePolicy = {
          ...current,
          primaryPrefix: prefix,
          allowedPrefixes: [prefix, ...current.allowedPrefixes.filter((item) => item !== prefix)],
        };
        results.push({
          type: action.type,
          value: user.isDemo
            ? await this.settings
                .set(
                  this.demoSettingKey(user, BOX_CODE_POLICY_SETTING),
                  next as unknown as Prisma.InputJsonValue,
                  user.id,
                )
                .then(() => next)
            : await this.boxCodes.updatePolicy(next, user.id),
        });
      } else if (action.type === 'RUN_WB_DIAGNOSTICS') {
        results.push({
          type: action.type,
          value: await this.diagnoseMarketplaceConnections({}, user),
        });
      } else {
        throw new BadRequestException(`Автоматическое действие ${String(action.type)} запрещено.`);
      }
    }
    await this.auditLog.write({
      userId: user.id,
      action: 'administration.ai.apply',
      entity: 'AdministrationChangePreview',
      entityId: previewId,
      payload: { previewId, results },
    });
    return { previewId, applied: true, results };
  }

  documentation(user: AuthUser) {
    this.assertOwner(user);
    return {
      generatedAt: new Date().toISOString(),
      sections: [
        {
          id: 'roles',
          title: 'Роли и доступы',
          summary:
            'OWNER управляет административным контуром; ADMIN обслуживает WMS; MANAGER принимает решения; OPERATOR выполняет операции; CLIENT видит свой кабинет; TSD работает со сканером.',
        },
        {
          id: 'warehouse',
          title: 'Складской контур',
          summary:
            'Приёмка создаёт уникальные короба и остатки, перемещения сохраняют историю, заявки резервируют только нужные единицы, инвентаризация сравнивает WMS с фактом.',
        },
        {
          id: 'fbs',
          title: 'FBS',
          summary:
            'WMS получает заказы по API, связывает товары и короба, создаёт заявку, проводит сборку на ТСД, упаковку, грузоместа, стикеры и передачу в WB.',
        },
        {
          id: 'billing',
          title: 'Биллинг и калькуляторы',
          summary:
            'Начисления формируются из услуг клиента, хранения, логистики, FBS и ручных операций; параметры клиента имеют приоритет над общими значениями.',
        },
        {
          id: 'troubleshooting',
          title: 'Устранение неисправностей',
          summary:
            'Проверяйте здоровье API, токен и склад маркетплейса, актуальность резервов, состояние заявки, остатки короба, очередь ТСД и журнал аудита.',
        },
      ],
      references: [
        {
          title: 'Руководство пользователя',
          path: 'docs/WMS-USER-GUIDE.md',
        },
        {
          title: 'Администрирование владельца',
          path: 'docs/WMS-ADMINISTRATION.md',
        },
        {
          title: 'Техническое руководство',
          path: 'docs/WMS-TECHNICAL-GUIDE.md',
        },
        {
          title: 'Устранение неисправностей',
          path: 'docs/WMS-TROUBLESHOOTING.md',
        },
        {
          title: 'Карта алгоритмов',
          path: 'docs/WMS-ALGORITHMS.md',
        },
      ],
      externalReferences: [
        {
          title: 'OpenAI Structured Outputs',
          url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
        },
        {
          title: 'OpenAI Function Calling',
          url: 'https://developers.openai.com/api/docs/guides/function-calling',
        },
      ],
    };
  }

  private assertOwner(user: AuthUser) {
    if (!user.administrationEnabled) {
      throw new ForbiddenException('Раздел доступен только назначенному владельцу WMS.');
    }
  }

  private demoSettingKey(user: AuthUser, key: string) {
    return `demo-plus.${user.id}.${key}`;
  }

  private async buildLocalAssistantPlan(prompt: string) {
    const normalized = prompt.toLocaleLowerCase('ru-RU');
    const prefixMatch = prompt.match(
      /префикс(?:а|ы)?(?:\s+короб(?:а|ов))?.{0,30}?(?:на|=)\s*[«"'`]?([A-ZА-ЯЁ0-9_-]{1,32})/iu,
    );
    if (prefixMatch?.[1]) {
      const prefix = prefixMatch[1].toLocaleUpperCase('ru-RU');
      return {
        title: `Изменить основной префикс коробов на ${prefix}`,
        summary:
          'Новый префикс станет основным. Старые префиксы сохранятся разрешёнными, поэтому существующие короба продолжат работать.',
        risk: 'MEDIUM',
        recommendations: [
          'Сначала напечатайте тестовую этикетку.',
          'Не переименовывайте существующие короба массово без отдельного плана миграции.',
          'После применения проверьте веб-приёмку и ТСД.',
        ],
        rollback: 'Вернуть прежний основной префикс в настройках коробов.',
        actions: [{ type: 'UPDATE_BOX_PREFIX', prefix, executable: true }],
      };
    }
    if (
      (normalized.includes('wildberries') || normalized.includes('wb') || normalized.includes('вб')) &&
      (normalized.includes('проверь') || normalized.includes('диагност'))
    ) {
      return {
        title: 'Проверить подключения Wildberries',
        summary:
          'Будут выполнены только читающие запросы к API: срок токена, список складов, новые и исторические FBS-заказы.',
        risk: 'LOW',
        recommendations: ['Запускать повторно не чаще раза в минуту для одного кабинета.'],
        rollback: 'Не требуется: данные не изменяются.',
        actions: [{ type: 'RUN_WB_DIAGNOSTICS', executable: true }],
      };
    }
    return {
      title: 'Изменение программной логики WMS',
      summary:
        'Запрос не сводится к разрешённой системной настройке. ИИ подготовил безопасный маршрут, но автоматическое изменение production-кода запрещено.',
      risk: 'HIGH',
      recommendations: [
        'Определить затрагиваемый модуль и ожидаемый результат на конкретном примере.',
        'Создать автоматическую проверку текущего и нового поведения.',
        'Сделать резервную точку, применить изменение в исходниках и выполнить сборку.',
        'Показать diff владельцу и только затем развернуть production с планом отката.',
      ],
      rollback: 'Вернуть предыдущий образ API/Web и восстановить настройку либо данные из резервной точки.',
      actions: [{ type: 'CODE_CHANGE_REQUEST', executable: false }],
    };
  }
}

function normalizeAiSettings(value: unknown) {
  const input = asRecord(value);
  const model = text(input.model) || AI_DEFAULTS.model;
  const approvalMode = text(input.approvalMode).toUpperCase();
  return {
    enabled: input.enabled === true,
    provider: 'OPENAI',
    model: model.slice(0, 100),
    approvalMode: ['ALWAYS', 'HIGH_RISK_ONLY'].includes(approvalMode)
      ? approvalMode
      : 'ALWAYS',
    allowAutomatedSettings: input.allowAutomatedSettings !== false,
    allowCodeChanges: false,
    locations: Array.isArray(input.locations)
      ? [...new Set(input.locations.map(text).filter(Boolean))].slice(0, 30)
      : AI_DEFAULTS.locations,
    systemPrompt: (text(input.systemPrompt) || AI_DEFAULTS.systemPrompt).slice(0, 4000),
  };
}

function normalizeSettingValue(key: string, value: unknown) {
  if (key === 'operations.autoRefreshSeconds' || key === 'inventory.reviewRefreshSeconds') {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 2 || number > 300) {
      throw new BadRequestException('Интервал должен быть целым числом от 2 до 300 секунд.');
    }
    return number;
  }
  if (key === 'marketplace.diagnostics') {
    const input = asRecord(value);
    const intervalMinutes = Number(input.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
      throw new BadRequestException('Интервал диагностики должен быть от 5 до 1440 минут.');
    }
    return {
      enabled: input.enabled !== false,
      intervalMinutes,
      notifyOwners: input.notifyOwners !== false,
    };
  }
  return jsonSafe(value);
}

function normalizeWorkspaceOverrides(value: unknown) {
  const source = asRecord(value);
  const result: Partial<Record<WorkspaceId, boolean>> = {};
  for (const workspaceId of WORKSPACE_IDS) {
    if (typeof source[workspaceId] === 'boolean') result[workspaceId] = source[workspaceId] as boolean;
  }
  return result;
}

function requiredReason(value: string | undefined) {
  const reason = value?.trim() ?? '';
  if (reason.length < 3 || reason.length > 500) {
    throw new BadRequestException('Укажите причину изменения длиной от 3 до 500 символов.');
  }
  return reason;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    throw new BadRequestException('Значение не является корректным JSON.');
  }
}

async function diagnoseWildberries(connection: MarketplaceConnectionForDiagnostics) {
  const headers = { Authorization: connection.apiKey, 'Content-Type': 'application/json' };
  const token = inspectJwt(connection.apiKey);
  const [warehouses, newOrders, history] = await Promise.all([
    safeMarketplaceRequest('https://marketplace-api.wildberries.ru/api/v3/warehouses', { headers }),
    safeMarketplaceRequest('https://marketplace-api.wildberries.ru/api/v3/orders/new', { headers }),
    safeMarketplaceRequest(
      'https://marketplace-api.wildberries.ru/api/v3/orders?limit=1&next=0',
      { headers },
    ),
  ]);
  const warehouseRows = Array.isArray(warehouses.body) ? warehouses.body : [];
  const newRows = arrayFromBody(newOrders.body, 'orders');
  const historyRows = arrayFromBody(history.body, 'orders');
  const tokenExpiresAt = typeof token?.exp === 'number' ? token.exp : null;
  return {
    connectionId: connection.id,
    client: connection.client,
    marketplace: connection.marketplace,
    accountName: connection.accountName,
    healthy: warehouses.ok && newOrders.ok && history.ok,
    token: {
      format: token ? 'JWT' : 'OPAQUE',
      expiresAt: tokenExpiresAt ? new Date(tokenExpiresAt * 1000).toISOString() : null,
      expired: tokenExpiresAt ? tokenExpiresAt * 1000 <= Date.now() : null,
      test: token?.t === true,
    },
    connectedWarehouse: {
      id: connection.fbsWarehouseId,
      name: connection.fbsWarehouseName,
      valid:
        !connection.fbsWarehouseId ||
        warehouseRows.some((item) => String(asRecord(item).id) === connection.fbsWarehouseId),
    },
    capabilities: {
      warehouses: capability(warehouses, warehouseRows.length),
      newFbsOrders: capability(newOrders, newRows.length),
      orderHistory: capability(history, historyRows.length),
    },
    warehouses: warehouseRows.slice(0, 30).map((item) => {
      const row = asRecord(item);
      return {
        id: text(row.id),
        name: text(row.name),
        officeId: row.officeId ?? null,
        deliveryType: row.deliveryType ?? null,
      };
    }),
  };
}

async function diagnoseOzon(connection: MarketplaceConnectionForDiagnostics) {
  if (!connection.sellerId) {
    return {
      connectionId: connection.id,
      client: connection.client,
      marketplace: connection.marketplace,
      accountName: connection.accountName,
      healthy: false,
      error: 'Не заполнен Ozon Client-Id.',
    };
  }
  const response = await safeMarketplaceRequest('https://api-seller.ozon.ru/v1/seller/info', {
    method: 'POST',
    headers: {
      'Client-Id': connection.sellerId,
      'Api-Key': connection.apiKey,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return {
    connectionId: connection.id,
    client: connection.client,
    marketplace: connection.marketplace,
    accountName: connection.accountName,
    healthy: response.ok,
    capability: capability(response, response.ok ? 1 : 0),
  };
}

async function safeMarketplaceRequest(url: string, init: RequestInit) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body,
      error: response.ok ? null : marketplaceMessage(body, response.status),
    };
  } catch (caught) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      body: {},
      error: caught instanceof Error ? caught.message : 'Ошибка подключения.',
    };
  }
}

function capability(
  result: Awaited<ReturnType<typeof safeMarketplaceRequest>>,
  count: number,
) {
  return {
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    count,
    error: result.error,
  };
}

function marketplaceMessage(value: unknown, status: number) {
  const body = asRecord(value);
  return (
    text(body.message) ||
    text(body.detail) ||
    text(body.error) ||
    `Маркетплейс вернул HTTP ${status}.`
  );
}

function administrationJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function administrationMoscowDayRange(value?: string) {
  const nowInMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requested = String(value ?? '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : nowInMoscow;
  const from = new Date(`${date}T00:00:00+03:00`);
  if (Number.isNaN(from.getTime())) {
    throw new BadRequestException('Дата статистики должна быть в формате ГГГГ-ММ-ДД.');
  }
  const normalized = new Date(from.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (normalized !== date) {
    throw new BadRequestException('Указана несуществующая календарная дата.');
  }
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const label = `За ${new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(from)}`;
  return { date, from, to, label };
}

function administrationText(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim();
  return normalized || null;
}

export function administrationCanonicalTsdDeviceCode(value: string) {
  const normalized = String(value ?? '').trim();
  if (!/^TSD-INSTALL-/i.test(normalized)) return normalized;
  return normalized.split('@', 1)[0].toUpperCase();
}

function administrationVirtualTsdLogin(deviceId: string) {
  const normalized = String(deviceId ?? '').trim();
  if (!/^USER:/i.test(normalized)) return null;

  // Monitor identifiers append a short discriminator so simultaneous TSD
  // sessions do not overwrite each other's heartbeat. It is not part of the
  // WMS login: USER:ADMIN@B045E060 must be matched as USER:ADMIN.
  const login = normalized
    .slice('USER:'.length)
    .replace(/@[0-9A-F]{8}$/i, '')
    .trim()
    .toLowerCase();
  return login || null;
}

function administrationNumber(value: Record<string, unknown>, key: string) {
  const candidate = Number(value[key]);
  return Number.isFinite(candidate) ? Math.trunc(candidate) : null;
}

function administrationOperationRequestId(
  operationKey: string,
  operationType: string,
  payload: Record<string, unknown>,
) {
  const payloadRequestId = administrationText(payload, 'requestId');
  if (payloadRequestId) return payloadRequestId;
  if (operationType === 'box_search_scan') {
    const parts = operationKey.split(':');
    return parts.length >= 3 ? parts[1] : '';
  }
  return '';
}

function administrationOperationStage(operationType: string, payload: Record<string, unknown>) {
  if (operationType === 'box_search_scan') return 'box-search';
  if (operationType === 'move_scan') return 'moves';
  return administrationText(payload, 'stage') ?? 'open';
}

function administrationStageLabel(stage: string) {
  const labels: Record<string, string> = {
    open: 'Открыта заявка',
    'box-search': 'Поиск коробов',
    relabel: 'Переклейка',
    moves: 'Перемещения',
    'boxless-packing': 'Сборка без коробов',
    packed: 'Упаковано',
  };
  return labels[stage] ?? stage;
}

function administrationRequestSummary(request: {
  id: string;
  number: number;
  title: string;
  status: unknown;
  client: { id: string; code: string; name: string };
}) {
  return {
    id: request.id,
    number: request.number,
    title: request.title,
    status: String(request.status),
    client: request.client,
  };
}

function administrationProtectedFbsReason(task: {
  orderId: string;
  kiz: string | null;
  wbMetaStatus: string;
  relabelConfirmedAt: Date | null;
}) {
  if (task.kiz || task.wbMetaStatus === 'ACCEPTED') {
    return `Заказ ${task.orderId}: КИЗ уже принят маркетплейсом. Сначала отмените или подтвердите решение по КИЗ.`;
  }
  if (task.relabelConfirmedAt) {
    return `Заказ ${task.orderId}: переклейка уже подтверждена и учтена в остатках.`;
  }
  return null;
}

function administrationVersionAtLeast(value: string | null | undefined, minimum: string) {
  const parse = (version: string | null | undefined) => String(version ?? '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
  const actual = parse(value);
  const required = parse(minimum);
  const length = Math.max(actual.length, required.length);
  for (let index = 0; index < length; index += 1) {
    const left = actual[index] ?? 0;
    const right = required[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function inspectJwt(value: string) {
  try {
    const payload = value.split('.')[1];
    return payload
      ? (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
          string,
          unknown
        >)
      : null;
  } catch {
    return null;
  }
}

function arrayFromBody(value: unknown, key: string) {
  const body = asRecord(value);
  return Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
}

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function memoryUsageMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function cleanupTemporaryFiles(now: number) {
  const empty = { roots: [] as string[], scanned: 0, deleted: 0, freedBytes: 0, freedMb: 0 };
  if (process.platform !== 'linux' || process.env.NODE_ENV !== 'production') return empty;

  const configured = String(process.env.WMS_TEMP_DIRS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const roots = [...new Set([tmpdir(), '/app/tmp', '/app/exports', ...configured].map((item) => resolve(item)))]
    .filter((root) => root === '/tmp' || (root.startsWith('/app/') && /(?:tmp|temp|cache|exports?)/i.test(root)));
  const retentionHours = Math.min(720, Math.max(6, Number(process.env.WMS_TEMP_RETENTION_HOURS) || 48));
  const cutoff = now - retentionHours * 60 * 60 * 1000;
  const result = { ...empty, roots };
  const scanLimit = 20_000;

  const visit = async (directory: string): Promise<void> => {
    if (result.scanned >= scanLimit) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.scanned >= scanLimit) break;
      const path = resolve(directory, entry.name);
      if (!path.startsWith(`${directory}/`) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      result.scanned += 1;
      try {
        const info = await lstat(path);
        if (info.mtimeMs >= cutoff) continue;
        await unlink(path);
        result.deleted += 1;
        result.freedBytes += info.size;
      } catch {
        // Файл мог исчезнуть или использоваться между проверкой и удалением.
      }
    }
  };
  for (const root of roots) await visit(root);
  result.freedMb = Math.round((result.freedBytes / 1024 / 1024) * 100) / 100;
  return result;
}

type MarketplaceConnectionForDiagnostics = Prisma.ClientMarketplaceConnectionGetPayload<{
  include: { client: { select: { id: true; code: true; name: true } } };
}>;
