import 'reflect-metadata';
import {expect,it} from 'vitest';
import {Reflector} from '@nestjs/core';
import {LamodaController} from '../src/modules/lamoda/lamoda.controller';
import {PermissionsGuard} from '../src/modules/auth/guards/permissions.guard';
// TEST: route decorators allow request users to plan without granting credential management.
it('allows customer planning routes and keeps API management routes restricted',()=>{
 const guard=new PermissionsGuard(new Reflector());
 const check=(name:string,permissions:string[])=>guard.canActivate({getHandler:()=>LamodaController.prototype[name],getClass:()=>LamodaController,switchToHttp:()=>({getRequest:()=>({user:{roleCodes:['CLIENT'],permissionCodes:permissions},method:'POST',url:'/lamoda'})})} as never);
 for(const name of ['accounts','overview','warehouses','template'])expect(check(name,['client-requests:read'])).toBe(true);
 for(const name of ['importPlan','availability','fromShipment','assembly']){expect(check(name,['client-requests:read','client-requests:write'])).toBe(true);expect(()=>check(name,['client-requests:read'])).toThrow();}
 for(const name of ['create','update','check','sync','link'])expect(()=>check(name,['client-requests:read','client-requests:write'])).toThrow();
});
