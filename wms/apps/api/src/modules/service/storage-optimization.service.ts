import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  buildStorageOptimizationPlan,
  type StorageOptimizationPlan,
  type StorageOptimizationSourceRow,
} from './storage-optimization-planner';
import { buildStorageOptimizationWorkbook, storageOptimizationXlsxMimeType } from './storage-optimization-xlsx';

export type StorageOptimizationReport = StorageOptimizationPlan & {
  client: { id: string; code: string; name: string };
  generatedAt: string;
  summary: StorageOptimizationPlan['summary'] & { excludedUnits: number };
};

@Injectable()
export class StorageOptimizationService {
  constructor(private readonly prisma: PrismaService) {}

  async buildReport(clientId: string): Promise<StorageOptimizationReport> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true, name: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден.');

    // FIX: recommendations use only positive, available, physically boxed stock.
    const [balances, excluded] = await Promise.all([this.prisma.stockBalance.findMany({
      where: {
        clientId,
        status: 'AVAILABLE',
        quantity: { gt: 0 },
        boxId: { not: null },
      },
      select: {
        warehouseId: true,
        quantity: true,
        warehouse: { select: { id: true, name: true, city: true } },
        pallet: { select: { code: true } },
        box: {
          select: {
            code: true,
            warehouse: { select: { id: true, name: true, city: true } },
            pallet: { select: { code: true } },
            storagePlacement: {
              select: {
                pallet: { select: { code: true } },
              },
            },
          },
        },
        sku: {
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            color: true,
            size: true,
            barcodes: {
              select: { value: true, isPrimary: true },
              orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ warehouseId: 'asc' }, { boxId: 'asc' }, { skuId: 'asc' }],
    }), this.prisma.stockBalance.aggregate({
      where: {
        clientId,
        quantity: { gt: 0 },
        OR: [{ status: { not: 'AVAILABLE' } }, { boxId: null }],
      },
      _sum: { quantity: true },
    })]);

    const sourceRows: StorageOptimizationSourceRow[] = balances.flatMap((balance) => {
      if (!balance.box) return [];
      const warehouse = balance.warehouse ?? balance.box.warehouse;
      return [{
        warehouseId: warehouse?.id ?? balance.warehouseId ?? 'WITHOUT_WAREHOUSE',
        warehouseName: warehouse?.name || warehouse?.city || 'Без филиала',
        skuId: balance.sku.id,
        barcode: balance.sku.barcodes[0]?.value ?? null,
        article: balance.sku.article || balance.sku.clientSku || balance.sku.internalSku,
        productName: balance.sku.name,
        color: balance.sku.color,
        size: balance.sku.size,
        sourcePalletSort:
          balance.box.storagePlacement?.pallet.code ??
          balance.box.pallet?.code ??
          balance.pallet?.code ??
          null,
        sourceBox: balance.box.code,
        quantity: balance.quantity,
      }];
    });

    const plan = buildStorageOptimizationPlan(sourceRows);
    return {
      client,
      generatedAt: new Date().toISOString(),
      ...plan,
      summary: {
        ...plan.summary,
        // FIX: active or unboxed stock is visible in the summary but never recommended for movement.
        excludedUnits: excluded._sum.quantity ?? 0,
      },
    };
  }

  async buildReportFile(clientId: string) {
    const report = await this.buildReport(clientId);
    const timestamp = report.generatedAt.slice(0, 16).replace(/[:T]/g, '-');
    return {
      content: buildStorageOptimizationWorkbook(report),
      mimeType: storageOptimizationXlsxMimeType(),
      fileName: `storage_optimization_${safeFileName(report.client.code)}_${timestamp}.xlsx`,
    };
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9А-Яа-я_-]+/g, '_').replace(/^_+|_+$/g, '') || 'client';
}
