import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdministrationService } from '../src/modules/administration/administration.service';

describe('AdministrationService: owner boundary', () => {
  const service = new AdministrationService({} as never, {} as never, {} as never, {} as never);

  it('не открывает документацию обычному администратору', () => {
    expect(() =>
      service.documentation({
        id: 'admin-1',
        name: 'Администратор',
        email: 'admin@example.test',
        administrationEnabled: false,
      } as never),
    ).toThrow(ForbiddenException);
  });

  it('открывает документацию назначенному владельцу', () => {
    const result = service.documentation({
      id: 'owner-1',
      name: 'Владелец',
      email: 'owner@example.test',
      administrationEnabled: true,
    } as never);

    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.references.some((item) => item.path === 'docs/WMS-USER-GUIDE.md')).toBe(true);
  });

  it('безопасно оптимизирует технические данные и обновляет статистику базы', async () => {
    const prisma = {
      mobileCommand: { deleteMany: vi.fn().mockResolvedValue({ count: 12 }) },
      mobileSession: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ databaseSizeBytes: '104857600', liveRows: '1000', deadRows: '50' }])
        .mockResolvedValueOnce([{ databaseSizeBytes: '104857600', liveRows: '985', deadRows: '35' }]),
    };
    const auditLog = { write: vi.fn().mockResolvedValue(undefined) };
    const marketplaceConnections = {
      pruneExpiredRuntimeCaches: vi.fn().mockReturnValue({ removed: 5, retained: 2 }),
    };
    const optimizationService = new AdministrationService(
      prisma as never,
      {} as never,
      {} as never,
      auditLog as never,
      marketplaceConnections as never,
    );

    const result = await optimizationService.optimizePerformance({
      id: 'owner-1',
      name: 'Владелец',
      email: 'owner@example.test',
      administrationEnabled: true,
    } as never);

    expect(result.status).toBe('COMPLETED');
    expect(result.cleanup).toEqual({ expiredMobileCommands: 12, expiredMobileSessions: 3 });
    expect(result.runtime).toEqual(expect.objectContaining({ expiredCacheEntries: 5, retainedCacheEntries: 2 }));
    expect(result.database.after).toEqual({ sizeMb: 100, liveRows: 985, deadRows: 35 });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('ANALYZE'));
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'administration.performance.optimize' }),
    );
  });

  it('считает завершённые заказы, отпиканные единицы и точное время сборщика', async () => {
    const completedAt = new Date('2026-08-09T10:01:30.000Z');
    const prisma = {
      tsdOperation: { findMany: vi.fn().mockResolvedValue([]) },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue([{
            id: 'task-1',
            requestId: 'request-1',
            orderId: 'order-1',
            productName: 'Костюм',
            article: 'SKU-1',
            itemCount: 2,
            deviceCode: 'TSD-1',
            workerUserId: 'worker-1',
            workerName: 'Ирина',
            startedAt: new Date('2026-08-09T10:00:00.000Z'),
            completedAt,
          }]),
      },
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([{ id: 'request-1', number: 161, client: { name: 'Клиент' } }]),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const monitorService = new AdministrationService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (monitorService as any).listTsdWorkloads = vi.fn().mockResolvedValue({
      checkedAt: completedAt.toISOString(),
      summary: { registeredDevices: 0, onlineDevices: 0, busyDevices: 0, tasks: 0, protectedTasks: 0 },
      devices: [],
    });

    const result = await monitorService.listTsdMonitor({ isDemo: false } as never);

    expect(result.pickerStatistics.summary).toEqual({ workers: 1, orders: 1, units: 2 });
    expect(result.pickerStatistics.workers[0]).toEqual(expect.objectContaining({
      workerName: 'Ирина',
      orders: 1,
      units: 2,
      averageDurationSeconds: 90,
      totalDurationSeconds: 90,
    }));
    expect(result.pickerStatistics.workers[0].orderDetails[0]).toEqual(expect.objectContaining({
      orderId: 'order-1',
      requestNumber: 161,
      durationSeconds: 90,
    }));
  });

  it('освобождает только активную инвентаризацию пользователя выбранного ТСД', async () => {
    const prisma = {
      tsdDevice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'device-1',
          code: 'TSD-01',
          name: 'TSD-01',
          userId: 'worker-1',
          user: { id: 'worker-1', name: 'Эля', email: 'elya@example.test' },
        }),
      },
      tsdOperation: {
        findFirst: vi.fn().mockResolvedValue({
          deviceId: 'device-1',
          payload: {
            screen: 'INVENTORY_COUNT',
            appVersion: '0.1.120',
            inventorySessionId: 'inventory-1',
          },
          updatedAt: new Date('2026-08-09T20:00:00.000Z'),
        }),
        create: vi.fn().mockResolvedValue({ id: 'command-1' }),
      },
      inventorySession: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inventory-1',
          type: 'BOX_CHECK',
          status: 'ACTIVE',
          title: 'Проверка короба FFL_TEST_001',
          comment: null,
          boxes: [{
            id: 'audit-box-1',
            boxCode: 'FFL_TEST_001',
            countedByName: 'Эля',
            startedAt: new Date('2026-08-09T19:50:00.000Z'),
          }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const auditLog = { write: vi.fn().mockResolvedValue(undefined) };
    const service = new AdministrationService(
      prisma as never,
      {} as never,
      {} as never,
      auditLog as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.issueTsdMonitorAction('TSD-01', 'UNLOCK_INVENTORY', {
      id: 'owner-1',
      name: 'Администратор',
      email: 'owner@example.test',
      administrationEnabled: true,
    } as never);

    expect(prisma.inventorySession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inventory-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'CANCELLED', completedByUserId: 'owner-1' }),
    }));
    expect(prisma.tsdOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deviceId: 'device-1',
        payload: expect.objectContaining({ action: 'UNLOCK_INVENTORY' }),
      }),
    }));
    expect(result.inventoryRelease).toEqual(expect.objectContaining({
      released: true,
      sessionId: 'inventory-1',
      boxCodes: ['FFL_TEST_001'],
    }));
    expect(auditLog.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'administration.tsd-inventory.unlock',
      entityId: 'inventory-1',
    }));
  });
});
