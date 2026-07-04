import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingUnit,
  ClientNotificationEvent,
  LogisticsDeliveryStatus,
  LogisticsPricingMode,
  LogisticsTripStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import type { LogisticsDirection as ParsedLogisticsDirection } from '../imports/parsers/logistics-xlsx.parser';
import { AssignDeliveryTripDto } from './dto/assign-delivery-trip.dto';
import { CreateDeliveryRequestDto } from './dto/create-delivery-request.dto';
import { CreateLogisticsCarrierDto } from './dto/create-logistics-carrier.dto';
import { CreateLogisticsTripDto } from './dto/create-logistics-trip.dto';
import { FinalizeDeliveryQuoteDto } from './dto/finalize-delivery-quote.dto';
import { ListDeliveryRequestsDto } from './dto/list-delivery-requests.dto';
import { ListLogisticsTripsDto } from './dto/list-logistics-trips.dto';
import { QuoteLogisticsDto } from './dto/quote-logistics.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { UpdateLogisticsTripStatusDto } from './dto/update-logistics-trip-status.dto';

type ParsedLogisticsTariffSet = {
  note: string;
  directions: ParsedLogisticsDirection[];
  issues: Array<{ row: number; message: string }>;
};

type CommitLogisticsTariffSetOptions = {
  name: string;
  sourceFile?: string;
  activeFrom?: string;
  activeTo?: string;
};

type RateTierLike = {
  label: string;
  minPallets: number | null;
  maxPallets: number | null;
  maxBoxes: number | null;
  priceRub: Prisma.Decimal | number;
  pricingMode: LogisticsPricingMode;
};

const DEFAULT_LOGISTICS_ORIGIN = 'Москва';

@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  listTariffSets() {
    return this.prisma.logisticsTariffSet.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { directions: true } },
      },
    });
  }

  async listDestinationSuggestions(query: { search?: string; tariffSetId?: string } = {}) {
    const search = normalizeText(query.search)?.toLowerCase();
    const activeTariffSet = query.tariffSetId ? null : await this.findActiveTariffSet(new Date());
    const tariffSetId = query.tariffSetId ?? activeTariffSet?.id;
    const rows = await this.prisma.logisticsDirection.findMany({
      where: {
        tariffSetId: tariffSetId ?? undefined,
      },
      select: {
        origin: true,
        destination: true,
        tariffSetId: true,
        tariffSet: {
          select: {
            name: true,
            sourceFile: true,
          },
        },
      },
      orderBy: [{ destination: 'asc' }, { origin: 'asc' }],
      take: 2000,
    });
    const suggestions = new Map<string, {
      value: string;
      label: string;
      description: string;
      origin: string;
      destination: string;
      tariffSetId: string;
      tariffSetName: string;
      sourceFile: string | null;
    }>();

    rows.forEach((row) => {
      const destination = row.destination.trim();
      if (!destination) {
        return;
      }

      const normalizedDestination = this.normalizePoint(destination);
      if (search && !normalizedDestination.includes(search)) {
        return;
      }

      if (!suggestions.has(normalizedDestination)) {
        suggestions.set(normalizedDestination, {
          value: destination,
          label: destination,
          description: [row.origin, row.tariffSet.name].filter(Boolean).join(' -> '),
          origin: row.origin,
          destination,
          tariffSetId: row.tariffSetId,
          tariffSetName: row.tariffSet.name,
          sourceFile: row.tariffSet.sourceFile,
        });
      }
    });

    return [...suggestions.values()].slice(0, 80);
  }

  getTariffSet(id: string) {
    return this.prisma.logisticsTariffSet.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { directions: true } },
        directions: {
          orderBy: [{ origin: 'asc' }, { destination: 'asc' }],
          include: { tiers: { orderBy: [{ maxBoxes: 'asc' }, { minPallets: 'asc' }] } },
        },
      },
    });
  }

  async commitTariffSet(parsed: ParsedLogisticsTariffSet, options: CommitLogisticsTariffSetOptions) {
    if (parsed.issues.length > 0) {
      throw new BadRequestException({
        message: 'Файл содержит ошибки, импорт тарифов логистики остановлен.',
        issues: parsed.issues,
      });
    }

    const directions = parsed.directions.filter((direction) => direction.tiers.length > 0);
    if (directions.length === 0) {
      throw new BadRequestException('В файле не найдено ни одного направления с тарифами.');
    }

    return this.prisma.logisticsTariffSet.create({
      data: {
        name: options.name,
        sourceFile: options.sourceFile,
        note: parsed.note || null,
        activeFrom: this.parseDate(options.activeFrom),
        activeTo: this.parseDate(options.activeTo),
        directions: {
          create: directions.map((direction) => ({
            origin: direction.origin,
            destination: direction.destination,
            note: parsed.note || null,
            pricingMode: direction.pricingMode as LogisticsPricingMode,
            tiers: {
              create: direction.tiers.map((tier) => ({
                label: tier.label,
                minPallets: tier.minPallets,
                maxPallets: tier.maxPallets,
                maxBoxes: tier.maxBoxes,
                pricingMode: tier.pricingMode as LogisticsPricingMode,
                priceRub: tier.priceRub,
              })),
            },
          })),
        },
      },
      include: {
        directions: {
          include: { tiers: true },
        },
      },
    });
  }

  async quote(dto: QuoteLogisticsDto) {
    if (Boolean(dto.boxes) === Boolean(dto.pallets)) {
      throw new BadRequestException('Для расчета передайте ровно одно значение: boxes или pallets.');
    }

    const quoteDate = dto.quoteDate ? new Date(dto.quoteDate) : new Date();
    const tariffSet = dto.tariffSetId
      ? await this.prisma.logisticsTariffSet.findUnique({ where: { id: dto.tariffSetId } })
      : await this.findActiveTariffSet(quoteDate);

    if (!tariffSet) {
      throw new NotFoundException('Активный набор тарифов логистики не найден.');
    }

    const directions = await this.prisma.logisticsDirection.findMany({
      where: { tariffSetId: tariffSet.id },
      include: { tiers: true },
    });

    const direction = directions.find(
      (item) =>
        this.normalizePoint(item.origin) === this.normalizePoint(DEFAULT_LOGISTICS_ORIGIN) &&
        this.normalizePoint(item.destination) === this.normalizePoint(dto.destination),
    );

    if (!direction) {
      throw new NotFoundException('Направление логистики не найдено в выбранном наборе тарифов.');
    }

    const tier = this.selectRateTier(direction.tiers, { boxes: dto.boxes, pallets: dto.pallets });
    const estimatedTotalRub = this.calculateQuoteTotal(tier, dto.pallets);

    return {
      tariffSet: {
        id: tariffSet.id,
        name: tariffSet.name,
        sourceFile: tariffSet.sourceFile,
      },
      route: {
        origin: DEFAULT_LOGISTICS_ORIGIN,
        destination: direction.destination,
      },
      input: {
        boxes: dto.boxes ?? null,
        pallets: dto.pallets ?? null,
      },
      tier: this.serializeTier(tier),
      estimatedTotalRub,
      requiresManualReview: tier.pricingMode === LogisticsPricingMode.MANUAL_REVIEW,
      note: tier.pricingMode === LogisticsPricingMode.MANUAL_REVIEW ? direction.note : tariffSet.note,
    };
  }

  listCarriers() {
    return this.prisma.logisticsCarrier.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { trips: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  createCarrier(dto: CreateLogisticsCarrierDto) {
    const name = normalizeRequiredText(dto.name, 'Название перевозчика обязательно.');

    return this.prisma.logisticsCarrier.create({
      data: {
        name,
        phone: normalizeText(dto.phone),
        contactName: normalizeText(dto.contactName),
        comment: normalizeText(dto.comment),
      },
      include: {
        _count: { select: { trips: true } },
      },
    });
  }

  listTrips(query: ListLogisticsTripsDto) {
    return this.prisma.logisticsTrip.findMany({
      where: {
        carrierId: query.carrierId,
        status: query.status,
      },
      include: logisticsTripInclude,
      orderBy: [{ plannedDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async createTrip(dto: CreateLogisticsTripDto) {
    const carrierId = normalizeText(dto.carrierId);
    const plannedDate = this.parseDate(dto.plannedDate);

    if (carrierId) {
      const carrier = await this.prisma.logisticsCarrier.findFirst({
        where: { id: carrierId, isActive: true },
        select: { id: true },
      });

      if (!carrier) {
        throw new BadRequestException('Перевозчик не найден или отключен.');
      }
    }

    return this.prisma.logisticsTrip.create({
      data: {
        code: normalizeText(dto.code) ?? (await this.generateTripCode(plannedDate)),
        carrierId,
        plannedDate,
        vehicleNumber: normalizeText(dto.vehicleNumber),
        driverName: normalizeText(dto.driverName),
        driverPhone: normalizeText(dto.driverPhone),
        comment: normalizeText(dto.comment),
      },
      include: logisticsTripInclude,
    });
  }

  async updateTripStatus(id: string, dto: UpdateLogisticsTripStatusDto) {
    const trip = await this.prisma.logisticsTrip.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!trip) {
      throw new NotFoundException('Рейс доставки не найден.');
    }

    return this.prisma.logisticsTrip.update({
      where: { id },
      data: {
        status: dto.status,
        comment: normalizeText(dto.comment),
      },
      include: logisticsTripInclude,
    });
  }

  listDeliveryRequests(query: ListDeliveryRequestsDto, user: AuthUser) {
    return this.prisma.logisticsDeliveryRequest.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
        status: query.status,
      },
      include: deliveryRequestInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
  }

  async createDeliveryRequest(dto: CreateDeliveryRequestDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    const clientRequest = dto.requestId
      ? await this.prisma.clientRequest.findFirst({
          where: {
            id: dto.requestId,
            clientId: dto.clientId,
          },
          include: {
            packages: {
              select: {
                packageType: true,
              },
            },
          },
        })
      : null;

    if (dto.requestId && !clientRequest) {
      throw new BadRequestException('Связанная клиентская заявка не найдена у выбранного клиента.');
    }

    const actualQuantity = this.resolveDeliveryQuantity(dto, clientRequest?.packages ?? []);
    const quote = await this.tryQuoteForDelivery({
      ...dto,
      boxes: actualQuantity.quoteBoxes,
      pallets: actualQuantity.quotePallets,
    });
    const status = quote.estimatedTotalRub != null && !quote.requiresManualReview
      ? LogisticsDeliveryStatus.QUOTED
      : LogisticsDeliveryStatus.REQUESTED;

    // Русский комментарий: заявку создаем даже при ручном тарифе, чтобы менеджер не терял обращение клиента.
    return this.prisma.logisticsDeliveryRequest.create({
      data: {
        clientId: dto.clientId,
        requestId: dto.requestId,
        tariffSetId: quote.tariffSetId ?? dto.tariffSetId,
        origin: DEFAULT_LOGISTICS_ORIGIN,
        destination: dto.destination.trim(),
        boxes: actualQuantity.boxes,
        pallets: actualQuantity.pallets,
        desiredShipDate: this.parseDate(dto.desiredShipDate),
        status,
        estimatedTotalRub: quote.estimatedTotalRub,
        requiresManualReview: quote.requiresManualReview,
        comment: normalizeText(dto.comment),
        managerComment: quote.note,
        createdByUserId: user.id,
      },
      include: deliveryRequestInclude,
    });
  }

  async assignDeliveryTrip(id: string, dto: AssignDeliveryTripDto, user: AuthUser) {
    const request = await this.prisma.logisticsDeliveryRequest.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        plannedShipDate: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Заявка на доставку не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    const tripId = normalizeText(dto.tripId ?? undefined);
    if (!tripId) {
      return this.prisma.logisticsDeliveryRequest.update({
        where: { id },
        data: { tripId: null },
        include: deliveryRequestInclude,
      });
    }

    const trip = await this.prisma.logisticsTrip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        plannedDate: true,
      },
    });

    if (!trip) {
      throw new NotFoundException('Рейс доставки не найден.');
    }

    if (trip.status === LogisticsTripStatus.COMPLETED || trip.status === LogisticsTripStatus.CANCELLED) {
      throw new BadRequestException('Нельзя назначить доставку в завершенный или отмененный рейс.');
    }

    const nextStatus =
      request.status === LogisticsDeliveryStatus.REQUESTED || request.status === LogisticsDeliveryStatus.QUOTED
        ? LogisticsDeliveryStatus.PLANNED
        : request.status;

    const data: Prisma.LogisticsDeliveryRequestUpdateInput = {
      trip: { connect: { id: trip.id } },
      status: nextStatus,
    };

    if (!request.plannedShipDate && trip.plannedDate) {
      data.plannedShipDate = trip.plannedDate;
    }

    // Русский комментарий: назначение на рейс переводит заявку в операционный план без ручной смены статуса менеджером.
    return this.prisma.logisticsDeliveryRequest.update({
      where: { id },
      data,
      include: deliveryRequestInclude,
    });
  }

  async updateDeliveryStatus(id: string, dto: UpdateDeliveryStatusDto, user: AuthUser) {
    const request = await this.prisma.logisticsDeliveryRequest.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        origin: true,
        destination: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Заявка на доставку не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.logisticsDeliveryRequest.update({
        where: { id },
        data: {
          status: dto.status,
          plannedShipDate: this.parseDate(dto.plannedShipDate),
          managerComment: normalizeText(dto.managerComment),
        },
        include: deliveryRequestInclude,
      });

      if (
        request.status !== dto.status &&
        (await isClientNotificationEnabled(
          tx,
          request.clientId,
          ClientNotificationEvent.LOGISTICS_DELIVERY_STATUS_CHANGED,
        ))
      ) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId: updated.requestId,
            title: 'Статус доставки изменен',
            body: `${request.origin} -> ${request.destination}: ${deliveryStatusLabel(request.status)} -> ${deliveryStatusLabel(dto.status)}`,
            severity: dto.status === LogisticsDeliveryStatus.DELIVERED ? 'SUCCESS' : 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      return updated;
    });
  }

  async finalizeDeliveryQuote(id: string, dto: FinalizeDeliveryQuoteDto, user: AuthUser) {
    const request = await this.prisma.logisticsDeliveryRequest.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        billingChargeId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Заявка на доставку не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    if (request.billingChargeId) {
      throw new BadRequestException('Доставка уже связана с начислением, сумму нельзя менять.');
    }

    if (request.status === LogisticsDeliveryStatus.CANCELLED) {
      throw new BadRequestException('Нельзя финализировать расчет отмененной доставки.');
    }

    const nextStatus =
      request.status === LogisticsDeliveryStatus.REQUESTED ? LogisticsDeliveryStatus.QUOTED : request.status;

    // Русский комментарий: ручная финализация снимает флаг проверки и открывает доставку для дальнейшего workflow/биллинга.
    return this.prisma.logisticsDeliveryRequest.update({
      where: { id },
      data: {
        estimatedTotalRub: dto.estimatedTotalRub,
        requiresManualReview: false,
        status: nextStatus,
        managerComment: normalizeText(dto.managerComment),
      },
      include: deliveryRequestInclude,
    });
  }

  async generateDeliveryBillingCharge(id: string, user: AuthUser) {
    const request = await this.prisma.logisticsDeliveryRequest.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true } },
        request: { select: { id: true, title: true } },
        tariffSet: { select: { id: true, name: true } },
        billingCharge: { select: { id: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Заявка на доставку не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    if (request.billingChargeId) {
      return this.prisma.logisticsDeliveryRequest.findUniqueOrThrow({
        where: { id },
        include: deliveryRequestInclude,
      });
    }

    if (request.status !== LogisticsDeliveryStatus.DELIVERED) {
      throw new BadRequestException('Начисление доставки можно создать только после статуса "Доставлена".');
    }

    if (request.requiresManualReview || request.estimatedTotalRub == null) {
      throw new BadRequestException('Для доставки нужен финальный расчет тарифа перед начислением.');
    }

    const sourceKey = deliverySourceKey(request.id);
    const totalRub = Number(request.estimatedTotalRub);
    if (!Number.isFinite(totalRub) || totalRub <= 0) {
      throw new BadRequestException('Некорректная сумма доставки для начисления.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingCharge = await tx.billingCharge.findFirst({
        where: { sourceKey },
        select: { id: true },
      });

      const charge =
        existingCharge ??
        (await tx.billingCharge.create({
          data: {
            clientId: request.clientId,
            serviceId: (await ensureDeliveryBillingService(tx)).id,
            requestId: request.requestId,
            description: `Доставка ${request.origin} -> ${request.destination}`,
            unit: BillingUnit.SERVICE,
            quantity: 1,
            unitPriceRub: totalRub,
            totalRub,
            status: BillingChargeStatus.APPROVED,
            serviceDate: request.plannedShipDate ?? request.desiredShipDate ?? new Date(),
            source: BillingChargeSource.LOGISTICS,
            sourceKey,
            metadata: {
              deliveryRequestId: request.id,
              route: {
                origin: request.origin,
                destination: request.destination,
              },
              boxes: request.boxes,
              pallets: request.pallets,
              tariffSetId: request.tariffSetId,
              tariffSetName: request.tariffSet?.name ?? null,
              clientRequestId: request.requestId,
            },
            comment: request.managerComment ?? request.comment,
            createdByUserId: user.id,
            approvedByUserId: user.id,
            approvedAt: new Date(),
          },
          select: { id: true },
        }));

      // Русский комментарий: связь хранится в заявке, чтобы в логистике сразу было видно, что доставка уже ушла в биллинг.
      return tx.logisticsDeliveryRequest.update({
        where: { id: request.id },
        data: { billingChargeId: charge.id },
        include: deliveryRequestInclude,
      });
    });
  }

  selectRateTier(tiers: RateTierLike[], input: { boxes?: number; pallets?: number }) {
    if (input.boxes != null) {
      const candidates = tiers
        .filter((tier) => tier.maxBoxes != null && input.boxes != null && input.boxes <= tier.maxBoxes)
        .sort((left, right) => (left.maxBoxes ?? Number.MAX_SAFE_INTEGER) - (right.maxBoxes ?? Number.MAX_SAFE_INTEGER));

      if (candidates[0]) {
        return candidates[0];
      }
    }

    if (input.pallets != null) {
      const candidates = tiers
        .filter((tier) => this.isPalletTierMatch(tier, input.pallets as number))
        .sort((left, right) => this.palletTierRank(right) - this.palletTierRank(left));

      if (candidates[0]) {
        return candidates[0];
      }
    }

    throw new BadRequestException('Подходящая ступень тарифа для указанного количества не найдена.');
  }

  calculateQuoteTotal(tier: RateTierLike, pallets?: number) {
    const priceRub = Number(tier.priceRub);

    if (tier.pricingMode === LogisticsPricingMode.TOTAL) {
      return priceRub;
    }

    if (tier.pricingMode === LogisticsPricingMode.PER_PALLET && pallets != null) {
      return Number((priceRub * pallets).toFixed(2));
    }

    // Русский комментарий: неоднозначные строки показываем оператору без автоумножения, чтобы не сделать неверный счет.
    return null;
  }

  private findActiveTariffSet(at: Date) {
    return this.prisma.logisticsTariffSet.findFirst({
      where: {
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: at } }] },
          { OR: [{ activeTo: null }, { activeTo: { gte: at } }] },
        ],
      },
      orderBy: [{ activeFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private isPalletTierMatch(tier: RateTierLike, pallets: number) {
    if (tier.maxBoxes != null) {
      return false;
    }

    const minPallets = tier.minPallets ?? 1;
    const maxPallets = tier.maxPallets ?? Number.MAX_SAFE_INTEGER;
    return pallets >= minPallets && pallets <= maxPallets;
  }

  private palletTierRank(tier: RateTierLike) {
    const min = tier.minPallets ?? 1;
    const max = tier.maxPallets ?? Number.MAX_SAFE_INTEGER;
    const specificity = tier.maxPallets == null ? 0 : tier.minPallets === tier.maxPallets ? 2 : 1;
    return specificity * 1_000_000 + min * 1_000 - (max === Number.MAX_SAFE_INTEGER ? 999 : max - min);
  }

  private serializeTier(tier: RateTierLike) {
    return {
      label: tier.label,
      minPallets: tier.minPallets,
      maxPallets: tier.maxPallets,
      maxBoxes: tier.maxBoxes,
      pricingMode: tier.pricingMode,
      priceRub: Number(tier.priceRub),
    };
  }

  private async tryQuoteForDelivery(dto: CreateDeliveryRequestDto) {
    try {
      const quote = await this.quote({
        tariffSetId: dto.tariffSetId,
        destination: dto.destination,
        boxes: dto.boxes,
        pallets: dto.pallets,
        quoteDate: dto.desiredShipDate,
      });

      return {
        tariffSetId: quote.tariffSet.id,
        estimatedTotalRub: quote.estimatedTotalRub,
        requiresManualReview: quote.requiresManualReview || quote.estimatedTotalRub == null,
        note: quote.note,
      };
    } catch (caught) {
      const details = caught instanceof Error ? caught.message : 'тариф не найден';
      const message = `Требуется ручной расчет фулфилментом: ${details}`;

      return {
        tariffSetId: dto.tariffSetId,
        estimatedTotalRub: null,
        requiresManualReview: true,
        note: message,
      };
    }
  }

  private resolveDeliveryQuantity(
    dto: CreateDeliveryRequestDto,
    packages: Array<{ packageType: string | null }>,
  ) {
    if (dto.requestId) {
      if (packages.length === 0) {
        throw new BadRequestException('Для доставки по заявке сначала упакуйте заявку: фактические короба и паллеты берутся из упаковки.');
      }

      const counts = packages.reduce(
        (result, pack) => {
          if (isPalletPackage(pack.packageType)) {
            result.pallets += 1;
          } else {
            result.boxes += 1;
          }
          return result;
        },
        { boxes: 0, pallets: 0 },
      );

      return {
        boxes: counts.boxes || null,
        pallets: counts.pallets || null,
        quoteBoxes: counts.pallets > 0 ? undefined : counts.boxes || undefined,
        quotePallets: counts.pallets > 0 ? counts.pallets : undefined,
      };
    }

    if (Boolean(dto.boxes) === Boolean(dto.pallets)) {
      throw new BadRequestException('Для доставки передайте ровно одно значение: короба или паллеты.');
    }

    return {
      boxes: dto.boxes ?? null,
      pallets: dto.pallets ?? null,
      quoteBoxes: dto.boxes,
      quotePallets: dto.pallets,
    };
  }

  private normalizePoint(value: string) {
    return value.toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
  }

  private parseDate(value?: string) {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Некорректная дата тарифа: ${value}`);
    }

    return date;
  }

  private async generateTripCode(plannedDate?: Date) {
    const baseDate = plannedDate ?? new Date();
    const prefix = `TRIP-${baseDate.toISOString().slice(0, 10).replace(/-/g, '')}`;
    const sequence = await this.prisma.logisticsTrip.count({
      where: { code: { startsWith: prefix } },
    });

    return `${prefix}-${String(sequence + 1).padStart(3, '0')}`;
  }
}

const DELIVERY_SERVICE_CODE = 'LOGISTICS_DELIVERY';

const logisticsTripInclude = {
  carrier: {
    select: {
      id: true,
      name: true,
      phone: true,
      contactName: true,
      isActive: true,
    },
  },
  deliveries: {
    select: {
      id: true,
      clientId: true,
      origin: true,
      destination: true,
      boxes: true,
      pallets: true,
      desiredShipDate: true,
      plannedShipDate: true,
      status: true,
      client: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  },
} satisfies Prisma.LogisticsTripInclude;

const deliveryRequestInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  request: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
    },
  },
  tariffSet: {
    select: {
      id: true,
      name: true,
    },
  },
  billingCharge: {
    select: {
      id: true,
      description: true,
      status: true,
      totalRub: true,
    },
  },
  trip: {
    select: {
      id: true,
      code: true,
      plannedDate: true,
      status: true,
      vehicleNumber: true,
      driverName: true,
      carrier: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.LogisticsDeliveryRequestInclude;

function ensureDeliveryBillingService(tx: Prisma.TransactionClient) {
  return tx.billingService.upsert({
    where: { code: DELIVERY_SERVICE_CODE },
    update: {
      name: 'Доставка по заявке',
      unit: BillingUnit.SERVICE,
      isActive: true,
    },
    create: {
      code: DELIVERY_SERVICE_CODE,
      name: 'Доставка по заявке',
      unit: BillingUnit.SERVICE,
      isActive: true,
    },
  });
}

function deliverySourceKey(deliveryRequestId: string) {
  return `logistics-delivery:${deliveryRequestId}`;
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function deliveryStatusLabel(status: LogisticsDeliveryStatus) {
  const labels: Record<LogisticsDeliveryStatus, string> = {
    [LogisticsDeliveryStatus.REQUESTED]: 'запрос',
    [LogisticsDeliveryStatus.QUOTED]: 'рассчитано',
    [LogisticsDeliveryStatus.PLANNED]: 'запланировано',
    [LogisticsDeliveryStatus.IN_TRANSIT]: 'в пути',
    [LogisticsDeliveryStatus.DELIVERED]: 'доставлено',
    [LogisticsDeliveryStatus.CANCELLED]: 'отменено',
  };

  return labels[status];
}

function normalizeText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRequiredText(value: string, message: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new BadRequestException(message);
  }

  return normalized;
}
