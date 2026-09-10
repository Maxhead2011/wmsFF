import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FbsReshipmentPanel } from '../src/components/fbs/FbsReshipmentPanel';
import '../src/styles.css';
// TEST: synthetic identity, isolated fixture, never uses production credentials.
function Fixture() {
  const [clientId, client] = useState('test-client');
  const [warehouse, branch] = useState('test-warehouse');
  const [account, user] = useState('test-admin');
  const isClient = new URLSearchParams(location.search).get('role') === 'CLIENT';
  const [canWrite, setCanWrite] = useState(true);
  return <main><button onClick={() => client(value => `${value}-next`)}>Сменить клиента</button>
    <button onClick={() => branch(value => `${value}-next`)}>Сменить филиал</button>
    <button onClick={() => user(value => `${value}-next`)}>Сменить сотрудника</button>
    <button onClick={() => setCanWrite(value => !value)}>Переключить право заявок</button>
    <FbsReshipmentPanel clientId={clientId} session={{ accessToken: `qa-only-${account}`, tokenType: 'Bearer', user: {
      id: account, email: 'qa@example.test', name: 'QA', roleCodes: [isClient ? 'CLIENT' : 'ADMIN'],
      permissionCodes: canWrite ? ['client-requests:write'] : [],
      activeWarehouseId: warehouse, clientScopeMode: isClient ? 'LIMITED' : 'ALL',
      clientIds: ['test-client'], writableClientIds: ['test-client'],
    } }} /></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
