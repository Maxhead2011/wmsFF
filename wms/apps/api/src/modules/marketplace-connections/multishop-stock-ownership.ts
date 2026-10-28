import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopDestination } from './multishop-stock-transport';

export const MULTISHOP_ACTIVE_PREFIX = 'marketplace.multishop.active.v1:';
export type ShopOwnership = { status: 'ACTIVE' | 'STOPPING' | 'OFF'; destinations: Record<string, ShopDestination> };

// FIX: legacy writers are fenced at the common network boundary, including retries.
// Stopping does not silently hand ownership back to the legacy automatic writer.
// Previously managed destinations remain fenced after their zero is confirmed.
export async function assertNotMultishopOwned(db: Prisma.TransactionClient, clientId: string, apiKey: string, chrtIds: number[]) {
  if (process.env.WMS_MULTISHOP_PUBLICATION_ENABLED !== 'true') return;
  const setting = await db.systemSetting.findUnique({ where: { key: MULTISHOP_ACTIVE_PREFIX + clientId } });
  const active = setting?.value as unknown as ShopOwnership | undefined;
  if (!active) return;
  const connection = await db.clientMarketplaceConnection.findFirst({ where: { clientId, marketplace: 'WILDBERRIES', apiKey, isActive: true }, select: { id: true } });
  if (!connection) throw new ConflictException('Кабинет WB не найден.');
  if (Object.values(active.destinations).some(d => d.connectionId === connection.id && d.marketplace === 'WILDBERRIES' && chrtIds.includes(Number(d.productId.split(':').at(-1))))) {
    throw new ConflictException('Остатками этих товаров управляет группа магазинов. Измените настройки в разделе «Между магазинами».');
  }
}
