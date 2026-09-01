// TEST: every authenticated TSD mutation becomes an audit operation without breaking warehouse work.
import { TsdOperationStatus } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TsdAuditInterceptor } from '../src/modules/tsd/tsd-audit.interceptor';

describe('TsdAuditInterceptor', () => {
  it('записывает полное успешное действие ТСД с сотрудником, устройством, запросом и ответом', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const interceptor = new TsdAuditInterceptor({ tsdOperation: { create } } as never);
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/tsd/fbs/tasks/task-1/scan',
      route: { path: 'fbs/tasks/:id/scan' },
      params: { id: 'task-1' },
      query: {},
      body: { code: 'FFL_LKB0109_001', password: 'must-not-be-logged' },
      user: { id: 'worker-1', name: 'Анна', deviceCode: 'TSD-01' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    const result = await firstValueFrom(
      interceptor.intercept(context as never, { handle: () => of({ needed: true, boxCode: 'FFL_LKB0109_001' }) }),
    );

    expect(result).toEqual({ needed: true, boxCode: 'FFL_LKB0109_001' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'TSD-01',
        operationType: 'tsd_api_action',
        status: TsdOperationStatus.ACCEPTED,
        payload: expect.objectContaining({
          actor: { userId: 'worker-1', name: 'Анна' },
          request: expect.objectContaining({
            method: 'POST',
            path: '/api/v1/tsd/fbs/tasks/task-1/scan',
            body: { code: 'FFL_LKB0109_001', password: '[REDACTED]' },
          }),
          response: { needed: true, boxCode: 'FFL_LKB0109_001' },
        }),
      }),
    });
  });

  it('не пишет heartbeat и публичный вход с паролем', async () => {
    const create = vi.fn();
    const interceptor = new TsdAuditInterceptor({ tsdOperation: { create } } as never);

    for (const originalUrl of ['/api/v1/tsd/monitor/heartbeat', '/api/v1/tsd/login']) {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', originalUrl, route: {}, body: { password: 'secret' } }),
        }),
      };
      await firstValueFrom(interceptor.intercept(context as never, { handle: () => of({ ok: true }) }));
    }

    expect(create).not.toHaveBeenCalled();
  });

  it('не ломает рабочую операцию ТСД, если технический журнал временно недоступен', async () => {
    const interceptor = new TsdAuditInterceptor({
      tsdOperation: { create: vi.fn().mockRejectedValue(new Error('database unavailable')) },
    } as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/v1/tsd/transfers/execute',
          route: {},
          body: { boxCode: 'BOX-1' },
          user: { id: 'worker-1', name: 'Анна', email: 'a@example.com', deviceCode: 'TSD-01' },
        }),
      }),
    };

    await expect(firstValueFrom(interceptor.intercept(context as never, { handle: () => of({ moved: true }) })))
      .resolves.toEqual({ moved: true });
  });
});
