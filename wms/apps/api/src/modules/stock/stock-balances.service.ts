import { Injectable } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto';

export type BalanceKeyInput = {
  clientId: string;
  skuId: string;
  boxId?: string | null;
  palletId?: string | null;
  status: StockStatus;
};

@Injectable()
export class StockBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  list(filter: ListStockBalancesDto, user: AuthUser) {
    const search = filter.search?.trim();
    const skuWhere: Prisma.SkuWhereInput | undefined =
      filter.barcode || search
        ? {
            ...(filter.barcode ? { barcodes: { some: { value: filter.barcode } } } : {}),
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { internalSku: { contains: search, mode: 'insensitive' } },
                    { clientSku: { contains: search, mode: 'insensitive' } },
                    { article: { contains: search, mode: 'insensitive' } },
                    { barcodes: { some: { value: { contains: search } } } },
                  ],
                }
              : {}),
          }
        : undefined;
    const where: Prisma.StockBalanceWhereInput = {
      clientId: this.clientScopes.resolveClientFilter(user, filter.clientId),
      skuId: filter.skuId,
      box: filter.boxCode ? { code: filter.boxCode } : undefined,
      sku: skuWhere,
    };

    return this.prisma.stockBalance.findMany({
      where,
      include: {
        sku: { include: { barcodes: true } },
        box: true,
        pallet: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: search ? 100 : undefined,
    });
  }

  balanceKey(input: BalanceKeyInput) {
    // Русский комментарий: отдельный ключ убирает неоднозначность SQL NULL в составных unique-индексах.
    return [input.clientId, input.skuId, input.boxId ?? 'no-box', input.palletId ?? 'no-pallet', input.status].join(':');
  }
}
