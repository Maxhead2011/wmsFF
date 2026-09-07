import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { PalletSortingPanel } from './PalletSortingPanel';
import { canOpenWorkspace, workspaceNav } from '../../lib/workspaces';

afterEach(() => vi.unstubAllEnvs());
it('provides an ADMIN-only sorting entry without changing other workspace permissions', () => {
  // TEST: OWNER plus system:admin must not bypass the explicitly requested role.
  vi.stubEnv('VITE_PALLET_SORTING_ENABLED', 'true');
  const item = workspaceNav.find(w => w.id === 'pallet-sorting');
  expect(item).toBeDefined();
  const user: any = { roleCodes: ['OWNER'], permissionCodes: ['system:admin'] };
  expect(canOpenWorkspace(user, item!)).toBe(false);
  expect(canOpenWorkspace({ ...user, roleCodes: ['ADMIN'] }, item!)).toBe(true);
});
it('renders the source scan prompt and refuses the screen for non-admins', () => {
  // TEST: direct rendering does not expose administrative controls to a collector.
  const session: any = { accessToken: 'test', user: { id: 'admin', roleCodes: ['ADMIN'], activeWarehouseId: 'wh' } };
  expect(renderToStaticMarkup(<PalletSortingPanel session={session} />)).toContain('Паллет-сорт или короб');
  expect(renderToStaticMarkup(<PalletSortingPanel session={{ ...session, user: { roleCodes: ['OPERATOR'] } }} />)).not.toContain('Начать сортировку');
});
