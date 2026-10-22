import 'reflect-metadata';
import { expect,it,vi } from 'vitest';
import { ReceiptChannelsController } from '../src/modules/warehouse/receipt-channels.controller';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
// TEST: a client manager reaches the normal preview transaction, without admin escalation.
it('accepts an explicit receipt branch for a client manager',async()=>{
 vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');
 const db:any={systemSetting:{findUnique:vi.fn(async()=>({value:{enabled:true,userId:'u',clientId:'c'}})),findMany:vi.fn(async()=>[{value:{warehouseId:'w'}}])},$transaction:vi.fn(async()=>({available:1}))};
 const user:any={id:'u',roleCodes:['CLIENT'],permissionCodes:[],writableClientIds:['c'],clientIds:['c'],clientScopeMode:'LIMITED'};
 const controller=new ReceiptChannelsController(db,new ClientScopeService(),{} as any);
 try {await expect(controller.preview(user,{id:'a'.repeat(32),clientId:'c',warehouseId:'w',fbs:false,fbo:true,revision:0})).resolves.toEqual({available:1});expect(db.$transaction).toHaveBeenCalledOnce();}finally{vi.unstubAllEnvs();}
});

// TEST: changing directions cannot escape the existing client/branch scope.
it.each(['read-only','foreign-client','foreign-branch'])('rejects %s before entering a write transaction',async scenario=>{
 vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');vi.stubEnv('WMS_RECEIPT_APPROVAL_ENABLED','true');
 const db:any={systemSetting:{findMany:vi.fn(async()=>[{value:{warehouseId:'w'}}])},$transaction:vi.fn()};
 const user:any={id:'u',roleCodes:['CLIENT'],permissionCodes:[],writableClientIds:scenario==='read-only'?[]:['c'],clientIds:['c'],clientScopeMode:'LIMITED'};
 const controller=new ReceiptChannelsController(db,new ClientScopeService(),{} as any);
 try {await expect(controller.save(user,{id:'a'.repeat(32),clientId:scenario==='foreign-client'?'other':'c',warehouseId:scenario==='foreign-branch'?'other':'w',fbs:false,fbo:true,revision:0})).rejects.toThrow();expect(db.$transaction).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
