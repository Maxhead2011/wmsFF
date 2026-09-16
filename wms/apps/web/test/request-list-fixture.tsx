import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ClientRequestSummary } from '../src/lib/api';
import { ClientRequestsTable } from '../src/components/client-requests/ClientRequestsTable';
import '../src/styles.css';
import '../src/components/client-requests/client-requests.css';

// TEST: isolated display fixture; no credentials, APIs or real customer data.
const items: ClientRequestSummary[] = [999, 1000, 1001, 10000, 1000000].map((number, index) => ({
  id: `qa-${number}`, number, clientId: 'qa-client', type: 'OUTBOUND',
  status: index === 2 ? 'DONE' : 'IN_WORK', priority: 'NORMAL', title: `FBS тест ${number}`,
  comment: null, contactName: null, contactPhone: null, destinationCity: 'Тестовый склад',
  deliveryAddress: null, desiredDate: null, managerComment: null,
  createdAt: '2026-09-16T07:00:00Z', updatedAt: '2026-09-16T07:00:00Z',
  client: { id: 'qa-client', code: 'QA', name: 'Тестовый клиент' },
  createdBy: null, assignedTo: null, items: [], files: [], packages: [],
  wbSupplyIds: index === 0 ? [] : index === 3 ? ['WB-GI-123456789', 'WB-GI-987654321'] : [`WB-GI-${number}`],
}));
const noAction = () => {};
function Fixture() {
  const [opened, setOpened] = useState('');
  const readOnly = new URLSearchParams(location.search).get('role') === 'client';
  return <main className="client-requests-panel">
    <h1>Тестовый список заявок</h1><output aria-label="Открытая заявка">{opened}</output>
    <ClientRequestsTable items={items} canChangeStatus={!readOnly} canPickOutbound={!readOnly}
      canCancelRequests={!readOnly} canEditAnyRequest={!readOnly} canRefreshPickInstruction={false}
      onOpenDocument={request => setOpened(String(request.number))}
      onStatusChange={noAction} onCancelRequest={noAction} onEditRequest={noAction}
      onPickOutbound={noAction} onPackageOutbound={noAction} onShipOutbound={noAction} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
