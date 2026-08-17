import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccessTokenService } from '../src/modules/auth/access-token.service';

describe('AccessTokenService', () => {
  const service = new AccessTokenService({
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'test-secret' : 'test'),
  } as never);

  it('подписывает и проверяет access token', () => {
    const token = service.sign('user-1');

    expect(service.verify(token)).toMatchObject({ sub: 'user-1' });
  });

  it('сохраняет claims устройства в access token ТСД', () => {
    const token = service.sign('user-1', { deviceId: 'device-1', deviceCode: 'TSD-01' });

    expect(service.verify(token)).toMatchObject({
      sub: 'user-1',
      deviceId: 'device-1',
      deviceCode: 'TSD-01',
    });
  });

  it('отклоняет токен с измененной подписью', () => {
    const token = service.sign('user-1');
    const tampered = `${token.slice(0, -1)}x`;

    expect(() => service.verify(tampered)).toThrow(UnauthorizedException);
  });

  it('создаёт стабильный идентификатор конкретного токена', () => {
    const token = service.sign('user-1');

    expect(service.fingerprint(token)).toHaveLength(64);
    expect(service.fingerprint(token)).toBe(service.fingerprint(token));
    expect(service.fingerprint(`${token}x`)).not.toBe(service.fingerprint(token));
  });
});
