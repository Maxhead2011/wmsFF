import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';

describe('AnalyticsService access', () => {
  it('не обращается к БД, если аналитика отключена в профиле логина', async () => {
    const service = new AnalyticsService({} as never, {} as never, {} as never, {} as never);

    await expect(
      service.listClients({
        id: 'user-1',
        email: 'client@example.com',
        name: 'Клиент',
        analyticsEnabled: false,
        roleCodes: ['CLIENT'],
        permissionCodes: [],
        clientScopeMode: 'LIMITED',
        clientIds: ['client-1'],
        writableClientIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
