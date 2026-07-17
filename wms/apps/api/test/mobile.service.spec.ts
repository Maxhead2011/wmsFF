import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { MobileAuthService } from '../src/modules/mobile/mobile-auth.service';
import { MobileService } from '../src/modules/mobile/mobile.service';

describe('MobileService', () => {
  it('ограничивает клиентский dashboard назначенным клиентом и скрывает черновики счетов', async () => {
    const prisma = {
      clientRequest: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 25 }, _count: { _all: 2 } }) },
      billingInvoice: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      clientNotification: { count: vi.fn().mockResolvedValue(1) },
      box: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new MobileService(prisma as never, new ClientScopeService(), {} as never);
    const user = clientUser();

    const result = await service.dashboard(user);

    expect(result.stock.units).toBe(25);
    expect(prisma.clientRequest.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: { in: ['client-1'] } } }),
    );
    expect(prisma.billingInvoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: { in: ['client-1'] },
          status: { in: ['ISSUED', 'PAID'] },
        }),
      }),
    );
  });

  it('выдает мобильную пару токенов и привязывает установку к пользователю', async () => {
    const tx = {
      mobileDevice: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1' }),
      },
      mobileSession: { updateMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback) => callback(tx)),
      mobileSession: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
    };
    const auth = { login: vi.fn().mockResolvedValue({ user: clientUser(), accessToken: 'old' }) };
    const tokens = { sign: vi.fn().mockReturnValue('access-mobile') };
    const audit = { write: vi.fn().mockResolvedValue({}) };
    const service = new MobileAuthService(prisma as never, auth as never, tokens as never, audit as never);

    const result = await service.login(
      { login: 'client', password: 'secret', installationId: 'install-123', appVersion: '0.1.0' },
      { ip: '127.0.0.1' },
    );

    expect(result.accessToken).toBe('access-mobile');
    expect(result.refreshToken.length).toBeGreaterThan(40);
    expect(tx.mobileDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ installationId: 'install-123' }) }),
    );
    expect(prisma.mobileSession.create).toHaveBeenCalledOnce();
  });
});

function clientUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'client',
    name: 'Клиент',
    roleCodes: ['CLIENT'],
    permissionCodes: ['clients:read', 'stock:read', 'client-requests:read', 'client-requests:write', 'billing:read'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: ['client-1'],
  };
}
