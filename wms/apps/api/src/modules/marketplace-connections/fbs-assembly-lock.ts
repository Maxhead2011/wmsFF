import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';

// FIX: manual and scheduled actions share a cross-process PostgreSQL lock.
// No stock changes occur in this transaction; existing services keep their own atomic writes.
export async function withFbsAssemblyLock<T>(prisma: PrismaService, clientId: string, action: () => Promise<T>, orderKeys?: string[]): Promise<T> {
  if (process.env.WMS_AUTO_ASSEMBLY_ENABLED !== 'true') return action();
  return prisma.$transaction(async tx => {
    const keys = orderKeys?.length ? [...new Set(orderKeys)].sort().map(key => `fbs-assembly:${clientId}:${key}`) : [`fbs-assembly:${clientId}`];
    for (const key of keys) {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
      if (!rows[0]?.locked) throw new ConflictException('Для выбранных заказов уже выполняется создание сборки. Остальные заказы доступны для ручной работы.');
    }
    return action();
  }, { timeout: 600000, maxWait: 5000 });
}
