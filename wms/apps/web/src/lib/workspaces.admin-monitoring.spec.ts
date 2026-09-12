import { afterEach, describe, expect, it, vi } from 'vitest';
import { canOpenWorkspace, workspaceNav } from './workspaces';
import type { AuthUser } from './api';
afterEach(() => vi.unstubAllEnvs());
const monitoring = workspaceNav.find(item => item.id === 'monitoring')!;
const admin = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], administrationEnabled: false, workspaceVisibility: { monitoring: false } } as unknown as AuthUser;
describe('ADMIN monitoring menu', () => {
  it('shows the real menu for ADMIN even with a stale individual visibility setting', () => {
    // TEST: reproduces the hidden menu using the actual navigation definition.
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    expect(canOpenWorkspace(admin, monitoring)).toBe(true);
  });
  it.each([undefined, 'false'])('preserves sold installation visibility with flag %s', flag => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', flag);
    expect(canOpenWorkspace(admin, monitoring)).toBe(false);
  });
  it.each([{ isDemo: true }, { roleCodes: ['MANAGER'] }, { permissionCodes: [] }])('keeps normal restrictions for %j', override => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    expect(canOpenWorkspace({ ...admin, ...override }, monitoring)).toBe(false);
  });
  it('does not grant the administration workspace', () => {
    // TEST: opening monitoring must not promote ADMIN to owner.
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    expect(canOpenWorkspace(admin, workspaceNav.find(item => item.id === 'administration')!)).toBe(false);
  });
});
