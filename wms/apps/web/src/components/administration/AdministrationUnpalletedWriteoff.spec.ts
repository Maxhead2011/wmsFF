import { describe, expect, it } from 'vitest';
import type { AuthSession } from '../../lib/api';
import { visibleTechnicalWorkSections } from './AdministrationTechnicalWork';
import {
  canUseUnpalletedWriteoff,
  UNPALLETED_WRITEOFF_BATCH_SIZE,
} from './AdministrationUnpalletedWriteoff';

function session(permissionCodes: string[], roleCodes: string[], isDemo = false): AuthSession {
  return {
    accessToken: 'test-token',
    tokenType: 'Bearer',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test',
      isDemo,
      roleCodes,
      permissionCodes,
      clientScopeMode: 'LIMITED',
      clientIds: [],
      writableClientIds: [],
    },
  };
}

describe('ADMIN-only unpalleted write-off access', () => {
  // TEST: a client must never see the destructive action, even with ordinary stock permissions.
  it('скрывает действие от клиента', () => {
    const clientSession = session(['stock:read', 'stock:write'], ['CLIENT']);
    expect(canUseUnpalletedWriteoff(clientSession)).toBe(false);
    expect(visibleTechnicalWorkSections(clientSession).map((section) => section.id))
      .not.toContain('UNPALLETED_WRITEOFF');
    expect(canUseUnpalletedWriteoff(session(['system:admin'], ['CLIENT']))).toBe(false);
  });

  // TEST: administration:demo is intentionally insufficient for destructive stock changes.
  it('скрывает действие от демо-администратора', () => {
    expect(canUseUnpalletedWriteoff(session(['administration:demo'], ['ADMIN'], true))).toBe(false);
  });

  // TEST: only a real system administrator gets the control.
  it('показывает действие системному администратору', () => {
    const adminSession = session(['system:admin'], ['ADMIN']);
    expect(canUseUnpalletedWriteoff(adminSession)).toBe(true);
    expect(visibleTechnicalWorkSections(adminSession).map((section) => section.id))
      .toContain('UNPALLETED_WRITEOFF');
  });

  // TEST: the operator can submit the full server-approved batch in one run.
  it('отправляет до 25 коробов за одну партию', () => {
    expect(UNPALLETED_WRITEOFF_BATCH_SIZE).toBe(25);
  });
});
