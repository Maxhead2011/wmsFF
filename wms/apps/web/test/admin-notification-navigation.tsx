import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WarehouseOpsPanel} from '../src/components/warehouse/WarehouseOpsPanel';
import {resolveAdminNotificationTarget,type WarehouseNotificationTarget} from '../src/lib/adminNotificationTarget';
import '../src/styles.css';
const session:any={accessToken:'test-token',user:{id:'owner',activeWarehouseId:'warehouse',permissionCodes:['system:admin','stock:write'],roleCodes:['OWNER'],clientScopeMode:'ALL'}};
function Fixture(){const [target,setTarget]=useState<WarehouseNotificationTarget|null>(null);return <><button onClick={()=>{const t=resolveAdminNotificationTarget({id:1,type:'MISSING_PALLET_BOX',title:'Нет короба',body:'Сборщик · [FBS_MISSING_PALLET_BOX] Короб: FFL_LKB0409_315; паллетсорт: PALET_SORT_102',clientId:'client',warehouseId:'warehouse',createdAt:'',isRead:false,sessionId:'signal'});if(t.workspace==='warehouse')setTarget({...t,nonce:Date.now()});}}>Открыть сигнал</button><WarehouseOpsPanel session={session} notificationTarget={target}/></>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
