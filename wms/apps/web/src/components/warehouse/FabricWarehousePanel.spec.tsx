import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarehouseOpsPanel } from './WarehouseOpsPanel';
import type { AuthSession } from '../../lib/api';
const session = { accessToken: 'synthetic', user: { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: 'moscow' } } as AuthSession;
// TEST: the fabric entry is isolated to our installation.
describe('warehouse fabric entry', () => {
  afterEach(() => vi.unstubAllGlobals());
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
