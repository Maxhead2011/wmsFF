import React from 'react';
import {createRoot} from 'react-dom/client';
import {OzonCustomerImport} from '../src/components/client-requests/OzonCustomerImport';
import '../src/styles.css';
// TEST: source UI with intercepted APIs; no real orders, stock or external writes.
createRoot(document.getElementById('root')!).render(<OzonCustomerImport embedded session={{accessToken:'synthetic',user:{id:'u'}} as any} clients={[{id:'c',name:'Клиент А'},{id:'other',name:'Клиент Б'}] as any} onCreated={()=>{}}/>);
