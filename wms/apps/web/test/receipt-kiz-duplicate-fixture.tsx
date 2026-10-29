import React from 'react';
import { createRoot } from 'react-dom/client';
import { OnlineReceiptPanel } from '../src/components/warehouse/OnlineReceiptPanel';
import '../src/styles.css';
// TEST: the real panel and API client use synthetic, intercepted data only.
createRoot(document.getElementById('root')!).render(<OnlineReceiptPanel fixedClientId="client" session={{ accessToken: 'synthetic-test-token', user: { id: 'test-admin', roleCodes: ['ADMIN'], permissionCodes: ['warehouse:write', 'stock:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] } } as any} />);
