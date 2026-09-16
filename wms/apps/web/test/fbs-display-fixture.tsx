import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthSession } from '../src/lib/api';
import { FbsPanel } from '../src/components/fbs/FbsPanel';
import '../src/styles.css';

// TEST: synthetic identity only. Browser script intercepts every API request.
const session: AuthSession = { accessToken: 'synthetic-qa-token', tokenType: 'Bearer', user: {
  id: 'qa', email: 'qa@example.test', name: 'Тестовый пользователь', roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
} };
createRoot(document.getElementById('root')!).render(<FbsPanel session={session} />);
