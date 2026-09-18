import { Prisma, TsdOperation, TsdOperationStatus } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

type HistoryRow = Pick<TsdOperation, 'id' | 'deviceId' | 'operationKey' | 'operationType' | 'payload' | 'status' | 'serverMessage' | 'createdAt' | 'updatedAt'>;

export async function readTsdMonitorHistory(db: PrismaService, kind: 'errors' | 'activity', since: Date): Promise<HistoryRow[]> {
  const where: Prisma.TsdOperationWhereInput = kind === 'errors' ? {
    createdAt: { gte: since }, AND: [
      { operationType: { not: 'monitor_command' } },
      { OR: [{ operationType: 'monitor_error' }, { status: { in: [TsdOperationStatus.REJECTED, TsdOperationStatus.NEEDS_REVIEW] } }] },
    ],
  } : { createdAt: { gte: since }, operationType: { notIn: ['monitor_heartbeat', 'monitor_command', 'monitor_message'] } };
  const take = kind === 'errors' ? 500 : 1000;
  if (process.env.WMS_TSD_MONITOR_COMPACT_ENABLED !== 'true') {
    return db.tsdOperation.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  }
  // FIX: project display fields inside PostgreSQL; never transfer audit responses or screenshots to the monitor.
  const filter = kind === 'errors'
    ? Prisma.sql`"operationType" <> 'monitor_command' AND ("operationType" = 'monitor_error' OR "status" IN ('REJECTED', 'NEEDS_REVIEW'))`
    : Prisma.sql`"operationType" NOT IN ('monitor_heartbeat', 'monitor_command', 'monitor_message')`;
  return db.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT "id", "deviceId", "operationKey", "operationType", "status", "serverMessage", "createdAt", "updatedAt",
      jsonb_strip_nulls(jsonb_build_object(
        'deviceCode', payload->'deviceCode', 'message', payload->'message',
        'screenLabel', payload->'screenLabel', 'screen', payload->'screen',
        'stageLabel', payload->'stageLabel', 'stage', payload->'stage',
        'requestId', payload->'requestId', 'requestNumber', payload->'requestNumber',
        'orderId', payload->'orderId', 'workerName', payload->'workerName',
        'clientName', payload->'clientName', 'boxCode', payload->'boxCode',
        'normalizedBoxCode', payload->'normalizedBoxCode', 'barcode', payload->'barcode'
      )) AS payload
    FROM "TsdOperation" WHERE "createdAt" >= ${since.toISOString()}::timestamp AND ${filter}
    ORDER BY "createdAt" DESC LIMIT ${take}
  `);
}
