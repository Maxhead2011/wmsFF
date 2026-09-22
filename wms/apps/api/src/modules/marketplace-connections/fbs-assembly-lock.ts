import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';

// FIX: manual and scheduled actions share a cross-process PostgreSQL lock.
// No stock changes occur in this transaction; existing services keep their own atomic writes.
export async function withFbsAssemblyLock<T>(prisma: PrismaService, clientId: string, action: () => Promise<T>): Promise<T> {
  if (process.env.WMS_AUTO_ASSEMBLY_ENABLED !== 'true') return action();
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${'fbs-assembly:' + clientId})) AS locked`;
    if (!rows[0]?.locked) throw new ConflictException('Для клиента уже выполняется создание сборки. Повторите после завершения текущей операции.');
    return action();
  }, { timeout: 600000, maxWait: 5000 });
}
