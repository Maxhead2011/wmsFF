import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FbsReshipmentPanel } from '../src/components/fbs/FbsReshipmentPanel';
import '../src/styles.css';
// TEST: synthetic identity, isolated fixture, never uses production credentials.
function Fixture() {
  const [clientId, client] = useState('test-client');
  const [warehouse, branch] = useState('test-warehouse');
  const [account, user] = useState('test-admin');
  return <main><button onClick={() => client(value => `${value}-next`)}>Сменить клиента</button>
    <button onClick={() => branch(value => `${value}-next`)}>Сменить филиал</button>
    <button onClick={() => user(value => `${value}-next`)}>Сменить сотрудника</button>
    <FbsReshipmentPanel clientId={clientId} session={{ accessToken: `qa-only-${account}`, tokenType: 'Bearer', user: {
      id: account, email: 'qa@example.test', name: 'QA', roleCodes: ['ADMIN'], permissionCodes: [],
      activeWarehouseId: warehouse, clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
    } }} /></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
