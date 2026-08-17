import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpenseCategory,
  ExpenseMaterialMovementType,
  ExpenseSource,
  ExpenseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { BillingService } from '../billing/billing.service';
import {
  AddExpenseMaterialStockDto,
  CreateExpenseEntryDto,
  CreateExpenseMaterialDto,
  ListExpensesDto,
  UpdateExpenseMaterialDto,
  UpdateExpensePayrollRateDto,
  UpsertClientExpenseMaterialRuleDto,
} from './dto/expenses.dto';

const EXPENSE_PAYROLL_RATE_PREFIX = 'expenses.payroll.rate.';
const EXPENSE_PAYROLL_RESET_PREFIX = 'expenses.payroll.counterReset.';
const DEFAULT_EXPENSE_PAYROLL_RATE_RUB = 7;

const expenseEntryInclude = {
  client: { select: { id: true, code: true, name: true } },
  request: { select: { id: true, number: true, title: true } },
  material: { select: { id: true, code: true, name: true, unit: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ExpenseEntryInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly billing: BillingService,
  ) {}

  async listEntries(query: ListExpensesDto, user: AuthUser) {
    const period = parsePeriod(query, false);
    const entries = await this.prisma.expenseEntry.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
        category: query.category,
        expenseDate: period.where,
      },
      include: expenseEntryInclude,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      take: query.limit ?? 500,
    });

    return entries.map(formatExpenseEntry);
  }

  async getPayroll(query: ListExpensesDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const period = parsePayrollPeriod(query);
    const visibleClients = await this.prisma.client.findMany({
      where: { isDemo: Boolean(user.isDemo) },
      select: { id: true },
    });
    const tasks = await this.prisma.fbsTsdAssembly.findMany({
      where: {
        clientId: { in: visibleClients.map((client) => client.id) },
        status: 'COMPLETED',
        completedAt: { gte: period.from, lt: period.toExclusive },
        workerUserId: { not: null },
      },
      select: {
        id: true,
        orderId: true,
        itemCount: true,
        deviceCode: true,
        workerUserId: true,
        workerName: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { completedAt: 'asc' },
      take: 50000,
    });
    const workerIds = [...new Set(tasks.map((task) => task.workerUserId).filter((id): id is string => Boolean(id)))];
    const [users, payrollSettings] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isDemo: Boolean(user.isDemo),
          OR: [
            { tsdActivationCodeHash: { not: null } },
            { tsdDevices: { some: {} } },
            ...(workerIds.length ? [{ id: { in: workerIds } }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          tsdDevices: {
            select: { code: true, name: true, status: true },
            orderBy: { code: 'asc' },
          },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.systemSetting.findMany({
        where: {
          OR: [
            { key: { startsWith: EXPENSE_PAYROLL_RATE_PREFIX } },
            { key: { startsWith: EXPENSE_PAYROLL_RESET_PREFIX } },
          ],
        },
        select: { key: true, value: true, updatedAt: true },
      }),
    ]);
    const rateSettings = payrollSettings.filter((setting) => setting.key.startsWith(EXPENSE_PAYROLL_RATE_PREFIX));
    const resetSettings = payrollSettings.filter((setting) => setting.key.startsWith(EXPENSE_PAYROLL_RESET_PREFIX));
    const rateByUserId = new Map(rateSettings.map((setting) => [
      setting.key.slice(EXPENSE_PAYROLL_RATE_PREFIX.length),
      { rateRub: expensePayrollRate(setting.value), updatedAt: setting.updatedAt.toISOString() },
    ]));
    const resetByUserId = new Map(resetSettings.map((setting) => [
      setting.key.slice(EXPENSE_PAYROLL_RESET_PREFIX.length),
      expensePayrollResetAt(setting.value),
    ]));
    const tasksByUserId = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!task.workerUserId) continue;
      const rows = tasksByUserId.get(task.workerUserId) ?? [];
      rows.push(task);
      tasksByUserId.set(task.workerUserId, rows);
    }
    const rows = users.map((payrollUser) => {
      const resetAt = resetByUserId.get(payrollUser.id) ?? null;
      const allUserTasks = tasksByUserId.get(payrollUser.id) ?? [];
      const userTasks = resetAt && resetAt < period.toExclusive
        ? allUserTasks.filter((task) => task.completedAt && task.completedAt >= resetAt)
        : allUserTasks;
      const units = userTasks.reduce((sum, task) => sum + Math.max(1, task.itemCount), 0);
      const measuredTasks = userTasks.filter((task) => task.startedAt && task.completedAt);
      const productiveDurationSeconds = measuredTasks.reduce((sum, task) => (
        sum + Math.max(0, Math.round((task.completedAt!.getTime() - task.startedAt!.getTime()) / 1000))
      ), 0);
      const workStartedAt = measuredTasks.length
        ? new Date(Math.min(...measuredTasks.map((task) => task.startedAt!.getTime())))
        : null;
      const workEndedAt = userTasks.length
        ? new Date(Math.max(...userTasks.map((task) => task.completedAt!.getTime())))
        : null;
      const workSpanSeconds = workStartedAt && workEndedAt
        ? Math.max(0, Math.round((workEndedAt.getTime() - workStartedAt.getTime()) / 1000))
        : null;
      const storedRate = rateByUserId.get(payrollUser.id);
      const rateRub = storedRate?.rateRub ?? DEFAULT_EXPENSE_PAYROLL_RATE_RUB;
      return {
        userId: payrollUser.id,
        userName: payrollUser.name,
        email: payrollUser.email,
        status: payrollUser.status,
        deviceCodes: [...new Set([
          ...payrollUser.tsdDevices.map((device) => device.code),
          ...userTasks.map((task) => task.deviceCode),
        ])].sort((left, right) => left.localeCompare(right, 'ru-RU')),
        orders: userTasks.length,
        units,
        measuredOrders: measuredTasks.length,
        workStartedAt: workStartedAt?.toISOString() ?? null,
        workEndedAt: workEndedAt?.toISOString() ?? null,
        workSpanSeconds,
        productiveDurationSeconds,
        averageDurationSecondsPerOrder: measuredTasks.length
          ? Math.round(productiveDurationSeconds / measuredTasks.length)
          : null,
        averageDurationSecondsPerUnit: units > 0 && measuredTasks.length
          ? Math.round(productiveDurationSeconds / units)
          : null,
        rateRub,
        rateIsDefault: !storedRate,
        rateUpdatedAt: storedRate?.updatedAt ?? null,
        resetAt: resetAt?.toISOString() ?? null,
        payrollRub: roundMoney(units * rateRub),
      };
    });
    return {
      period: {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        from: period.from.toISOString(),
        to: period.toExclusive.toISOString(),
      },
      defaultRateRub: DEFAULT_EXPENSE_PAYROLL_RATE_RUB,
      summary: {
        users: rows.length,
        activeWorkers: rows.filter((row) => row.units > 0).length,
        orders: rows.reduce((sum, row) => sum + row.orders, 0),
        units: rows.reduce((sum, row) => sum + row.units, 0),
        productiveDurationSeconds: rows.reduce((sum, row) => sum + row.productiveDurationSeconds, 0),
        payrollRub: roundMoney(rows.reduce((sum, row) => sum + row.payrollRub, 0)),
      },
      workers: rows.sort((left, right) => right.units - left.units || left.userName.localeCompare(right.userName, 'ru-RU')),
      generatedAt: new Date().toISOString(),
    };
  }

  async updatePayrollRate(userId: string, dto: UpdateExpensePayrollRateDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const payrollUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isDemo: Boolean(user.isDemo),
      },
      select: { id: true, name: true, email: true },
    });
    if (!payrollUser) throw new NotFoundException('Пользователь ТСД не найден.');
    const rateRub = roundMoney(dto.rateRub);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: `${EXPENSE_PAYROLL_RATE_PREFIX}${payrollUser.id}` },
      create: {
        key: `${EXPENSE_PAYROLL_RATE_PREFIX}${payrollUser.id}`,
        value: { rateRub },
        updatedByUserId: user.id,
      },
      update: {
        value: { rateRub },
        updatedByUserId: user.id,
      },
      select: { updatedAt: true },
    });
    return {
      userId: payrollUser.id,
      userName: payrollUser.name,
      email: payrollUser.email,
      rateRub,
      rateIsDefault: false,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  async resetPayrollCounter(userId: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const payrollUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isDemo: Boolean(user.isDemo),
      },
      select: { id: true, name: true, email: true },
    });
    if (!payrollUser) throw new NotFoundException('Пользователь ТСД не найден.');
    const resetAt = new Date();
    await this.prisma.systemSetting.upsert({
      where: { key: `${EXPENSE_PAYROLL_RESET_PREFIX}${payrollUser.id}` },
      create: {
        key: `${EXPENSE_PAYROLL_RESET_PREFIX}${payrollUser.id}`,
        value: { resetAt: resetAt.toISOString() },
        updatedByUserId: user.id,
      },
      update: {
        value: { resetAt: resetAt.toISOString() },
        updatedByUserId: user.id,
      },
    });
    return {
      userId: payrollUser.id,
      userName: payrollUser.name,
      email: payrollUser.email,
      resetAt: resetAt.toISOString(),
      message: `Счётчик сборщицы ${payrollUser.name} обнулён. История выполненных заданий сохранена.`,
    };
  }

  async createEntry(dto: CreateExpenseEntryDto, user: AuthUser) {
    const clientId = cleanOptional(dto.clientId);
    const requestId = cleanOptional(dto.requestId);
    if (clientId) {
      this.clientScopes.requireClientAccess(user, clientId, 'write');
    } else {
      this.clientScopes.requireGlobalClientAccess(user);
    }

    if (requestId) {
      const request = await this.prisma.clientRequest.findUnique({
        where: { id: requestId },
        select: { id: true, clientId: true },
      });
      if (!request) throw new NotFoundException('Заявка не найдена.');
      if (clientId && request.clientId !== clientId) {
        throw new BadRequestException('Заявка относится к другому клиенту.');
      }
      this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    }

    const entry = await this.prisma.expenseEntry.create({
      data: {
        category: dto.category,
        source:
          dto.category === ExpenseCategory.LOGISTICS
            ? ExpenseSource.LOGISTICS
            : ExpenseSource.MANUAL,
        expenseDate: parseDate(dto.expenseDate),
        amountRub: moneyDecimal(dto.amountRub),
        description: requiredText(dto.description, 'Укажите описание расхода.'),
        clientId,
        requestId,
        quantity:
          dto.quantity === undefined ? null : quantityDecimal(dto.quantity),
        unit: cleanOptional(dto.unit),
        unitPriceRub:
          dto.unitPriceRub === undefined
            ? null
            : costDecimal(dto.unitPriceRub),
        workerName: cleanOptional(dto.workerName),
        comment: cleanOptional(dto.comment),
        createdByUserId: user.id,
      },
      include: expenseEntryInclude,
    });
    return formatExpenseEntry(entry);
  }

  async cancelEntry(id: string, user: AuthUser) {
    const entry = await this.prisma.expenseEntry.findUnique({
      where: { id },
      include: expenseEntryInclude,
    });
    if (!entry) throw new NotFoundException('Расход не найден.');
    if (entry.clientId) {
      this.clientScopes.requireClientAccess(user, entry.clientId, 'write');
    } else {
      this.clientScopes.requireGlobalClientAccess(user);
    }
    if (entry.status === ExpenseStatus.CANCELLED) {
      return formatExpenseEntry(entry);
    }
    if (
      entry.source === ExpenseSource.MATERIAL_PURCHASE ||
      entry.source === ExpenseSource.MATERIAL_WRITE_OFF ||
      entry.source === ExpenseSource.AUTO_MATERIAL_CONSUMPTION
    ) {
      throw new BadRequestException(
        'Этот расход связан с движением расходного материала. Для исправления выполните корректировку остатка материала.',
      );
    }

    const updated = await this.prisma.expenseEntry.update({
      where: { id },
      data: {
        status: ExpenseStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: user.id,
      },
      include: expenseEntryInclude,
    });
    return formatExpenseEntry(updated);
  }

  async listMaterials(user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const materials = await this.prisma.expenseMaterial.findMany({
      include: {
        _count: { select: { rules: true, movements: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return materials.map(formatExpenseMaterial);
  }

  async createMaterial(dto: CreateExpenseMaterialDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    const initialQuantity = dto.initialQuantity ?? 0;
    const averageUnitCostRub = dto.averageUnitCostRub ?? 0;

    try {
      const material = await this.prisma.$transaction(async (tx) => {
        const created = await tx.expenseMaterial.create({
          data: {
            code: normalizeMaterialCode(dto.code),
            name: requiredText(dto.name, 'Укажите название материала.'),
            unit: cleanOptional(dto.unit) ?? 'шт.',
            stockQuantity: quantityDecimal(initialQuantity),
            averageUnitCostRub: costDecimal(averageUnitCostRub),
            minStockQuantity: quantityDecimal(dto.minStockQuantity ?? 0),
            comment: cleanOptional(dto.comment),
          },
        });
        if (initialQuantity > 0) {
          await tx.expenseMaterialMovement.create({
            data: {
              materialId: created.id,
              type: ExpenseMaterialMovementType.INITIAL,
              quantity: quantityDecimal(initialQuantity),
              unitCostRub: costDecimal(averageUnitCostRub),
              comment: 'Начальный остаток при создании материала',
              createdByUserId: user.id,
            },
          });
        }
        return created;
      });
      return formatExpenseMaterial({ ...material, _count: { rules: 0, movements: initialQuantity > 0 ? 1 : 0 } });
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Материал с таким кодом уже существует.');
      }
      throw caught;
    }
  }

  async updateMaterial(id: string, dto: UpdateExpenseMaterialDto, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    await this.requireMaterial(id);
    try {
      const material = await this.prisma.expenseMaterial.update({
        where: { id },
        data: {
          code: dto.code === undefined ? undefined : normalizeMaterialCode(dto.code),
          name:
            dto.name === undefined
              ? undefined
              : requiredText(dto.name, 'Укажите название материала.'),
          unit: dto.unit === undefined ? undefined : requiredText(dto.unit, 'Укажите единицу измерения.'),
          minStockQuantity:
            dto.minStockQuantity === undefined
              ? undefined
              : quantityDecimal(dto.minStockQuantity),
          isActive: dto.isActive,
          comment: dto.comment === undefined ? undefined : cleanOptional(dto.comment),
        },
        include: { _count: { select: { rules: true, movements: true } } },
      });
      return formatExpenseMaterial(material);
    } catch (caught) {
      if (isUniqueError(caught)) {
        throw new BadRequestException('Материал с таким кодом уже существует.');
      }
      throw caught;
    }
  }

  async addMaterialStock(
    id: string,
    dto: AddExpenseMaterialStockDto,
    user: AuthUser,
  ) {
    this.clientScopes.requireGlobalClientAccess(user);
    if (
      dto.type === ExpenseMaterialMovementType.INITIAL ||
      dto.type === ExpenseMaterialMovementType.CONSUMPTION
    ) {
      throw new BadRequestException('Этот тип движения создаётся системой автоматически.');
    }
    if (!Number.isFinite(dto.quantity) || dto.quantity === 0) {
      throw new BadRequestException('Количество должно отличаться от нуля.');
    }
    if (
      (dto.type === ExpenseMaterialMovementType.PURCHASE ||
        dto.type === ExpenseMaterialMovementType.WRITE_OFF) &&
      dto.quantity < 0
    ) {
      throw new BadRequestException('Для закупки и списания укажите положительное количество.');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const material = await tx.expenseMaterial.findUnique({ where: { id } });
        if (!material) throw new NotFoundException('Расходный материал не найден.');

        const currentStock = decimalNumber(material.stockQuantity);
        const currentCost = decimalNumber(material.averageUnitCostRub);
        const movementQuantity =
          dto.type === ExpenseMaterialMovementType.WRITE_OFF
            ? -Math.abs(dto.quantity)
            : dto.quantity;
        const nextStock = roundQuantity(currentStock + movementQuantity);
        const unitCost =
          dto.unitCostRub === undefined ? currentCost : dto.unitCostRub;
        const nextAverageCost =
          dto.type === ExpenseMaterialMovementType.PURCHASE &&
          movementQuantity > 0 &&
          nextStock > 0
            ? roundCost(
                (Math.max(0, currentStock) * currentCost +
                  movementQuantity * unitCost) /
                  (Math.max(0, currentStock) + movementQuantity),
              )
            : currentCost;
        const expenseDate = dto.expenseDate
          ? parseDate(dto.expenseDate)
          : new Date();
        const expenseAmount =
          dto.type === ExpenseMaterialMovementType.PURCHASE ||
          dto.type === ExpenseMaterialMovementType.WRITE_OFF
            ? roundMoney(Math.abs(movementQuantity) * unitCost)
            : 0;
        const source =
          dto.type === ExpenseMaterialMovementType.PURCHASE
            ? ExpenseSource.MATERIAL_PURCHASE
            : dto.type === ExpenseMaterialMovementType.WRITE_OFF
              ? ExpenseSource.MATERIAL_WRITE_OFF
              : null;
        const entry = source
          ? await tx.expenseEntry.create({
              data: {
                category: ExpenseCategory.MATERIALS,
                source,
                expenseDate,
                amountRub: moneyDecimal(expenseAmount),
                description:
                  dto.type === ExpenseMaterialMovementType.PURCHASE
                    ? `Закупка: ${material.name}`
                    : `Списание: ${material.name}`,
                materialId: material.id,
                quantity: quantityDecimal(Math.abs(movementQuantity)),
                unit: material.unit,
                unitPriceRub: costDecimal(unitCost),
                comment: cleanOptional(dto.comment),
                createdByUserId: user.id,
              },
            })
          : null;
        const movement = await tx.expenseMaterialMovement.create({
          data: {
            materialId: material.id,
            type: dto.type,
            quantity: quantityDecimal(movementQuantity),
            unitCostRub: costDecimal(unitCost),
            expenseEntryId: entry?.id,
            comment: cleanOptional(dto.comment),
            createdByUserId: user.id,
          },
        });
        const updated = await tx.expenseMaterial.update({
          where: { id: material.id },
          data: {
            stockQuantity: quantityDecimal(nextStock),
            averageUnitCostRub: costDecimal(nextAverageCost),
          },
          include: { _count: { select: { rules: true, movements: true } } },
        });
        return { material: updated, movement, entry };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      material: formatExpenseMaterial(result.material),
      movement: {
        id: result.movement.id,
        type: result.movement.type,
        quantity: decimalNumber(result.movement.quantity),
        unitCostRub: decimalNullable(result.movement.unitCostRub),
        createdAt: result.movement.createdAt.toISOString(),
      },
      expenseEntryId: result.entry?.id ?? null,
    };
  }

  async listMaterialMovements(materialId: string, user: AuthUser) {
    this.clientScopes.requireGlobalClientAccess(user);
    await this.requireMaterial(materialId);
    const movements = await this.prisma.expenseMaterialMovement.findMany({
      where: { materialId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        request: { select: { id: true, number: true, title: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantity: decimalNumber(movement.quantity),
      unitCostRub: decimalNullable(movement.unitCostRub),
      comment: movement.comment,
      client: movement.client,
      request: movement.request,
      createdBy: movement.createdBy,
      createdAt: movement.createdAt.toISOString(),
    }));
  }

  async listClientMaterialRules(clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const [client, materials, rules] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.expenseMaterial.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.clientExpenseMaterialRule.findMany({
        where: { clientId },
      }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');
    const ruleByMaterialId = new Map(
      rules.map((rule) => [rule.materialId, rule]),
    );
    return {
      client,
      materials: materials.map((material) => {
        const rule = ruleByMaterialId.get(material.id);
        return {
          material: formatExpenseMaterial({
            ...material,
            _count: { rules: 0, movements: 0 },
          }),
          isEnabled: rule?.isEnabled ?? false,
          quantityPerShippedUnit: rule
            ? decimalNumber(rule.quantityPerShippedUnit)
            : 1,
          chargeSeparately: rule?.chargeSeparately ?? false,
          billingUnitPriceRub: decimalNullable(rule?.billingUnitPriceRub),
          comment: rule?.comment ?? null,
          updatedAt: rule?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  async upsertClientMaterialRule(
    clientId: string,
    materialId: string,
    dto: UpsertClientExpenseMaterialRuleDto,
    user: AuthUser,
  ) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    const [client, material] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true },
      }),
      this.prisma.expenseMaterial.findUnique({
        where: { id: materialId },
        select: { id: true, isActive: true },
      }),
    ]);
    if (!client) throw new NotFoundException('Клиент не найден.');
    if (!material) throw new NotFoundException('Расходный материал не найден.');
    if (dto.isEnabled && !material.isActive) {
      throw new BadRequestException('Нельзя включить неактивный материал.');
    }
    if (
      dto.chargeSeparately &&
      (dto.billingUnitPriceRub === undefined ||
        dto.billingUnitPriceRub < 0)
    ) {
      throw new BadRequestException(
        'Для отдельного начисления укажите цену материала для клиента.',
      );
    }

    await this.prisma.clientExpenseMaterialRule.upsert({
      where: { clientId_materialId: { clientId, materialId } },
      create: {
        clientId,
        materialId,
        isEnabled: dto.isEnabled,
        quantityPerShippedUnit: quantityDecimal(
          dto.quantityPerShippedUnit,
        ),
        chargeSeparately: dto.chargeSeparately,
        billingUnitPriceRub: dto.chargeSeparately
          ? moneyDecimal(dto.billingUnitPriceRub ?? 0)
          : null,
        comment: cleanOptional(dto.comment),
        updatedByUserId: user.id,
      },
      update: {
        isEnabled: dto.isEnabled,
        quantityPerShippedUnit: quantityDecimal(
          dto.quantityPerShippedUnit,
        ),
        chargeSeparately: dto.chargeSeparately,
        billingUnitPriceRub: dto.chargeSeparately
          ? moneyDecimal(dto.billingUnitPriceRub ?? 0)
          : null,
        comment: cleanOptional(dto.comment),
        updatedByUserId: user.id,
      },
    });
    return this.listClientMaterialRules(clientId, user);
  }

  async getReport(query: ListExpensesDto, user: AuthUser) {
    const period = parsePeriod(query, true);
    const entries = await this.prisma.expenseEntry.findMany({
      where: {
        clientId: this.clientScopes.resolveClientFilter(user, query.clientId),
        category: query.category,
        status: ExpenseStatus.ACTIVE,
        expenseDate: period.where,
      },
      include: expenseEntryInclude,
      orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
    });
    const formatted = entries.map(formatExpenseEntry);
    const byCategory = new Map<
      ExpenseCategory,
      { amountRub: number; entriesCount: number }
    >();
    const byClient = new Map<
      string,
      {
        client: { id: string; code: string; name: string } | null;
        amountRub: number;
        entriesCount: number;
      }
    >();
    const byDay = new Map<string, number>();
    const byWorker = new Map<
      string,
      {
        workerName: string;
        totalRub: number;
        payrollPickersRub: number;
        handlingPprRub: number;
        contractWorkRub: number;
        entriesCount: number;
      }
    >();
    let totalRub = 0;
    let linkedToClientsRub = 0;

    formatted.forEach((entry) => {
      totalRub = roundMoney(totalRub + entry.amountRub);
      const category = byCategory.get(entry.category) ?? {
        amountRub: 0,
        entriesCount: 0,
      };
      category.amountRub = roundMoney(category.amountRub + entry.amountRub);
      category.entriesCount += 1;
      byCategory.set(entry.category, category);

      const clientKey = entry.client?.id ?? '__overhead__';
      const client = byClient.get(clientKey) ?? {
        client: entry.client,
        amountRub: 0,
        entriesCount: 0,
      };
      client.amountRub = roundMoney(client.amountRub + entry.amountRub);
      client.entriesCount += 1;
      byClient.set(clientKey, client);
      if (entry.client) linkedToClientsRub = roundMoney(linkedToClientsRub + entry.amountRub);

      const date = entry.expenseDate.slice(0, 10);
      byDay.set(date, roundMoney((byDay.get(date) ?? 0) + entry.amountRub));

      if (entry.workerName) {
        const workerKey = entry.workerName.trim().toLocaleLowerCase('ru-RU');
        const worker = byWorker.get(workerKey) ?? {
          workerName: entry.workerName.trim(),
          totalRub: 0,
          payrollPickersRub: 0,
          handlingPprRub: 0,
          contractWorkRub: 0,
          entriesCount: 0,
        };
        worker.totalRub = roundMoney(worker.totalRub + entry.amountRub);
        worker.entriesCount += 1;
        if (entry.category === ExpenseCategory.PAYROLL_PICKERS) {
          worker.payrollPickersRub = roundMoney(
            worker.payrollPickersRub + entry.amountRub,
          );
        } else if (entry.category === ExpenseCategory.HANDLING_PPR) {
          worker.handlingPprRub = roundMoney(
            worker.handlingPprRub + entry.amountRub,
          );
        } else if (entry.category === ExpenseCategory.CONTRACT_WORK) {
          worker.contractWorkRub = roundMoney(
            worker.contractWorkRub + entry.amountRub,
          );
        }
        byWorker.set(workerKey, worker);
      }
    });

    const categoryTotals = Object.values(ExpenseCategory).map((category) => ({
      category,
      amountRub: byCategory.get(category)?.amountRub ?? 0,
      entriesCount: byCategory.get(category)?.entriesCount ?? 0,
    }));

    return {
      periodFrom: period.from.toISOString(),
      periodTo: period.to.toISOString(),
      generatedAt: new Date().toISOString(),
      totals: {
        totalRub,
        entriesCount: formatted.length,
        linkedToClientsRub,
        overheadRub: roundMoney(totalRub - linkedToClientsRub),
        materialsRub:
          byCategory.get(ExpenseCategory.MATERIALS)?.amountRub ?? 0,
        logisticsRub:
          byCategory.get(ExpenseCategory.LOGISTICS)?.amountRub ?? 0,
        payrollPickersRub:
          byCategory.get(ExpenseCategory.PAYROLL_PICKERS)?.amountRub ?? 0,
        handlingPprRub:
          byCategory.get(ExpenseCategory.HANDLING_PPR)?.amountRub ?? 0,
        contractWorkRub:
          byCategory.get(ExpenseCategory.CONTRACT_WORK)?.amountRub ?? 0,
      },
      byCategory: categoryTotals.sort(
        (left, right) => right.amountRub - left.amountRub,
      ),
      byClient: [...byClient.values()].sort(
        (left, right) => right.amountRub - left.amountRub,
      ),
      daily: [...byDay.entries()].map(([date, amountRub]) => ({
        date,
        amountRub,
      })),
      byWorker: [...byWorker.values()].sort(
        (left, right) => right.totalRub - left.totalRub,
      ),
      entries: formatted,
    };
  }

  async getDebts(clientId: string | undefined, user: AuthUser) {
    const reconciliation = await this.billing.listReconciliation(
      { clientId },
      user,
    );
    const invoiceIds = reconciliation.clients.flatMap((client) =>
      client.invoices.map((invoice) => invoice.id),
    );
    const invoices =
      invoiceIds.length > 0
        ? await this.prisma.billingInvoice.findMany({
            where: { id: { in: invoiceIds } },
            select: {
              id: true,
              comment: true,
              items: {
                select: {
                  id: true,
                  description: true,
                  unit: true,
                  quantity: true,
                  unitPriceRub: true,
                  totalRub: true,
                  serviceDate: true,
                },
                orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
              },
            },
          })
        : [];
    const detailsByInvoiceId = new Map(
      invoices.map((invoice) => [
        invoice.id,
        {
          comment: invoice.comment,
          items: invoice.items.map((item) => ({
            ...item,
            quantity: decimalNumber(item.quantity),
            unitPriceRub: decimalNumber(item.unitPriceRub),
            totalRub: decimalNumber(item.totalRub),
            serviceDate: item.serviceDate.toISOString(),
          })),
        },
      ]),
    );
    return {
      ...reconciliation,
      clients: reconciliation.clients.map((client) => ({
        ...client,
        invoices: client.invoices.map((invoice) => ({
          ...invoice,
          comment: detailsByInvoiceId.get(invoice.id)?.comment ?? null,
          items: detailsByInvoiceId.get(invoice.id)?.items ?? [],
        })),
      })),
    };
  }

  private async requireMaterial(id: string) {
    const material = await this.prisma.expenseMaterial.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!material) throw new NotFoundException('Расходный материал не найден.');
    return material;
  }
}

function formatExpenseEntry(
  entry: Prisma.ExpenseEntryGetPayload<{ include: typeof expenseEntryInclude }>,
) {
  return {
    id: entry.id,
    category: entry.category,
    source: entry.source,
    status: entry.status,
    expenseDate: entry.expenseDate.toISOString(),
    amountRub: decimalNumber(entry.amountRub),
    description: entry.description,
    quantity: decimalNullable(entry.quantity),
    unit: entry.unit,
    unitPriceRub: decimalNullable(entry.unitPriceRub),
    workerName: entry.workerName,
    sourceKey: entry.sourceKey,
    comment: entry.comment,
    client: entry.client,
    request: entry.request,
    material: entry.material,
    createdBy: entry.createdBy,
    cancelledBy: entry.cancelledBy,
    cancelledAt: entry.cancelledAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function formatExpenseMaterial<
  T extends {
    id: string;
    code: string;
    name: string;
    unit: string;
    stockQuantity: Prisma.Decimal;
    averageUnitCostRub: Prisma.Decimal;
    minStockQuantity: Prisma.Decimal;
    isActive: boolean;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { rules: number; movements: number };
  },
>(material: T) {
  const stockQuantity = decimalNumber(material.stockQuantity);
  const averageUnitCostRub = decimalNumber(material.averageUnitCostRub);
  const minStockQuantity = decimalNumber(material.minStockQuantity);
  return {
    id: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    stockQuantity,
    averageUnitCostRub,
    stockValueRub: roundMoney(stockQuantity * averageUnitCostRub),
    minStockQuantity,
    isLowStock: stockQuantity <= minStockQuantity,
    isActive: material.isActive,
    comment: material.comment,
    rulesCount: material._count.rules,
    movementsCount: material._count.movements,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

function parsePeriod(
  query: Pick<ListExpensesDto, 'dateFrom' | 'dateTo'>,
  useCurrentMonth: boolean,
) {
  const now = new Date();
  const defaultFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const defaultTo = endOfDay(now);
  const from = query.dateFrom
    ? parseDate(query.dateFrom)
    : useCurrentMonth
      ? defaultFrom
      : undefined;
  const to = query.dateTo
    ? endOfDay(parseDate(query.dateTo))
    : useCurrentMonth
      ? defaultTo
      : undefined;
  if (from && to && from > to) {
    throw new BadRequestException(
      'Дата начала периода не может быть позже даты окончания.',
    );
  }
  return {
    from: from ?? new Date(0),
    to: to ?? new Date('9999-12-31T23:59:59.999Z'),
    where:
      from || to
        ? {
            gte: from,
            lte: to,
          }
        : undefined,
  };
}

function parsePayrollPeriod(query: Pick<ListExpensesDto, 'dateFrom' | 'dateTo'>) {
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultFrom = `${today.slice(0, 8)}01`;
  const dateFrom = payrollDate(query.dateFrom, defaultFrom);
  const dateTo = payrollDate(query.dateTo, today);
  const from = new Date(`${dateFrom}T00:00:00+03:00`);
  const toStart = new Date(`${dateTo}T00:00:00+03:00`);
  if (from > toStart) {
    throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
  }
  if (toStart.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new BadRequestException('Период ФОТ не может превышать 366 дней.');
  }
  return {
    dateFrom,
    dateTo,
    from,
    toExclusive: new Date(toStart.getTime() + 24 * 60 * 60 * 1000),
  };
}

function payrollDate(value: string | undefined, fallback: string) {
  const candidate = String(value ?? '').trim() || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new BadRequestException('Дата ФОТ должна быть в формате ГГГГ-ММ-ДД.');
  }
  const parsed = new Date(`${candidate}T00:00:00+03:00`);
  const normalized = new Date(parsed.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (normalized !== candidate) throw new BadRequestException('Указана несуществующая календарная дата.');
  return candidate;
}

function expensePayrollRate(value: Prisma.JsonValue) {
  const candidate = typeof value === 'number'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? Number((value as Record<string, unknown>).rateRub)
      : Number.NaN;
  return Number.isFinite(candidate) && candidate >= 0
    ? roundMoney(candidate)
    : DEFAULT_EXPENSE_PAYROLL_RATE_RUB;
}

function expensePayrollResetAt(value: Prisma.JsonValue) {
  const candidate = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? String((value as Record<string, unknown>).resetAt ?? '')
      : '';
  const parsed = candidate ? new Date(candidate) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseDate(value: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new BadRequestException(`Некорректная дата: ${value}.`);
  }
  return result;
}

function endOfDay(value: Date) {
  const result = new Date(value);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function requiredText(value: unknown, message: string) {
  const result = String(value ?? '').trim();
  if (!result) throw new BadRequestException(message);
  return result;
}

function cleanOptional(value: unknown) {
  const result = String(value ?? '').trim();
  return result || undefined;
}

function normalizeMaterialCode(value: string) {
  return requiredText(value, 'Укажите код материала.')
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function decimalNumber(value: Prisma.Decimal | string | number) {
  return Number(value);
}

function decimalNullable(
  value: Prisma.Decimal | string | number | null | undefined,
) {
  return value == null ? null : Number(value);
}

function quantityDecimal(value: number) {
  return new Prisma.Decimal(roundQuantity(value).toFixed(3));
}

function moneyDecimal(value: number) {
  return new Prisma.Decimal(roundMoney(value).toFixed(2));
}

function costDecimal(value: number) {
  return new Prisma.Decimal(roundCost(value).toFixed(4));
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundCost(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function isUniqueError(caught: unknown) {
  return (
    caught instanceof Prisma.PrismaClientKnownRequestError &&
    caught.code === 'P2002'
  );
}
