import {describe,it,expect} from 'vitest';
import {canOpenWorkspace,workspaceNav} from './workspaces';
import type {AuthUser} from './api';
const user={roleCodes:['CLIENT'],permissionCodes:[],analyticsEnabled:false} as unknown as AuthUser;
const analytics=workspaceNav.find(w=>w.id==='analytics')!;
// TEST: warehouse analytics is independent of the WB subscription, preserving sold/default and explicit visibility.
describe('fulfillment analytics navigation',()=>{
 it('opens for an opted-in client without WB analytics',()=>expect(canOpenWorkspace({...user,fulfillmentAnalyticsEnabled:true},analytics)).toBe(true));
 it('preserves the WB-only behavior when the installation flag is absent',()=>{expect(canOpenWorkspace(user,analytics)).toBe(false);expect(canOpenWorkspace({...user,analyticsEnabled:true},analytics)).toBe(true);});
 it('honors a hidden analytics menu',()=>expect(canOpenWorkspace({...user,fulfillmentAnalyticsEnabled:true,workspaceVisibility:{analytics:false}},analytics)).toBe(false));
});
