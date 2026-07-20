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
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
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
const MAX_BOXES_FOR_BOX_TARIFF = 10;
const BOXES_PER_PALLET = 16;
const EXTRA_BOXES_PER_PALLET = 4;
const FBS_ITEMS_PER_BOX = 14;
const FBS_BOXES_PER_PALLET = 16;
const FBS_FIXED_DELIVERY_LIMIT = 1000;
const FBS_VNUKOVO = 'Внуково';
const FBS_KAVKAZ = 'Кавказский Бульвар';

@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  listTariffSets() {
    return this.prisma.logisticsTariffSet.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { directions: true } },
      },
    });
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

  async listDestinationSuggestions(filter: { search?: string; tariffSetId?: string }) {
    const search = normalizeText(filter.search);
    const tariffSetId = normalizeText(filter.tariffSetId);
    const directions = await this.prisma.logisticsDirection.findMany({
      where: {
        ...(tariffSetId ? { tariffSetId } : {}),
        ...(search
          ? {
              OR: [
                { destination: { contains: search, mode: 'insensitive' } },
                { origin: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        tariffSet: {
          select: {
            id: true,
            name: true,
            sourceFile: true,
          },
        },
      },
      orderBy: [{ destination: 'asc' }, { origin: 'asc' }],
      take: 200,
    });

    const unique = new Map<string, (typeof directions)[number]>();
    directions.forEach((direction) => {
      const key = [direction.tariffSetId, this.normalizePoint(direction.origin), this.normalizePoint(direction.destination)].join('|');
      if (!unique.has(key)) {
        unique.set(key, direction);
      }
    });

    return [...unique.values()].slice(0, 50).map((direction) => ({
      value: direction.destination,
      label: direction.destination,
      description: `${direction.origin} -> ${direction.destination} · ${direction.tariffSet.name}`,
      origin: direction.origin,
      destination: direction.destination,
      tariffSetId: direction.tariffSet.id,
      tariffSetName: direction.tariffSet.name,
      sourceFile: direction.tariffSet.sourceFile,
    }));
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

    const direction = this.findTariffDirection(
      directions.filter((item) => this.normalizePoint(item.origin) === this.normalizePoint(DEFAULT_LOGISTICS_ORIGIN)),
      dto.destination,
    );

    if (!direction) {
      throw new NotFoundException('Направление логистики не найдено в выбранном наборе тарифов.');
    }

    const pricingInput = dto.boxes != null && dto.boxes > MAX_BOXES_FOR_BOX_TARIFF
      ? { boxes: undefined, pallets: calculateLogisticsPalletCount(dto.boxes) }
      : { boxes: dto.boxes, pallets: dto.pallets };
    const tier = this.selectRateTier(direction.tiers, pricingInput);
    const estimatedTotalRub = this.calculateQuoteTotal(tier, pricingInput.pallets);

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
        boxes: pricingInput.boxes ?? null,
        pallets: pricingInput.pallets ?? null,
      },
      tier: this.serializeTier(tier),
      estimatedTotalRub,
      requiresManualReview: tier.pricingMode === LogisticsPricingMode.MANUAL_REVIEW,
      note: tier.pricingMode === LogisticsPricingMode.MANUAL_REVIEW ? direction.note : tariffSet.note,
    };
  }

  async listFbsCalculatorDestinations() {
    const tariffSet = await this.findActiveTariffSet(new Date());
    if (!tariffSet) {
      throw new NotFoundException('Активный набор тарифов логистики не найден.');
    }

    const directions = await this.prisma.logisticsDirection.findMany({
      where: {
        tariffSetId: tariffSet.id,
        origin: { equals: DEFAULT_LOGISTICS_ORIGIN, mode: 'insensitive' },
      },
      select: { destination: true },
      orderBy: { destination: 'asc' },
    });
    const unique = new Map<string, string>();
    directions.forEach((direction) => {
      const destination = direction.destination.trim();
      const key = this.normalizePoint(destination);
      if (destination && !unique.has(key)) {
        unique.set(key, destination);
      }
    });
    [FBS_VNUKOVO, FBS_KAVKAZ].forEach((destination) =>
      unique.set(this.normalizePoint(destination), destination),
    );
    const destinations = [...unique.values()].sort((left, right) =>
      left.localeCompare(right, 'ru'),
    );

    return { destinations };
  }

  async quoteFbsCalculator(dto: { quantity: number; destination: string }) {
    const boxes = Math.ceil(dto.quantity / FBS_ITEMS_PER_BOX);
    const specialDeliveryPrice = calculateSpecialFbsDelivery(
      dto.destination,
      dto.quantity,
      boxes,
    );
    if (specialDeliveryPrice != null) {
      return this.buildFbsCalculatorTotal(
        dto.quantity,
        boxes,
        dto.destination,
        specialDeliveryPrice,
      );
    }
    const logistics = await this.quote({
      destination: dto.destination,
      boxes,
    });
    if (logistics.estimatedTotalRub == null) {
      return {
        destination: logistics.route.destination,
        totalWithTax: null,
        requiresManualReview: true,
      };
    }

    return this.buildFbsCalculatorTotal(
      dto.quantity,
      boxes,
      logistics.route.destination,
      logistics.estimatedTotalRub,
    );
  }

  private buildFbsCalculatorTotal(
    quantity: number,
    boxes: number,
    destination: string,
    deliveryPrice: number,
  ) {
    const processingCost = quantity * 10;
    const stickersCost = quantity * 3;
    const boxesCost = boxes * 100;
    const assemblyCost = boxes * 40;
    const servicesWithMarkup =
      (processingCost + stickersCost + boxesCost + assemblyCost) * 1.5;
    const totalWithTax = Number(
      (((servicesWithMarkup + deliveryPrice) / 94) * 100).toFixed(2),
    );

    return {
      destination,
      totalWithTax,
      requiresManualReview: false,
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

  async ensurePackedRequestBilling(requestId: string, user: AuthUser) {
    const clientRequest = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        title: true,
        destinationCity: true,
        desiredDate: true,
      },
    });
    if (!clientRequest) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, clientRequest.clientId, 'write');
    const destination = normalizeText(clientRequest.destinationCity ?? undefined);
    if (!destination) {
      return { status: 'REQUIRES_DESTINATION' as const, deliveryRequest: null };
    }

    let deliveryRequest = await this.prisma.logisticsDeliveryRequest.findFirst({
      where: {
        requestId,
        status: { not: LogisticsDeliveryStatus.CANCELLED },
      },
      include: deliveryRequestInclude,
      orderBy: { createdAt: 'desc' },
    });
    if (!deliveryRequest) {
      deliveryRequest = await this.createDeliveryRequest(
        {
          clientId: clientRequest.clientId,
          requestId,
          destination,
          desiredShipDate: clientRequest.desiredDate?.toISOString(),
          comment: `Автоматически создано после упаковки заявки ${clientRequest.title}.`,
        },
        user,
      );
    }

    if (!deliveryRequest.billingChargeId) {
      deliveryRequest = await this.generateDeliveryBillingCharge(deliveryRequest.id, user);
    }

    return {
      status: deliveryRequest.requiresManualReview ? ('PRICE_REVIEW' as const) : ('READY' as const),
      deliveryRequest,
    };
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
    const notifyClient =
      request.status !== dto.status &&
      (await isClientNotificationEnabled(
        this.prisma,
        request.clientId,
        ClientNotificationEvent.LOGISTICS_DELIVERY_STATUS_CHANGED,
      ));

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.logisticsDeliveryRequest.update({
        where: { id },
        data: {
          status: dto.status,
          plannedShipDate: this.parseDate(dto.plannedShipDate),
          managerComment: normalizeText(dto.managerComment),
        },
        include: deliveryRequestInclude,
      });

      if (notifyClient) {
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

    if (notifyClient) {
      void this.telegram?.notifyClient(
        request.clientId,
        [
          'LOGOFF WMS: изменен статус доставки.',
          `${request.origin} -> ${request.destination}`,
          `Статус: ${deliveryStatusLabel(request.status)} -> ${deliveryStatusLabel(dto.status)}`,
        ].join('\n'),
      );
    }

    return updated;
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

    if (request.status === LogisticsDeliveryStatus.CANCELLED) {
      throw new BadRequestException('Нельзя создать начисление для отмененной доставки.');
    }

    const sourceKey = deliverySourceKey(request.id);
    const quotedTotalRub = Number(request.estimatedTotalRub);
    const priceRequiresConfirmation =
      request.requiresManualReview || request.estimatedTotalRub == null || !Number.isFinite(quotedTotalRub) || quotedTotalRub <= 0;
    const totalRub = priceRequiresConfirmation ? 0 : quotedTotalRub;

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
            description: `Доставка ${request.origin} -> ${request.destination}${
              priceRequiresConfirmation ? ' (цена требует согласования)' : ''
            }`,
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
              priceRequiresConfirmation,
            },
            comment:
              request.managerComment ??
              request.comment ??
              (priceRequiresConfirmation ? 'Тариф не найден. Укажите цену в черновом счете перед выставлением.' : null),
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
    const quoteDate = dto.desiredShipDate ? new Date(dto.desiredShipDate) : new Date();
    const tariffSet = dto.tariffSetId
      ? await this.prisma.logisticsTariffSet.findUnique({ where: { id: dto.tariffSetId } })
      : await this.findActiveTariffSet(quoteDate);

    try {
      if (!tariffSet) {
        throw new NotFoundException('Активный набор тарифов логистики не найден.');
      }

      const quote = await this.quote({
        tariffSetId: tariffSet.id,
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
        tariffSetId: tariffSet?.id ?? dto.tariffSetId,
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
      const calculatedPallets = Math.max(counts.pallets, calculateLogisticsPalletCount(counts.boxes));
      const usePalletTariff = counts.pallets > 0 || counts.boxes > MAX_BOXES_FOR_BOX_TARIFF;

      return {
        boxes: counts.boxes || null,
        pallets: usePalletTariff ? calculatedPallets || null : null,
        quoteBoxes: usePalletTariff ? undefined : counts.boxes || undefined,
        quotePallets: usePalletTariff ? calculatedPallets || undefined : undefined,
      };
    }

    if (Boolean(dto.boxes) === Boolean(dto.pallets)) {
      throw new BadRequestException('Для доставки передайте ровно одно значение: короба или паллеты.');
    }

    const calculatedPallets = dto.boxes != null && dto.boxes > MAX_BOXES_FOR_BOX_TARIFF
      ? calculateLogisticsPalletCount(dto.boxes)
      : dto.pallets;
    const usePalletTariff = dto.pallets != null || calculatedPallets != null;

    return {
      boxes: dto.boxes ?? null,
      pallets: usePalletTariff ? calculatedPallets ?? null : null,
      quoteBoxes: usePalletTariff ? undefined : dto.boxes,
      quotePallets: usePalletTariff ? calculatedPallets : undefined,
    };
  }

  private normalizePoint(value: string) {
    return value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
  }

  private normalizeCity(value: string) {
    return this.normalizePoint(value.replace(/\([^)]*\)/g, ' '));
  }

  private findTariffDirection<T extends { destination: string }>(directions: T[], destination: string) {
    const exact = directions.find(
      (item) => this.normalizePoint(item.destination) === this.normalizePoint(destination),
    );
    if (exact) {
      return exact;
    }

    const city = this.normalizeCity(destination);
    const cityMatches = directions.filter((item) => this.normalizeCity(item.destination) === city);
    return cityMatches.length === 1 ? cityMatches[0] : undefined;
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

function calculateSpecialFbsDelivery(destination: string, quantity: number, boxes: number) {
  const normalized = destination.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  const isVnukovo = normalized.includes('внуково');
  const isKavkaz = normalized.includes('кавказ');
  if (!isVnukovo && !isKavkaz) return null;
  if (quantity <= FBS_FIXED_DELIVERY_LIMIT) {
    return isVnukovo ? 1500 : 3000;
  }

  const pallets = Math.ceil(boxes / FBS_BOXES_PER_PALLET);
  if (isVnukovo) {
    return pallets * (pallets <= 2 ? 1500 : 1200);
  }
  const pricePerPallet =
    pallets === 1
      ? 3500
      : pallets === 2
        ? 3000
        : pallets === 3
          ? 2800
          : pallets === 4
            ? 2500
            : pallets === 5
              ? 2300
              : pallets === 6
                ? 2200
                : 2000;
  return pallets * pricePerPallet;
}

export function calculateLogisticsPalletCount(boxes: number) {
  if (!Number.isFinite(boxes) || boxes <= 0) {
    return 0;
  }

  const normalizedBoxes = Math.floor(boxes);
  const fullPallets = Math.floor(normalizedBoxes / BOXES_PER_PALLET);
  const remainder = normalizedBoxes % BOXES_PER_PALLET;
  return fullPallets + (remainder > EXTRA_BOXES_PER_PALLET ? 1 : 0);
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
