import './src/styles.css';
import React from 'react';import{createRoot}from'react-dom/client';import{FboWorkspace}from'./src/components/client-requests/FboWorkspace';
createRoot(document.getElementById('root')!).render(<FboWorkspace session={{accessToken:'fixture',tokenType:'Bearer',user:{id:'test',name:'Тест',email:'test@example.invalid',roleCodes:['OWNER'],permissionCodes:['system:admin'],clientIds:[],writableClientIds:[],clientScopeMode:'ALL'}}}/>);
