import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingPriceTaxMode,
  BillingUnit,
  ClientRequestStatus,
  ClientRequestType,
  MovementType,
  Prisma,
  StockBalance,
  StockStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { RequestBillingAutomationService } from '../billing/request-billing-automation.service';
import { clientRequestPackageInclude } from '../client-requests/client-request-packages.include';
import { FulfillClientRequestDto } from './dto/fulfill-client-request.dto';
import { PickClientRequestDto } from './dto/pick-client-request.dto';
import { TransferBetweenBoxesDto } from './dto/transfer-between-boxes.dto';
import { StockBalancesService } from './stock-balances.service';

export type ReceiveIntoBoxInput = {
  clientId: string;
  skuId?: string;
  barcode?: string;
  boxCode: string;
  quantity: number;
  status?: StockStatus;
  idempotencyKey: string;
  sourceDocument?: string;
  comment?: string;
};

export type AdjustInventoryInput = {
  clientId: string;
  skuId?: string;
  barcode?: string;
  boxCode: string;
  countedQuantity: number;
  status?: StockStatus;
  idempotencyKey: string;
  comment?: string;
};

type RequestItemForAllocation = {
  id: string;
  skuId: string | null;
  barcode: string | null;
  quantity: number;
};

type RequestAllocationPlan = {
  lines: Array<{
    itemId: string;
    skuId: string;
    skuWeightGrams: number | null;
    barcode: string | null;
    requestedQuantity: number;
    allocations: Array<{ balance: StockBalance; quantity: number }>;
  }>;
};

type RequestPackageInput = {
  packageCode: string;
  packageType?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  comment?: string;
  metadata?: Prisma.InputJsonValue;
  items: Array<{
    requestItemId: string;
    skuId: string;
    barcode: string | null;
    quantity: number;
  }>;
};

@Injectable()
export class StockOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly balances: StockBalancesService,
    private readonly billingAutomation?: RequestBillingAutomationService,
  ) {}

  transferBetweenBoxes(dto: TransferBetweenBoxesDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    return this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findUnique({
        where: { idempotencyKey: `${dto.idempotencyKey}:out` },
      });

      if (existingMovement) {
        // Русский комментарий: повтор операции с ТСД возвращаем как уже принятую, чтобы offline retry был безопасным.
        return {
          idempotencyKey: dto.idempotencyKey,
          status: 'ALREADY_APPLIED',
        };
      }

      const sku = await this.resolveSku(tx, dto);
      const fromBox = await this.resolveBox(tx, dto.clientId, dto.fromBoxCode);
      const toBox = await this.ensureTargetBox(tx, dto.clientId, dto.toBoxCode);
      const status = dto.status ?? StockStatus.AVAILABLE;

      const sourceBalance = await tx.stockBalance.findFirst({
        where: {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: fromBox.id,
          status,
        },
      });

      if (!sourceBalance || sourceBalance.quantity < dto.quantity) {
        throw new BadRequestException('Недостаточно остатка в исходном коробе.');
      }

      await this.decrementSourceBalance(tx, sourceBalance, dto.quantity);
      const targetBalance = await this.incrementTargetBalance(tx, {
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: toBox.id,
        palletId: toBox.palletId,
        status,
        quantity: dto.quantity,
      });

      await tx.stockMovement.create({
        data: {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: fromBox.id,
          palletId: fromBox.palletId,
          type: 'MOVE',
          status,
          quantity: -dto.quantity,
          idempotencyKey: `${dto.idempotencyKey}:out`,
          comment: dto.comment ?? `Перенос в короб ${toBox.code}`,
        },
      });

      await tx.stockMovement.create({
        data: {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: toBox.id,
          palletId: toBox.palletId,
          type: 'MOVE',
          status,
          quantity: dto.quantity,
          idempotencyKey: `${dto.idempotencyKey}:in`,
          comment: dto.comment ?? `Перенос из короба ${fromBox.code}`,
        },
      });

      return {
        idempotencyKey: dto.idempotencyKey,
        status: 'APPLIED',
        skuId: sku.id,
        fromBox: fromBox.code,
        toBox: toBox.code,
        quantity: dto.quantity,
        targetBalance,
      };
    });
  }

  pickClientRequest(dto: PickClientRequestDto, user: AuthUser) {
    const baseKey = dto.idempotencyKey ?? `pick-request:${dto.requestId}`;

    return this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findFirst({
        where: { idempotencyKey: { startsWith: `${baseKey}:` } },
      });

      if (existingMovement) {
        const packages = await this.listRequestPackages(tx, dto.requestId);
        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: dto.requestId,
          packages,
        };
      }

      const request = await tx.clientRequest.findUnique({
        where: { id: dto.requestId },
        include: {
          items: true,
        },
      });

      if (!request) {
        throw new NotFoundException('Клиентская заявка не найдена.');
      }

      this.clientScopes.requireClientAccess(user, request.clientId, 'write');

      if (request.type !== ClientRequestType.OUTBOUND) {
        throw new BadRequestException('Сборка доступна только для заявок на отгрузку.');
      }

      if (request.status === ClientRequestStatus.CANCELLED || request.status === ClientRequestStatus.REJECTED) {
        throw new BadRequestException('Нельзя собирать отмененную или отклоненную заявку.');
      }

      if (
        request.status !== ClientRequestStatus.SUBMITTED &&
        request.status !== ClientRequestStatus.IN_REVIEW &&
        request.status !== ClientRequestStatus.APPROVED
      ) {
        throw new BadRequestException('Сборку можно запускать только для новой, проверяемой или согласованной заявки.');
      }

      if (request.items.length === 0) {
        throw new BadRequestException('В заявке нет товарных позиций для сборки.');
      }

      const plan = await this.planRequestPick(tx, request.clientId, request.items);

      // Русский комментарий: сначала строим полный план по всем строкам, и только потом меняем остатки,
      // чтобы нехватка по одной позиции не оставила заявку частично собранной.
      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);
          await this.incrementTargetBalance(tx, {
            clientId: request.clientId,
            skuId: line.skuId,
            boxId: allocation.balance.boxId!,
            palletId: allocation.balance.palletId,
            status: StockStatus.PACKING,
            quantity: allocation.quantity,
          });

          await tx.stockMovement.create({
            data: {
              clientId: request.clientId,
              skuId: line.skuId,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: 'PICK',
              status: StockStatus.AVAILABLE,
              quantity: -allocation.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:${line.itemId}:${allocation.balance.id}:out`,
              comment: dto.comment ?? `Сборка заявки ${request.title}`,
            },
          });

          await tx.stockMovement.create({
            data: {
              clientId: request.clientId,
              skuId: line.skuId,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: 'PICK',
              status: StockStatus.PACKING,
              quantity: allocation.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:${line.itemId}:${allocation.balance.id}:in`,
              comment: dto.comment ?? `Передано в упаковку по заявке ${request.title}`,
            },
          });
        }
      }

      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.IN_WORK,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? request.managerComment,
        },
      });

      return {
        idempotencyKey: baseKey,
        status: 'APPLIED',
        requestId: request.id,
        clientId: request.clientId,
        pickedLines: this.formatFulfillmentLines(plan, 'pickedQuantity'),
      };
    });
  }

  packageClientRequest(dto: FulfillClientRequestDto, user: AuthUser) {
    const baseKey = dto.idempotencyKey ?? `pack-request:${dto.requestId}`;

    return this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findFirst({
        where: { idempotencyKey: { startsWith: `${baseKey}:` } },
      });

      if (existingMovement) {
        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: dto.requestId,
        };
      }

      const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Упаковка');
      this.ensureRequestCanMove(request, 'упаковывать');

      if (request.status !== ClientRequestStatus.IN_WORK) {
        throw new BadRequestException('Упаковка доступна только после сборки заявки.');
      }

      const plan = await this.planRequestAllocations(tx, request.clientId, request.items, StockStatus.PACKING);

      // Русский комментарий: упаковка переводит уже собранный товар из PACKING в SHIPPING,
      // чтобы отгрузка работала только с упакованным остатком.
      await this.applyStatusMove(tx, {
        request,
        plan,
        baseKey,
        movementType: MovementType.PACK,
        sourceStatus: StockStatus.PACKING,
        targetStatus: StockStatus.SHIPPING,
        sourceComment: dto.comment ?? `Упаковка заявки ${request.title}`,
        targetComment: dto.comment ?? `Передано в отгрузку по заявке ${request.title}`,
      });

      const packages = await this.createRequestPackages(tx, {
        request,
        plan,
        dto,
        user,
      });
      await this.createFulfillmentBillingCharges(tx, {
        request,
        packages,
        user,
        serviceDate: new Date(),
      });

      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.PACKED,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Заявка упакована и готова к отгрузке.',
        },
      });

      return {
        idempotencyKey: baseKey,
        status: 'APPLIED',
        requestId: request.id,
        clientId: request.clientId,
        packedLines: this.formatFulfillmentLines(plan, 'packedQuantity'),
        packages,
      };
    });
  }

  async shipClientRequest(dto: FulfillClientRequestDto, user: AuthUser) {
    const baseKey = dto.idempotencyKey ?? `ship-request:${dto.requestId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Отгрузка');

      if (request.status === ClientRequestStatus.DONE) {
        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      this.ensureRequestCanMove(request, 'отгружать');

      const existingMovement = await tx.stockMovement.findFirst({
        where: { idempotencyKey: { startsWith: `${baseKey}:` } },
      });

      if (existingMovement) {
        await tx.clientRequest.update({
          where: { id: request.id },
          data: {
            status: ClientRequestStatus.DONE,
            assignedToUserId: user.id,
            managerComment: dto.comment ?? 'Заявка отгружена со склада.',
          },
        });

        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      if (request.status !== ClientRequestStatus.PACKED) {
        throw new BadRequestException('Отгрузка доступна только после упаковки заявки.');
      }

      await this.ensurePackedStockIsInShipping(tx, request, `complete-pack-before-ship:${request.id}:${baseKey}`);

      const plan = await this.planRequestAllocations(tx, request.clientId, request.items, StockStatus.SHIPPING);

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);

          await tx.stockMovement.create({
            data: {
              clientId: request.clientId,
              skuId: line.skuId,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: MovementType.SHIP,
              status: StockStatus.SHIPPING,
              quantity: -allocation.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:${line.itemId}:${allocation.balance.id}:out`,
              comment: dto.comment ?? `Отгрузка заявки ${request.title}`,
            },
          });
        }
      }

      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.DONE,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Заявка отгружена со склада.',
        },
      });

      return {
        idempotencyKey: baseKey,
        status: 'APPLIED',
        requestId: request.id,
        clientId: request.clientId,
        shippedLines: this.formatFulfillmentLines(plan, 'shippedQuantity'),
      };
    });

    if (result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED') {
      await this.billingAutomation?.generateForDoneRequest(result.requestId, user);
    }

    return result;
  }

  async shipClientRequestFromCurrentStock(dto: FulfillClientRequestDto, user: AuthUser) {
    const baseKey = dto.idempotencyKey ?? `manual-ship-request:${dto.requestId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findFirst({
        where: {
          OR: [
            { idempotencyKey: { startsWith: `${baseKey}:` } },
            {
              sourceDocument: dto.requestId,
              type: MovementType.SHIP,
              quantity: { lt: 0 },
            },
          ],
        },
      });

      const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'РћС‚РіСЂСѓР·РєР°');

      if (request.status === ClientRequestStatus.DONE) {
        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      this.ensureRequestCanMove(request, 'РѕС‚РіСЂСѓР¶Р°С‚СЊ');

      if (existingMovement) {
        await tx.clientRequest.update({
          where: { id: request.id },
          data: {
            status: ClientRequestStatus.DONE,
            assignedToUserId: user.id,
            managerComment: dto.comment ?? 'Р—Р°СЏРІРєР° СЃРґР°РЅР°; СЃРїРёСЃР°РЅРёРµ СЂР°РЅРµРµ СѓР¶Рµ Р±С‹Р»Рѕ РІС‹РїРѕР»РЅРµРЅРѕ.',
          },
        });

        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      this.ensureManualDonePackageInput(dto);
      const plan = await this.planRequestShipment(tx, request.clientId, request.items);
      const packages = await this.createRequestPackages(tx, {
        request,
        plan,
        dto,
        user,
      });
      await this.createFulfillmentBillingCharges(tx, {
        request,
        packages,
        user,
        serviceDate: new Date(),
      });

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);

          await tx.stockMovement.create({
            data: {
              clientId: request.clientId,
              skuId: line.skuId,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: MovementType.SHIP,
              status: allocation.balance.status,
              quantity: -allocation.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:${line.itemId}:${allocation.balance.id}:out`,
              comment: dto.comment ?? `Р СѓС‡РЅРѕРµ Р·Р°РєСЂС‹С‚РёРµ Р·Р°СЏРІРєРё ${request.title} СЃРѕ СЃРїРёСЃР°РЅРёРµРј РѕСЃС‚Р°С‚РєР°`,
            },
          });
        }
      }

      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.DONE,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Р—Р°СЏРІРєР° СЃРґР°РЅР°; РѕСЃС‚Р°С‚РєРё СЃРїРёСЃР°РЅС‹ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.',
        },
      });

      return {
        idempotencyKey: baseKey,
        status: 'APPLIED',
        requestId: request.id,
        clientId: request.clientId,
        shippedLines: this.formatFulfillmentLines(plan, 'shippedQuantity'),
        packages,
      };
    });

    if (result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED') {
      await this.billingAutomation?.generateForDoneRequest(result.requestId, user);
    }

    return result;
  }

  receiveIntoBox(dto: ReceiveIntoBoxInput, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    return this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (existingMovement) {
        // Русский комментарий: повтор receipt_scan с тем же ключом не создает второй приход.
        return {
          idempotencyKey: dto.idempotencyKey,
          status: 'ALREADY_APPLIED',
        };
      }

      const { createdDraft, sku } = await this.resolveOrCreateSkuForReceipt(tx, dto);
      const box = await this.ensureTargetBox(tx, dto.clientId, dto.boxCode);
      const status = dto.status ?? StockStatus.RECEIVING;

      const targetBalance = await this.incrementTargetBalance(tx, {
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: box.id,
        palletId: box.palletId,
        status,
        quantity: dto.quantity,
      });

      await tx.stockMovement.create({
        data: {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: box.id,
          palletId: box.palletId,
          type: 'RECEIPT',
          status,
          quantity: dto.quantity,
          sourceDocument: dto.sourceDocument,
          idempotencyKey: dto.idempotencyKey,
          comment: dto.comment ?? `Приемка ТСД в короб ${box.code}`,
        },
      });

      return {
        idempotencyKey: dto.idempotencyKey,
        status: 'APPLIED',
        skuId: sku.id,
        skuIsDraft: sku.isDraft,
        skuDraftCreated: createdDraft,
        skuName: sku.name,
        box: box.code,
        quantity: dto.quantity,
        targetBalance,
      };
    });
  }

  adjustInventoryToCounted(dto: AdjustInventoryInput, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');

    return this.prisma.$transaction(async (tx) => {
      const existingMovement = await tx.stockMovement.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (existingMovement) {
        // Русский комментарий: повтор подтверждения разбора ТСД не создает вторую корректировку.
        return {
          idempotencyKey: dto.idempotencyKey,
          status: 'ALREADY_APPLIED',
        };
      }

      const sku = await this.resolveSku(tx, dto);
      const box = await this.resolveBox(tx, dto.clientId, dto.boxCode);
      const status = dto.status ?? StockStatus.AVAILABLE;
      const balance = await tx.stockBalance.findFirst({
        where: {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: box.id,
          status,
        },
      });
      const currentQuantity = balance?.quantity ?? 0;
      const delta = dto.countedQuantity - currentQuantity;

      if (delta > 0) {
        await this.incrementTargetBalance(tx, {
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: box.id,
          palletId: box.palletId,
          status,
          quantity: delta,
        });
      }

      if (delta < 0 && balance) {
        await this.decrementSourceBalance(tx, balance, Math.abs(delta));
      }

      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: box.id,
            palletId: box.palletId,
            type: 'INVENTORY_ADJUSTMENT',
            status,
            quantity: delta,
            idempotencyKey: dto.idempotencyKey,
            comment: dto.comment ?? `Корректировка инвентаризации ТСД в коробе ${box.code}`,
          },
        });
      }

      return {
        idempotencyKey: dto.idempotencyKey,
        status: delta === 0 ? 'NO_CHANGE' : 'APPLIED',
        skuId: sku.id,
        box: box.code,
        previousQuantity: currentQuantity,
        countedQuantity: dto.countedQuantity,
        delta,
      };
    });
  }

  planTransferQuantities(sourceQuantity: number, targetQuantity: number, requestedQuantity: number) {
    if (requestedQuantity <= 0) {
      throw new BadRequestException('Количество должно быть больше нуля.');
    }

    if (sourceQuantity < requestedQuantity) {
      throw new BadRequestException('Недостаточно остатка в исходном коробе.');
    }

    return {
      sourceQuantity: sourceQuantity - requestedQuantity,
      targetQuantity: targetQuantity + requestedQuantity,
    };
  }

  private async planRequestPick(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
  ) {
    return this.planRequestAllocations(tx, clientId, items, StockStatus.AVAILABLE);
  }

  private async planRequestShipment(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
  ): Promise<RequestAllocationPlan> {
    const lines = [];
    const balanceRemaining = new Map<string, number>();
    const sourceStatuses: StockStatus[] = [StockStatus.SHIPPING, StockStatus.PACKING, StockStatus.AVAILABLE];

    for (const item of items) {
      const sku = await this.resolveSku(tx, {
        clientId,
        skuId: item.skuId ?? undefined,
        barcode: item.barcode ?? undefined,
      });
      const balances = await tx.stockBalance.findMany({
        where: {
          clientId,
          skuId: sku.id,
          status: { in: sourceStatuses },
          quantity: { gt: 0 },
        },
        orderBy: [{ updatedAt: 'asc' }],
      });
      balances.sort((left, right) => {
        const statusPriority = sourceStatuses.indexOf(left.status) - sourceStatuses.indexOf(right.status);
        if (statusPriority !== 0) {
          return statusPriority;
        }
        return (left.updatedAt?.getTime?.() ?? 0) - (right.updatedAt?.getTime?.() ?? 0);
      });

      let remaining = item.quantity;
      const allocations: Array<{ balance: StockBalance; quantity: number }> = [];

      for (const balance of balances) {
        if (remaining <= 0) {
          break;
        }

        const available = balanceRemaining.has(balance.id) ? balanceRemaining.get(balance.id)! : balance.quantity;
        if (available <= 0) {
          continue;
        }

        const quantity = Math.min(available, remaining);
        allocations.push({ balance, quantity });
        balanceRemaining.set(balance.id, available - quantity);
        remaining -= quantity;
      }

      if (remaining > 0) {
        throw new BadRequestException(`Недостаточно остатка для списания позиции ${sku.internalSku}.`);
      }

      lines.push({
        itemId: item.id,
        skuId: sku.id,
        skuWeightGrams: sku.weightGrams,
        barcode: item.barcode,
        requestedQuantity: item.quantity,
        allocations,
      });
    }

    return { lines };
  }

  private async ensurePackedStockIsInShipping(
    tx: Prisma.TransactionClient,
    request: { id: string; clientId: string; title?: string | null; items: RequestItemForAllocation[] },
    baseKey: string,
  ) {
    const missingItems = await this.findItemsMissingInStatus(tx, request.clientId, request.items, StockStatus.SHIPPING);

    if (missingItems.length === 0) {
      return;
    }

    const plan = await this.planRequestAllocations(tx, request.clientId, missingItems, StockStatus.PACKING);

    await this.applyStatusMove(tx, {
      request,
      plan,
      baseKey,
      movementType: MovementType.PACK,
      sourceStatus: StockStatus.PACKING,
      targetStatus: StockStatus.SHIPPING,
      sourceComment: `Достроена упаковка перед отгрузкой заявки ${request.title ?? request.id}`,
      targetComment: `Передано в отгрузку перед закрытием заявки ${request.title ?? request.id}`,
    });
  }

  private async findItemsMissingInStatus(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
    status: StockStatus,
  ): Promise<RequestItemForAllocation[]> {
    const remainingBySku = new Map<string, number>();
    const missingItems: RequestItemForAllocation[] = [];

    for (const item of items) {
      const sku = await this.resolveSku(tx, {
        clientId,
        skuId: item.skuId ?? undefined,
        barcode: item.barcode ?? undefined,
      });
      let available = remainingBySku.get(sku.id);

      if (available == null) {
        const balances = await tx.stockBalance.findMany({
          where: {
            clientId,
            skuId: sku.id,
            status,
            quantity: { gt: 0 },
            boxId: { not: null },
          },
        });
        available = balances.reduce((sum, balance) => sum + balance.quantity, 0);
      }

      if (available < item.quantity) {
        missingItems.push({ ...item, quantity: item.quantity - available });
      }

      remainingBySku.set(sku.id, Math.max(0, available - item.quantity));
    }

    return missingItems;
  }

  private async planRequestAllocations(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
    sourceStatus: StockStatus,
  ): Promise<RequestAllocationPlan> {
    const lines = [];
    const balanceRemaining = new Map<string, number>();

    for (const item of items) {
      const sku = await this.resolveSku(tx, {
        clientId,
        skuId: item.skuId ?? undefined,
        barcode: item.barcode ?? undefined,
      });
      const balances = await tx.stockBalance.findMany({
        where: {
          clientId,
          skuId: sku.id,
          status: sourceStatus,
          quantity: { gt: 0 },
          boxId: { not: null },
        },
        orderBy: [{ updatedAt: 'asc' }],
      });
      let remaining = item.quantity;
      const allocations: Array<{ balance: StockBalance; quantity: number }> = [];

      for (const balance of balances) {
        if (remaining <= 0) {
          break;
        }

        const available = balanceRemaining.has(balance.id) ? balanceRemaining.get(balance.id)! : balance.quantity;
        if (available <= 0) {
          continue;
        }

        const quantity = Math.min(available, remaining);
        allocations.push({ balance, quantity });
        balanceRemaining.set(balance.id, available - quantity);
        remaining -= quantity;
      }

      if (remaining > 0) {
        throw new BadRequestException(`Недостаточно остатка ${sourceStatus} для позиции ${sku.internalSku}.`);
      }

      lines.push({
        itemId: item.id,
        skuId: sku.id,
        skuWeightGrams: sku.weightGrams,
        barcode: item.barcode,
        requestedQuantity: item.quantity,
        allocations,
      });
    }

    return { lines };
  }

  private async loadOutboundRequest(
    tx: Prisma.TransactionClient,
    requestId: string,
    user: AuthUser,
    operationName: string,
  ) {
    const request = await tx.clientRequest.findUnique({
      where: { id: requestId },
      include: {
        items: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'write');

    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException(`${operationName} доступна только для заявок на отгрузку.`);
    }

    return request;
  }

  private ensureRequestCanMove(
    request: {
      status: ClientRequestStatus;
      items: RequestItemForAllocation[];
    },
    action: string,
  ) {
    if (request.status === ClientRequestStatus.CANCELLED || request.status === ClientRequestStatus.REJECTED) {
      throw new BadRequestException(`Нельзя ${action} отмененную или отклоненную заявку.`);
    }

    if (request.items.length === 0) {
      throw new BadRequestException('В заявке нет товарных позиций для складской операции.');
    }
  }

  private listRequestPackages(tx: Prisma.TransactionClient, requestId: string) {
    return tx.clientRequestPackage.findMany({
      where: { requestId },
      include: clientRequestPackageInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  private async createRequestPackages(
    tx: Prisma.TransactionClient,
    input: {
      request: { id: string; clientId: string };
      plan: RequestAllocationPlan;
      dto: FulfillClientRequestDto;
      user: AuthUser;
    },
  ) {
    const packages = this.buildPackageInputs(input.request.id, input.plan, input.dto);
    const createdPackages = [];

    for (const packageInput of packages) {
      createdPackages.push(
        await tx.clientRequestPackage.create({
          data: {
            requestId: input.request.id,
            clientId: input.request.clientId,
            packageCode: packageInput.packageCode,
            packageType: packageInput.packageType,
            weightGrams: packageInput.weightGrams,
            lengthCm: packageInput.lengthCm,
            widthCm: packageInput.widthCm,
            heightCm: packageInput.heightCm,
            comment: packageInput.comment,
            metadata: packageInput.metadata,
            createdByUserId: input.user.id,
            items: {
              create: packageInput.items.map((item) => ({
                requestItemId: item.requestItemId,
                skuId: item.skuId,
                barcode: item.barcode,
                quantity: item.quantity,
              })),
            },
          },
          include: clientRequestPackageInclude,
        }),
      );
    }

    return createdPackages;
  }

  private buildPackageInputs(
    requestId: string,
    plan: RequestAllocationPlan,
    dto: FulfillClientRequestDto,
  ): RequestPackageInput[] {
    const lineByItemId = new Map(plan.lines.map((line) => [line.itemId, line]));

    if (!dto.packages?.length) {
      const items = plan.lines.map((line) => ({
        requestItemId: line.itemId,
        skuId: line.skuId,
        skuWeightGrams: line.skuWeightGrams,
        barcode: line.barcode,
        quantity: line.requestedQuantity,
      }));
      const boxes = Math.max(0, Math.floor(dto.boxes ?? 0));
      const pallets = Math.max(0, Math.floor(dto.pallets ?? 0));
      const packageCount = Math.max(1, boxes + pallets);
      const generatedPackages: RequestPackageInput[] = [];

      for (let index = 0; index < packageCount; index += 1) {
        const packageCode = `PKG-${requestId.slice(0, 8)}-${index + 1}`;
        const packageType = index >= boxes && pallets > 0 ? 'PALLET' : 'BOX';
        const isPrimaryPackage = index === 0;
        generatedPackages.push({
          packageCode,
          packageType,
          comment: dto.comment?.trim() || undefined,
          metadata: isPrimaryPackage
            ? validateBoxWeight(packageCode, { packageType }, items)
            : { generatedFromPackageCount: true },
          items: isPrimaryPackage ? items.map(({ skuWeightGrams: _skuWeightGrams, ...item }) => item) : [],
        });
      }

      return generatedPackages;
    }

    const seenCodes = new Set<string>();
    const totalsByItemId = new Map<string, number>();
    const packages = dto.packages.map((packageDto, index) => {
      const packageCode = packageDto.packageCode?.trim() || `PKG-${requestId.slice(0, 8)}-${index + 1}`;
      if (seenCodes.has(packageCode)) {
        throw new BadRequestException(`Упаковочное место ${packageCode} указано повторно.`);
      }
      seenCodes.add(packageCode);

      if (!packageDto.items?.length) {
        throw new BadRequestException(`В упаковочном месте ${packageCode} нет товарных строк.`);
      }

      const items = packageDto.items.map((item) => {
        const line = lineByItemId.get(item.requestItemId);
        if (!line) {
          throw new BadRequestException(`Позиция ${item.requestItemId} не найдена в заявке.`);
        }

        totalsByItemId.set(item.requestItemId, (totalsByItemId.get(item.requestItemId) ?? 0) + item.quantity);

        return {
          requestItemId: item.requestItemId,
          skuId: line.skuId,
          skuWeightGrams: line.skuWeightGrams,
          barcode: line.barcode,
          quantity: item.quantity,
        };
      });
      const metadata = validateBoxWeight(packageCode, packageDto, items);

      return {
        packageCode,
        packageType: packageDto.packageType?.trim() || undefined,
        weightGrams: packageDto.weightGrams,
        lengthCm: packageDto.lengthCm,
        widthCm: packageDto.widthCm,
        heightCm: packageDto.heightCm,
        comment: packageDto.comment?.trim() || undefined,
        metadata,
        items: items.map(({ skuWeightGrams: _skuWeightGrams, ...item }) => item),
      };
    });

    for (const line of plan.lines) {
      if ((totalsByItemId.get(line.itemId) ?? 0) !== line.requestedQuantity) {
        throw new BadRequestException('Состав упаковочных мест должен совпадать с количеством в заявке.');
      }
    }

    return packages;
  }

  private ensureManualDonePackageInput(dto: FulfillClientRequestDto) {
    if (!dto.comment?.trim()) {
      throw new BadRequestException('Для ручного закрытия отгрузки нужен комментарий.');
    }

    if (!dto.packages?.length) {
      throw new BadRequestException('Для ручного закрытия отгрузки укажите фактические упаковочные места.');
    }

    if (dto.boxes == null || dto.pallets == null || dto.packedUnits == null) {
      throw new BadRequestException('Для ручного закрытия отгрузки укажите количество коробов, паллет и упакованных единиц.');
    }

    const counts = dto.packages.reduce(
      (result, pack) => {
        if (isPalletPackage(pack.packageType)) {
          result.pallets += 1;
        } else {
          result.boxes += 1;
        }
        result.packedUnits += pack.items.reduce((sum, item) => sum + item.quantity, 0);
        return result;
      },
      { boxes: 0, pallets: 0, packedUnits: 0 },
    );

    if (counts.boxes !== dto.boxes || counts.pallets !== dto.pallets || counts.packedUnits !== dto.packedUnits) {
      throw new BadRequestException('Итоги ручного закрытия должны совпадать с составом упаковочных мест.');
    }
  }

  private async createFulfillmentBillingCharges(
    tx: Prisma.TransactionClient,
    input: {
      request: { id: string; clientId: string; title?: string | null };
      packages: Array<{ packageType: string | null }>;
      user: AuthUser;
      serviceDate: Date;
    },
  ) {
    if (!('billingService' in tx) || !('clientBillingService' in tx) || !('billingCharge' in tx)) {
      return;
    }

    const counts = input.packages.reduce(
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
    const rows = [
      { ...FULFILLMENT_BILLING_SERVICES.BOX_60_40_40, quantity: counts.boxes },
      { ...FULFILLMENT_BILLING_SERVICES.BOX_ASSEMBLY, quantity: counts.boxes },
      { ...FULFILLMENT_BILLING_SERVICES.PALLET, quantity: counts.pallets },
      { ...FULFILLMENT_BILLING_SERVICES.PALLET_ASSEMBLY, quantity: counts.pallets },
    ].filter((row) => row.quantity > 0);

    for (const row of rows) {
      const sourceKey = `fulfillment-package:${input.request.id}:${row.code}`;
      const existingCharge = await tx.billingCharge.findFirst({
        where: { sourceKey },
        select: { id: true },
      });
      if (existingCharge) {
        continue;
      }

      const service = await tx.billingService.upsert({
        where: { code: row.code },
        update: {
          name: row.name,
          unit: row.unit,
          defaultPriceRub: row.defaultPriceRub,
          isActive: true,
        },
        create: {
          code: row.code,
          name: row.name,
          unit: row.unit,
          defaultPriceRub: row.defaultPriceRub,
          isActive: true,
        },
      });
      const clientPrice = await tx.clientBillingService.upsert({
        where: {
          clientId_serviceId: {
            clientId: input.request.clientId,
            serviceId: service.id,
          },
        },
        update: {},
        create: {
          clientId: input.request.clientId,
          serviceId: service.id,
          priceRub: row.defaultPriceRub,
          taxMode: BillingPriceTaxMode.INCLUDED,
          isActive: true,
          updatedByUserId: input.user.id,
        },
      });
      if (!clientPrice.isActive) {
        continue;
      }

      const unitPriceRub = applyFulfillmentTaxMode(Number(clientPrice.priceRub), clientPrice.taxMode);
      const totalRub = roundMoney(unitPriceRub * row.quantity);
      await tx.billingCharge.create({
        data: {
          clientId: input.request.clientId,
          serviceId: service.id,
          requestId: input.request.id,
          description: `${row.name} по заявке ${input.request.title ?? input.request.id}`,
          unit: row.unit,
          quantity: row.quantity,
          unitPriceRub,
          totalRub,
          status: BillingChargeStatus.APPROVED,
          serviceDate: input.serviceDate,
          source: BillingChargeSource.MANUAL,
          sourceKey,
          metadata: {
            requestId: input.request.id,
            packageBilling: true,
            packagesCount: input.packages.length,
            boxes: counts.boxes,
            pallets: counts.pallets,
            taxMode: clientPrice.taxMode,
            priceBeforeTaxRub: Number(clientPrice.priceRub),
          },
          comment: 'Автоматически создано при упаковке заявки',
          createdByUserId: input.user.id,
          approvedByUserId: input.user.id,
          approvedAt: new Date(),
        },
      });
    }
  }

  private async applyStatusMove(
    tx: Prisma.TransactionClient,
    input: {
      request: { id: string; clientId: string };
      plan: RequestAllocationPlan;
      baseKey: string;
      movementType: MovementType;
      sourceStatus: StockStatus;
      targetStatus: StockStatus;
      sourceComment: string;
      targetComment: string;
    },
  ) {
    for (const line of input.plan.lines) {
      for (const allocation of line.allocations) {
        await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);
        await this.incrementTargetBalance(tx, {
          clientId: input.request.clientId,
          skuId: line.skuId,
          boxId: allocation.balance.boxId!,
          palletId: allocation.balance.palletId,
          status: input.targetStatus,
          quantity: allocation.quantity,
        });

        await tx.stockMovement.create({
          data: {
            clientId: input.request.clientId,
            skuId: line.skuId,
            boxId: allocation.balance.boxId,
            palletId: allocation.balance.palletId,
            type: input.movementType,
            status: input.sourceStatus,
            quantity: -allocation.quantity,
            sourceDocument: input.request.id,
            idempotencyKey: `${input.baseKey}:${line.itemId}:${allocation.balance.id}:out`,
            comment: input.sourceComment,
          },
        });

        await tx.stockMovement.create({
          data: {
            clientId: input.request.clientId,
            skuId: line.skuId,
            boxId: allocation.balance.boxId,
            palletId: allocation.balance.palletId,
            type: input.movementType,
            status: input.targetStatus,
            quantity: allocation.quantity,
            sourceDocument: input.request.id,
            idempotencyKey: `${input.baseKey}:${line.itemId}:${allocation.balance.id}:in`,
            comment: input.targetComment,
          },
        });
      }
    }
  }

  private formatFulfillmentLines(plan: RequestAllocationPlan, quantityKey: string) {
    return plan.lines.map((line) => ({
      itemId: line.itemId,
      skuId: line.skuId,
      requestedQuantity: line.requestedQuantity,
      [quantityKey]: line.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
      allocations: line.allocations.map((allocation) => ({
        boxId: allocation.balance.boxId,
        palletId: allocation.balance.palletId,
        quantity: allocation.quantity,
      })),
    }));
  }

  private async resolveSku(tx: Prisma.TransactionClient, dto: { clientId: string; skuId?: string; barcode?: string }) {
    if (dto.skuId) {
      const sku = await tx.sku.findFirst({ where: { id: dto.skuId, clientId: dto.clientId } });
      if (!sku) {
        throw new NotFoundException('SKU не найден у клиента.');
      }
      return sku;
    }

    if (!dto.barcode) {
      throw new BadRequestException('Для складской операции нужен SKU или штрихкод.');
    }

    const barcode = await tx.barcode.findFirst({
      where: {
        value: dto.barcode,
        sku: { clientId: dto.clientId },
      },
      include: { sku: true },
    });

    if (!barcode) {
      throw new NotFoundException('Штрихкод не найден у клиента.');
    }

    return barcode.sku;
  }

  private async resolveOrCreateSkuForReceipt(
    tx: Prisma.TransactionClient,
    dto: { clientId: string; skuId?: string; barcode?: string },
  ) {
    if (dto.skuId) {
      return { sku: await this.resolveSku(tx, dto), createdDraft: false };
    }

    const barcodeValue = cleanBarcode(dto.barcode);
    if (!barcodeValue) {
      throw new BadRequestException('Для приемки нужен SKU или штрихкод товара.');
    }

    const existingBarcode = await tx.barcode.findFirst({
      where: {
        value: barcodeValue,
        sku: { clientId: dto.clientId },
      },
      include: { sku: true },
    });

    if (existingBarcode) {
      return { sku: existingBarcode.sku, createdDraft: false };
    }

    try {
      const internalSku = await this.buildAutoInternalSku(tx, dto.clientId, barcodeValue);
      const sku = await tx.sku.create({
        data: {
          clientId: dto.clientId,
          internalSku,
          name: `Новый товар без карточки: ${barcodeValue}`,
          volumeSource: 'MANUAL',
          isDraft: true,
          draftSource: 'RECEIPT_SCAN',
          barcodes: {
            create: {
              value: barcodeValue,
              isPrimary: true,
            },
          },
        },
      });

      return { sku, createdDraft: true };
    } catch (caught) {
      if (!isUniqueConstraintError(caught)) {
        throw caught;
      }

      const createdByParallelReceipt = await tx.barcode.findFirst({
        where: {
          value: barcodeValue,
          sku: { clientId: dto.clientId },
        },
        include: { sku: true },
      });
      if (createdByParallelReceipt) {
        return { sku: createdByParallelReceipt.sku, createdDraft: false };
      }

      throw new BadRequestException('Не удалось создать карточку товара по новому штрихкоду. Повторите приемку.');
    }
  }

  private async buildAutoInternalSku(tx: Prisma.TransactionClient, clientId: string, barcode: string) {
    const compact = barcode.replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 72) || `SKU-${hashText(barcode)}`;
    const base = `AUTO-${compact}`.slice(0, 92);
    let candidate = base;
    let suffix = 1;

    while (await tx.sku.findUnique({ where: { clientId_internalSku: { clientId, internalSku: candidate } } })) {
      suffix += 1;
      candidate = `${base.slice(0, 92)}-${suffix}`.slice(0, 100);
    }

    return candidate;
  }

  private async resolveBox(tx: Prisma.TransactionClient, clientId: string, code: string) {
    const box = await tx.box.findUnique({
      where: { clientId_code: { clientId, code } },
    });

    if (!box) {
      throw new NotFoundException(`Короб ${code} не найден.`);
    }

    return box;
  }

  private ensureTargetBox(tx: Prisma.TransactionClient, clientId: string, code: string) {
    return tx.box.upsert({
      where: { clientId_code: { clientId, code } },
      update: {},
      create: { clientId, code },
    });
  }

  private async decrementSourceBalance(tx: Prisma.TransactionClient, balance: StockBalance, quantity: number) {
    const updatedBalance = await tx.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: { decrement: quantity } },
    });

    if (updatedBalance.quantity < 0) {
      throw new BadRequestException('Складская операция увела остаток в минус.');
    }

    if (updatedBalance.quantity === 0) {
      await tx.stockBalance.delete({ where: { id: balance.id } });
    }
  }

  private incrementTargetBalance(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      skuId: string;
      boxId: string;
      palletId?: string | null;
      status: StockStatus;
      quantity: number;
    },
  ) {
    const balanceKey = this.balances.balanceKey(input);

    return tx.stockBalance.upsert({
      where: { balanceKey },
      update: {
        quantity: { increment: input.quantity },
      },
      create: {
        balanceKey,
        clientId: input.clientId,
        skuId: input.skuId,
        boxId: input.boxId,
        palletId: input.palletId,
        status: input.status,
        quantity: input.quantity,
      },
    });
  }
}

function cleanBarcode(value?: string) {
  return value?.trim() || '';
}

function isUniqueConstraintError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

const FULFILLMENT_BILLING_SERVICES = {
  BOX_60_40_40: {
    code: 'BOX_60_40_40',
    name: 'Короб 60*40*40',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 100,
  },
  BOX_ASSEMBLY: {
    code: 'BOX_ASSEMBLY',
    name: 'Сборка короба',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 40,
  },
  PALLET: {
    code: 'PALLET',
    name: 'Паллет',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 350,
  },
  PALLET_ASSEMBLY: {
    code: 'PALLET_ASSEMBLY',
    name: 'Сборка паллета',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 250,
  },
} as const;

const MAX_BOX_WEIGHT_GRAMS = 25_000;

function validateBoxWeight(
  packageCode: string,
  packageDto: { packageType?: string; weightGrams?: number },
  items: Array<{ quantity: number; skuWeightGrams: number | null }>,
): Prisma.InputJsonValue | undefined {
  if (isPalletPackage(packageDto.packageType)) {
    return undefined;
  }

  if (packageDto.weightGrams != null) {
    if (packageDto.weightGrams > MAX_BOX_WEIGHT_GRAMS) {
      throw new BadRequestException(`Вес короба ${packageCode} превышает 25 кг.`);
    }
    return undefined;
  }

  const missingWeights = items.filter((item) => item.skuWeightGrams == null).reduce((sum, item) => sum + item.quantity, 0);
  if (missingWeights > 0) {
    return {
      warnings: [
        {
          code: 'SKU_WEIGHT_MISSING',
          message: 'Вес короба не проверен: у части SKU не заполнен weightGrams.',
          missingUnits: missingWeights,
        },
      ],
    };
  }

  const calculatedWeightGrams = items.reduce((sum, item) => sum + (item.skuWeightGrams ?? 0) * item.quantity, 0);
  if (calculatedWeightGrams > MAX_BOX_WEIGHT_GRAMS) {
    throw new BadRequestException(`Расчетный вес короба ${packageCode} превышает 25 кг.`);
  }

  return {
    calculatedWeightGrams,
  };
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function applyFulfillmentTaxMode(unitPriceRub: number, taxMode: BillingPriceTaxMode) {
  if (taxMode === BillingPriceTaxMode.ADD_6_PERCENT) {
    return roundMoney((unitPriceRub / 94) * 100);
  }

  return roundMoney(unitPriceRub);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
