import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FbsManualAssemblyPanel } from '../src/components/service/FbsManualAssemblyPanel';
import '../src/styles.css';
import '../src/components/service/service-center.css';
// TEST: isolated browser fixture, synthetic identity and intercepted API only.
function Fixture() {
  const [warehouse, setWarehouse] = useState('moscow');
  return <main style={{ padding: 24 }}><button onClick={() => setWarehouse(w => w === 'moscow' ? 'other' : 'moscow')}>Сменить активный филиал</button>
    <FbsManualAssemblyPanel clientId="test-client" session={{ accessToken: 'qa-only', tokenType: 'Bearer', user: {
      id: 'test-owner', name: 'TEST', email: 'test@example.invalid', roleCodes: ['OWNER'], permissionCodes: ['system:admin'],
      activeWarehouseId: warehouse, clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
    } }}/></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
