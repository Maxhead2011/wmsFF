import React from 'react';
import {createRoot} from 'react-dom/client';
import {OzonCustomerWorkspace} from '../src/components/ozon-fbo/OzonCustomerWorkspace';
import '../src/styles.css';
// TEST: production workspace with synthetic accounts and intercepted API, no live writes.
const readOnly=new URLSearchParams(location.search).has('readonly');
createRoot(document.getElementById('root')!).render(<OzonCustomerWorkspace session={{accessToken:'synthetic',user:{id:'u',roleCodes:['ADMIN'],permissionCodes:readOnly?[]:['system:admin'],activeWarehouseId:'w'}} as any}/>);
