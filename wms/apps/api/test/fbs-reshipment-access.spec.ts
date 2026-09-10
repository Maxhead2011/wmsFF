import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { canUseFbsReshipment, requireFbsReshipmentClientAccess } from '../src/modules/marketplace-connections/fbs-reshipment-access';

// TEST: isolated self-service policy, including accidentally broad mixed-role profiles.
describe('reshipment client access policy', () => {
  const client: AuthUser = { id: 'u', name: 'Client', email: 'unit@example.invalid', roleCodes: ['CLIENT'],
    permissionCodes: ['client-requests:write'], clientScopeMode: 'LIMITED', clientIds: ['c'], writableClientIds: ['c'] };
  it('permits only clients present in both explicit scopes', () => {
    expect(canUseFbsReshipment(client)).toBe(true);
    expect(() => requireFbsReshipmentClientAccess(client, 'c')).not.toThrow();
    expect(() => requireFbsReshipmentClientAccess(client, 'foreign')).toThrow();
  });
  it.each<Partial<AuthUser>>([
    { isDemo: true }, { permissionCodes: [] }, { permissionCodes: ['clients:write'] }, { permissionCodes: ['system:admin'] },
    { clientIds: [] }, { writableClientIds: [] }, { writableClientIds: ['other'] }, { hiddenClientIds: ['c'] },
    { roleCodes: ['MANAGER'] }, { roleCodes: [] },
  ])('denies incomplete or forbidden client capability %j', change => {
    const user = { ...client, ...change };
    expect(canUseFbsReshipment(user)).toBe(false);
    expect(() => requireFbsReshipmentClientAccess(user, 'c')).toThrow();
  });
  it.each(['ADMIN', 'OWNER'])('does not bypass CLIENT scope through mixed %s role/global permissions', role => {
    const user = { ...client, roleCodes: ['CLIENT', role], clientScopeMode: 'ALL' as const,
      permissionCodes: ['client-requests:write', 'system:admin'] };
    expect(() => requireFbsReshipmentClientAccess(user, 'c')).not.toThrow();
    expect(() => requireFbsReshipmentClientAccess(user, 'foreign')).toThrow();
  });
  it.each(['ADMIN', 'OWNER'])('preserves non-demo staff %s policy; ordinary scopes are still enforced by callers', role => {
    const user = { ...client, roleCodes: [role], permissionCodes: [], clientIds: [], writableClientIds: [] };
    expect(canUseFbsReshipment(user)).toBe(true);
    expect(() => requireFbsReshipmentClientAccess(user, 'c')).not.toThrow();
    expect(canUseFbsReshipment({ ...user, isDemo: true })).toBe(false);
  });
});
