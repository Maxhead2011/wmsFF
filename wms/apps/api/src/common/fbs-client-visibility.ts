import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../modules/auth/auth.types';

// FIX: this is a single-client display exception for our company, not a change to show-all semantics.
const GUSHCHA = 'd7b835c1-6273-4b2c-be39-c96476fa7b5d';
const OUR_COMPANY = '0f31c965-66c3-4882-af0a-a390feb15a98';
export async function hiddenFbsClientIds(db: any, user: AuthUser): Promise<string[]> {
  if (process.env.WMS_FBS_GUSHCHA_VISIBILITY_ENABLED !== 'true' || user.isDemo || user.roleCodes.includes('CLIENT')) return [];
  if (!user.activeWarehouseId) return [GUSHCHA];
  const warehouse = await db.warehouse.findUnique({where:{id:user.activeWarehouseId},select:{ownCompanyId:true}});
  return !warehouse?.ownCompanyId || warehouse.ownCompanyId === OUR_COMPANY ? [GUSHCHA] : [];
}
export async function assertFbsClientVisible(db: any, user: AuthUser, clientId: string) {
  if (clientId?.trim() !== GUSHCHA) return;
  if ((await hiddenFbsClientIds(db,user)).includes(GUSHCHA)) throw new NotFoundException('Клиент недоступен в FBS нашей компании.');
}
