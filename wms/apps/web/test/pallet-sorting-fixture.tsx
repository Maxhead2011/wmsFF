import React from 'react';
import { createRoot } from 'react-dom/client';
import { PalletSortingPanel } from '../src/components/inventory/PalletSortingPanel';
// TEST: isolated entry, synthetic identity, no production authentication or data.
createRoot(document.getElementById('root')!).render(<PalletSortingPanel session={{ accessToken: 'qa-only', tokenType: 'Bearer', user: {
  id: 'qa-admin', email: 'qa@example.test', name: 'QA', roleCodes: ['ADMIN'], permissionCodes: ['stock:write'],
  activeWarehouseId: 'qa-warehouse', clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
} }} />);
