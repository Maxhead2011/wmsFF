import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  ClientNotificationSeverity,
  MovementType,
  PickWaveBalanceReviewStatus,
  PickWaveRequestStatus,
  PickWaveStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { CreatePickWaveDto } from './dto/create-pick-wave.dto';
import { ListPickWavesDto } from './dto/list-pick-waves.dto';
import { RunPickWaveDto } from './dto/run-pick-wave.dto';
import { UpdatePickWaveBalanceReviewDto } from './dto/update-pick-wave-balance-review.dto';
import { pickWaveInclude } from './pick-wave.include';
import { PickInstructionService } from './pick-instruction.service';
import { StockOperationsService } from './stock-operations.service';

const pickWaveRequestStatuses: ClientRequestStatus[] = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
];

const balanceReviewInclude = {
  requests: {
    include: {
      request: {
        select: {
          id: true,
          clientId: true,
          title: true,
          status: true,
          destinationCity: true,
          client: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: { requestId: 'asc' },
  },
  balanceLines: {
    include: {
      allocations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
    orderBy: [{ sourceBoxCode: 'asc' }, { internalSku: 'asc' }],
  },
  createdBy: { select: { id: true, email: true, name: true } },
  assignedPicker: { select: { id: true, email: true, name: true } },
} satisfies Prisma.PickWaveInclude;

type BalanceReviewWave = Prisma.PickWaveGetPayload<{ include: typeof balanceReviewInclude }>;

@Injectable()
export class FulfillmentWaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly operations: StockOperationsService,
    private readonly pickInstructions: PickInstructionService,
    private readonly telegram: TelegramNotificationService,
  ) {}

  listWaves(query: ListPickWavesDto, user: AuthUser) {
    return this.prisma.pickWave.findMany({
      where: {
        status: query.status,
        requests: {
          some: {
            request: {
              clientId: this.clientScopes.resolveClientFilter(user),
            },
          },
        },
      },
      include: pickWaveInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
  }

  async createWave(dto: CreatePickWaveDto, user: AuthUser) {
    const requestIds = [...new Set(dto.requestIds.map((id) => id.trim()).filter(Boolean))];
    const assignedPickerUserId = await this.resolveAssignedPickerId(dto.assignedPickerUserId);
    if (requestIds.length === 0) {
      throw new BadRequestException('Для волны сборки нужна хотя бы одна заявка.');
    }

    const requests = await this.prisma.clientRequest.findMany({
      where: { id: { in: requestIds } },
      include: { items: true },
    });
    if (requests.length !== requestIds.length) {
      throw new NotFoundException('Одна или несколько заявок для волны не найдены.');
    }

    const busyLinks = await this.prisma.pickWaveRequest.findMany({
      where: {
        requestId: { in: requestIds },
        wave: { status: { notIn: [PickWaveStatus.CANCELLED, PickWaveStatus.DONE] } },
      },
      include: { wave: true },
    });
    if (busyLinks.length > 0) {
      throw new BadRequestException('Одна или несколько заявок уже входят в активную волну сборки.');
    }

    if (new Set(requests.map((request) => request.clientId)).size !== 1) {
      throw new BadRequestException('В одной волне могут находиться только заявки одного клиента.');
    }

    for (const request of requests) {
      this.clientScopes.requireClientAccess(user, request.clientId, 'write');
      if (request.type !== ClientRequestType.OUTBOUND) {
        throw new BadRequestException('В волну сборки можно добавлять только outbound-заявки.');
      }
      if (!pickWaveRequestStatuses.includes(request.status)) {
        throw new BadRequestException('В волну можно добавлять новые, проверяемые, согласованные или уже переданные в работу заявки.');
      }
      if (request.items.length === 0) {
        throw new BadRequestException('В заявке нет товарных позиций для сборки.');
      }
    }

    const draft = await this.pickInstructions.buildWaveDraft(requestIds, user);
    const waveNumber = this.nextWaveNumber();
    const generatedAt = new Date(draft.generatedAt);
    const needsBalanceReview = draft.balanceLines.length > 0;
    const wave = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pickWave.create({
        data: {
          waveNumber,
          status: needsBalanceReview ? PickWaveStatus.BALANCE_REVIEW : PickWaveStatus.FROZEN,
          comment: dto.comment?.trim() || undefined,
          plan: this.toJson(draft.plan),
          planGeneratedAt: generatedAt,
          planFrozenAt: needsBalanceReview ? undefined : generatedAt,
          balanceReviewStatus: needsBalanceReview
            ? PickWaveBalanceReviewStatus.PENDING
            : PickWaveBalanceReviewStatus.NOT_REQUIRED,
          createdByUserId: user.id,
          assignedPickerUserId,
          requests: {
            create: requestIds.map((requestId) => ({ requestId })),
          },
          balanceLines: {
            create: draft.balanceLines.map((line) => ({
              ...line,
              sourceBoxId: line.sourceBoxId ?? undefined,
              barcode: line.barcode ?? undefined,
              color: line.color ?? undefined,
              size: line.size ?? undefined,
            })),
          },
        },
        include: pickWaveInclude,
      });

      for (const request of requests) {
        if (request.status !== ClientRequestStatus.IN_WORK) {
          await tx.clientRequest.update({
            where: { id: request.id },
            data: { status: ClientRequestStatus.IN_WORK, assignedToUserId: assignedPickerUserId ?? user.id },
          });
          await tx.clientRequestEvent.create({
            data: {
              requestId: request.id,
              clientId: request.clientId,
              eventType: ClientRequestEventType.STATUS_CHANGED,
              title: `Заявка включена в волну ${waveNumber}`,
              body: needsBalanceReview
                ? 'Сформирована общая инструкция. Требуется проверка складских балансов клиентом.'
                : 'Общая инструкция сформирована и зафиксирована.',
              statusFrom: request.status,
              statusTo: ClientRequestStatus.IN_WORK,
              createdByUserId: user.id,
            },
          });
        }
      }

      if (needsBalanceReview) {
        await tx.clientNotification.create({
          data: {
            clientId: requests[0].clientId,
            requestId: requests[0].id,
            title: 'Требуется проверить балансы волны',
            body: `${waveNumber}: распределите остатки по городам или подтвердите хранение на складе. Строк: ${draft.balanceLines.length}.`,
            severity: ClientNotificationSeverity.WARNING,
            createdByUserId: user.id,
          },
        });
      }

      return created;
    });

    if (needsBalanceReview) {
      void this.telegram.notifyClient(
        requests[0].clientId,
        [
          'LOGOff WMS: требуется проверить балансы.',
          `Волна: ${waveNumber}`,
          `Заявок: ${requests.length}`,
          `Остатков для решения: ${draft.balanceLines.length}`,
          'Откройте раздел заявок и нажмите «Проверить балансы».',
        ].join('\n'),
      );
    }

    requestIds.forEach((requestId) => this.pickInstructions.invalidateRequestInstruction(requestId));
    return wave;
  }

  async listBalanceReviews(user: AuthUser) {
    const waves = await this.prisma.pickWave.findMany({
      where: {
        balanceReviewStatus: {
          in: [PickWaveBalanceReviewStatus.PENDING, PickWaveBalanceReviewStatus.SUBMITTED],
        },
        requests: {
          some: {
            request: { clientId: this.clientScopes.resolveClientFilter(user) },
          },
        },
      },
      include: balanceReviewInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
    return waves.map((wave) => this.toBalanceReviewResponse(wave));
  }

  async getBalanceReview(waveId: string, user: AuthUser) {
    const wave = await this.loadBalanceReview(waveId);
    this.requireWaveClientAccess(wave, user, 'read');
    return this.toBalanceReviewResponse(wave);
  }

  async saveBalanceReview(waveId: string, dto: UpdatePickWaveBalanceReviewDto, user: AuthUser) {
    const wave = await this.loadBalanceReview(waveId);
    this.requireWaveClientAccess(wave, user, 'write');
    if (
      wave.status !== PickWaveStatus.BALANCE_REVIEW ||
      wave.balanceReviewStatus !== PickWaveBalanceReviewStatus.PENDING
    ) {
      throw new BadRequestException('Проверка балансов этой волны уже закрыта.');
    }

    const linesById = new Map(wave.balanceLines.map((line) => [line.id, line]));
    const requestIds = new Set(wave.requests.map((link) => link.requestId));
    const seenLineIds = new Set<string>();
    for (const decision of dto.decisions) {
      const line = linesById.get(decision.lineId);
      if (!line) {
        throw new BadRequestException('Строка баланса не относится к выбранной волне.');
      }
      if (seenLineIds.has(decision.lineId)) {
        throw new BadRequestException('Одна строка баланса передана несколько раз.');
      }
      seenLineIds.add(decision.lineId);
      const allocatedQuantity = decision.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      if (allocatedQuantity + decision.keepQuantity !== line.remainingQuantity) {
        throw new BadRequestException(
          `Для ${line.sourceBoxCode} / ${line.internalSku} распределите ровно ${line.remainingQuantity} шт.`,
        );
      }
      for (const allocation of decision.allocations) {
        if (!requestIds.has(allocation.requestId)) {
          throw new BadRequestException('Остаток можно отправить только в заявку этой волны.');
        }
        const targetBarcode = allocation.targetBarcode?.trim() ?? '';
        if (allocation.needsRelabel && !targetBarcode) {
          throw new BadRequestException('Для перемаркировки укажите новый штрихкод.');
        }
        if (allocation.needsRelabel && targetBarcode === (line.barcode ?? '').trim()) {
          throw new BadRequestException('Новый штрихкод перемаркировки должен отличаться от исходного.');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const decision of dto.decisions) {
        await tx.pickWaveBalanceAllocation.deleteMany({ where: { lineId: decision.lineId } });
        await tx.pickWaveBalanceLine.update({
          where: { id: decision.lineId },
          data: {
            keepQuantity: decision.keepQuantity,
            isReviewed: true,
            comment: normalizeOptionalText(decision.comment),
            allocations: {
              create: decision.allocations.map((allocation) => ({
                requestId: allocation.requestId,
                quantity: allocation.quantity,
                needsRelabel: allocation.needsRelabel === true,
                targetBarcode: allocation.needsRelabel ? normalizeOptionalText(allocation.targetBarcode) : null,
                comment: normalizeOptionalText(allocation.comment),
              })),
            },
          },
        });
      }
    });

    return this.getBalanceReview(waveId, user);
  }

  async submitBalanceReview(waveId: string, user: AuthUser) {
    let wave = await this.loadBalanceReview(waveId);
    this.requireWaveClientAccess(wave, user, 'write');
    if (wave.balanceReviewStatus === PickWaveBalanceReviewStatus.APPROVED) {
      return this.toBalanceReviewResponse(wave);
    }
    if (wave.status !== PickWaveStatus.BALANCE_REVIEW) {
      throw new BadRequestException('Волна не ожидает проверки балансов.');
    }
    this.validateCompleteBalanceReview(wave);

    if (wave.balanceReviewStatus === PickWaveBalanceReviewStatus.PENDING) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.pickWave.updateMany({
          where: {
            id: waveId,
            status: PickWaveStatus.BALANCE_REVIEW,
            balanceReviewStatus: PickWaveBalanceReviewStatus.PENDING,
          },
          data: {
            balanceReviewStatus: PickWaveBalanceReviewStatus.SUBMITTED,
            balanceReviewSubmittedAt: new Date(),
            balanceReviewSubmittedByUserId: user.id,
          },
        });
        if (locked.count !== 1) {
          throw new BadRequestException('Проверка балансов уже отправляется другим пользователем.');
        }

        const requestById = new Map(wave.requests.map((link) => [link.requestId, link.request]));
        const affectedRequestIds = new Set<string>();
        for (const line of wave.balanceLines) {
          for (const allocation of line.allocations) {
            const request = requestById.get(allocation.requestId);
            if (!request) {
              throw new BadRequestException('Заявка назначения не найдена в волне.');
            }
            const item = await tx.clientRequestItem.create({
              data: {
                requestId: request.id,
                skuId: line.skuId,
                barcode: line.barcode,
                name: line.name,
                quantity: allocation.quantity,
                comment: balanceReviewItemComment(wave.waveNumber, line, request, allocation),
              },
            });
            await tx.pickWaveBalanceAllocation.update({
              where: { id: allocation.id },
              data: { appliedRequestItemId: item.id },
            });
            affectedRequestIds.add(request.id);
          }
        }

        for (const requestId of affectedRequestIds) {
          const request = requestById.get(requestId)!;
          await tx.clientRequestEvent.create({
            data: {
              requestId,
              clientId: request.clientId,
              eventType: ClientRequestEventType.COMMENT,
              title: `Добавлены товары из балансов волны ${wave.waveNumber}`,
              body: 'Количество заявки дополнено решением клиента при проверке складских остатков.',
              createdByUserId: user.id,
            },
          });
        }
      });
      wave = await this.loadBalanceReview(waveId);
    }

    const forcedAllocations = wave.balanceLines.flatMap((line) =>
      line.allocations.map((allocation) => {
        if (!allocation.appliedRequestItemId) {
          throw new BadRequestException('Не удалось связать распределение баланса с позицией заявки.');
        }
        return {
          orderId: allocation.appliedRequestItemId,
          balanceId: line.balanceId,
          quantity: allocation.quantity,
        };
      }),
    );
    const requestIds = wave.requests.map((link) => link.requestId);
    const finalDraft = await this.pickInstructions.buildWaveDraft(requestIds, user, forcedAllocations);
    const approvedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.pickWave.update({
        where: { id: waveId },
        data: {
          status: PickWaveStatus.FROZEN,
          balanceReviewStatus: PickWaveBalanceReviewStatus.APPROVED,
          plan: this.toJson(finalDraft.plan),
          planVersion: { increment: 1 },
          planGeneratedAt: new Date(finalDraft.generatedAt),
          planFrozenAt: approvedAt,
        },
      });
      await tx.clientNotification.create({
        data: {
          clientId: wave.requests[0].request.clientId,
          requestId: wave.requests[0].requestId,
          title: 'Балансы подтверждены',
          body: `${wave.waveNumber}: распределение сохранено, инструкция зафиксирована для склада.`,
          createdByUserId: user.id,
        },
      });
    });

    requestIds.forEach((requestId) => this.pickInstructions.invalidateRequestInstruction(requestId));
    void this.telegram.notifyClient(
      wave.requests[0].request.clientId,
      `LOGOff WMS: балансы волны ${wave.waveNumber} подтверждены. Инструкция передана складу.`,
    );
    void this.telegram.notifyFulfillment(
      `LOGOff WMS: клиент подтвердил балансы волны ${wave.waveNumber}. Можно начинать сборку.`,
    );
    return this.getBalanceReview(waveId, user);
  }

  async runWave(waveId: string, dto: RunPickWaveDto, user: AuthUser) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id: waveId },
      include: pickWaveInclude,
    });
    if (!wave) {
      throw new NotFoundException('Волна сборки не найдена.');
    }
    this.requireWaveClientAccess(wave, user, 'write');
    if (wave.status === PickWaveStatus.CANCELLED) {
      throw new BadRequestException('Отмененную волну сборки нельзя запускать.');
    }
    if (wave.status === PickWaveStatus.DONE) {
      throw new BadRequestException('Волна сборки уже завершена.');
    }
    if (
      wave.status === PickWaveStatus.BALANCE_REVIEW ||
      wave.balanceReviewStatus === PickWaveBalanceReviewStatus.PENDING ||
      wave.balanceReviewStatus === PickWaveBalanceReviewStatus.SUBMITTED
    ) {
      throw new BadRequestException('Сначала клиент должен проверить и подтвердить складские балансы волны.');
    }

    const locked = await this.prisma.pickWave.updateMany({
      where: { id: wave.id, status: wave.status },
      data: { status: PickWaveStatus.PICKING },
    });
    if (locked.count !== 1) {
      throw new BadRequestException('Состояние волны изменилось. Обновите список и повторите действие.');
    }

    const runResults = [];
    let failedCount = 0;

    for (const waveRequest of wave.requests) {
      if (waveRequest.status === PickWaveRequestStatus.PICKED) {
        runResults.push({
          requestId: waveRequest.requestId,
          status: 'SKIPPED_ALREADY_PICKED',
        });
        continue;
      }

      try {
        // Русский комментарий: волна использует уже существующий idempotent pick-request,
        // поэтому повтор запуска не дублирует движения stock ledger.
        const result = await this.operations.pickClientRequest(
          {
            requestId: waveRequest.requestId,
            idempotencyKey: `${dto.idempotencyKey ?? `wave-pick:${wave.id}`}:${waveRequest.requestId}`,
            comment: dto.comment?.trim() || `Волна сборки ${wave.waveNumber}`,
          },
          user,
        );
        await this.prisma.pickWaveRequest.update({
          where: { waveId_requestId: { waveId: wave.id, requestId: waveRequest.requestId } },
          data: {
            status: PickWaveRequestStatus.PICKED,
            pickedAt: new Date(),
            result: this.toJson(result),
          },
        });
        runResults.push({
          requestId: waveRequest.requestId,
          status: result.status,
        });
      } catch (caught) {
        failedCount += 1;
        const message = caught instanceof Error ? caught.message : 'Не удалось собрать заявку в волне.';
        await this.prisma.pickWaveRequest.update({
          where: { waveId_requestId: { waveId: wave.id, requestId: waveRequest.requestId } },
          data: {
            status: PickWaveRequestStatus.FAILED,
            result: { message },
          },
        });
        runResults.push({
          requestId: waveRequest.requestId,
          status: 'FAILED',
          message,
        });
      }
    }

    const status = failedCount > 0 ? PickWaveStatus.FAILED : PickWaveStatus.DONE;
    const updatedWave = await this.prisma.pickWave.update({
      where: { id: wave.id },
      data: { status },
      include: pickWaveInclude,
    });

    return {
      wave: updatedWave,
      results: runResults,
    };
  }

  async cancelWave(waveId: string, user: AuthUser) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id: waveId },
      include: pickWaveInclude,
    });
    if (!wave) {
      throw new NotFoundException('Волна сборки не найдена.');
    }
    this.requireWaveClientAccess(wave, user, 'write');

    if (wave.status === PickWaveStatus.CANCELLED) {
      return wave;
    }
    if (wave.status === PickWaveStatus.DONE) {
      throw new BadRequestException('Завершённую волну отменить нельзя.');
    }
    if (wave.status === PickWaveStatus.PICKING) {
      throw new BadRequestException('Сборка этой волны уже выполняется. Дождитесь её завершения.');
    }
    if (wave.requests.some((link) => link.status === PickWaveRequestStatus.PICKED)) {
      throw new BadRequestException('В волне уже есть собранные заявки. Отмена может повредить складские остатки.');
    }

    const requestIds = wave.requests.map((link) => link.requestId);
    const movementCount = await this.prisma.stockMovement.count({
      where: {
        type: MovementType.PICK,
        sourceDocument: { in: requestIds },
        idempotencyKey: { contains: wave.id },
      },
    });
    if (movementCount > 0) {
      throw new BadRequestException('По волне уже проведены складские движения. Безопасная отмена невозможна.');
    }

    const [statusEvents, appliedAllocations] = await Promise.all([
      this.prisma.clientRequestEvent.findMany({
        where: {
          requestId: { in: requestIds },
          eventType: ClientRequestEventType.STATUS_CHANGED,
          title: `Заявка включена в волну ${wave.waveNumber}`,
          statusTo: ClientRequestStatus.IN_WORK,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pickWaveBalanceAllocation.findMany({
        where: {
          line: { waveId },
          appliedRequestItemId: { not: null },
        },
        select: { id: true, appliedRequestItemId: true },
      }),
    ]);
    const previousStatusByRequest = new Map<string, ClientRequestStatus>();
    for (const event of statusEvents) {
      if (event.statusFrom && !previousStatusByRequest.has(event.requestId)) {
        previousStatusByRequest.set(event.requestId, event.statusFrom);
      }
    }
    const appliedRequestItemIds = appliedAllocations
      .map((allocation) => allocation.appliedRequestItemId)
      .filter((id): id is string => Boolean(id));
    if (appliedRequestItemIds.length > 0) {
      const usedAppliedItems = await this.prisma.clientRequestItem.count({
        where: {
          id: { in: appliedRequestItemIds },
          OR: [{ packageItems: { some: {} } }, { boxSelections: { some: {} } }],
        },
      });
      if (usedAppliedItems > 0) {
        throw new BadRequestException('Добавленные при согласовании позиции уже используются в сборке. Отмена невозможна.');
      }
    }
    const cancelledAt = new Date();
    const cancellationNote = `Отменена ${cancelledAt.toLocaleString('ru-RU')} пользователем ${user.name}.`;

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.pickWave.updateMany({
        where: { id: wave.id, status: wave.status },
        data: {
          status: PickWaveStatus.CANCELLED,
          balanceReviewStatus: PickWaveBalanceReviewStatus.NOT_REQUIRED,
          comment: [wave.comment?.trim(), cancellationNote].filter(Boolean).join('\n'),
        },
      });
      if (locked.count !== 1) {
        throw new BadRequestException('Состояние волны изменилось. Обновите список и повторите отмену.');
      }

      if (appliedAllocations.length > 0) {
        await tx.pickWaveBalanceAllocation.updateMany({
          where: { id: { in: appliedAllocations.map((allocation) => allocation.id) } },
          data: { appliedRequestItemId: null },
        });
      }
      if (appliedRequestItemIds.length > 0) {
        await tx.clientRequestItem.deleteMany({ where: { id: { in: appliedRequestItemIds } } });
      }

      for (const link of wave.requests) {
        const previousStatus = previousStatusByRequest.get(link.requestId);
        const canRestore = link.request.status === ClientRequestStatus.IN_WORK && previousStatus !== undefined;
        if (canRestore) {
          await tx.clientRequest.update({
            where: { id: link.requestId },
            data: { status: previousStatus },
          });
        }
        await tx.clientRequestEvent.create({
          data: {
            requestId: link.requestId,
            clientId: link.request.clientId,
            eventType: canRestore ? ClientRequestEventType.STATUS_CHANGED : ClientRequestEventType.COMMENT,
            title: `Волна ${wave.waveNumber} отменена`,
            body: canRestore
              ? 'Заявка освобождена и снова доступна для включения в волну.'
              : 'Волна отменена без изменения текущего статуса заявки.',
            statusFrom: canRestore ? link.request.status : undefined,
            statusTo: canRestore ? previousStatus : undefined,
            createdByUserId: user.id,
          },
        });
      }
    });

    requestIds.forEach((requestId) => this.pickInstructions.invalidateRequestInstruction(requestId));
    return this.prisma.pickWave.findUniqueOrThrow({
      where: { id: wave.id },
      include: pickWaveInclude,
    });
  }

  private async loadBalanceReview(waveId: string) {
    const wave = await this.prisma.pickWave.findUnique({
      where: { id: waveId },
      include: balanceReviewInclude,
    });
    if (!wave) {
      throw new NotFoundException('Волна сборки не найдена.');
    }
    return wave;
  }

  private requireWaveClientAccess(
    wave: { requests: Array<{ request: { clientId: string } }> },
    user: AuthUser,
    mode: 'read' | 'write',
  ) {
    const clientIds = [...new Set(wave.requests.map((link) => link.request.clientId))];
    if (clientIds.length !== 1) {
      throw new BadRequestException('В волне обнаружены заявки разных клиентов.');
    }
    this.clientScopes.requireClientAccess(user, clientIds[0], mode);
  }

  private validateCompleteBalanceReview(wave: BalanceReviewWave) {
    const requestIds = new Set(wave.requests.map((link) => link.requestId));
    for (const line of wave.balanceLines) {
      if (!line.isReviewed || line.keepQuantity === null) {
        throw new BadRequestException(`Не принято решение по ${line.sourceBoxCode} / ${line.internalSku}.`);
      }
      const allocated = line.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      if (allocated + line.keepQuantity !== line.remainingQuantity) {
        throw new BadRequestException(
          `Для ${line.sourceBoxCode} / ${line.internalSku} распределено не ${line.remainingQuantity} шт.`,
        );
      }
      for (const allocation of line.allocations) {
        if (!requestIds.has(allocation.requestId)) {
          throw new BadRequestException('Одна из строк распределена в заявку вне волны.');
        }
        if (allocation.needsRelabel && !allocation.targetBarcode?.trim()) {
          throw new BadRequestException('Для перемаркировки не указан новый штрихкод.');
        }
      }
    }
  }

  private toBalanceReviewResponse(wave: BalanceReviewWave) {
    const reviewedLines = wave.balanceLines.filter((line) => line.isReviewed).length;
    const totalRemaining = wave.balanceLines.reduce((sum, line) => sum + line.remainingQuantity, 0);
    const allocatedQuantity = wave.balanceLines.reduce(
      (sum, line) => sum + line.allocations.reduce((lineSum, allocation) => lineSum + allocation.quantity, 0),
      0,
    );
    return {
      id: wave.id,
      waveNumber: wave.waveNumber,
      status: wave.status,
      balanceReviewStatus: wave.balanceReviewStatus,
      planVersion: wave.planVersion,
      planGeneratedAt: wave.planGeneratedAt?.toISOString() ?? null,
      planFrozenAt: wave.planFrozenAt?.toISOString() ?? null,
      createdAt: wave.createdAt.toISOString(),
      updatedAt: wave.updatedAt.toISOString(),
      client: wave.requests[0]?.request.client ?? null,
      requests: wave.requests.map((link) => ({
        id: link.request.id,
        title: link.request.title,
        status: link.request.status,
        destinationCity: link.request.destinationCity,
      })),
      summary: {
        lines: wave.balanceLines.length,
        reviewedLines,
        pendingLines: wave.balanceLines.length - reviewedLines,
        totalRemaining,
        allocatedQuantity,
        keepQuantity: totalRemaining - allocatedQuantity,
        smallBalanceLines: wave.balanceLines.filter((line) => line.remainingQuantity <= 5).length,
      },
      lines: wave.balanceLines.map((line) => ({
        id: line.id,
        balanceId: line.balanceId,
        sourceBoxCode: line.sourceBoxCode,
        skuId: line.skuId,
        internalSku: line.internalSku,
        barcode: line.barcode,
        name: line.name,
        color: line.color,
        size: line.size,
        originalQuantity: line.originalQuantity,
        plannedQuantity: line.plannedQuantity,
        remainingQuantity: line.remainingQuantity,
        keepQuantity: line.keepQuantity,
        isReviewed: line.isReviewed,
        isSmallBalance: line.remainingQuantity <= 5,
        comment: line.comment,
        allocations: line.allocations.map((allocation) => ({
          id: allocation.id,
          requestId: allocation.requestId,
          quantity: allocation.quantity,
          needsRelabel: allocation.needsRelabel,
          targetBarcode: allocation.targetBarcode,
          comment: allocation.comment,
        })),
      })),
    };
  }

  private async resolveAssignedPickerId(input?: string) {
    const assignedPickerUserId = input?.trim();
    if (!assignedPickerUserId) {
      return undefined;
    }

    const picker = await this.prisma.user.findUnique({
      where: { id: assignedPickerUserId },
      select: { id: true, status: true },
    });
    if (!picker || picker.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Ответственный сборщик для волны не найден или заблокирован.');
    }

    return picker.id;
  }

  private nextWaveNumber() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `WAVE-${stamp}-${suffix}`;
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

function balanceReviewItemComment(
  waveNumber: string,
  line: BalanceReviewWave['balanceLines'][number],
  request: BalanceReviewWave['requests'][number]['request'],
  allocation: BalanceReviewWave['balanceLines'][number]['allocations'][number],
) {
  return [
    `Добавлено при проверке балансов волны: ${waveNumber}`,
    `Исходный короб: ${line.sourceBoxCode}`,
    request.destinationCity ? `Город: ${request.destinationCity}` : null,
    allocation.needsRelabel ? `Перемаркировка из: ${line.barcode ?? ''}` : null,
    allocation.needsRelabel ? `Перемаркировка в: ${allocation.targetBarcode ?? ''}` : null,
    allocation.needsRelabel ? 'Перемаркировка: да' : null,
    normalizeOptionalText(allocation.comment),
  ]
    .filter(Boolean)
    .join('; ');
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
