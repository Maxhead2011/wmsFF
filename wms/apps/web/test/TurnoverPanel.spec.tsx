import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthSession } from '../src/lib/api';
import { TurnoverPanel } from '../src/components/turnover/TurnoverPanel';
import { WarehouseOpsPanel } from '../src/components/warehouse/WarehouseOpsPanel';

const session: AuthSession = {
  accessToken: 'test-token',
  tokenType: 'Bearer',
  user: {
    id: 'admin-1',
    email: 'admin@example.test',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin', 'stock:read', 'stock:write', 'warehouse:read', 'warehouse:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  },
};

describe('storage workspace navigation', () => {
  // TEST: Storage accounting belongs to Turnover and must not be duplicated
  // in the warehouse operations picker.
  it('shows the storage tile in Turnover only', () => {
    const turnover = renderToStaticMarkup(<TurnoverPanel session={session} />);
    const warehouse = renderToStaticMarkup(<WarehouseOpsPanel session={session} />);

    expect(turnover).toContain('Литраж, тарифы и начисления за хранение.');
    expect(warehouse).not.toContain('Литраж, тарифы и начисления за хранение.');
  });
});
