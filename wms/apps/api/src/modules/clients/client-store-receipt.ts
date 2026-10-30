import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { validateStoreDirectory } from './client-stores.policy';

export const storeDirectoryKey = (clientId: string) => `client.stores.v1:${clientId}`;
export const skuStoresKey = (clientId: string, skuId: string) => `client.sku-stores.v1:${clientId}:${skuId}`;

// FIX: multiple permissions reference one physical SKU, never separate balances.
export function validateSkuStores(value: unknown, allowedStoreIds: readonly string[]): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 50 ||
      value.some(id => typeof id !== 'string' || !allowedStoreIds.includes(id)) || new Set(value).size !== value.length) {
    throw new BadRequestException('Укажите разрешённые магазины товара без повторов.');
  }
  return [...value].sort();
}

// FIX: invoked inside the stock transaction. Unknown old scans require review, not inferred ownership.
export async function assertStoreReceipt(tx: Prisma.TransactionClient, input: {
  clientId: string; skuId: string; storeId?: string; sourceDocument?: string;
}) {
  if (process.env.WMS_CLIENT_STORES_ENABLED !== 'true' || process.env.WMS_CLIENT_STORE_RECEIPTS_ENABLED !== 'true') return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeDirectoryKey(input.clientId)}))`;
  const directory = await tx.systemSetting.findUnique({where: {key: storeDirectoryKey(input.clientId)}});
  if (!directory) {
    if (input.storeId) throw new BadRequestException('Магазины клиента ещё не настроены.');
    return null;
  }
  const connections = await tx.clientMarketplaceConnection.findMany({where: {clientId: input.clientId}, select: {id: true}});
  let stores;
  try { stores = validateStoreDirectory(directory.value, connections.map(c => c.id)); }
  catch { throw new BadRequestException('Связи магазинов требуют проверки администратором.'); }
  const store = stores.find(s => s.id === input.storeId);
  if (!store) throw new BadRequestException('Укажите магазин приёмки. Старый скан без магазина требует разбора.');
  const membership = await tx.systemSetting.findUnique({where: {key: skuStoresKey(input.clientId, input.skuId)}});
  const ids = validateSkuStores(membership?.value, stores.map(s => s.id));
  if (!ids.includes(store.id)) throw new BadRequestException('Товар не разрешён для выбранного магазина. Проверьте ШК.');
  if (!input.sourceDocument?.trim()) throw new BadRequestException('Для приёмки магазина нужен документ приёмки.');
  const key = `client.receipt-store.v1:${input.clientId}:${input.sourceDocument}`;
  const context = await tx.systemSetting.findUnique({where: {key}});
  if (context && context.value !== store.id) throw new BadRequestException('Документ приёмки уже относится к другому магазину.');
  if (!context) await tx.systemSetting.create({data: {key, value: store.id}});
  return {storeId: store.id, storeName: store.name};
}
