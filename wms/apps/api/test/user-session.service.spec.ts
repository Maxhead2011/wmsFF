import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserSessionService } from '../src/modules/auth/user-session.service';

describe('UserSessionService', () => {
  it('регистрирует новую браузерную сессию', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'session-1' });
    const service = new UserSessionService(
      { userSession: { upsert } } as never,
      { fingerprint: () => 'token-id' } as never,
    );

    await service.register(
      'user-1',
      'token',
      { sub: 'user-1', iat: 1, exp: 2_000_000_000 },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 Chrome/130.0' },
    );

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { accessTokenId: 'token-id' },
      create: expect.objectContaining({
        userId: 'user-1',
        accessTokenId: 'token-id',
        ipAddress: '127.0.0.1',
        appName: 'WMS',
        browserName: 'Google Chrome',
      }),
    }));
  });

  it('отклоняет уже закрытую сессию', async () => {
    const service = new UserSessionService(
      {
        userSession: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'session-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() - 1_000),
            lastSeenAt: new Date(),
          }),
        },
      } as never,
      { fingerprint: () => 'token-id' } as never,
    );

    await expect(
      service.assertActive('user-1', 'token', { sub: 'user-1', iat: 1, exp: 2_000_000_000 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('закрывает сессию по предъявленному токену', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'session-1' });
    const service = new UserSessionService(
      {
        userSession: {
          findUnique: vi.fn().mockResolvedValue({ id: 'session-1' }),
          update,
        },
      } as never,
      { fingerprint: () => 'token-id' } as never,
    );

    await expect(service.revokeByToken('token')).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        expiresAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      }),
    }));
  });
});
