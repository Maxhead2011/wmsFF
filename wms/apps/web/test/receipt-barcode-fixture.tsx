import React from 'react';
import {createRoot} from 'react-dom/client';
import {AdministrationPanel} from '../src/components/administration/AdministrationPanel';
import '../src/styles.css';
// TEST: synthetic identity with intercepted API.
createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><AdministrationPanel onOpenWorkspace={()=>{}} session={{accessToken:'barcode-test-only',tokenType:'Bearer',user:{id:'admin',email:'admin@example.test',name:'Администратор',roleCodes:['ADMIN'],permissionCodes:['stock:write'],administrationEnabled:false,clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'moscow'}}}/></main>);
