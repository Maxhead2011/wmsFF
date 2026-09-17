import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';

// FIX: inspection never requests a label, binds a KIZ or acknowledges a print.
@Injectable()
export class WbPrintCheckService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}

  async inspect(input: string | undefined, user: AuthUser) {
    if (!user.permissionCodes.includes('system:admin')) throw new ForbiddenException('Нет доступа к сервисному меню.');
    if (process.env.WMS_WB_PRINT_CHECK_ENABLED !== 'true') throw new NotFoundException('Проверка печати WB выключена.');
    const orderId = (typeof input === 'string' ? input : '').trim().replace(/^№\s*/, '');
    if (!/^[1-9]\d{0,19}$/.test(orderId)) throw new BadRequestException('Введите номер заказа WB — только цифры.');
    const clientId = this.scopes.resolveClientFilter(user);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const where = { orderId, clientId };
      const [tasks, history, attempts] = await Promise.all([
        tx.fbsTsdAssembly.findMany({ where: { ...where, marketplace: 'WILDBERRIES' }, select: {
          id: true, clientId: true, connectionId: true, requestId: true, productName: true, article: true,
          barcode: true, boxCode: true, workerName: true, kiz: true, wbMetaStatus: true, status: true,
          startedAt: true, completedAt: true, updatedAt: true, errorMessage: true, stickerPartA: true, stickerPartB: true,
        } }),
        tx.fbsWebKizStickerPrint.findMany({ where, orderBy: { printedAt: 'asc' } }),
        tx.fbsAssemblyAttemptHistory.findMany({ where, orderBy: { completedAt: 'asc' } }),
      ]);
      type Row = typeof tasks[number];
      const rows: Array<Row & { archived: boolean }> = tasks.map(t => ({ ...t, archived: false }));
      for (const a of attempts) {
        const s = (a.taskSnapshot ?? {}) as Record<string, unknown>;
        const str = (key: string) => typeof s[key] === 'string' ? s[key] as string : null;
        // Archived attempts keep their own assembly identity; a repeated collection is not a duplicate print.
        if (rows.some(t => t.id === (str('id') ?? a.id) && t.clientId === a.clientId)) continue;
        rows.push({ id: str('id') ?? a.id, clientId: a.clientId, connectionId: str('connectionId') ?? '', requestId: a.requestId,
          productName: str('productName') ?? '', article: str('article'), barcode: str('barcode'), boxCode: str('boxCode'),
          workerName: str('workerName'), kiz: a.kiz, wbMetaStatus: str('wbMetaStatus') ?? 'UNKNOWN', status: str('status') ?? 'ARCHIVED',
          startedAt: str('startedAt') ? new Date(str('startedAt')!) : null, completedAt: a.completedAt, updatedAt: a.archivedAt,
          errorMessage: str('errorMessage'), stickerPartA: str('stickerPartA'), stickerPartB: str('stickerPartB'), archived: true });
      }
      for (const h of history) if (!rows.some(t => t.id === h.assemblyId && t.clientId === h.clientId)) {
        rows.push({ id: h.assemblyId, clientId: h.clientId, connectionId: '', requestId: h.requestId, productName: '', article: null,
          barcode: null, boxCode: null, workerName: null, kiz: h.kiz, wbMetaStatus: 'UNKNOWN', status: 'HISTORY_ONLY',
          startedAt: null, completedAt: null, updatedAt: h.printedAt, errorMessage: null, stickerPartA: null, stickerPartB: null, archived: true });
      }
      if (!rows.length) return { orderId, checkedAt: new Date().toISOString(), results: [] };
      const ids = rows.map(t => t.id), clients = [...new Set(rows.map(t => t.clientId))];
      const [jobs, audits, requests, names, connections] = await Promise.all([
        tx.fbsPrintJob.findMany({ where: { orderId, assemblyId: { in: ids } }, orderBy: { createdAt: 'asc' }, select: {
          id: true, assemblyId: true, historyId: true, requestId: true, kiz: true, status: true, source: true, deviceCode: true,
          requestedBy: true, createdAt: true, claimedAt: true, printedAt: true, failedAt: true, errorMessage: true, attempts: true,
          stickerCode: true, station: { select: { name: true, printerName: true } },
        } }),
        tx.auditLog.findMany({ where: { entity: 'FbsTsdAssembly', entityId: { in: ids }, action: { in: ['FBS_KIZ_SCAN_ACCEPTED', 'FBS_WB_KIZ_REPLACED_AFTER_PRODUCT_PICK'] } },
          orderBy: { createdAt: 'asc' }, select: { entityId: true, action: true, createdAt: true, payload: true, userId: true } }),
        tx.clientRequest.findMany({ where: { id: { in: rows.map(t => t.requestId) }, clientId: { in: clients } }, select: {
          id: true, number: true, clientId: true, warehouse: { select: { name: true } },
        } }),
        tx.client.findMany({ where: { id: { in: clients } }, select: { id: true, name: true } }),
        tx.clientMarketplaceConnection.findMany({ where: { id: { in: rows.map(t => t.connectionId).filter(Boolean) }, clientId: { in: clients } }, select: { id: true, accountName: true } }),
      ]);
      const actors = await tx.user.findMany({ where: { id: { in: audits.map(a => a.userId).filter((id): id is string => !!id) } }, select: { id: true, name: true } });
      return { orderId, checkedAt: new Date().toISOString(), results: rows.map(t => {
        const request = requests.find(r => r.id === t.requestId && r.clientId === t.clientId);
        return { ...t, clientName: names.find(c => c.id === t.clientId)?.name ?? t.clientId,
          connectionName: connections.find(c => c.id === t.connectionId)?.accountName ?? null,
          requestNumber: request?.number ?? null, warehouseName: request?.warehouse?.name ?? null,
          scans: audits.filter(a => a.entityId === t.id).flatMap(a => {
            const p = (a.payload ?? {}) as Record<string, unknown>;
            if (p.clientId !== t.clientId || p.orderId !== orderId) return [];
            return [{ action: a.action, at: a.createdAt, worker: actors.find(u => u.id === a.userId)?.name ?? null,
              kiz: typeof p.kiz === 'string' ? p.kiz : null, boxCode: typeof p.boxCode === 'string' ? p.boxCode : null }];
          }),
          prints: jobs.filter(j => j.assemblyId === t.id && j.requestId === t.requestId),
          labelRequests: history.filter(h => h.assemblyId === t.id && h.clientId === t.clientId).map(h => ({
            at: h.printedAt, worker: h.printedBy, kiz: h.kiz, stickerCode: h.stickerCode,
            hasPrintJob: jobs.some(j => j.historyId === h.id),
          })),
        };
      }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
