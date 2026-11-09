import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarehouseOpsPanel } from './WarehouseOpsPanel';
import type { AuthSession } from '../../lib/api';
const session = { accessToken: 'synthetic', user: { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: 'moscow' } } as AuthSession;
// TEST: the fabric entry is isolated to our installation.
describe('warehouse fabric entry', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  // TEST: direct access through a configured IP must expose the same entry.
  it('shows fabrics on an alternate configured installation address', () => {
    vi.stubEnv('VITE_OUR_WMS_HOSTS', 'wms.logoff.pro,192.0.2.10');
    vi.stubGlobal('window', { location: { hostname: '192.0.2.10' } });
    expect(renderToStaticMarkup(<WarehouseOpsPanel session={session} />)).toContain('warehouse-topic-tile--fabrics');
  });
  it('shows fabrics in our warehouse', () => {
    vi.stubGlobal('window', { location: { hostname: 'wms.logoff.pro' } });
    const html = renderToStaticMarkup(<WarehouseOpsPanel session={session} />);
    expect(html).toContain('Ткани: хранение и учёт');
    expect(html).toContain('warehouse-topic-tile--fabrics');
  });
  it('does not expose the new entry on sold installations', () => {
    vi.stubGlobal('window', { location: { hostname: 'sold.example' } });
    expect(renderToStaticMarkup(<WarehouseOpsPanel session={session} />)).not.toContain('warehouse-topic-tile--fabrics');
  });
});
