import { Injectable } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingUnit,
  ClientRequestStatus,
  ExpenseCategory,
  ExpenseMaterialMovementType,
  ExpenseSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class ExpenseAutomationService {
  constructor(private readonly prisma: PrismaService) {}

  async consumeForDoneRequest(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        number: true,
        title: true,
        clientId: true,
        status: true,
        updatedAt: true,
        items: { select: { quantity: true } },
        client: {
          select: {
            expenseMaterialRules: {
              where: { isEnabled: true, material: { isActive: true } },
              include: { material: true },
              orderBy: { material: { name: 'asc' } },
            },
          },
        },
      },
    });
    if (!request || request.status !== ClientRequestStatus.DONE) {
      return {
        status: 'SKIPPED' as const,
        reason: 'REQUEST_NOT_DONE',
        consumedMaterials: 0,
        billingCharges: 0,
        shortages: [],
      };
    }

    const shippedUnits = request.items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity),
      0,
    );
    if (shippedUnits <= 0 || request.client.expenseMaterialRules.length === 0) {
      return {
        status: 'APPLIED' as const,
        shippedUnits,
        consumedMaterials: 0,
        billingCharges: 0,
        shortages: [],
      };
    }

    let consumedMaterials = 0;
    let billingCharges = 0;
    const shortages: Array<{
      materialId: string;
      materialName: string;
      stockQuantity: number;
      shortageQuantity: number;
      unit: string;
    }> = [];

    for (const rule of request.client.expenseMaterialRules) {
      const sourceKey = `request-material:${request.id}:${rule.id}`;
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.expenseMaterialMovement.findUnique({
            where: { sourceKey },
            select: { id: true },
          });
          if (existing) return { applied: false, charged: false, stock: null };

          const freshMaterial = await tx.expenseMaterial.findUnique({
            where: { id: rule.materialId },
          });
          if (!freshMaterial || !freshMaterial.isActive) {
            return { applied: false, charged: false, stock: null };
          }

          const quantity = roundQuantity(
            shippedUnits * Number(rule.quantityPerShippedUnit),
          );
          if (quantity <= 0) {
            return { applied: false, charged: false, stock: null };
          }
          const currentStock = Number(freshMaterial.stockQuantity);
          const nextStock = roundQuantity(currentStock - quantity);
          const internalUnitCost = Number(freshMaterial.averageUnitCostRub);
          const internalAmount = roundMoney(quantity * internalUnitCost);

          const expense = await tx.expenseEntry.create({
            data: {
              category: ExpenseCategory.MATERIALS,
              source: ExpenseSource.AUTO_MATERIAL_CONSUMPTION,
              expenseDate: request.updatedAt,
              amountRub: moneyDecimal(internalAmount),
              description: `Расход на заявку №${String(request.number).padStart(6, '0')}: ${freshMaterial.name}`,
              clientId: request.clientId,
              requestId: request.id,
              materialId: freshMaterial.id,
              quantity: quantityDecimal(quantity),
              unit: freshMaterial.unit,
              unitPriceRub: costDecimal(internalUnitCost),
              sourceKey,
              comment: `Автоматически: ${shippedUnits} отправленных ед. × ${Number(rule.quantityPerShippedUnit)} ${freshMaterial.unit}.`,
              createdByUserId: user.id,
            },
          });

          await tx.expenseMaterialMovement.create({
            data: {
              materialId: freshMaterial.id,
              type: ExpenseMaterialMovementType.CONSUMPTION,
              quantity: quantityDecimal(-quantity),
              unitCostRub: costDecimal(internalUnitCost),
              clientId: request.clientId,
              requestId: request.id,
              expenseEntryId: expense.id,
              sourceKey,
              comment: `Заявка №${String(request.number).padStart(6, '0')}: ${request.title}`,
              createdByUserId: user.id,
            },
          });

          await tx.expenseMaterial.update({
            where: { id: freshMaterial.id },
            data: { stockQuantity: quantityDecimal(nextStock) },
          });

          let charged = false;
          if (rule.chargeSeparately) {
            const unitPrice = Number(rule.billingUnitPriceRub ?? 0);
            await tx.billingCharge.create({
              data: {
                clientId: request.clientId,
                requestId: request.id,
                description: `Расходный материал: ${freshMaterial.name}`,
                unit: BillingUnit.PIECE,
                quantity: quantityDecimal(quantity),
                unitPriceRub: moneyDecimal(unitPrice),
                totalRub: moneyDecimal(quantity * unitPrice),
                status: BillingChargeStatus.APPROVED,
                serviceDate: request.updatedAt,
                source: BillingChargeSource.MANUAL,
                sourceKey: `expense-material-charge:${request.id}:${rule.id}`,
                metadata: {
                  expenseMaterialId: freshMaterial.id,
                  expenseMaterialCode: freshMaterial.code,
                  autoConsumption: true,
                  shippedUnits,
                  quantityPerShippedUnit: Number(
                    rule.quantityPerShippedUnit,
                  ),
                  includedInProcessing: false,
                },
                comment: `Автоматическое отдельное начисление расходного материала по заявке №${String(request.number).padStart(6, '0')}.`,
                createdByUserId: user.id,
                approvedByUserId: user.id,
                approvedAt: new Date(),
              },
            });
            charged = true;
          }

          return {
            applied: true,
            charged,
            stock: {
              materialId: freshMaterial.id,
              materialName: freshMaterial.name,
              stockQuantity: nextStock,
              shortageQuantity: Math.max(0, -nextStock),
              unit: freshMaterial.unit,
            },
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result.applied) continue;
      consumedMaterials += 1;
      if (result.charged) billingCharges += 1;
      if (result.stock && result.stock.shortageQuantity > 0) {
        shortages.push(result.stock);
      }
    }

    return {
      status: 'APPLIED' as const,
      shippedUnits,
      consumedMaterials,
      billingCharges,
      shortages,
    };
  }
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
