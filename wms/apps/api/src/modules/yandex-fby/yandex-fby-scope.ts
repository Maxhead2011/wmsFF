import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
// FIX: old TSD clients cannot misclassify an FBY assembly as WB.
export function fbyQueueScope(marketplace?: string): Prisma.ClientRequestWhereInput {
  if (process.env.WMS_YANDEX_FBY_ENABLED !== 'true') {
    if (marketplace === 'YANDEX_MARKET') throw new BadRequestException('FBY не включён.');
    return {};
  }
  return { yandexFbyShipment: marketplace === 'YANDEX_MARKET' ? { isNot: null } : { is: null } };
}
