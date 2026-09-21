import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

export const stockConfirmationEnabled = () => process.env.WMS_WB_STOCK_CONFIRMATION_ENABLED === 'true' && process.env.WMS_WB_STOCK_FINE_SETTINGS === 'true';
const states = ['ALL', 'CONFIRMED', 'MISMATCH', 'UNCONFIRMED', 'PENDING'];
export type ConfirmationQuery = { clientId?: string; connectionId?: string; search?: string; warehouseId?: string; status?: string; page?: string };
// FIX: missing WB observations stay null; large WB identifiers are lossless strings.
export function confirmationRow(row: any) {
  return { ...row, chrtId: String(row.chrtId), difference: row.observedAmount === null ? null : row.observedAmount - row.calculatedAmount };
}
@Injectable()
export class WbStockConfirmationService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}
  capabilities() { return { enabled: stockConfirmationEnabled() }; }
  async list(query: ConfirmationQuery, user: AuthUser) {
    if (!stockConfirmationEnabled() || user.isDemo) throw new ForbiddenException('Подтверждение остатков WB пока недоступно.');
    if (!query || ['clientId','connectionId','search','warehouseId','status','page'].some(k => (query as any)[k] !== undefined && typeof (query as any)[k] !== 'string')) throw new BadRequestException('Некорректные параметры списка.');
    const clientId = query.clientId?.trim(), connectionId = query.connectionId?.trim();
    if (!clientId || !connectionId) throw new BadRequestException('Выберите клиента и кабинет WB.');
    this.scopes.requireClientAccess(user, clientId, 'read');
    const page = Number(query.page ?? 1), status = query.status ?? 'ALL';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !states.includes(status)) throw new BadRequestException('Некорректные параметры списка.');
    const connection = await this.prisma.clientMarketplaceConnection.findFirst({ where: { id: connectionId, clientId, marketplace: 'WILDBERRIES', isActive: true }, select: { id: true, accountName: true, fbsExecutionWarehouseId: true } });
    if (!connection) throw new NotFoundException('Активный кабинет WB не найден.');
    if (!user.roleCodes.includes('CLIENT') && !user.permissionCodes.includes('system:admin')
      && (!connection.fbsExecutionWarehouseId || user.activeWarehouseId !== connection.fbsExecutionWarehouseId || (user.warehouseIds && !user.warehouseIds.includes(connection.fbsExecutionWarehouseId)))) throw new ForbiddenException('Выберите доступный филиал исполнения кабинета.');
    const search = (query.search ?? '').trim().slice(0, 150), warehouse = (query.warehouseId ?? '').trim();
    const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    const base = Prisma.sql`c."clientId"=${clientId} AND c."connectionId"=${connectionId}`;
    const where = Prisma.sql`${base}
      AND (${warehouse}='' OR c."warehouseId"=${warehouse})
      AND (${status}='ALL' OR c.status=${status} OR (${status}='PENDING' AND c.status IN ('PLANNED','SENDING','SENT')) OR (${status}='UNCONFIRMED' AND c.status NOT IN ('CONFIRMED','MISMATCH','PLANNED','SENDING','SENT')))
      AND (${search}='' OR s.article ILIKE ${pattern} OR s.name ILIKE ${pattern} OR s."internalSku" ILIKE ${pattern} OR c."chrtId"::text=${search}
        OR EXISTS(SELECT 1 FROM "Barcode" b WHERE b."skuId"=s.id AND b.value ILIKE ${pattern}))`;
    // Repeatable read keeps counters and the page on one snapshot while the publisher updates rows.
    return this.prisma.$transaction(async tx => {
      const summary = await tx.$queryRaw<any[]>(Prisma.sql`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status='CONFIRMED')::int AS confirmed,
        count(*) FILTER(WHERE status='MISMATCH')::int AS mismatches,
        count(*) FILTER(WHERE status NOT IN ('CONFIRMED','MISMATCH','PLANNED','SENDING','SENT'))::int AS unconfirmed,
        count(*) FILTER(WHERE status IN ('PLANNED','SENDING','SENT'))::int AS pending,
        max("checkedAt") AS "lastCheckedAt" FROM "WbStockPublicationCheck" c WHERE ${base}`);
      const counts = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT count(*)::int AS total FROM "WbStockPublicationCheck" c
        LEFT JOIN "Sku" s ON s.id=c."skuId" AND s."clientId"=c."clientId" WHERE ${where}`);
      const rows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT c.id,c."warehouseId",c."skuId",c."chrtId",c.phase,c.status,c."calculatedAmount",c."sentAmount",c."observedAmount",c."sentAt",c."checkedAt",c."updatedAt",c.error,
        s.article,s.name,s.size,(SELECT b.value FROM "Barcode" b WHERE b."skuId"=s.id ORDER BY b."isPrimary" DESC,b.value LIMIT 1) AS barcode
        FROM "WbStockPublicationCheck" c LEFT JOIN "Sku" s ON s.id=c."skuId" AND s."clientId"=c."clientId"
        WHERE ${where} ORDER BY c."updatedAt" DESC,c.id ASC LIMIT 50 OFFSET ${(page-1)*50}`);
      const warehouses = await tx.$queryRaw<Array<{ id: string; name: string; total: number }>>(Prisma.sql`SELECT c."warehouseId" AS id,
        COALESCE(max(sh."warehouseName"),c."warehouseId") AS name,count(*)::int AS total FROM "WbStockPublicationCheck" c
        LEFT JOIN "FbsStockAllocationPolicy" p ON p."clientId"=c."clientId" AND p."connectionId"=c."connectionId"
        LEFT JOIN "FbsStockAllocationShare" sh ON sh."policyId"=p.id AND sh."warehouseId"=c."warehouseId"
        WHERE ${base} GROUP BY c."warehouseId" ORDER BY name,c."warehouseId"`);
      return { summary: summary[0], total: counts[0]?.total ?? 0, rows: rows.map(confirmationRow), warehouses, page, pageSize: 50, generatedAt: new Date().toISOString(), accountName: connection.accountName };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
