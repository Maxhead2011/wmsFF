import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth.types';
import { ClientScopeService } from './client-scope.service';

const service = new ClientScopeService();

function demoUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'demo-user',
    email: 'demo',
    name: 'Demo',
    isDemo: true,
    roleCodes: ['CLIENT'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: ['demo-client'],
    writableClientIds: ['demo-client'],
    ...overrides,
  };
}

describe('ClientScopeService demo isolation', () => {
  it('keeps a demo user limited even if role settings accidentally grant global access', () => {
    expect(service.resolveClientFilter(demoUser())).toEqual({ in: ['demo-client'] });
    expect(() => service.requireGlobalClientAccess(demoUser())).toThrow(ForbiddenException);
  });

  it('rejects reading or writing another client', () => {
    expect(() => service.requireClientAccess(demoUser(), 'real-client', 'read')).toThrow(ForbiddenException);
    expect(() => service.requireClientAccess(demoUser(), 'real-client', 'write')).toThrow(ForbiddenException);
  });

  it('allows the single assigned demo client', () => {
    expect(() => service.requireClientAccess(demoUser(), 'demo-client', 'read')).not.toThrow();
    expect(() => service.requireClientAccess(demoUser(), 'demo-client', 'write')).not.toThrow();
  });

  it('excludes demo clients from a live global session', () => {
    const liveAdmin = demoUser({
      id: 'admin',
      email: 'admin',
      name: 'Admin',
      isDemo: false,
      clientIds: [],
      writableClientIds: [],
      hiddenClientIds: ['demo-client'],
    });

    expect(service.resolveClientFilter(liveAdmin)).toEqual({ notIn: ['demo-client'] });
    expect(() => service.requireClientAccess(liveAdmin, 'real-client', 'read')).not.toThrow();
    expect(() => service.requireClientAccess(liveAdmin, 'demo-client', 'read')).toThrow(ForbiddenException);
  });
});
