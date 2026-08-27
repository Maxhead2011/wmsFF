import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingPriceTaxMode,
  BillingUnit,
  ClientRequestEventType,
  ClientRequestStatus,
  ClientRequestType,
  MovementType,
  Prisma,
  StockBalance,
  StockStatus,
  TsdOperationStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { captureShippedKizHistory } from '../../common/shipment-history/shipped-kiz-history';
import { BoxCodePolicyService } from '../../common/boxes/box-code-policy.service';
import { ArchivedEmptyBoxPalletDetachService } from '../../common/boxes/archived-empty-box-pallet-detach.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { RequestBillingAutomationService } from '../billing/request-billing-automation.service';
import { ExpenseAutomationService } from '../expenses/expense-automation.service';
import { clientRequestPackageInclude } from '../client-requests/client-request-packages.include';
import { LogisticsService } from '../logistics/logistics.service';
import { FulfillClientRequestDto } from './dto/fulfill-client-request.dto';
import { PickClientRequestDto } from './dto/pick-client-request.dto';
import { TransferBetweenBoxesDto } from './dto/transfer-between-boxes.dto';
import { TransferWholeBoxDto } from './dto/transfer-whole-box.dto';
import { StockBalancesService } from './stock-balances.service';

const allocationBoxSelect = {
  code: true,
  warehouseId: true,
  zoneId: true,
  palletId: true,
  zone: { select: { warehouseId: true } },
  pallet: { select: { zone: { select: { warehouseId: true } } } },
} as const;

type StockBalanceForAllocation = Prisma.StockBalanceGetPayload<{
  include: { box: { select: typeof allocationBoxSelect } };
}>;

type RequestBoxSelectionForAllocation = Prisma.ClientRequestBoxSelectionGetPayload<{
  include: { box: { select: { code: true; warehouseId: true } } };
}>;

type TransferExecutionInput = TransferBetweenBoxesDto & {
  sourceDocument?: string;
};

type StockTransferValidationDb = Pick<Prisma.TransactionClient, 'barcode' | 'box' | 'stockBalance'>;
type TsdTransferDb = Pick<
  Prisma.TransactionClient,
  'barcode' | 'box' | 'productMark' | 'stockBalance'
>;
type TsdTransferSourceBox = Prisma.BoxGetPayload<{
  include: {
    client: { select: { id: true; code: true; name: true } };
    zone: { select: { warehouseId: true } };
    pallet: { select: { zone: { select: { warehouseId: true } } } };
    balances: {
      include: {
        sku: {
          include: {
            barcodes: { select: { value: true; isPrimary: true } };
          };
        };
      };
    };
  };
}>;
type TsdTransferScannedItem = {
  sku: TsdTransferSourceBox['balances'][number]['sku'];
  scanCode: string;
  scanType: 'BARCODE' | 'KIZ';
  productMarkId: string | null;
  availableQuantity: number;
  requiresKizRegistration: boolean;
};

export type ReceiveIntoBoxInput = {
  clientId: string;
  warehouseId?: string;
  skuId?: string;
  barcode?: string;
  kiz?: string;
  boxCode?: string;
  quantity: number;
  status?: StockStatus;
  idempotencyKey: string;
  sourceDocument?: string;
  comment?: string;
  allowReceiptError?: boolean;
};

export type AdjustInventoryInput = {
  clientId: string;
  skuId?: string;
  barcode?: string;
  // FIX: отсутствие boxCode допустимо только для клиента storesWithoutBoxes.
  boxCode?: string;
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

export type PhysicalStockSourceInput = {
  requestItemId: string;
  boxCode?: string;
  noBox?: boolean;
  quantity: number;
};

type RequestAllocationPlan = {
  lines: Array<{
    itemId: string;
    skuId: string;
    skuWeightGrams: number | null;
    barcode: string | null;
    requestedQuantity: number;
    allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }>;
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
    private readonly logistics?: LogisticsService,
    private readonly inventoryLock?: InventoryLockService,
    private readonly boxCodes?: BoxCodePolicyService,
    private readonly expenseAutomation?: ExpenseAutomationService,
    private readonly archivedEmptyBoxDetach?: ArchivedEmptyBoxPalletDetachService,
  ) {}

  private resolveWritableWarehouseId(user: AuthUser) {
    if (user.permissionCodes.includes('system:admin') || user.roleCodes.includes('CLIENT')) {
      return undefined;
    }
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId) {
      throw new BadRequestException('Выберите активный филиал.');
    }
    if (!user.writableWarehouseIds?.includes(warehouseId)) {
      throw new ForbiddenException('Филиал не назначен сотруднику для складских операций.');
    }
    return warehouseId;
  }

  private assertRequestWarehouse(
    request: { warehouseId?: string | null },
    warehouseId: string | undefined,
  ) {
    if (warehouseId && request.warehouseId !== warehouseId) {
      throw new ForbiddenException('Заявка относится к другому филиалу. Переключите город работы.');
    }
  }

  private assertBoxWarehouse(
    warehouseId: string | undefined,
    box: {
      warehouseId?: string | null;
      zoneId?: string | null;
      palletId?: string | null;
      zone?: { warehouseId: string } | null;
      pallet?: { zone: { warehouseId: string } | null } | null;
    },
  ) {
    if (!warehouseId) return;
    if (
      box.warehouseId !== warehouseId ||
      (box.zoneId !== null && box.zoneId !== undefined && box.zone?.warehouseId !== warehouseId) ||
      (box.palletId !== null && box.palletId !== undefined && box.pallet?.zone?.warehouseId !== warehouseId)
    ) {
      throw new ForbiddenException(
        'Короб, его зона или паллета относятся к другому филиалу. Переключите город работы.',
      );
    }
  }

  private warehouseScopedBoxWhere(warehouseId: string | undefined): Prisma.BoxWhereInput | undefined {
    if (!warehouseId) return undefined;
    return {
      warehouseId,
      AND: [
        { OR: [{ zoneId: null }, { zone: { warehouseId } }] },
        { OR: [{ palletId: null }, { pallet: { zone: { warehouseId } } }] },
      ],
    };
  }

  private requireBalanceWarehouseId(warehouseId: string | null | undefined) {
    if (!warehouseId) {
      throw new BadRequestException('Невозможно определить филиал остатка. Привяжите короб или заявку к складу.');
    }
    return warehouseId;
  }

  async transferBetweenBoxes(dto: TransferBetweenBoxesDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    if (warehouseId) {
      const boxes = await this.prisma.box.findMany({
        where: { clientId: dto.clientId, code: { in: [dto.fromBoxCode.trim(), dto.toBoxCode.trim()] } },
        select: {
          code: true,
          warehouseId: true,
          zoneId: true,
          palletId: true,
          zone: { select: { warehouseId: true } },
          pallet: { select: { zone: { select: { warehouseId: true } } } },
        },
      });
      for (const foreignBox of boxes) {
        this.assertBoxWarehouse(warehouseId, foreignBox);
      }
    }
    if (this.boxCodes) {
      dto.toBoxCode = await this.boxCodes.requireAllowed(dto.toBoxCode);
    }

    return this.prisma.$transaction((tx) => this.applyTransferBetweenBoxes(tx, dto, warehouseId));
  }

  async inspectTsdTransferSource(boxCodeValue: unknown, user: AuthUser) {
    const sourceBox = await this.loadTsdTransferSourceBox(
      this.prisma,
      requiredTsdTransferText(boxCodeValue, 'Отсканируйте исходный короб.'),
      user,
    );
    return this.formatTsdTransferSource(sourceBox);
  }

  async inspectTsdTransferItem(payload: Record<string, unknown>, user: AuthUser) {
    const fromBoxCode = requiredTsdTransferText(
      payload.fromBoxCode,
      'Сначала отсканируйте исходный короб.',
    );
    const scanCode = requiredTsdTransferText(
      payload.scanCode,
      'Отсканируйте ШК товара или КИЗ.',
    );

    // FIX: КИЗ, которого ещё нет в WMS, привязываем только после явно отсканированного ШК.
    const inspected = payload.bindMissingKiz === true
      ? await this.prisma.$transaction(async (tx) => {
          await this.inventoryLock?.assertStockMovementsAllowed();
          const sourceBox = await this.loadTsdTransferSourceBox(tx, fromBoxCode, user);
          const item = await this.bindMissingTsdTransferKiz(
            tx,
            sourceBox,
            requiredTsdTransferText(payload.skuId, 'Повторно отсканируйте ШК товара.'),
            scanCode,
            `TSD ${user.deviceCode ?? user.id}`,
          );
          return { sourceBox, item };
        }, STOCK_TRANSFER_TRANSACTION_OPTIONS)
      : await (async () => {
          const sourceBox = await this.loadTsdTransferSourceBox(this.prisma, fromBoxCode, user);
          const item = await this.resolveTsdTransferScannedItem(this.prisma, sourceBox, scanCode);
          return { sourceBox, item };
        })();

    const { sourceBox, item } = inspected;
    return {
      state: item.requiresKizRegistration ? 'SCAN_KIZ' : 'SCAN_ITEM',
      sourceBox: this.formatTsdTransferSource(sourceBox).sourceBox,
      item: formatTsdTransferItem(item),
      message:
        item.requiresKizRegistration
          ? `ШК товара «${item.sku.name}» принят. Теперь отсканируйте КИЗ этой единицы.`
          : item.scanType === 'KIZ'
          ? `КИЗ принят. Будет перемещена 1 единица товара «${item.sku.name}».`
          : `Товар принят. Будет перемещена 1 единица «${item.sku.name}».`,
    };
  }

  async executeTsdTransfer(payload: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const fromBoxCode = this.boxCodes
      ? await this.boxCodes.normalize(
          requiredTsdTransferText(payload.fromBoxCode, 'Сначала отсканируйте исходный короб.'),
        )
      : requiredTsdTransferText(payload.fromBoxCode, 'Сначала отсканируйте исходный короб.');
    const toBoxCode = this.boxCodes
      ? await this.boxCodes.requireAllowed(
          requiredTsdTransferText(payload.toBoxCode, 'Отсканируйте короб назначения.'),
        )
      : requiredTsdTransferText(payload.toBoxCode, 'Отсканируйте короб назначения.');
    const scanCode = requiredTsdTransferText(payload.scanCode, 'Отсканируйте ШК товара или КИЗ.');
    const idempotencyKey = requiredTsdTransferText(
      payload.idempotencyKey,
      'Не удалось создать номер операции. Повторите перемещение.',
    ).slice(0, 220);
    if (fromBoxCode.toLocaleUpperCase('ru-RU') === toBoxCode.toLocaleUpperCase('ru-RU')) {
      throw new BadRequestException('Исходный короб и короб назначения совпадают.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findUnique({
        where: { idempotencyKey: `${idempotencyKey}:out` },
        include: { sku: true },
      });
      if (existing) {
        this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
        const inbound = await tx.stockMovement.findUnique({
          where: { idempotencyKey: `${idempotencyKey}:in` },
          include: { box: { select: { code: true } } },
        });
        return {
          status: 'ALREADY_APPLIED' as const,
          message: 'Это перемещение уже было выполнено. Повтор не добавлен.',
          sourceBoxCode: fromBoxCode,
          targetBoxCode: inbound?.box?.code ?? toBoxCode,
          sourceBoxArchived: false,
          item: {
            skuId: existing.skuId,
            name: existing.sku.name,
            article: existing.sku.article ?? existing.sku.clientSku ?? existing.sku.internalSku,
            color: existing.sku.color,
            size: existing.sku.size,
            scanCode,
            scanType: 'BARCODE',
            availableQuantity: 0,
          },
        };
      }

      const sourceBox = await this.loadTsdTransferSourceBox(tx, fromBoxCode, user);
      const operationWarehouseId =
        warehouseId ??
        this.requireBalanceWarehouseId(sourceBox.warehouseId ?? user.activeWarehouseId);
      const item = await this.resolveTsdTransferScannedItem(tx, sourceBox, scanCode);
      await this.applyTransferBetweenBoxes(tx, {
        clientId: sourceBox.clientId,
        skuId: item.sku.id,
        fromBoxCode: sourceBox.code,
        toBoxCode,
        quantity: 1,
        status: StockStatus.AVAILABLE,
        idempotencyKey,
        sourceDocument: `TSD ${user.deviceCode ?? user.id}`,
        comment: `Перемещение на ТСД: ${sourceBox.code} → ${toBoxCode}`,
      }, operationWarehouseId);

      const targetBox = await tx.box.findUnique({ where: { code: toBoxCode } });
      if (!targetBox || targetBox.clientId !== sourceBox.clientId) {
        throw new BadRequestException(`Короб назначения ${toBoxCode} не удалось открыть.`);
      }
      if (item.productMarkId) {
        const inbound = await tx.stockMovement.findUnique({
          where: { idempotencyKey: `${idempotencyKey}:in` },
          select: { id: true },
        });
        await tx.productMark.update({
          where: { id: item.productMarkId },
          data: {
            boxId: targetBox.id,
            stockMovementId: inbound?.id,
          },
        });
      }

      const [remainingBalance, remainingMarks] = await Promise.all([
        tx.stockBalance.aggregate({
          where: { boxId: sourceBox.id, quantity: { gt: 0 } },
          _sum: { quantity: true },
        }),
        // FIX: исторический SHIPPING КИЗ не является активным содержимым короба
        // и не должен мешать архивированию после полного перемещения остатка.
        tx.productMark.count({
          where: {
            boxId: sourceBox.id,
            status: { not: StockStatus.SHIPPING },
          },
        }),
      ]);
      const sourceRemaining = remainingBalance._sum.quantity ?? 0;
      const sourceBoxArchived = sourceRemaining === 0 && remainingMarks === 0;
      if (sourceBoxArchived) {
        await tx.box.update({
          where: { id: sourceBox.id },
          data: { status: 'archived' },
        });
        // FIX: archive and pallet detach must commit atomically.
        await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
          { boxId: sourceBox.id, userId: user.id, reason: 'tsd-single-transfer' },
          tx,
        );
      }

      return {
        status: 'APPLIED' as const,
        message: `Перемещена 1 единица «${item.sku.name}»: ${sourceBox.code} → ${targetBox.code}.`,
        sourceBoxCode: sourceBox.code,
        targetBoxCode: targetBox.code,
        sourceBoxArchived,
        sourceRemaining,
        item: formatTsdTransferItem(item),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async executeTsdTransferBatch(payload: Record<string, unknown>, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const fromBoxCode = this.boxCodes
      ? await this.boxCodes.normalize(
          requiredTsdTransferText(payload.fromBoxCode, 'Сначала отсканируйте исходный короб.'),
        )
      : requiredTsdTransferText(payload.fromBoxCode, 'Сначала отсканируйте исходный короб.');
    const toBoxCode = this.boxCodes
      ? await this.boxCodes.requireAllowed(
          requiredTsdTransferText(payload.toBoxCode, 'Отсканируйте короб назначения.'),
        )
      : requiredTsdTransferText(payload.toBoxCode, 'Отсканируйте короб назначения.');
    const scanCodes = tsdTransferScanCodes(payload.scanCodes);
    const idempotencyKey = requiredTsdTransferText(
      payload.idempotencyKey,
      'Не удалось создать номер пакетного перемещения. Повторите операцию.',
    ).slice(0, 180);
    if (fromBoxCode.toLocaleUpperCase('ru-RU') === toBoxCode.toLocaleUpperCase('ru-RU')) {
      throw new BadRequestException('Исходный короб и короб назначения совпадают.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findFirst({
        where: { idempotencyKey: { startsWith: `${idempotencyKey}:1:` } },
        include: { sku: true },
      });
      if (existing) {
        this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
        const source = await tx.box.findUnique({
          where: { code: fromBoxCode },
          select: { id: true, status: true },
        });
        const sourceRemaining = source
          ? (
              await tx.stockBalance.aggregate({
                where: { boxId: source.id, quantity: { gt: 0 } },
                _sum: { quantity: true },
              })
            )._sum.quantity ?? 0
          : 0;
        return {
          status: 'ALREADY_APPLIED' as const,
          message: `Пакетное перемещение ${scanCodes.length} ед. уже выполнено. Повтор не добавлен.`,
          sourceBoxCode: fromBoxCode,
          targetBoxCode: toBoxCode,
          sourceBoxArchived: source?.status === 'archived',
          sourceRemaining,
          movedQuantity: scanCodes.length,
          items: [],
        };
      }

      const initialSourceBox = await this.loadTsdTransferSourceBox(tx, fromBoxCode, user);
      const operationWarehouseId =
        warehouseId ??
        this.requireBalanceWarehouseId(initialSourceBox.warehouseId ?? user.activeWarehouseId);
      const normalizedKizScans = new Set<string>();
      const movedItems: ReturnType<typeof formatTsdTransferItem>[] = [];
      const targetBox = await this.ensureTargetBox(
        tx,
        initialSourceBox.clientId,
        toBoxCode,
        operationWarehouseId,
      );

      for (const [index, scanCode] of scanCodes.entries()) {
        const sourceBox =
          index === 0
            ? initialSourceBox
            : await this.loadTsdTransferSourceBox(tx, fromBoxCode, user);
        const item = await this.resolveTsdTransferScannedItem(tx, sourceBox, scanCode);
        if (item.scanType === 'KIZ') {
          const normalizedKiz = item.scanCode.toLocaleLowerCase('ru-RU');
          if (normalizedKizScans.has(normalizedKiz)) {
            throw new BadRequestException(
              `КИЗ ${printableTransferScan(item.scanCode)} отсканирован в этом перемещении повторно.`,
            );
          }
          normalizedKizScans.add(normalizedKiz);
        }
        const lineKey = `${idempotencyKey}:${index + 1}`;
        await this.applyTransferBetweenBoxes(tx, {
          clientId: sourceBox.clientId,
          skuId: item.sku.id,
          fromBoxCode: sourceBox.code,
          toBoxCode: targetBox.code,
          quantity: 1,
          status: StockStatus.AVAILABLE,
          idempotencyKey: lineKey,
          sourceDocument: `TSD ${user.deviceCode ?? user.id}`,
          comment: `Пакетное перемещение на ТСД: ${sourceBox.code} → ${targetBox.code}`,
        }, operationWarehouseId);

        if (item.productMarkId) {
          const inbound = await tx.stockMovement.findUnique({
            where: { idempotencyKey: `${lineKey}:in` },
            select: { id: true },
          });
          await tx.productMark.update({
            where: { id: item.productMarkId },
            data: {
              boxId: targetBox.id,
              stockMovementId: inbound?.id,
            },
          });
        }
        movedItems.push(formatTsdTransferItem(item));
      }

      const [remainingBalance, remainingMarks] = await Promise.all([
        tx.stockBalance.aggregate({
          where: { boxId: initialSourceBox.id, quantity: { gt: 0 } },
          _sum: { quantity: true },
        }),
        // FIX: исторический SHIPPING КИЗ не является активным содержимым короба
        // и не должен мешать архивированию после полного пакетного перемещения.
        tx.productMark.count({
          where: {
            boxId: initialSourceBox.id,
            status: { not: StockStatus.SHIPPING },
          },
        }),
      ]);
      const sourceRemaining = remainingBalance._sum.quantity ?? 0;
      const sourceBoxArchived = sourceRemaining === 0 && remainingMarks === 0;
      if (sourceBoxArchived) {
        await tx.box.update({
          where: { id: initialSourceBox.id },
          data: { status: 'archived' },
        });
        // FIX: archive and pallet detach must commit atomically.
        await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
          { boxId: initialSourceBox.id, userId: user.id, reason: 'tsd-batch-transfer' },
          tx,
        );
      }

      return {
        status: 'APPLIED' as const,
        message: `Перемещено ${movedItems.length} ед.: ${initialSourceBox.code} → ${targetBox.code}.`,
        sourceBoxCode: initialSourceBox.code,
        targetBoxCode: targetBox.code,
        sourceBoxArchived,
        sourceRemaining,
        movedQuantity: movedItems.length,
        items: movedItems,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async transferWholeBox(dto: TransferWholeBoxDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);

    const fromBoxCode = dto.fromBoxCode.trim();
    const toBoxCode = this.boxCodes
      ? await this.boxCodes.requireAllowed(dto.toBoxCode)
      : dto.toBoxCode.trim();
    if (!fromBoxCode || !toBoxCode) {
      throw new BadRequestException('Укажите исходный и целевой короба.');
    }
    if (fromBoxCode.toLocaleUpperCase('ru-RU') === toBoxCode.toLocaleUpperCase('ru-RU')) {
      throw new BadRequestException('Исходный и целевой короба совпадают.');
    }

    return this.prisma.$transaction(async (tx) => {
      const alreadyApplied = await tx.stockMovement.findFirst({
        where: { idempotencyKey: { startsWith: `${dto.idempotencyKey}:` } },
        select: { id: true },
      });
      if (alreadyApplied) {
        return {
          idempotencyKey: dto.idempotencyKey,
          status: 'ALREADY_APPLIED' as const,
        };
      }

      const sourceBox = await tx.box.findUnique({
        where: { clientId_code: { clientId: dto.clientId, code: fromBoxCode } },
        include: {
          zone: { select: { warehouseId: true } },
          pallet: { select: { zone: { select: { warehouseId: true } } } },
          balances: {
            where: { quantity: { gt: 0 }, warehouseId },
            orderBy: [{ skuId: 'asc' }, { status: 'asc' }],
          },
          productMarks: {
            select: { id: true, skuId: true, status: true },
          },
        },
      });
      if (!sourceBox || sourceBox.status !== 'active') {
        throw new NotFoundException(`Исходный короб ${fromBoxCode} не найден в активных остатках.`);
      }
      this.assertBoxWarehouse(warehouseId, sourceBox);
      if (sourceBox.balances.length === 0) {
        throw new BadRequestException(`В коробе ${sourceBox.code} нет остатка для перемещения.`);
      }

      const existingTarget = await tx.box.findUnique({
        where: { clientId_code: { clientId: dto.clientId, code: toBoxCode } },
        include: {
          zone: { select: { warehouseId: true } },
          pallet: { select: { zone: { select: { warehouseId: true } } } },
        },
      });
      if (existingTarget) this.assertBoxWarehouse(warehouseId, existingTarget);
      if (existingTarget && existingTarget.status !== 'active') {
        throw new BadRequestException(`Короб ${toBoxCode} не является активным и не может принять остаток.`);
      }
      const targetBox =
        existingTarget ??
        (await tx.box.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(
              warehouseId ?? sourceBox.warehouseId ?? user.activeWarehouseId,
            ),
            clientId: dto.clientId,
            code: toBoxCode,
            status: 'active',
          },
        }));

      const balanceKeys = new Set(sourceBox.balances.map((balance) => `${balance.skuId}:${balance.status}`));
      const orphanMarks = sourceBox.productMarks.filter((mark) => !balanceKeys.has(`${mark.skuId}:${mark.status}`));
      const autoApproveChecks = canAutoApproveStockChecks(user);
      if (orphanMarks.length > 0 && !autoApproveChecks) {
        throw new BadRequestException(
          `Короб ${sourceBox.code} содержит КИЗ без соответствующего остатка. Перемещение остановлено для проверки.`,
        );
      }

      let totalQuantity = 0;
      let movedMarks = 0;
      for (const [index, balance] of sourceBox.balances.entries()) {
        const quantity = balance.quantity;
        const lineKey = `${dto.idempotencyKey}:${index + 1}:${balance.id}`;
        await this.decrementSourceBalance(tx, balance, quantity);
        await this.incrementTargetBalance(tx, {
          warehouseId: this.requireBalanceWarehouseId(targetBox.warehouseId),
          clientId: dto.clientId,
          skuId: balance.skuId,
          boxId: targetBox.id,
          palletId: targetBox.palletId,
          status: balance.status,
          quantity,
        });

        await tx.stockMovement.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(targetBox.warehouseId),
            clientId: dto.clientId,
            skuId: balance.skuId,
            boxId: sourceBox.id,
            palletId: sourceBox.palletId,
            type: MovementType.MOVE,
            status: balance.status,
            quantity: -quantity,
            sourceDocument: 'TSD-BOX-CONSOLIDATION',
            idempotencyKey: `${lineKey}:out`,
            comment: dto.comment?.trim() || `Объединение остатков: перенос в короб ${targetBox.code}`,
          },
        });
        const inboundMovement = await tx.stockMovement.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(targetBox.warehouseId),
            clientId: dto.clientId,
            skuId: balance.skuId,
            boxId: targetBox.id,
            palletId: targetBox.palletId,
            type: MovementType.MOVE,
            status: balance.status,
            quantity,
            sourceDocument: 'TSD-BOX-CONSOLIDATION',
            idempotencyKey: `${lineKey}:in`,
            comment: dto.comment?.trim() || `Объединение остатков: перенос из короба ${sourceBox.code}`,
          },
        });
        const marks = await tx.productMark.updateMany({
          where: {
            boxId: sourceBox.id,
            skuId: balance.skuId,
            status: balance.status,
          },
          data: {
            boxId: targetBox.id,
            stockMovementId: inboundMovement.id,
          },
        });
        movedMarks += marks.count;
        totalQuantity += quantity;
      }

      if (orphanMarks.length > 0) {
        const movedOrphanMarks = await tx.productMark.updateMany({
          where: { id: { in: orphanMarks.map((mark) => mark.id) }, boxId: sourceBox.id },
          data: { boxId: targetBox.id, stockMovementId: null },
        });
        movedMarks += movedOrphanMarks.count;
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'ADMIN_AUTO_APPROVE_BOX_TRANSFER_CHECK',
            entity: 'Box',
            entityId: sourceBox.id,
            payload: {
              fromBox: sourceBox.code,
              toBox: targetBox.code,
              orphanMarkIds: orphanMarks.map((mark) => mark.id),
              orphanMarks: orphanMarks.length,
              reason: 'КИЗ без соответствующего остатка автоматически пропущены администратором при перемещении короба',
            },
          },
        });
      }

      const [remainingBalances, remainingMarks] = await Promise.all([
        tx.stockBalance.count({ where: { boxId: sourceBox.id, quantity: { gt: 0 } } }),
        tx.productMark.count({ where: { boxId: sourceBox.id } }),
      ]);
      const sourceArchived = remainingBalances === 0 && remainingMarks === 0;
      if (sourceArchived) {
        await tx.box.update({
          where: { id: sourceBox.id },
          data: { status: 'archived' },
        });
        // FIX: a whole-box move cannot leave its archived source on a pallet-sort.
        await this.archivedEmptyBoxDetach?.detachIfArchivedAndEmpty(
          { boxId: sourceBox.id, userId: user.id, reason: 'whole-box-transfer' },
          tx,
        );
      }

      return {
        idempotencyKey: dto.idempotencyKey,
        status: 'APPLIED' as const,
        fromBox: sourceBox.code,
        toBox: targetBox.code,
        targetCreated: !existingTarget,
        lines: sourceBox.balances.length,
        quantity: totalQuantity,
        movedMarks,
        autoApprovedChecks: orphanMarks.length,
        sourceArchived,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async previewBoxTransfersXlsx(clientId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const warehouseId = this.resolveWritableWarehouseId(user);
    const rows = parseBoxTransferImportRows(file);
    return this.validateBoxTransferRows(clientId, fileName(file), rows, this.prisma, warehouseId);
  }

  async commitBoxTransfersXlsx(clientId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const parsedRows = parseBoxTransferImportRows(file);
    const batchId = randomUUID();
    const sourceFileName = fileName(file);

    return this.prisma.$transaction(
      async (tx) => {
        const preview = await this.validateBoxTransferRows(clientId, sourceFileName, parsedRows, tx, warehouseId);
        const readyRows = preview.rows.filter((row) => row.status === 'READY' && row.skuId);
        if (readyRows.length === 0) {
          throw new BadRequestException({
            message: 'В файле нет строк, которые можно безопасно переместить.',
            preview,
          });
        }

        const results = [];
        for (const row of readyRows) {
          const idempotencyKey = `web-box-transfer-batch:${batchId}:${row.rowNumber}`;
          const result = await this.applyTransferBetweenBoxes(tx, {
            clientId,
            skuId: row.skuId,
            fromBoxCode: row.fromBoxCode,
            toBoxCode: row.toBoxCode,
            quantity: row.quantity,
            status: StockStatus.AVAILABLE,
            idempotencyKey,
            sourceDocument: sourceFileName,
            comment: `Файл ${sourceFileName}, строка ${row.rowNumber}`,
          });
          results.push({ rowNumber: row.rowNumber, ...result });
        }

        const storedRows: StoredBoxTransferRow[] = preview.rows.map((row) => ({
          ...row,
          status: row.status === 'READY' ? 'APPLIED' : 'REJECTED',
          stockStatus: StockStatus.AVAILABLE,
          idempotencyKey:
            row.status === 'READY' ? `web-box-transfer-batch:${batchId}:${row.rowNumber}` : undefined,
          message: row.status === 'READY' ? 'Перемещение выполнено.' : row.message,
        }));
        const appliedQuantity = readyRows.reduce((sum, row) => sum + row.quantity, 0);
        const batchStatus = preview.summary.errorRows > 0 ? 'APPLIED_WITH_ERRORS' : 'APPLIED';
        const batch = await tx.stockTransferBatch.create({
          data: {
            id: batchId,
            clientId,
            fileName: sourceFileName,
            mimeType: file?.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: file?.buffer.length ?? 0,
            content: Uint8Array.from(file?.buffer ?? []),
            status: batchStatus,
            rowCount: preview.summary.rows,
            appliedRowCount: preview.summary.readyRows,
            rejectedRowCount: preview.summary.errorRows,
            quantity: appliedQuantity,
            rows: toJsonValue(storedRows),
            uploadedByUserId: user.id,
            uploadedByName: user.name,
          },
        });

        return {
          status: batchStatus,
          rows: readyRows.length,
          quantity: appliedQuantity,
          results,
          preview: {
            ...preview,
            rows: storedRows,
          },
          batch: transferBatchSummary(batch),
        };
      },
      STOCK_TRANSFER_TRANSACTION_OPTIONS,
    );
  }

  importBoxTransfersXlsx(clientId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    return this.commitBoxTransfersXlsx(clientId, file, user);
  }

  async listBoxTransferBatches(clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const batches = await this.prisma.stockTransferBatch.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: stockTransferBatchSummarySelect,
      take: 100,
    });

    return batches.map(transferBatchSummary);
  }

  async getBoxTransferBatchFile(id: string, user: AuthUser) {
    const batch = await this.prisma.stockTransferBatch.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        fileName: true,
        mimeType: true,
        content: true,
      },
    });
    if (!batch) {
      throw new NotFoundException('Файл перемещений не найден.');
    }
    this.clientScopes.requireClientAccess(user, batch.clientId, 'write');

    return {
      fileName: normalizeUploadedFileName(batch.fileName),
      mimeType: batch.mimeType,
      content: Buffer.from(batch.content),
    };
  }

  async reverseBoxTransferBatch(id: string, user: AuthUser) {
    if (!canDeleteTransferBatches(user)) {
      throw new ForbiddenException('Удалять файлы перемещений может только администратор или владелец.');
    }

    const existing = await this.prisma.stockTransferBatch.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Файл перемещений не найден.');
    }
    this.clientScopes.requireClientAccess(user, existing.clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);

    return this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.stockTransferBatch.findUnique({ where: { id } });
        if (!batch) {
          throw new NotFoundException('Файл перемещений не найден.');
        }
        if (batch.status === 'REVERSED') {
          return { status: 'ALREADY_REVERSED', batch: transferBatchSummary(batch) };
        }

        const sourceFileName = normalizeUploadedFileName(batch.fileName);
        const rows = storedBoxTransferRows(batch.rows).filter((row) => row.status === 'APPLIED');
        for (const row of [...rows].reverse()) {
          try {
            await this.applyTransferBetweenBoxes(tx, {
              clientId: batch.clientId,
              skuId: row.skuId,
              fromBoxCode: row.toBoxCode,
              toBoxCode: row.fromBoxCode,
              quantity: row.quantity,
              status: StockStatus.AVAILABLE,
              idempotencyKey: `reverse-box-transfer-batch:${batch.id}:${row.rowNumber}`,
              sourceDocument: sourceFileName,
              comment: `Отмена файла ${sourceFileName}, строка ${row.rowNumber}`,
            }, warehouseId);
          } catch (caught) {
            throw new BadRequestException(
              `Файл нельзя удалить: строка ${row.rowNumber}. ${exceptionMessage(caught)}`,
            );
          }
        }

        const reversed = await tx.stockTransferBatch.update({
          where: { id: batch.id },
          data: {
            status: 'REVERSED',
            reversedAt: new Date(),
            reversedByUserId: user.id,
            reversedByName: user.name,
          },
        });

        return {
          status: 'REVERSED',
          reversedRows: rows.length,
          quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
          batch: transferBatchSummary(reversed),
        };
      },
      STOCK_TRANSFER_TRANSACTION_OPTIONS,
    );
  }

  private async applyTransferBetweenBoxes(
    tx: Prisma.TransactionClient,
    dto: TransferExecutionInput,
    warehouseId?: string,
  ) {
    const existingMovement = await tx.stockMovement.findUnique({
      where: { idempotencyKey: `${dto.idempotencyKey}:out` },
    });

    if (existingMovement) {
      return {
        idempotencyKey: dto.idempotencyKey,
        status: 'ALREADY_APPLIED' as const,
      };
    }

    const sku = await this.resolveSku(tx, dto);
    const fromBox = await this.resolveBox(tx, dto.clientId, dto.fromBoxCode, warehouseId);
    const operationWarehouseId =
      warehouseId ?? this.requireBalanceWarehouseId(fromBox.warehouseId);
    const toBox = await this.ensureTargetBox(
      tx,
      dto.clientId,
      dto.toBoxCode,
      operationWarehouseId,
    );
    const status = dto.status ?? StockStatus.AVAILABLE;

    const sourceBalance = await tx.stockBalance.findFirst({
      where: {
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: fromBox.id,
        warehouseId: operationWarehouseId,
        status,
      },
    });

    if (!sourceBalance || sourceBalance.quantity < dto.quantity) {
      throw new BadRequestException('Недостаточно остатка в исходном коробе.');
    }

    await this.decrementSourceBalance(tx, sourceBalance, dto.quantity);
    const targetBalance = await this.incrementTargetBalance(tx, {
      warehouseId: this.requireBalanceWarehouseId(toBox.warehouseId),
      clientId: dto.clientId,
      skuId: sku.id,
      boxId: toBox.id,
      palletId: toBox.palletId,
      status,
      quantity: dto.quantity,
    });

    await tx.stockMovement.create({
      data: {
        warehouseId: this.requireBalanceWarehouseId(fromBox.warehouseId),
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: fromBox.id,
        palletId: fromBox.palletId,
        type: 'MOVE',
        status,
        quantity: -dto.quantity,
        sourceDocument: dto.sourceDocument,
        idempotencyKey: `${dto.idempotencyKey}:out`,
        comment: dto.comment ?? `Перенос в короб ${toBox.code}`,
      },
    });

    await tx.stockMovement.create({
      data: {
        warehouseId: this.requireBalanceWarehouseId(toBox.warehouseId),
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: toBox.id,
        palletId: toBox.palletId,
        type: 'MOVE',
        status,
        quantity: dto.quantity,
        sourceDocument: dto.sourceDocument,
        idempotencyKey: `${dto.idempotencyKey}:in`,
        comment: dto.comment ?? `Перенос из короба ${fromBox.code}`,
      },
    });

    return {
      idempotencyKey: dto.idempotencyKey,
      status: 'APPLIED' as const,
      skuId: sku.id,
      fromBox: fromBox.code,
      toBox: toBox.code,
      quantity: dto.quantity,
      targetBalance,
    };
  }

  private async validateBoxTransferRows(
    clientId: string,
    sourceFileName: string,
    rows: BoxTransferImportRow[],
    db: StockTransferValidationDb,
    warehouseId?: string,
  ) {
    const barcodeValues = [...new Set(rows.map((row) => row.barcode).filter(Boolean))];
    const [boxes, barcodeRecords, balances] = await Promise.all([
      db.box.findMany({ where: { clientId, warehouseId }, select: { code: true } }),
      barcodeValues.length
        ? db.barcode.findMany({
            where: { value: { in: barcodeValues }, sku: { clientId } },
            include: { sku: true },
          })
        : Promise.resolve([]),
      db.stockBalance.findMany({
        where: {
          clientId,
          status: StockStatus.AVAILABLE,
          warehouseId,
          boxId: { not: null },
          box: this.warehouseScopedBoxWhere(warehouseId),
        },
        include: { box: { select: { code: true } } },
      }),
    ]);

    const existingBoxes = new Set(boxes.map((box) => box.code));
    const knownBoxes = new Set(existingBoxes);
    const skuByBarcode = new Map<string, (typeof barcodeRecords)[number]['sku']>();
    barcodeRecords.forEach((record) => {
      if (!skuByBarcode.has(record.value)) {
        skuByBarcode.set(record.value, record.sku);
      }
    });
    const simulatedBalances = new Map<string, number>();
    balances.forEach((balance) => {
      if (balance.box?.code) {
        simulatedBalances.set(transferBalanceKey(balance.box.code, balance.skuId), balance.quantity);
      }
    });

    const previewRows: BoxTransferPreviewRow[] = [];
    for (const row of rows) {
      const errors = [...row.errors];
      const sku = row.barcode ? skuByBarcode.get(row.barcode) : undefined;
      if (row.barcode && !sku) {
        errors.push(`Штрихкод ${row.barcode} не найден у клиента.`);
      }
      if (row.fromBoxCode && !knownBoxes.has(row.fromBoxCode)) {
        errors.push(`Исходный короб ${row.fromBoxCode} не найден.`);
      }
      if (
        row.fromBoxCode &&
        row.toBoxCode &&
        row.fromBoxCode.toLocaleUpperCase('ru') === row.toBoxCode.toLocaleUpperCase('ru')
      ) {
        errors.push('Исходный и целевой короба совпадают.');
      }

      const sourceKey = sku ? transferBalanceKey(row.fromBoxCode, sku.id) : '';
      const availableQuantity = sourceKey ? simulatedBalances.get(sourceKey) ?? 0 : 0;
      if (errors.length === 0 && availableQuantity < row.quantity) {
        errors.push(`Недостаточно товара: доступно ${availableQuantity}, требуется ${row.quantity}.`);
      }

      const targetBoxExists = existingBoxes.has(row.toBoxCode);
      if (errors.length > 0 || !sku) {
        previewRows.push({
          ...row,
          status: 'ERROR',
          errors,
          message: errors.join(' '),
          availableQuantity,
          targetBoxExists,
        });
        continue;
      }

      simulatedBalances.set(sourceKey, availableQuantity - row.quantity);
      const targetKey = transferBalanceKey(row.toBoxCode, sku.id);
      simulatedBalances.set(targetKey, (simulatedBalances.get(targetKey) ?? 0) + row.quantity);
      knownBoxes.add(row.toBoxCode);
      previewRows.push({
        ...row,
        skuId: sku.id,
        skuName: sku.name,
        internalSku: sku.internalSku,
        status: 'READY',
        errors: [],
        message: targetBoxExists
          ? 'Можно переместить.'
          : `Можно переместить. Короб ${row.toBoxCode} будет создан.`,
        availableQuantity,
        targetBoxExists,
      });
    }

    const readyRows = previewRows.filter((row) => row.status === 'READY');
    return {
      clientId,
      fileName: sourceFileName,
      summary: {
        rows: previewRows.length,
        readyRows: readyRows.length,
        errorRows: previewRows.length - readyRows.length,
        quantity: readyRows.reduce((sum, row) => sum + row.quantity, 0),
      },
      rows: previewRows,
    };
  }

  async pickClientRequest(dto: PickClientRequestDto, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
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
      this.assertRequestWarehouse(request, warehouseId);
      const operationWarehouseId = request.warehouseId ?? warehouseId;

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

      const savedSelections = await this.loadRequestBoxSelections(tx, request.id, operationWarehouseId);
      const plan = savedSelections.length
        ? await this.planRequestAllocationsFromSelections(
            tx,
            request.clientId,
            request.items,
            savedSelections,
            [StockStatus.AVAILABLE],
            operationWarehouseId,
          )
        : await this.planRequestPick(tx, request.clientId, request.items, operationWarehouseId);

      // Русский комментарий: сначала строим полный план по всем строкам, и только потом меняем остатки,
      // чтобы нехватка по одной позиции не оставила заявку частично собранной.
      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);
          await this.incrementTargetBalance(tx, {
            warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
            clientId: request.clientId,
            skuId: line.skuId,
            boxId: allocation.balance.boxId,
            palletId: allocation.balance.palletId,
            status: StockStatus.PACKING,
            quantity: allocation.quantity,
          });

          await tx.stockMovement.create({
            data: {
              warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
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
              warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
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

  async packageClientRequest(dto: FulfillClientRequestDto, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const baseKey = dto.idempotencyKey ?? `pack-request:${dto.requestId}`;

    return this.prisma.$transaction(async (tx) => {
      const packedAt = new Date();
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

      this.assertRequestWarehouse(request, warehouseId);
      const operationWarehouseId = request.warehouseId ?? warehouseId;
      if (request.status !== ClientRequestStatus.IN_WORK) {
        throw new BadRequestException('Упаковка доступна только после сборки заявки.');
      }

      await this.ensureAvailableStockIsInPacking(
        tx,
        request,
        `complete-pick-before-pack:${request.id}:${baseKey}`,
        operationWarehouseId,
      );

      const savedSelections = await this.loadRequestBoxSelections(tx, request.id, operationWarehouseId);
      const plan = savedSelections.length
        ? await this.planRequestAllocationsFromSelections(
            tx,
            request.clientId,
            request.items,
            savedSelections,
            [StockStatus.PACKING],
            operationWarehouseId,
          )
        : await this.planRequestAllocations(
            tx,
            request.clientId,
            request.items,
            StockStatus.PACKING,
            operationWarehouseId,
          );

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
        processedUnits: totalAllocatedUnits(plan),
        user,
        serviceDate: packedAt,
      });

      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.PACKED,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Заявка упакована и готова к отгрузке.',
        },
      });
      await this.createRequestStatusEvent(tx, {
        request,
        statusTo: ClientRequestStatus.PACKED,
        user,
        body: dto.comment ?? 'Заявка упакована и готова к отгрузке.',
        createdAt: packedAt,
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
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const baseKey = dto.idempotencyKey ?? `ship-request:${dto.requestId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const doneAt = new Date();
      const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Отгрузка');

      // Упаковка через ТСД или аварийный workflow могла завершиться без начислений.
      // Перед закрытием восстанавливаем их по фактическим упаковочным местам.
      this.assertRequestWarehouse(request, warehouseId);
      const operationWarehouseId = request.warehouseId ?? warehouseId;
      await this.ensureRequestFulfillmentBillingCharges(tx, request, user, doneAt);

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
        where: {
          OR: [
            { idempotencyKey: { startsWith: `${baseKey}:` } },
            {
              sourceDocument: request.id,
              type: MovementType.SHIP,
              quantity: { lt: 0 },
            },
          ],
        },
      });

      if (existingMovement) {
        await captureShippedKizHistory(tx, request.id, doneAt);
        await tx.clientRequest.update({
          where: { id: request.id },
          data: {
            status: ClientRequestStatus.DONE,
            assignedToUserId: user.id,
            managerComment: dto.comment ?? 'Заявка отгружена со склада.',
          },
        });
        await this.createRequestStatusEvent(tx, {
          request,
          statusTo: ClientRequestStatus.DONE,
          user,
          body: dto.comment ?? 'Заявка отгружена со склада.',
          createdAt: doneAt,
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

      await this.ensurePackedStockIsInShipping(
        tx,
        request,
        `complete-pack-before-ship:${request.id}:${baseKey}`,
        operationWarehouseId,
      );

      const savedSelections = await this.loadRequestBoxSelections(tx, request.id, operationWarehouseId);
      const plan = savedSelections.length
        ? await this.planRequestAllocationsFromSelections(
            tx,
            request.clientId,
            request.items,
            savedSelections,
            [StockStatus.SHIPPING],
            operationWarehouseId,
          )
        : await this.planRequestAllocations(
            tx,
            request.clientId,
            request.items,
            StockStatus.SHIPPING,
            operationWarehouseId,
          );

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);

          await tx.stockMovement.create({
            data: {
              warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
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

      await captureShippedKizHistory(tx, request.id, doneAt);
      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.DONE,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Заявка отгружена со склада.',
        },
      });

      await this.createRequestStatusEvent(tx, {
        request,
        statusTo: ClientRequestStatus.DONE,
        user,
        body: dto.comment ?? 'Заявка отгружена со склада.',
        createdAt: doneAt,
      });

      return {
        idempotencyKey: baseKey,
        status: 'APPLIED',
        requestId: request.id,
        clientId: request.clientId,
        shippedLines: this.formatFulfillmentLines(plan, 'shippedQuantity'),
      };
    });

    const logistics =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.ensureRequestLogisticsBilling(result.requestId, user)
        : undefined;
    const expenses =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.ensureRequestExpenseConsumption(result.requestId, user)
        : undefined;
    const billing =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.billingAutomation?.generateForDoneRequest(result.requestId, user)
        : undefined;

    return { ...result, logistics, expenses, billing };
  }

  async shipClientRequestFromCurrentStock(
    dto: FulfillClientRequestDto,
    user: AuthUser,
    physicalSources: PhysicalStockSourceInput[] = [],
  ) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);
    const baseKey = dto.idempotencyKey ?? `manual-ship-request:${dto.requestId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const doneAt = new Date();
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

      const request = await this.loadOutboundRequest(tx, dto.requestId, user, 'Отгрузка', true);

      this.assertRequestWarehouse(request, warehouseId);
      const operationWarehouseId = request.warehouseId ?? warehouseId;
      if (request.status === ClientRequestStatus.DONE) {
        await this.ensureRequestFulfillmentBillingCharges(tx, request, user, doneAt);
        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      this.ensureRequestCanMove(request, 'отгружать');

      if (existingMovement) {
        await this.ensureRequestFulfillmentBillingCharges(tx, request, user, doneAt);
        await captureShippedKizHistory(tx, request.id, doneAt);
        await tx.clientRequest.update({
          where: { id: request.id },
          data: {
            status: ClientRequestStatus.DONE,
            assignedToUserId: user.id,
            managerComment: dto.comment ?? 'Заявка сдана; списание ранее уже было выполнено.',
          },
        });

        return {
          idempotencyKey: baseKey,
          status: 'ALREADY_APPLIED',
          requestId: request.id,
          clientId: request.clientId,
        };
      }

      this.ensureManualDonePackageInput(
        dto,
        request.items.reduce((total, item) => total + item.quantity, 0),
      );
      const savedSelections = await this.loadRequestBoxSelections(tx, request.id, operationWarehouseId);
      // An explicitly confirmed physical source replaces the saved box selection.
      // Restoring old FBS selections as well would leave phantom PACKING/SHIPPING
      // balances in those boxes after the confirmed source has been shipped.
      if (savedSelections.length && physicalSources.length === 0) {
        await this.restoreCompletedFbsSelectionShortages(
          tx,
          request,
          savedSelections,
          baseKey,
          operationWarehouseId,
        );
      }
      const plan = physicalSources.length
        ? await this.planRequestAllocationsWithPhysicalSources(
            tx,
            request,
            savedSelections,
            physicalSources,
            baseKey,
            operationWarehouseId,
          )
        : savedSelections.length
          ? await this.planRequestAllocationsFromSelections(
            tx,
            request.clientId,
            request.items,
            savedSelections,
            [StockStatus.SHIPPING, StockStatus.PACKING, StockStatus.AVAILABLE],
            operationWarehouseId,
          )
          : await this.planRequestShipment(
              tx,
              request.clientId,
              request.items,
              operationWarehouseId,
            );
      await tx.clientRequestPackage.deleteMany({ where: { requestId: request.id } });
      const packages = await this.createRequestPackages(tx, {
        request,
        plan,
        dto,
        user,
      });
      await this.createFulfillmentBillingCharges(tx, {
        request,
        packages,
        processedUnits: totalAllocatedUnits(plan),
        user,
        serviceDate: doneAt,
      });

      for (const line of plan.lines) {
        for (const allocation of line.allocations) {
          await this.decrementSourceBalance(tx, allocation.balance, allocation.quantity);

          await tx.stockMovement.create({
            data: {
              warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
              clientId: request.clientId,
              skuId: line.skuId,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: MovementType.SHIP,
              status: allocation.balance.status,
              quantity: -allocation.quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:${line.itemId}:${allocation.balance.id}:out`,
              comment: dto.comment ?? `Ручное закрытие заявки ${request.title} со списанием остатка`,
            },
          });
        }
      }

      await captureShippedKizHistory(tx, request.id, doneAt);
      await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          status: ClientRequestStatus.DONE,
          assignedToUserId: user.id,
          managerComment: dto.comment ?? 'Заявка сдана; остатки списаны автоматически.',
        },
      });
      await this.createRequestStatusEvent(tx, {
        request,
        statusTo: ClientRequestStatus.DONE,
        user,
        body: dto.comment ?? 'Заявка сдана вручную; остатки списаны автоматически.',
        createdAt: doneAt,
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

    const logistics =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.ensureRequestLogisticsBilling(result.requestId, user)
        : undefined;
    const expenses =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.ensureRequestExpenseConsumption(result.requestId, user)
        : undefined;
    const billing =
      result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED'
        ? await this.billingAutomation?.generateForDoneRequest(result.requestId, user)
        : undefined;

    return { ...result, logistics, expenses, billing };
  }

  private async ensureRequestLogisticsBilling(requestId: string, user: AuthUser) {
    if (!this.logistics) {
      return undefined;
    }

    try {
      return await this.logistics.ensurePackedRequestBilling(requestId, user);
    } catch (caught) {
      return {
        status: 'FAILED' as const,
        message: caught instanceof Error ? caught.message : 'Не удалось рассчитать логистику по заявке.',
      };
    }
  }

  async receiveIntoBox(dto: ReceiveIntoBoxInput, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const scopedWarehouseId = this.resolveWritableWarehouseId(user);
    if (scopedWarehouseId && dto.warehouseId && dto.warehouseId !== scopedWarehouseId) {
      throw new ForbiddenException(
        'Приёмка относится к другому филиалу. Переключите город работы.',
      );
    }
    const operationWarehouseId =
      scopedWarehouseId ?? dto.warehouseId ?? user.activeWarehouseId ?? undefined;

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
      const box = dto.boxCode
        ? await this.ensureTargetBox(tx, dto.clientId, dto.boxCode, operationWarehouseId)
        : null;
      const status = dto.status ?? StockStatus.RECEIVING;
      const kiz = dto.kiz?.trim();

      if (sku.needsChestnyZnak && !sku.isUnmarked && !kiz && !dto.allowReceiptError) {
        throw new BadRequestException('Для товара нужен КИЗ. Сканируйте КИЗ перед закрытием короба.');
      }

      if (kiz) {
        const existingKiz = await tx.productMark.findFirst({
          where: {
            clientId: dto.clientId,
            value: { equals: kiz, mode: Prisma.QueryMode.insensitive },
          },
          select: {
            box: { select: { code: true, warehouseId: true } },
            stockMovement: { select: { warehouseId: true } },
          },
        });
        if (existingKiz) {
          const duplicateWarehouseId =
            existingKiz.box?.warehouseId ?? existingKiz.stockMovement?.warehouseId ?? null;
          throw new BadRequestException(
            duplicateKizMessage(
              !operationWarehouseId || duplicateWarehouseId === operationWarehouseId
                ? existingKiz.box?.code
                : undefined,
            ),
          );
        }
      }

      const targetBalance = await this.incrementTargetBalance(tx, {
        warehouseId: this.requireBalanceWarehouseId(box?.warehouseId ?? operationWarehouseId),
        clientId: dto.clientId,
        skuId: sku.id,
        boxId: box?.id ?? null,
        palletId: box?.palletId ?? null,
        status,
        quantity: dto.quantity,
      });

      const movement = await tx.stockMovement.create({
        data: {
          warehouseId: this.requireBalanceWarehouseId(box?.warehouseId ?? operationWarehouseId),
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: box?.id ?? null,
          palletId: box?.palletId ?? null,
          type: 'RECEIPT',
          status,
          quantity: dto.quantity,
          sourceDocument: dto.sourceDocument,
          idempotencyKey: dto.idempotencyKey,
          comment: dto.comment ?? (box ? `Приемка ТСД в короб ${box.code}` : 'Поштучная приемка ТСД без коробов'),
        },
      });

      if (kiz) {
        try {
          await tx.productMark.create({
            data: {
              clientId: dto.clientId,
              skuId: sku.id,
              boxId: box?.id ?? null,
              stockMovementId: movement.id,
              value: kiz,
              sourceDocument: dto.sourceDocument,
              status,
            },
          });
        } catch (caught) {
          if (isUniqueConstraintError(caught)) {
            throw new BadRequestException(duplicateKizMessage());
          }
          throw caught;
        }
      }

      return {
        idempotencyKey: dto.idempotencyKey,
        status: 'APPLIED',
        skuId: sku.id,
        skuIsDraft: sku.isDraft,
        skuDraftCreated: createdDraft,
        skuName: sku.name,
        needsChestnyZnak: sku.needsChestnyZnak,
        kiz: kiz ?? null,
        box: box?.code ?? null,
        quantity: dto.quantity,
        targetBalance,
      };
    });
  }

  async adjustInventoryToCounted(dto: AdjustInventoryInput, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.inventoryLock?.assertStockMovementsAllowed();
    const warehouseId = this.resolveWritableWarehouseId(user);

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
      const boxCode = dto.boxCode?.trim() || undefined;
      const client = !boxCode
        ? await tx.client.findUnique({
            where: { id: dto.clientId },
            select: { storesWithoutBoxes: true },
          })
        : null;
      if (!boxCode && !client?.storesWithoutBoxes) {
        throw new BadRequestException(
          'Для этого клиента обязателен boxCode. Корректировка без короба разрешена только при бескоробном учете.',
        );
      }
      // ADDED: бескоробный остаток остается в том же складе API-ключа с boxId/palletId = null.
      const box = boxCode
        ? await this.resolveBox(tx, dto.clientId, boxCode, warehouseId)
        : null;
      const balanceWarehouseId = box
        ? this.requireBalanceWarehouseId(box.warehouseId)
        : this.requireBalanceWarehouseId(warehouseId);
      const status = dto.status ?? StockStatus.AVAILABLE;
      const balance = await tx.stockBalance.findFirst({
        where: {
          clientId: dto.clientId,
          skuId: sku.id,
          ...(box
            ? { boxId: box.id }
            : { boxId: null, palletId: null }),
          warehouseId,
          status,
        },
      });
      const currentQuantity = balance?.quantity ?? 0;
      const delta = dto.countedQuantity - currentQuantity;

      if (delta > 0) {
        await this.incrementTargetBalance(tx, {
          warehouseId: balanceWarehouseId,
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: box?.id ?? null,
          palletId: box?.palletId ?? null,
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
            warehouseId: balanceWarehouseId,
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: box?.id ?? null,
            palletId: box?.palletId ?? null,
            type: 'INVENTORY_ADJUSTMENT',
            status,
            quantity: delta,
            idempotencyKey: dto.idempotencyKey,
            comment:
              dto.comment ??
              (box
                ? `Корректировка инвентаризации ТСД в коробе ${box.code}`
                : 'Корректировка инвентаризации без короба'),
          },
        });
      }

      return {
        idempotencyKey: dto.idempotencyKey,
        status: delta === 0 ? 'NO_CHANGE' : 'APPLIED',
        skuId: sku.id,
        box: box?.code ?? null,
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
    warehouseId?: string,
  ) {
    return this.planRequestAllocations(tx, clientId, items, StockStatus.AVAILABLE, warehouseId);
  }

  private async planRequestShipment(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
    warehouseId?: string,
  ): Promise<RequestAllocationPlan> {
    const client = 'client' in tx
      ? await tx.client.findUnique({
          where: { id: clientId },
          select: { storesWithoutBoxes: true },
        })
      : null;
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
          warehouseId,
          quantity: { gt: 0 },
          ...(client?.storesWithoutBoxes
            ? {}
            : warehouseId
              ? { box: this.warehouseScopedBoxWhere(warehouseId) }
              : { boxId: { not: null } }),
        },
        include: {
          box: { select: allocationBoxSelect },
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
      const allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }> = [];

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

  private loadRequestBoxSelections(
    tx: Prisma.TransactionClient,
    requestId: string,
    warehouseId?: string,
  ) {
    // Некоторые старые импорты и тестовые адаптеры могут не иметь новой таблицы до синхронизации схемы.
    if (!('clientRequestBoxSelection' in tx)) {
      return Promise.resolve([] as RequestBoxSelectionForAllocation[]);
    }
    return tx.clientRequestBoxSelection.findMany({
      where: {
        requestItem: { requestId },
        box: this.warehouseScopedBoxWhere(warehouseId),
      },
      include: { box: { select: allocationBoxSelect } },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  private async restoreCompletedFbsSelectionShortages(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      clientId: string;
      items: RequestItemForAllocation[];
    },
    selections: RequestBoxSelectionForAllocation[],
    baseKey: string,
    warehouseId?: string,
  ) {
    // Старые/тестовые Prisma-адаптеры могут не содержать FBS-таблицу.
    if (!('fbsTsdAssembly' in tx) || selections.length === 0) return;

    const completedTasks = await tx.fbsTsdAssembly.findMany({
      where: {
        requestId: request.id,
        status: 'COMPLETED',
        requestItemId: { in: [...new Set(selections.map((selection) => selection.requestItemId))] },
        boxId: { in: [...new Set(selections.map((selection) => selection.boxId))] },
      },
      select: {
        requestItemId: true,
        skuId: true,
        boxId: true,
        itemCount: true,
        completedAt: true,
      },
    });
    if (completedTasks.length === 0) return;

    const completedBySelection = new Map<string, number>();
    const completedAtBySelection = new Map<string, Date>();
    for (const task of completedTasks) {
      if (!task.boxId) continue;
      const key = `${task.requestItemId}:${task.skuId}:${task.boxId}`;
      completedBySelection.set(key, (completedBySelection.get(key) ?? 0) + Math.max(1, task.itemCount));
      if (task.completedAt) {
        const current = completedAtBySelection.get(key);
        if (!current || task.completedAt < current) completedAtBySelection.set(key, task.completedAt);
      }
    }

    const selectedSkuIds = [...new Set(selections.map((selection) => selection.skuId))];
    const selectedBoxIds = [...new Set(selections.map((selection) => selection.boxId))];
    const [balances, boxes, inventoryAdjustments] = await Promise.all([
      tx.stockBalance.findMany({
        where: {
          clientId: request.clientId,
          skuId: { in: selectedSkuIds },
          boxId: { in: selectedBoxIds },
          status: { in: [StockStatus.SHIPPING, StockStatus.PACKING, StockStatus.AVAILABLE] },
          quantity: { gt: 0 },
          warehouseId,
          box: this.warehouseScopedBoxWhere(warehouseId),
        },
      }),
      tx.box.findMany({
        where: { id: { in: selectedBoxIds }, ...(this.warehouseScopedBoxWhere(warehouseId) ?? {}) },
        select: { id: true, ...allocationBoxSelect },
      }),
      tx.stockMovement.findMany({
        where: {
          clientId: request.clientId,
          skuId: { in: selectedSkuIds },
          boxId: { in: selectedBoxIds },
          warehouseId,
          type: MovementType.INVENTORY_ADJUSTMENT,
          quantity: { lt: 0 },
        },
        select: {
          skuId: true,
          boxId: true,
          createdAt: true,
          idempotencyKey: true,
          sourceDocument: true,
        },
      }),
    ]);
    const boxById = new Map(boxes.map((box) => [box.id, box]));
    const inProcessBalanceBySelection = new Map<string, number>();
    const availableBalancesBySelection = new Map<string, StockBalance[]>();
    for (const balance of balances) {
      if (!balance.boxId) continue;
      const key = `${balance.skuId}:${balance.boxId}`;
      if (balance.status === StockStatus.AVAILABLE) {
        const available = availableBalancesBySelection.get(key) ?? [];
        available.push(balance);
        availableBalancesBySelection.set(key, available);
      } else {
        inProcessBalanceBySelection.set(
          key,
          (inProcessBalanceBySelection.get(key) ?? 0) + balance.quantity,
        );
      }
    }
    // Остаток PACKING/SHIPPING общий для короба. По мере обхода назначаем его
    // конкретным строкам заявки, чтобы две позиции не использовали один резерв повторно.
    const unassignedInProcessBySelection = new Map(inProcessBalanceBySelection);

    for (const selection of selections) {
      const completedQuantity =
        completedBySelection.get(`${selection.requestItemId}:${selection.skuId}:${selection.boxId}`) ?? 0;
      if (completedQuantity < selection.quantity) continue;

      const balanceKey = `${selection.skuId}:${selection.boxId}`;
      const inProcessPool = unassignedInProcessBySelection.get(balanceKey) ?? 0;
      const alreadyReserved = Math.min(selection.quantity, inProcessPool);
      unassignedInProcessBySelection.set(balanceKey, inProcessPool - alreadyReserved);
      const completedAt = completedAtBySelection.get(
        `${selection.requestItemId}:${selection.skuId}:${selection.boxId}`,
      );
      const recountedAfterCollection = Boolean(
        completedAt &&
          inventoryAdjustments.some(
            (movement) =>
              movement.skuId === selection.skuId &&
              movement.boxId === selection.boxId &&
              movement.createdAt >= completedAt &&
              !isFbsRelabelInventoryAdjustment(movement),
          ),
      );
      const shortage = Math.max(0, selection.quantity - alreadyReserved);
      if (shortage === 0) continue;

      const box = boxById.get(selection.boxId);
      if (!box) {
        throw new BadRequestException(
          `Короб ${selection.box.code} собранной FBS-заявки больше не найден в WMS.`,
        );
      }

      // Сканирование ТСД — физический факт отбора. До закрытия заявки переносим
      // эту единицу из AVAILABLE в SHIPPING, а не проверяем её повторно как
      // свободный товар. Если после сборки короб уже пересчитали, AVAILABLE
      // содержит только фактический остаток коробки и уменьшать его нельзя.
      let shiftedFromAvailable = 0;
      if (!recountedAfterCollection) {
        for (const balance of availableBalancesBySelection.get(balanceKey) ?? []) {
          if (shiftedFromAvailable >= shortage || balance.quantity <= 0) continue;
          const quantity = Math.min(balance.quantity, shortage - shiftedFromAvailable);
          await this.decrementSourceBalance(tx, balance, quantity);
          balance.quantity -= quantity;
          shiftedFromAvailable += quantity;
          await tx.stockMovement.create({
            data: {
              warehouseId: this.requireBalanceWarehouseId(balance.warehouseId),
              clientId: request.clientId,
              skuId: selection.skuId,
              boxId: selection.boxId,
              palletId: balance.palletId,
              type: MovementType.PICK,
              status: StockStatus.AVAILABLE,
              quantity: -quantity,
              sourceDocument: request.id,
              idempotencyKey: `${baseKey}:fbs-reserved:${selection.id}:${balance.id}:out`,
              comment:
                `Зарезервировано ${quantity} шт. уже собранного товара FBS из короба ${box.code} ` +
                'перед закрытием заявки.',
            },
          });
        }
      }

      await this.incrementTargetBalance(tx, {
        warehouseId: this.requireBalanceWarehouseId(box.warehouseId),
        clientId: request.clientId,
        skuId: selection.skuId,
        boxId: selection.boxId,
        palletId: box.palletId,
        status: StockStatus.SHIPPING,
        quantity: shortage,
      });
      if (shiftedFromAvailable > 0) {
        await tx.stockMovement.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(box.warehouseId),
            clientId: request.clientId,
            skuId: selection.skuId,
            boxId: selection.boxId,
            palletId: box.palletId,
            type: MovementType.PACK,
            status: StockStatus.SHIPPING,
            quantity: shiftedFromAvailable,
            sourceDocument: request.id,
            idempotencyKey: `${baseKey}:fbs-reserved:${selection.id}:in`,
            comment:
              `Уже собранный товар FBS из короба ${box.code} подготовлен к списанию ` +
              'при закрытии заявки.',
          },
        });
      }
      const reconciledQuantity = shortage - shiftedFromAvailable;
      if (reconciledQuantity > 0) {
        await tx.stockMovement.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(box.warehouseId),
            clientId: request.clientId,
            skuId: selection.skuId,
            boxId: selection.boxId,
            palletId: box.palletId,
            type: MovementType.INVENTORY_ADJUSTMENT,
            status: StockStatus.SHIPPING,
            quantity: reconciledQuantity,
            sourceDocument: request.id,
            idempotencyKey: `${baseKey}:fbs-reconciled:${selection.id}`,
            comment:
              `Восстановлен резерв ${reconciledQuantity} шт. уже собранного товара FBS после пересчёта ` +
              `короба ${box.code}; резерв будет списан при закрытии заявки.`,
          },
        });
      }
    }
  }

  private async ensureRequestExpenseConsumption(
    requestId: string,
    user: AuthUser,
  ) {
    if (!this.expenseAutomation) {
      return undefined;
    }

    try {
      return await this.expenseAutomation.consumeForDoneRequest(requestId, user);
    } catch (caught) {
      return {
        status: 'FAILED' as const,
        message:
          caught instanceof Error
            ? caught.message
            : 'Не удалось списать расходные материалы по заявке.',
      };
    }
  }

  private async planRequestAllocationsFromSelections(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
    selections: RequestBoxSelectionForAllocation[],
    sourceStatuses: StockStatus[],
    warehouseId?: string,
  ): Promise<RequestAllocationPlan> {
    const resolvedItems: Array<{
      item: RequestItemForAllocation;
      sku: { id: string; internalSku: string; weightGrams: number | null };
      selections: RequestBoxSelectionForAllocation[];
    }> = [];

    for (const item of items) {
      const sku = await this.resolveSku(tx, {
        clientId,
        skuId: item.skuId ?? undefined,
        barcode: item.barcode ?? undefined,
      });
      const itemSelections = selections.filter((selection) => selection.requestItemId === item.id);
      const selectedQuantity = itemSelections.reduce((sum, selection) => sum + selection.quantity, 0);
      if (selectedQuantity !== item.quantity) {
        throw new BadRequestException(
          `Для позиции ${sku.internalSku} нужно выбрать ${item.quantity} шт., сейчас выбрано ${selectedQuantity} шт.`,
        );
      }
      if (itemSelections.some((selection) => selection.skuId !== sku.id)) {
        throw new BadRequestException(`Сохраненный выбор коробов для позиции ${sku.internalSku} устарел.`);
      }
      resolvedItems.push({ item, sku, selections: itemSelections });
    }

    const skuIds = [...new Set(resolvedItems.map(({ sku }) => sku.id))];
    const boxIds = [...new Set(selections.map((selection) => selection.boxId))];
    const balances = await tx.stockBalance.findMany({
      where: {
        clientId,
        skuId: { in: skuIds },
        boxId: { in: boxIds },
        warehouseId,
        status: { in: sourceStatuses },
        quantity: { gt: 0 },
        box: {
          status: { notIn: ['deleted', 'archived'] },
          ...(this.warehouseScopedBoxWhere(warehouseId) ?? {}),
        },
      },
      include: { box: { select: allocationBoxSelect } },
      orderBy: [{ updatedAt: 'asc' }],
    });
    balances.sort((left, right) => {
      const statusPriority = sourceStatuses.indexOf(left.status) - sourceStatuses.indexOf(right.status);
      if (statusPriority !== 0) {
        return statusPriority;
      }
      return (left.updatedAt?.getTime?.() ?? 0) - (right.updatedAt?.getTime?.() ?? 0);
    });

    const balanceRemaining = new Map<string, number>();
    const lines: RequestAllocationPlan['lines'] = [];
    for (const { item, sku, selections: itemSelections } of resolvedItems) {
      const allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }> = [];
      for (const selection of itemSelections) {
        let remaining = selection.quantity;
        const matchingBalances = balances.filter(
          (balance) => balance.skuId === sku.id && balance.boxId === selection.boxId,
        );
        for (const balance of matchingBalances) {
          if (remaining <= 0) break;
          const available = balanceRemaining.has(balance.id) ? balanceRemaining.get(balance.id)! : balance.quantity;
          if (available <= 0) continue;
          const quantity = Math.min(available, remaining);
          allocations.push({ balance, quantity });
          balanceRemaining.set(balance.id, available - quantity);
          remaining -= quantity;
        }
        if (remaining > 0) {
          throw new BadRequestException(
            `В коробе ${selection.box.code} уже недостаточно товара ${sku.internalSku}. Обновите выбор коробов.`,
          );
        }
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

  /**
   * Закрытие по физическому факту используется только после ошибки штатного
   * списания. Для отмеченных строк менеджер подтверждает конкретный короб или
   * отсутствие короба. Имеющийся остаток списывается как обычно, а недостающая
   * в WMS часть сначала восстанавливается в SHIPPING отдельной корректировкой,
   * чтобы факт не создавал отрицательные остатки.
   */
  private async planRequestAllocationsWithPhysicalSources(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      clientId: string;
      items: RequestItemForAllocation[];
    },
    savedSelections: RequestBoxSelectionForAllocation[],
    physicalSources: PhysicalStockSourceInput[],
    baseKey: string,
    warehouseId?: string,
  ): Promise<RequestAllocationPlan> {
    const itemById = new Map(request.items.map((item) => [item.id, item]));
    const sourcesByItem = new Map<string, PhysicalStockSourceInput[]>();
    const duplicateSources = new Set<string>();
    const normalizedSources = physicalSources.map((source) => {
      const boxCode = source.boxCode?.trim() || undefined;
      const noBox = source.noBox === true;
      if (!itemById.has(source.requestItemId)) {
        throw new BadRequestException('В фактических источниках указан товар, которого нет в заявке.');
      }
      if (Boolean(boxCode) === noBox) {
        throw new BadRequestException('Для фактического источника выберите короб либо вариант «Без короба».');
      }
      const key = `${source.requestItemId}:${noBox ? 'NO_BOX' : boxCode!.toLocaleUpperCase('ru-RU')}`;
      if (duplicateSources.has(key)) {
        throw new BadRequestException('Один фактический источник нельзя указывать для позиции дважды.');
      }
      duplicateSources.add(key);
      return {
        requestItemId: source.requestItemId,
        boxCode,
        noBox,
        quantity: source.quantity,
      };
    });
    for (const source of normalizedSources) {
      const itemSources = sourcesByItem.get(source.requestItemId) ?? [];
      itemSources.push(source);
      sourcesByItem.set(source.requestItemId, itemSources);
    }
    for (const [requestItemId, sources] of sourcesByItem) {
      const requested = itemById.get(requestItemId)!.quantity;
      const confirmed = sources.reduce((sum, source) => sum + source.quantity, 0);
      if (confirmed !== requested) {
        throw new BadRequestException(
          `Для подтверждённой позиции нужно указать источник всех ${requested} шт., сейчас указано ${confirmed} шт.`,
        );
      }
    }

    const resolvedItems = await Promise.all(
      request.items.map(async (item) => ({
        item,
        sku: await this.resolveSku(tx, {
          clientId: request.clientId,
          skuId: item.skuId ?? undefined,
          barcode: item.barcode ?? undefined,
        }),
      })),
    );
    const [fbsLinks, fbsTasks] = await Promise.all([
      tx.fbsOrderRequestLink.findMany({
        where: {
          requestId: request.id,
          syncStatus: { not: 'REMOVED' },
        },
        select: {
          connectionId: true,
          orderId: true,
          lastSkuId: true,
        },
      }),
      tx.fbsTsdAssembly.findMany({
        where: { requestId: request.id },
        select: {
          connectionId: true,
          orderId: true,
          status: true,
        },
      }),
    ]);
    const completedFbsOrders = new Set(
      fbsTasks
        .filter((task) => task.status === 'COMPLETED')
        .map((task) => `${task.connectionId}:${task.orderId}`),
    );
    const incompleteFbsOrdersBySku = new Map<string, string[]>();
    for (const link of fbsLinks) {
      if (
        !link.lastSkuId ||
        completedFbsOrders.has(`${link.connectionId}:${link.orderId}`)
      ) {
        continue;
      }
      const orderIds = incompleteFbsOrdersBySku.get(link.lastSkuId) ?? [];
      orderIds.push(link.orderId);
      incompleteFbsOrdersBySku.set(link.lastSkuId, orderIds);
    }
    const requestedBoxCodes = [
      ...new Set(
        normalizedSources
          .map((source) => source.boxCode)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const boxes = requestedBoxCodes.length
      ? await tx.box.findMany({
          where: {
            clientId: request.clientId,
            code: { in: requestedBoxCodes, mode: 'insensitive' },
            status: { notIn: ['deleted', 'archived'] },
            ...(this.warehouseScopedBoxWhere(warehouseId) ?? {}),
          },
          select: { id: true, ...allocationBoxSelect },
        })
      : [];
    const boxByCode = new Map(
      boxes.map((box) => [box.code.toLocaleUpperCase('ru-RU'), box]),
    );
    for (const boxCode of requestedBoxCodes) {
      if (!boxByCode.has(boxCode.toLocaleUpperCase('ru-RU'))) {
        throw new BadRequestException(`Короб ${boxCode} не найден в активных коробах клиента.`);
      }
    }

    const sourceStatuses: StockStatus[] = [
      StockStatus.SHIPPING,
      StockStatus.PACKING,
      StockStatus.AVAILABLE,
    ];
    const balances = await tx.stockBalance.findMany({
      where: {
        clientId: request.clientId,
        skuId: { in: [...new Set(resolvedItems.map(({ sku }) => sku.id))] },
        status: { in: sourceStatuses },
        warehouseId,
        quantity: { gt: 0 },
        OR: [
          ...((!warehouseId || normalizedSources.some((source) => source.noBox))
            ? [{ boxId: null }]
            : []),
          {
            box: {
              status: { notIn: ['deleted', 'archived'] },
              ...(this.warehouseScopedBoxWhere(warehouseId) ?? {}),
            },
          },
        ],
      },
      include: { box: { select: allocationBoxSelect } },
      orderBy: [{ updatedAt: 'asc' }],
    });
    balances.sort((left, right) => {
      const statusPriority =
        sourceStatuses.indexOf(left.status) - sourceStatuses.indexOf(right.status);
      if (statusPriority !== 0) return statusPriority;
      return left.updatedAt.getTime() - right.updatedAt.getTime();
    });

    const remainingByBalance = new Map<string, number>();
    const lines: RequestAllocationPlan['lines'] = [];
    const allocateExisting = (
      skuId: string,
      quantity: number,
      matches: (balance: StockBalanceForAllocation) => boolean,
      allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }>,
    ) => {
      let remaining = quantity;
      for (const balance of balances) {
        if (remaining <= 0) break;
        if (balance.skuId !== skuId || !matches(balance)) continue;
        const available = remainingByBalance.has(balance.id)
          ? remainingByBalance.get(balance.id)!
          : balance.quantity;
        if (available <= 0) continue;
        const allocated = Math.min(available, remaining);
        allocations.push({ balance, quantity: allocated });
        remainingByBalance.set(balance.id, available - allocated);
        remaining -= allocated;
      }
      return remaining;
    };

    for (const { item, sku } of resolvedItems) {
      const allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }> = [];
      const confirmedSources = sourcesByItem.get(item.id);
      const incompleteFbsOrderIds = incompleteFbsOrdersBySku.get(sku.id) ?? [];
      if (incompleteFbsOrderIds.length > 0 && !confirmedSources) {
        throw new BadRequestException(
          `По позиции ${sku.internalSku} не завершены FBS-заказы №${incompleteFbsOrderIds.join(', №')}. ` +
            'Подтвердите фактический короб или выберите «Без короба» для этой позиции.',
        );
      }
      if (confirmedSources) {
        for (const [sourceIndex, source] of confirmedSources.entries()) {
          const box = source.noBox
            ? null
            : boxByCode.get(source.boxCode!.toLocaleUpperCase('ru-RU'))!;
          const missing = allocateExisting(
            sku.id,
            source.quantity,
            (balance) => (source.noBox ? balance.boxId === null : balance.boxId === box?.id),
            allocations,
          );
          if (missing <= 0) continue;

          const targetBalance = await this.incrementTargetBalance(tx, {
            warehouseId: this.requireBalanceWarehouseId(box?.warehouseId ?? warehouseId),
            clientId: request.clientId,
            skuId: sku.id,
            boxId: box?.id ?? null,
            palletId: box?.palletId ?? null,
            status: StockStatus.SHIPPING,
            quantity: missing,
          });
          const reconciledBalance: StockBalanceForAllocation = {
            ...targetBalance,
            box: box ? { ...box } : null,
          };
          if (!balances.some((balance) => balance.id === reconciledBalance.id)) {
            balances.push(reconciledBalance);
          }
          allocations.push({ balance: reconciledBalance, quantity: missing });
          remainingByBalance.set(reconciledBalance.id, 0);
          await tx.stockMovement.create({
            data: {
              warehouseId: this.requireBalanceWarehouseId(targetBalance.warehouseId),
              clientId: request.clientId,
              skuId: sku.id,
              boxId: box?.id ?? null,
              palletId: box?.palletId ?? null,
              type: MovementType.INVENTORY_ADJUSTMENT,
              status: StockStatus.SHIPPING,
              quantity: missing,
              sourceDocument: request.id,
              idempotencyKey:
                `${baseKey}:physical-source:${item.id}:${source.noBox ? 'no-box' : box!.id}:${sourceIndex}`,
              comment: source.noBox
                ? `Менеджер подтвердил ${missing} шт. товара без короба для закрытия заявки.`
                : `Менеджер подтвердил ${missing} шт. товара из физического короба ${box!.code} для закрытия заявки.`,
            },
          });
        }
      } else {
        const itemSelections = savedSelections.filter(
          (selection) => selection.requestItemId === item.id,
        );
        if (itemSelections.length > 0) {
          for (const selection of itemSelections) {
            const missing = allocateExisting(
              sku.id,
              selection.quantity,
              (balance) => balance.boxId === selection.boxId,
              allocations,
            );
            if (missing > 0) {
              throw new BadRequestException(
                `В коробе ${selection.box.code} уже недостаточно товара ${sku.internalSku}. ` +
                  'Укажите фактический короб или выберите «Без короба».',
              );
            }
          }
        } else {
          const missing = allocateExisting(
            sku.id,
            item.quantity,
            () => true,
            allocations,
          );
          if (missing > 0) {
            throw new BadRequestException(
              `Недостаточно остатка для списания позиции ${sku.internalSku}. ` +
                'Укажите фактический короб или выберите «Без короба».',
            );
          }
        }
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
    warehouseId?: string,
  ) {
    const missingItems = await this.findItemsMissingInStatus(
      tx,
      request.clientId,
      request.items,
      StockStatus.SHIPPING,
      warehouseId,
    );

    if (missingItems.length === 0) {
      return;
    }

    await this.ensureAvailableStockIsInPacking(
      tx,
      { ...request, items: missingItems },
      `complete-pick-before-ship:${request.id}:${baseKey}`,
      warehouseId,
    );

    const plan = await this.planRequestAllocations(
      tx,
      request.clientId,
      missingItems,
      StockStatus.PACKING,
      warehouseId,
    );

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

  private async ensureAvailableStockIsInPacking(
    tx: Prisma.TransactionClient,
    request: { id: string; clientId: string; title?: string | null; items: RequestItemForAllocation[] },
    baseKey: string,
    warehouseId?: string,
  ) {
    const missingItems = await this.findItemsMissingInStatus(
      tx,
      request.clientId,
      request.items,
      StockStatus.PACKING,
      warehouseId,
    );

    if (missingItems.length === 0) {
      return;
    }

    const plan = await this.planRequestAllocations(
      tx,
      request.clientId,
      missingItems,
      StockStatus.AVAILABLE,
      warehouseId,
    );

    await this.applyStatusMove(tx, {
      request,
      plan,
      baseKey,
      movementType: MovementType.PICK,
      sourceStatus: StockStatus.AVAILABLE,
      targetStatus: StockStatus.PACKING,
      sourceComment: `Достроена сборка перед упаковкой заявки ${request.title ?? request.id}`,
      targetComment: `Передано в упаковку перед закрытием сборки заявки ${request.title ?? request.id}`,
    });
  }

  private async findItemsMissingInStatus(
    tx: Prisma.TransactionClient,
    clientId: string,
    items: RequestItemForAllocation[],
    status: StockStatus,
    warehouseId?: string,
  ): Promise<RequestItemForAllocation[]> {
    const client = 'client' in tx
      ? await tx.client.findUnique({
          where: { id: clientId },
          select: { storesWithoutBoxes: true },
        })
      : null;
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
            warehouseId,
            quantity: { gt: 0 },
            ...(client?.storesWithoutBoxes
              ? {}
              : warehouseId
                ? { box: this.warehouseScopedBoxWhere(warehouseId) }
                : { boxId: { not: null } }),
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
    warehouseId?: string,
  ): Promise<RequestAllocationPlan> {
    const client = 'client' in tx
      ? await tx.client.findUnique({
          where: { id: clientId },
          select: { storesWithoutBoxes: true },
        })
      : null;
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
          warehouseId,
          quantity: { gt: 0 },
          ...(client?.storesWithoutBoxes
            ? {}
            : warehouseId
              ? { box: this.warehouseScopedBoxWhere(warehouseId) }
              : { boxId: { not: null } }),
        },
        include: {
          box: { select: allocationBoxSelect },
        },
        orderBy: [{ updatedAt: 'asc' }],
      });
      let remaining = item.quantity;
      const allocations: Array<{ balance: StockBalanceForAllocation; quantity: number }> = [];

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
    allowDelivery = false,
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

    const supportedType =
      request.type === ClientRequestType.OUTBOUND ||
      (allowDelivery && request.type === ClientRequestType.DELIVERY);
    if (!supportedType) {
      throw new BadRequestException(
        allowDelivery
          ? `${operationName} доступна только для товарных заявок «Отгрузка» и «Доставка».`
          : `${operationName} доступна только для заявок на отгрузку.`,
      );
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
      const hasExplicitPackageCounts = dto.boxes != null || dto.pallets != null;

      if (!hasExplicitPackageCounts) {
        const allocationPackages = buildAllocationPackages(requestId, plan, dto);
        if (allocationPackages.length > 0) {
          return allocationPackages;
        }
      }

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
            ? validateBoxWeight(packageCode, { packageType }, items, dto.allowOverweightPackages)
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
      const metadata = validateBoxWeight(packageCode, packageDto, items, dto.allowOverweightPackages);

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

  private ensureManualDonePackageInput(dto: FulfillClientRequestDto, expectedPackedUnits: number) {
    if (!dto.comment?.trim()) {
      throw new BadRequestException('Для ручного закрытия отгрузки нужен комментарий.');
    }

    if (dto.boxes == null || dto.pallets == null || dto.packedUnits == null) {
      throw new BadRequestException(
        'Для ручного закрытия заполните фактическое количество коробов, паллет и упакованных единиц.',
      );
    }

    if (dto.boxes + dto.pallets < 1) {
      throw new BadRequestException('Укажите хотя бы одно фактическое упаковочное место: короб или паллету.');
    }

    if (dto.packedUnits !== expectedPackedUnits) {
      throw new BadRequestException(
        `В заявке ${expectedPackedUnits} шт. Укажите такое же фактическое количество или сначала исправьте состав заявки.`,
      );
    }

    if (!dto.packages?.length) {
      return;
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

  private async createRequestStatusEvent(
    tx: Prisma.TransactionClient,
    input: {
      request: { id: string; clientId: string; status: ClientRequestStatus };
      statusTo: ClientRequestStatus;
      user: AuthUser;
      body?: string;
      createdAt: Date;
    },
  ) {
    if (input.request.status === input.statusTo) {
      return;
    }

    const existing = await tx.clientRequestEvent.findFirst({
      where: {
        requestId: input.request.id,
        eventType: ClientRequestEventType.STATUS_CHANGED,
        statusTo: input.statusTo,
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    await tx.clientRequestEvent.create({
      data: {
        requestId: input.request.id,
        clientId: input.request.clientId,
        eventType: ClientRequestEventType.STATUS_CHANGED,
        title: 'Статус заявки изменен',
        body: input.body,
        statusFrom: input.request.status,
        statusTo: input.statusTo,
        createdByUserId: input.user.id,
        createdAt: input.createdAt,
      },
    });
  }

  private async createFulfillmentBillingCharges(
    tx: Prisma.TransactionClient,
    input: {
      request: {
        id: string;
        clientId: string;
        title?: string | null;
        items?: Array<{ skuId?: string | null; quantity: number; comment?: string | null }>;
      };
      packages: Array<{ packageType: string | null }>;
      processedUnits: number;
      user: AuthUser;
      serviceDate: Date;
    },
  ) {
    if (!('billingService' in tx) || !('clientBillingService' in tx) || !('billingCharge' in tx)) {
      return;
    }
    if (
      'fbsOrderRequestLink' in tx &&
      typeof tx.fbsOrderRequestLink.count === 'function' &&
      (await tx.fbsOrderRequestLink.count({ where: { requestId: input.request.id } })) > 0
    ) {
      // FBS формирует собственный счёт и, при включённой настройке клиента,
      // отдельный счёт первичной обработки. Общие начисления заявки здесь не дублируем.
      return;
    }

    const packageCounts = input.packages.reduce(
      (result, pack) => {
        if (isPalletPackage(pack.packageType)) {
          result.explicitPallets += 1;
        } else {
          result.boxes += 1;
        }
        return result;
      },
      { boxes: 0, explicitPallets: 0 },
    );
    const counts = {
      boxes: packageCounts.boxes,
      pallets:
        packageCounts.explicitPallets > 0
          ? packageCounts.explicitPallets
          : calculatePalletCount(packageCounts.boxes),
    };
    const relabelUnits = await this.resolveRequestRelabelUnits(tx, input.request);
    const processing = await this.resolveRequestProcessingBreakdown(tx, input.request, input.processedUnits);
    const rows: FulfillmentBillingRow[] = [
      {
        ...FULFILLMENT_BILLING_SERVICES.ITEM_PROCESSING,
        quantity: processing.standardUnits,
        requiresConfiguredPrice: true,
      },
      {
        ...FULFILLMENT_BILLING_SERVICES.CLOTHING_PROCESSING,
        quantity: processing.clothingUnits,
        requiresConfiguredPrice: true,
      },
      {
        ...FULFILLMENT_BILLING_SERVICES.RELABELING,
        quantity: relabelUnits,
        requiresConfiguredPrice: true,
      },
      { ...FULFILLMENT_BILLING_SERVICES.BOX_60_40_40, quantity: counts.boxes },
      { ...FULFILLMENT_BILLING_SERVICES.BOX_ASSEMBLY, quantity: counts.boxes },
      { ...FULFILLMENT_BILLING_SERVICES.PALLET, quantity: counts.pallets },
      { ...FULFILLMENT_BILLING_SERVICES.PALLET_ASSEMBLY, quantity: counts.pallets },
    ].filter((row) => row.quantity > 0);

    for (const row of rows) {
      const sourceKey = `${row.sourceKeyPrefix}:${input.request.id}:${row.code}`;
      const existingCharge = await tx.billingCharge.findFirst({
        where: { sourceKey },
        select: { id: true },
      });
      if (existingCharge) {
        continue;
      }

      const { service, clientPrice, priceRequiresConfirmation } = row.requiresConfiguredPrice
        ? await this.findConfiguredFulfillmentService(tx, input.request.clientId, row)
        : await this.ensureStandardFulfillmentService(tx, input.request.clientId, row, input.user.id);
      if (!clientPrice.isActive && !priceRequiresConfirmation) {
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
            processedUnits: input.processedUnits,
            standardProcessingUnits: processing.standardUnits,
            clothingProcessingUnits: processing.clothingUnits,
            relabelUnits,
            packagesCount: input.packages.length,
            boxes: counts.boxes,
            pallets: counts.pallets,
            boxesPerPallet: BOXES_PER_PALLET,
            looseBoxesWithoutExtraPallet: LOOSE_BOXES_WITHOUT_EXTRA_PALLET,
            taxMode: clientPrice.taxMode,
            priceBeforeTaxRub: Number(clientPrice.priceRub),
            priceRequiresConfirmation,
          },
          comment: priceRequiresConfirmation
            ? 'Автоматически создано. Цена услуги не настроена и требует проверки в черновике счета.'
            : 'Автоматически создано при упаковке или закрытии заявки',
          createdByUserId: input.user.id,
          approvedByUserId: input.user.id,
          approvedAt: new Date(),
        },
      });
    }
  }

  private async resolveRequestRelabelUnits(
    tx: Prisma.TransactionClient,
    request: { id: string; items?: Array<{ quantity: number; comment?: string | null }> },
  ) {
    if ('tsdOperation' in tx && typeof tx.tsdOperation.count === 'function') {
      const completed = await tx.tsdOperation.count({
        where: {
          operationType: 'assembly_stage',
          status: TsdOperationStatus.ACCEPTED,
          AND: [
            { payload: { path: ['requestId'], equals: request.id } },
            { payload: { path: ['action'], equals: 'relabel-complete' } },
          ],
        },
      });
      if (completed > 0) return completed;
    }

    return (request.items ?? []).reduce(
      (sum, item) => (isRelabelRequestItem(item.comment) ? sum + Math.max(0, Math.floor(item.quantity)) : sum),
      0,
    );
  }

  private async resolveRequestProcessingBreakdown(
    tx: Prisma.TransactionClient,
    request: { id: string; clientId: string; items?: Array<{ skuId?: string | null }> },
    processedUnits: number,
  ) {
    const totalUnits = Math.max(0, Math.floor(processedUnits));
    if (totalUnits === 0 || !('client' in tx) || !('stockMovement' in tx)) {
      return { standardUnits: totalUnits, clothingUnits: 0 };
    }

    const client = await tx.client.findUnique({
      where: { id: request.clientId },
      select: { name: true, legalName: true },
    });
    if (!isLukinClient(client)) {
      return { standardUnits: totalUnits, clothingUnits: 0 };
    }

    const skuIds = [...new Set((request.items ?? []).map((item) => item.skuId).filter((value): value is string => Boolean(value)))];
    const movements = await tx.stockMovement.findMany({
      where: {
        clientId: request.clientId,
        ...(skuIds.length ? { skuId: { in: skuIds } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        skuId: true,
        boxId: true,
        type: true,
        status: true,
        quantity: true,
        sourceDocument: true,
        idempotencyKey: true,
        box: { select: { code: true } },
      },
    });

    const balances = new Map<string, ProcessingOriginBucket>();
    const transfers = new Map<string, ProcessingOriginBucket>();
    let packedClothingUnits = 0;
    let packedUnits = 0;
    let shippedClothingUnits = 0;
    let shippedUnits = 0;

    for (const movement of movements) {
      const quantity = Math.abs(movement.quantity);
      if (quantity <= 0) continue;
      const balanceKey = processingBalanceKey(movement.skuId, movement.boxId, movement.status);
      const boxCode = movement.box?.code ?? '';
      const pairKey = processingMovementPairKey(movement.idempotencyKey);

      if (movement.quantity < 0) {
        const bucket = balances.get(balanceKey) ?? originBucketForBox(boxCode, quantity);
        const consumed = consumeOriginBucket(bucket, quantity, boxCode);
        balances.set(balanceKey, bucket);
        if (pairKey) transfers.set(pairKey, addOriginBuckets(transfers.get(pairKey), consumed));

        if (movement.sourceDocument === request.id && movement.type === MovementType.PACK) {
          packedUnits += quantity;
          packedClothingUnits += consumed.clothing;
        }
        if (movement.sourceDocument === request.id && movement.type === MovementType.SHIP) {
          shippedUnits += quantity;
          shippedClothingUnits += consumed.clothing;
        }
        continue;
      }

      const carried = pairKey ? transfers.get(pairKey) : undefined;
      const incoming = carried ? consumeOriginBucket(carried, quantity, boxCode) : originBucketForBox(boxCode, quantity);
      balances.set(balanceKey, addOriginBuckets(balances.get(balanceKey), incoming));
      if (pairKey && carried && carried.clothing + carried.standard <= 0) transfers.delete(pairKey);
    }

    const classifiedUnits = packedUnits > 0 ? packedUnits : shippedUnits;
    const classifiedClothing = packedUnits > 0 ? packedClothingUnits : shippedClothingUnits;
    const clothingUnits = Math.min(totalUnits, classifiedUnits > 0 ? classifiedClothing : 0);
    return {
      standardUnits: Math.max(0, totalUnits - clothingUnits),
      clothingUnits,
    };
  }

  private async ensureRequestFulfillmentBillingCharges(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      clientId: string;
      title?: string | null;
      items: Array<{ quantity: number }>;
    },
    user: AuthUser,
    fallbackDate: Date,
  ) {
    if (!('billingService' in tx) || !('clientBillingService' in tx) || !('billingCharge' in tx)) {
      return;
    }

    const packages = await this.listRequestPackages(tx, request.id);
    const packagedUnits = packages.reduce(
      (packageTotal, packagePlace) =>
        packageTotal + packagePlace.items.reduce((itemTotal, item) => itemTotal + item.quantity, 0),
      0,
    );
    const packedEvent = await tx.clientRequestEvent.findFirst({
      where: {
        requestId: request.id,
        statusTo: ClientRequestStatus.PACKED,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    await this.createFulfillmentBillingCharges(tx, {
      request,
      packages,
      processedUnits:
        packagedUnits > 0
          ? packagedUnits
          : request.items.reduce((sum, item) => sum + item.quantity, 0),
      user,
      serviceDate: packedEvent?.createdAt ?? fallbackDate,
    });
  }

  private async findConfiguredFulfillmentService(
    tx: Prisma.TransactionClient,
    clientId: string,
    row: FulfillmentBillingRow,
  ) {
    const service = await tx.billingService.findFirst({
      where: {
        isActive: true,
        OR: [
          { code: row.code },
          { name: { equals: row.name, mode: Prisma.QueryMode.insensitive } },
        ],
        clientPrices: {
          some: {
            clientId,
            isActive: true,
          },
        },
      },
      include: {
        clientPrices: {
          where: { clientId, isActive: true },
          take: 1,
        },
      },
      orderBy: { code: 'asc' },
    });
    const activeClientPrice = service?.clientPrices[0];
    if (service && activeClientPrice) {
      return {
        service,
        clientPrice: activeClientPrice,
        priceRequiresConfirmation: Number(activeClientPrice.priceRub) <= 0,
      };
    }

    const fallbackService = await tx.billingService.upsert({
      where: { code: row.code },
      update: {
        name: row.name,
        unit: row.unit,
        isActive: true,
      },
      create: {
        code: row.code,
        name: row.name,
        unit: row.unit,
        isActive: true,
      },
    });
    const fallbackClientPrice =
      (await tx.clientBillingService.findUnique({
        where: {
          clientId_serviceId: {
            clientId,
            serviceId: fallbackService.id,
          },
        },
      })) ??
      (await tx.clientBillingService.create({
        data: {
          clientId,
          serviceId: fallbackService.id,
          priceRub: 0,
          taxMode: BillingPriceTaxMode.INCLUDED,
          isActive: false,
          comment: 'Цена требует настройки перед выставлением счета.',
        },
      }));

    return {
      service: fallbackService,
      clientPrice: fallbackClientPrice,
      priceRequiresConfirmation: true,
    };
  }

  private async ensureStandardFulfillmentService(
    tx: Prisma.TransactionClient,
    clientId: string,
    row: FulfillmentBillingRow,
    userId: string,
  ) {
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
          clientId,
          serviceId: service.id,
        },
      },
      update: {},
      create: {
        clientId,
        serviceId: service.id,
        priceRub: row.defaultPriceRub ?? 0,
        taxMode: BillingPriceTaxMode.INCLUDED,
        isActive: true,
        updatedByUserId: userId,
      },
    });

    return { service, clientPrice, priceRequiresConfirmation: false };
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
          warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
          clientId: input.request.clientId,
          skuId: line.skuId,
          boxId: allocation.balance.boxId,
          palletId: allocation.balance.palletId,
          status: input.targetStatus,
          quantity: allocation.quantity,
        });

        await tx.stockMovement.create({
          data: {
            warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
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
            warehouseId: this.requireBalanceWarehouseId(allocation.balance.warehouseId),
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

  private async loadTsdTransferSourceBox(
    db: TsdTransferDb,
    boxCodeValue: string,
    user: AuthUser,
  ): Promise<TsdTransferSourceBox> {
    const warehouseId = this.resolveWritableWarehouseId(user);
    const boxCode = this.boxCodes
      ? await this.boxCodes.normalize(boxCodeValue)
      : boxCodeValue.trim();
    const box = await db.box.findUnique({
      where: { code: boxCode },
      include: {
        client: { select: { id: true, code: true, name: true } },
        zone: { select: { warehouseId: true } },
        pallet: { select: { zone: { select: { warehouseId: true } } } },
        balances: {
          where: {
            status: StockStatus.AVAILABLE,
            warehouseId,
            quantity: { gt: 0 },
          },
          include: {
            sku: {
              include: {
                barcodes: {
                  select: { value: true, isPrimary: true },
                  orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }],
                },
              },
            },
          },
          orderBy: [{ sku: { name: 'asc' } }],
        },
      },
    });
    if (!box || ['deleted', 'archived'].includes(box.status)) {
      throw new NotFoundException(`Короб ${boxCode} не найден в активных остатках.`);
    }
    this.clientScopes.requireClientAccess(user, box.clientId, 'write');
    this.assertBoxWarehouse(warehouseId, box);
    if (box.balances.length === 0) {
      throw new BadRequestException(`В коробе ${box.code} нет доступного товара для перемещения.`);
    }
    return box;
  }

  private formatTsdTransferSource(sourceBox: TsdTransferSourceBox) {
    return {
      state: 'SCAN_ITEM',
      message: `Короб ${sourceBox.code} открыт. Отсканируйте ШК товара или КИЗ.`,
      sourceBox: {
        id: sourceBox.id,
        code: sourceBox.code,
        client: sourceBox.client,
        totalQuantity: sourceBox.balances.reduce(
          (sum, balance) => sum + balance.quantity,
          0,
        ),
        products: sourceBox.balances.map((balance) => ({
          skuId: balance.skuId,
          name: balance.sku.name,
          article:
            balance.sku.article ??
            balance.sku.clientSku ??
            balance.sku.internalSku,
          color: balance.sku.color,
          size: balance.sku.size,
          quantity: balance.quantity,
          requiresKiz:
            balance.sku.needsChestnyZnak && !balance.sku.isUnmarked,
          barcodes: balance.sku.barcodes.map((barcode) => barcode.value),
        })),
      },
    };
  }

  private async resolveTsdTransferScannedItem(
    db: TsdTransferDb,
    sourceBox: TsdTransferSourceBox,
    scanCodeValue: string,
  ): Promise<TsdTransferScannedItem> {
    const scanCode = requiredTsdTransferText(
      scanCodeValue,
      'Отсканируйте ШК товара или КИЗ.',
    );
    const productMark = await db.productMark.findFirst({
      where: {
        clientId: sourceBox.clientId,
        boxId: sourceBox.id,
        status: StockStatus.AVAILABLE,
        value: { equals: scanCode, mode: Prisma.QueryMode.insensitive },
      },
      select: { id: true, skuId: true },
    });
    if (productMark) {
      const balance = sourceBox.balances.find(
        (row) => row.skuId === productMark.skuId,
      );
      if (!balance || balance.quantity < 1) {
        throw new BadRequestException(
          `КИЗ числится в коробе ${sourceBox.code}, но доступного остатка товара нет. Передайте короб менеджеру.`,
        );
      }
      return {
        sku: balance.sku,
        scanCode,
        scanType: 'KIZ',
        productMarkId: productMark.id,
        availableQuantity: balance.quantity,
        requiresKizRegistration: false,
      };
    }

    const normalizedScan = scanCode.toLocaleLowerCase('ru-RU');
    const balance = sourceBox.balances.find((row) =>
      row.sku.barcodes.some(
        (barcode) =>
          barcode.value.toLocaleLowerCase('ru-RU') === normalizedScan,
      ),
    );
    if (!balance) {
      throw new NotFoundException(
        `В коробе ${sourceBox.code} нет товара с кодом ${printableTransferScan(scanCode)}.`,
      );
    }
    const registeredMarks = await db.productMark.count({
      where: {
        clientId: sourceBox.clientId,
        skuId: balance.skuId,
        boxId: sourceBox.id,
        status: StockStatus.AVAILABLE,
      },
    });
    const requiresKizRegistration =
      balance.sku.needsChestnyZnak && !balance.sku.isUnmarked;
    if (!requiresKizRegistration && registeredMarks >= balance.quantity) {
      throw new BadRequestException(
        `Для товара «${balance.sku.name}» в коробе зарегистрированы КИЗы. Отсканируйте КИЗ конкретной единицы.`,
      );
    }
    return {
      sku: balance.sku,
      scanCode,
      scanType: 'BARCODE',
      productMarkId: null,
      availableQuantity: requiresKizRegistration
        ? balance.quantity
        : balance.quantity - registeredMarks,
      requiresKizRegistration,
    };
  }

  private async bindMissingTsdTransferKiz(
    db: Prisma.TransactionClient,
    sourceBox: TsdTransferSourceBox,
    skuId: string,
    kizValue: string,
    sourceDocument: string,
  ): Promise<TsdTransferScannedItem> {
    const kiz = requiredTsdTransferText(kizValue, 'Отсканируйте КИЗ товара.');
    if (kiz.length <= 20) {
      throw new BadRequestException('После ШК товара нужно отсканировать его КИЗ.');
    }
    const balance = sourceBox.balances.find((row) => row.skuId === skuId);
    if (!balance || balance.quantity < 1) {
      throw new BadRequestException(
        `В коробе ${sourceBox.code} больше нет доступной единицы выбранного товара.`,
      );
    }
    if (!balance.sku.needsChestnyZnak || balance.sku.isUnmarked) {
      throw new BadRequestException('Для этого товара КИЗ не требуется. Повторно отсканируйте ШК.');
    }

    const existing = await db.productMark.findFirst({
      where: {
        clientId: sourceBox.clientId,
        value: { equals: kiz, mode: Prisma.QueryMode.insensitive },
      },
      select: { id: true, skuId: true, boxId: true, status: true },
    });
    if (existing) {
      if (
        existing.skuId === skuId &&
        existing.boxId === sourceBox.id &&
        existing.status === StockStatus.AVAILABLE
      ) {
        return {
          sku: balance.sku,
          scanCode: kiz,
          scanType: 'KIZ',
          productMarkId: existing.id,
          availableQuantity: balance.quantity,
          requiresKizRegistration: false,
        };
      }
      throw new BadRequestException(
        'Этот КИЗ уже привязан к другому товару или коробу. Перемещение остановлено.',
      );
    }

    const registeredMarks = await db.productMark.count({
      where: {
        clientId: sourceBox.clientId,
        skuId,
        boxId: sourceBox.id,
        status: StockStatus.AVAILABLE,
      },
    });
    try {
      if (registeredMarks >= balance.quantity) {
        // FIX: Количество не увеличиваем: физический КИЗ заменяет одну старую неиспользуемую привязку.
        const protectedKizValues = (
          await db.fbsTsdAssembly.findMany({
            where: {
              clientId: sourceBox.clientId,
              skuId,
              kiz: { not: null },
              status: { in: ['IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED'] },
            },
            select: { kiz: true },
          })
        )
          .map((row) => row.kiz)
          .filter((value): value is string => Boolean(value));
        const replaceable = await db.productMark.findFirst({
          where: {
            clientId: sourceBox.clientId,
            skuId,
            boxId: sourceBox.id,
            status: StockStatus.AVAILABLE,
            ...(protectedKizValues.length > 0
              ? { value: { notIn: protectedKizValues } }
              : {}),
          },
          orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, value: true, sourceDocument: true },
        });
        if (!replaceable) {
          throw new BadRequestException(
            `В коробе ${sourceBox.code} нет старой привязки КИЗ, которую можно безопасно заменить.`,
          );
        }
        const replaced = await db.productMark.update({
          where: { id: replaceable.id },
          data: {
            value: kiz,
            sourceDocument:
              `${sourceDocument}: физический КИЗ заменил старую привязку ` +
              `ref ${hashText(replaceable.value)} без изменения количества`,
          },
          select: { id: true },
        });
        return {
          sku: balance.sku,
          scanCode: kiz,
          scanType: 'KIZ',
          productMarkId: replaced.id,
          availableQuantity: balance.quantity,
          requiresKizRegistration: false,
        };
      }

      const created = await db.productMark.create({
        data: {
          clientId: sourceBox.clientId,
          skuId,
          boxId: sourceBox.id,
          value: kiz,
          sourceDocument,
          status: StockStatus.AVAILABLE,
        },
        select: { id: true },
      });
      return {
        sku: balance.sku,
        scanCode: kiz,
        scanType: 'KIZ',
        productMarkId: created.id,
        availableQuantity: balance.quantity,
        requiresKizRegistration: false,
      };
    } catch (caught) {
      if (isUniqueConstraintError(caught)) {
        throw new BadRequestException('Этот КИЗ уже есть в WMS. Повторная привязка запрещена.');
      }
      throw caught;
    }
  }

  private async resolveBox(
    tx: Prisma.TransactionClient,
    clientId: string,
    code: string,
    warehouseId?: string,
  ) {
    const box = await tx.box.findUnique({
      where: { clientId_code: { clientId, code } },
      include: {
        zone: { select: { warehouseId: true } },
        pallet: { select: { zone: { select: { warehouseId: true } } } },
      },
    });

    if (!box || ['deleted', 'archived'].includes(box.status)) {
      throw new NotFoundException(`Короб ${code} не найден.`);
    }

    this.assertBoxWarehouse(warehouseId, box);

    return box;
  }

  private async ensureTargetBox(
    tx: Prisma.TransactionClient,
    clientId: string,
    code: string,
    warehouseId?: string,
  ) {
    const existing = await tx.box.findUnique({
      where: { code },
      include: {
        zone: { select: { warehouseId: true } },
        pallet: { select: { zone: { select: { warehouseId: true } } } },
      },
    });
    if (existing && existing.clientId !== clientId) {
      throw new BadRequestException(
        `Короб ${code} принадлежит другому клиенту. Перемещение остановлено.`,
      );
    }
    if (existing && ['deleted', 'archived'].includes(existing.status)) {
      throw new BadRequestException(`Короб ${code} находится в архиве и не может быть переиспользован.`);
    }
    if (existing) this.assertBoxWarehouse(warehouseId, existing);
    if (existing) return existing;
    return tx.box.create({
      data: {
        clientId,
        code,
        warehouseId: this.requireBalanceWarehouseId(warehouseId),
      },
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
      warehouseId: string;
      clientId: string;
      skuId: string;
      boxId?: string | null;
      palletId?: string | null;
      status: StockStatus;
      quantity: number;
    },
  ) {
    const balanceKey = this.balances.balanceKey(input);

    return tx.stockBalance.upsert({
      where: { balanceKey },
      update: {
        warehouseId: input.warehouseId,
        quantity: { increment: input.quantity },
      },
      create: {
        balanceKey,
        warehouseId: input.warehouseId,
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

function requiredTsdTransferText(value: unknown, message: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new BadRequestException(message);
  }
  return normalized;
}

function tsdTransferScanCodes(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Отсканируйте хотя бы один товар для перемещения.');
  }
  const scanCodes = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (scanCodes.length === 0) {
    throw new BadRequestException('Отсканируйте хотя бы один товар для перемещения.');
  }
  if (scanCodes.length > 500) {
    throw new BadRequestException('За одно перемещение можно выбрать не более 500 единиц.');
  }
  return scanCodes;
}

function printableTransferScan(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 80);
}

function formatTsdTransferItem(item: TsdTransferScannedItem) {
  return {
    skuId: item.sku.id,
    name: item.sku.name,
    article: item.sku.article ?? item.sku.clientSku ?? item.sku.internalSku,
    color: item.sku.color,
    size: item.sku.size,
    scanCode: printableTransferScan(item.scanCode),
    scanType: item.scanType,
    availableQuantity: item.availableQuantity,
  };
}

function isUniqueConstraintError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function isFbsRelabelInventoryAdjustment(movement: {
  idempotencyKey: string | null;
  sourceDocument: string | null;
}) {
  const key = movement.idempotencyKey ?? '';
  return (
    key.startsWith('fbs-relabel:') ||
    key.startsWith('relabel-reconcile:') ||
    movement.sourceDocument?.startsWith('FBS TSD,') === true
  );
}

function duplicateKizMessage(boxCode?: string | null) {
  return boxCode
    ? `ДУБЛЬ КИЗ. Этот КИЗ уже находится в коробе ${boxCode}.`
    : 'ДУБЛЬ КИЗ. Этот КИЗ уже есть в WMS; повторная приемка запрещена.';
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

const FULFILLMENT_BILLING_SERVICES = {
  ITEM_PROCESSING: {
    code: 'ITEM_PROCESSING',
    name: 'Обработка товара',
    unit: BillingUnit.PIECE,
    defaultPriceRub: null,
    sourceKeyPrefix: 'fulfillment-processing',
  },
  CLOTHING_PROCESSING: {
    code: 'NOM_ОБРАБОТКА_ОДЕЖДЫ',
    name: 'Обработка одежды',
    unit: BillingUnit.PIECE,
    defaultPriceRub: null,
    sourceKeyPrefix: 'fulfillment-clothing-processing',
  },
  RELABELING: {
    code: 'RELABELING',
    name: 'Перемаркировка',
    unit: BillingUnit.PIECE,
    defaultPriceRub: null,
    sourceKeyPrefix: 'fulfillment-relabeling',
  },
  BOX_60_40_40: {
    code: 'BOX_60_40_40',
    name: 'Короб 60*40*40',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 100,
    sourceKeyPrefix: 'fulfillment-package',
  },
  BOX_ASSEMBLY: {
    code: 'BOX_ASSEMBLY',
    name: 'Сборка короба',
    unit: BillingUnit.PIECE,
    defaultPriceRub: 40,
    sourceKeyPrefix: 'fulfillment-package',
  },
  PALLET: {
    code: 'PALLET',
    name: 'Паллет',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 350,
    sourceKeyPrefix: 'fulfillment-package',
  },
  PALLET_ASSEMBLY: {
    code: 'PALLET_ASSEMBLY',
    name: 'Сборка паллета',
    unit: BillingUnit.PALLET,
    defaultPriceRub: 250,
    sourceKeyPrefix: 'fulfillment-package',
  },
} as const;

type FulfillmentBillingRow = {
  code: string;
  name: string;
  unit: BillingUnit;
  defaultPriceRub: number | null;
  sourceKeyPrefix: string;
  quantity: number;
  requiresConfiguredPrice?: boolean;
};

const BOXES_PER_PALLET = 16;
const LOOSE_BOXES_WITHOUT_EXTRA_PALLET = 4;

function calculatePalletCount(boxes: number) {
  const normalizedBoxes = Math.max(0, Math.floor(boxes));
  const fullPallets = Math.floor(normalizedBoxes / BOXES_PER_PALLET);
  const remainingBoxes = normalizedBoxes % BOXES_PER_PALLET;

  return fullPallets + (remainingBoxes > LOOSE_BOXES_WITHOUT_EXTRA_PALLET ? 1 : 0);
}

function isRelabelRequestItem(comment?: string | null) {
  const normalized = (comment ?? '').trim().toLocaleLowerCase('ru-RU');
  return normalized.includes('перемаркировка из:') || normalized.includes('количество перемаркировки:');
}

type ProcessingOriginBucket = { clothing: number; standard: number };

function isLukinClient(client?: { name?: string | null; legalName?: string | null } | null) {
  return `${client?.name ?? ''} ${client?.legalName ?? ''}`.toLocaleLowerCase('ru-RU').includes('лукин');
}

function isClothingOriginBox(boxCode?: string | null) {
  const normalized = (boxCode ?? '').trim().toLocaleUpperCase('ru-RU');
  return normalized.startsWith('FFL_LK0') || normalized.includes('VOZ');
}

function processingBalanceKey(skuId: string, boxId: string | null, status: StockStatus) {
  return `${skuId}|${boxId ?? 'NO_BOX'}|${status}`;
}

function processingMovementPairKey(idempotencyKey?: string | null) {
  return (idempotencyKey ?? '').replace(/:(out|in)$/i, '');
}

function originBucketForBox(boxCode: string, quantity: number): ProcessingOriginBucket {
  return isClothingOriginBox(boxCode)
    ? { clothing: quantity, standard: 0 }
    : { clothing: 0, standard: quantity };
}

function addOriginBuckets(current: ProcessingOriginBucket | undefined, added: ProcessingOriginBucket): ProcessingOriginBucket {
  return {
    clothing: (current?.clothing ?? 0) + added.clothing,
    standard: (current?.standard ?? 0) + added.standard,
  };
}

function consumeOriginBucket(bucket: ProcessingOriginBucket, quantity: number, fallbackBoxCode: string): ProcessingOriginBucket {
  let remaining = quantity;
  const clothing = Math.min(bucket.clothing, remaining);
  bucket.clothing -= clothing;
  remaining -= clothing;
  const standard = Math.min(bucket.standard, remaining);
  bucket.standard -= standard;
  remaining -= standard;
  if (remaining <= 0) return { clothing, standard };
  const fallback = originBucketForBox(fallbackBoxCode, remaining);
  return { clothing: clothing + fallback.clothing, standard: standard + fallback.standard };
}

function totalAllocatedUnits(plan: RequestAllocationPlan) {
  return plan.lines.reduce(
    (total, line) => total + line.allocations.reduce((lineTotal, allocation) => lineTotal + allocation.quantity, 0),
    0,
  );
}

function buildAllocationPackages(
  requestId: string,
  plan: RequestAllocationPlan,
  dto: FulfillClientRequestDto,
): RequestPackageInput[] {
  const byPackage = new Map<
    string,
    Map<
      string,
      {
        requestItemId: string;
        skuId: string;
        skuWeightGrams: number | null;
        barcode: string | null;
        quantity: number;
      }
    >
  >();

  for (const line of plan.lines) {
    for (const allocation of line.allocations) {
      const packageCode = allocation.balance.box?.code?.trim();
      if (!packageCode) {
        continue;
      }

      const rows = byPackage.get(packageCode) ?? new Map<string, {
        requestItemId: string;
        skuId: string;
        skuWeightGrams: number | null;
        barcode: string | null;
        quantity: number;
      }>();
      const itemKey = `${line.itemId}:${line.skuId}:${line.barcode ?? ''}`;
      const current =
        rows.get(itemKey) ?? {
          requestItemId: line.itemId,
          skuId: line.skuId,
          skuWeightGrams: line.skuWeightGrams,
          barcode: line.barcode,
          quantity: 0,
        };
      current.quantity += allocation.quantity;
      rows.set(itemKey, current);
      byPackage.set(packageCode, rows);
    }
  }

  return [...byPackage.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true }))
    .map(([packageCode, rows]) => {
      const items = [...rows.values()];
      const metadata = validateBoxWeight(
        packageCode,
        { packageType: 'BOX' },
        items,
        dto.allowOverweightPackages,
      );

      return {
        packageCode,
        packageType: 'BOX',
        comment: dto.comment?.trim() || undefined,
        metadata: {
          ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
          generatedFromPackingBalances: true,
          requestId,
        },
        items: items.map(({ skuWeightGrams: _skuWeightGrams, ...item }) => item),
      };
    });
}

const MAX_BOX_WEIGHT_GRAMS = 25_000;
const MAX_TRANSFER_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const STOCK_TRANSFER_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 180_000,
};

type BoxTransferImportRow = {
  rowNumber: number;
  fromBoxCode: string;
  barcode: string;
  toBoxCode: string;
  quantity: number;
  errors: string[];
};

type BoxTransferPreviewRow = BoxTransferImportRow & {
  status: 'READY' | 'ERROR';
  message: string;
  skuId?: string;
  skuName?: string;
  internalSku?: string;
  availableQuantity: number;
  targetBoxExists: boolean;
};

type StoredBoxTransferRow = Omit<BoxTransferPreviewRow, 'status'> & {
  status: 'APPLIED' | 'REJECTED';
  stockStatus: StockStatus;
  idempotencyKey?: string;
};

type StockTransferBatchSummaryRecord = {
  id: string;
  clientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  rowCount: number;
  appliedRowCount: number;
  rejectedRowCount: number;
  quantity: number;
  rows: Prisma.JsonValue;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  reversedByUserId: string | null;
  reversedByName: string | null;
  reversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const stockTransferBatchSummarySelect = {
  id: true,
  clientId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  rowCount: true,
  appliedRowCount: true,
  rejectedRowCount: true,
  quantity: true,
  rows: true,
  uploadedByUserId: true,
  uploadedByName: true,
  reversedByUserId: true,
  reversedByName: true,
  reversedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function parseBoxTransferImportRows(file: Express.Multer.File | undefined): BoxTransferImportRow[] {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Загрузите Excel-файл с перемещениями.');
  }
  if (file.buffer.length > MAX_TRANSFER_FILE_SIZE_BYTES) {
    throw new BadRequestException('Файл перемещений не должен превышать 10 МБ.');
  }

  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    throw new BadRequestException('В Excel-файле нет листа с перемещениями.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const parsed: BoxTransferImportRow[] = [];
  let currentFromBoxCode = '';
  let currentToBoxCode = '';

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const explicitFromBoxCode = cellText(row, 0);
    const barcode = cellText(row, 1);
    const explicitToBoxCode = cellText(row, 2);
    const quantityText = cellText(row, 3);
    const errors: string[] = [];

    if (!explicitFromBoxCode && !barcode && !explicitToBoxCode && !quantityText) {
      return;
    }

    if (looksLikeBoxTransferHeader(explicitFromBoxCode, barcode, explicitToBoxCode, quantityText)) {
      return;
    }

    if (explicitFromBoxCode) {
      currentFromBoxCode = explicitFromBoxCode;
    }
    if (explicitToBoxCode) {
      currentToBoxCode = explicitToBoxCode;
    }
    const fromBoxCode = explicitFromBoxCode || currentFromBoxCode;
    const toBoxCode = explicitToBoxCode || currentToBoxCode;

    if (!fromBoxCode) {
      errors.push('Не указан исходный короб.');
    }
    if (!barcode) {
      errors.push('Не указан штрихкод товара.');
    }
    if (!toBoxCode) {
      errors.push('Не указан целевой короб.');
    }
    if (!quantityText) {
      errors.push('Не указано количество.');
    }

    const quantity = Number(quantityText.replace(',', '.'));
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push('Количество должно быть целым числом больше 0.');
    }

    parsed.push({
      rowNumber,
      fromBoxCode,
      barcode,
      toBoxCode,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
      errors,
    });
  });

  if (parsed.length === 0) {
    throw new BadRequestException('В Excel-файле нет строк для перемещения.');
  }

  return parsed;
}

function transferBalanceKey(boxCode: string, skuId: string) {
  return `${boxCode}\u0000${skuId}`;
}

function fileName(file: Express.Multer.File | undefined) {
  return normalizeUploadedFileName(file?.originalname) || `Перемещения-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function normalizeUploadedFileName(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized || !/[ÃÐÑ]/.test(normalized)) {
    return normalized || '';
  }

  const decoded = Buffer.from(normalized, 'latin1').toString('utf8');
  return decoded.includes('�') ? normalized : decoded;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function storedBoxTransferRows(value: Prisma.JsonValue): StoredBoxTransferRow[] {
  return Array.isArray(value) ? (value as unknown as StoredBoxTransferRow[]) : [];
}

function transferBatchSummary(batch: StockTransferBatchSummaryRecord) {
  return {
    id: batch.id,
    clientId: batch.clientId,
    fileName: normalizeUploadedFileName(batch.fileName),
    mimeType: batch.mimeType,
    sizeBytes: batch.sizeBytes,
    status: batch.status,
    rowCount: batch.rowCount,
    appliedRowCount: batch.appliedRowCount,
    rejectedRowCount: batch.rejectedRowCount,
    quantity: batch.quantity,
    rows: storedBoxTransferRows(batch.rows),
    uploadedByUserId: batch.uploadedByUserId,
    uploadedByName: batch.uploadedByName,
    reversedByUserId: batch.reversedByUserId,
    reversedByName: batch.reversedByName,
    reversedAt: batch.reversedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

function canDeleteTransferBatches(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
}

function canAutoApproveStockChecks(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.roleCodes.some((role) => role === 'ADMIN' || role === 'OWNER');
}

function exceptionMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Операцию нельзя выполнить.';
}

function cellText(row: unknown[], index: number) {
  return String(row[index] ?? '').trim();
}

function looksLikeBoxTransferHeader(...values: string[]) {
  const text = values.join(' ').toLowerCase();
  return (
    text.includes('короб') ||
    text.includes('откуда') ||
    text.includes('куда') ||
    text.includes('шк') ||
    text.includes('баркод') ||
    text.includes('barcode') ||
    text.includes('колич') ||
    text.includes('quantity')
  );
}

export function validateBoxWeight(
  packageCode: string,
  packageDto: { packageType?: string; weightGrams?: number },
  items: Array<{ quantity: number; skuWeightGrams: number | null }>,
  allowOverweightPackages = false,
): Prisma.InputJsonValue | undefined {
  if (isPalletPackage(packageDto.packageType)) {
    return undefined;
  }

  if (packageDto.weightGrams != null) {
    if (packageDto.weightGrams > MAX_BOX_WEIGHT_GRAMS) {
      if (!allowOverweightPackages) {
        throw new BadRequestException(`Вес короба ${packageCode} превышает 25 кг.`);
      }
      // FIX: подтвержденный перевес не теряется — сохраняем его как предупреждение упаковки.
      return {
        measuredWeightGrams: packageDto.weightGrams,
        warnings: [
          {
            code: 'BOX_WEIGHT_OVER_LIMIT_CONFIRMED',
            message: `Вес короба ${packageCode} превышает 25 кг; перевес подтвержден менеджером.`,
            limitGrams: MAX_BOX_WEIGHT_GRAMS,
          },
        ],
      };
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
    if (!allowOverweightPackages) {
      throw new BadRequestException(`Расчетный вес короба ${packageCode} превышает 25 кг.`);
    }
    // FIX: разрешаем только повторное закрытие с явным подтверждением из web.
    return {
      calculatedWeightGrams,
      warnings: [
        {
          code: 'BOX_WEIGHT_OVER_LIMIT_CONFIRMED',
          message: `Расчетный вес короба ${packageCode} превышает 25 кг; перевес подтвержден менеджером.`,
          limitGrams: MAX_BOX_WEIGHT_GRAMS,
        },
      ],
    };
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
