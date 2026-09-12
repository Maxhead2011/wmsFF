import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccessAdminPanel } from '../src/components/access/AccessAdminPanel';
import '../src/styles.css';
// TEST: isolated UI with a synthetic identity and intercepted API requests.
createRoot(document.getElementById('root')!).render(<main style={{ padding: 24 }}><AccessAdminPanel session={{
  accessToken: 'user-deletion-test-only', tokenType: 'Bearer', user: {
    id: 'actor', email: 'actor@example.test', name: 'Администратор', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL', clientIds: [], writableClientIds: [], activeWarehouseId: 'moscow',
  },
}} /></main>);
