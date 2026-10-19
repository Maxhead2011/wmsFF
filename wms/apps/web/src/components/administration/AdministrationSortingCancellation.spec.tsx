import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { AdministrationSortingCancellation, cancellationBlock } from './AdministrationSortingCancellation';
import { canOpenWorkspace } from '../../lib/workspaces';
const session = (role: string) => ({ accessToken: 'token', user: { id: 'u', roleCodes: [role], permissionCodes: [], activeWarehouseId: 'wh', administrationEnabled: false } }) as any;
afterEach(() => vi.unstubAllEnvs());
// TEST: scoped administrators see the button without needing owner administration access.
it.each(['ADMIN', 'OWNER'])('shows the administrative entry for %s', role => {
  vi.stubEnv('VITE_PALLET_SORTING_ENABLED', 'true');
  expect(renderToStaticMarkup(<AdministrationSortingCancellation session={session(role)} />)).toContain('Незавершённые сортировки');
  expect(canOpenWorkspace(session(role).user, { id: 'administration', requiresAdministrationAccess: true } as any)).toBe(true);
});
it.each(['OPERATOR', 'MANAGER', 'CLIENT'])('hides cancellation for %s', role => {
  vi.stubEnv('VITE_PALLET_SORTING_ENABLED', 'true');
  expect(renderToStaticMarkup(<AdministrationSortingCancellation session={session(role)} />)).toBe('');
});
it('hides the tool in disabled installations and demo accounts', () => {
  vi.stubEnv('VITE_PALLET_SORTING_ENABLED', 'false');
  expect(renderToStaticMarkup(<AdministrationSortingCancellation session={session('OWNER')} />)).toBe('');
  vi.stubEnv('VITE_PALLET_SORTING_ENABLED', 'true'); const s = session('OWNER'); s.user.isDemo = true;
  expect(renderToStaticMarkup(<AdministrationSortingCancellation session={s} />)).toBe('');
});
it('shows why sessions with actual operations cannot be cancelled', () => {
  const state: any = { moves: [], targets: [], pendingRoutes: [], sources: [{ archived: false }] };
  expect(cancellationBlock(state)).toBe('');
  for (const patch of [{ moves: [{}] }, { targets: [{}] }, { pendingRoutes: [{}] }, { activeTargetId: 'box' }, { sources: [{ archived: true }] }]) {
    expect(cancellationBlock({ ...state, ...patch })).toContain('Требуется отдельная проверка');
  }
});
