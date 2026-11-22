import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const palitraClientId = 'e8597352-0b93-442c-9582-c694620a9695';
export type FulfillmentRule = 'zones' | 'pickKiz';
export const ruleKey = (id: string, rule: FulfillmentRule) => `client.fulfillment.${id}.${rule}`;
export function ruleAvailable(rule: FulfillmentRule) {
  return (rule === 'zones' ? process.env.WMS_OZON_BOX_ZONES_ENABLED : process.env.WMS_PALITRA_PICK_KIZ) === 'true';
}
// FIX: missing settings inherit the original per-installation client policy.
export async function configuredRule(db: Pick<Prisma.TransactionClient, 'systemSetting'>, id: string, rule: FulfillmentRule) {
  const saved = await db.systemSetting.findUnique({where:{key:ruleKey(id,rule)}, select:{value:true}});
  return typeof saved?.value === 'boolean' ? saved.value : id === palitraClientId;
}
export async function activeRule(db: Pick<Prisma.TransactionClient, 'systemSetting'>, id: string, rule: FulfillmentRule) {
  return ruleAvailable(rule) && await configuredRule(db,id,rule);
}
export function requireSettingsEditor(roles: readonly string[]) {
  if (!roles.some(role => role === 'ADMIN' || role === 'OWNER')) throw new ForbiddenException('Настройки меняет администратор или собственник.');
}
