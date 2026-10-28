import { afterEach, expect, it, vi } from 'vitest';
import { connected, visibleMarket, workspaceClients } from './marketplaceWorkspace';
import type { AuthSession, ClientSummary } from './api';
afterEach(()=>vi.unstubAllEnvs());
const ozon = {id:'o',marketplaceConnections:[{marketplace:'OZON',isActive:false}]} as ClientSummary;
const wb = {id:'w',marketplaceConnections:[{marketplace:'WILDBERRIES',isActive:true}]} as ClientSummary;
// TEST: clients from unrelated marketplaces cannot appear in the operational selector.
it('filters persisted connections while retaining disabled accounts',()=>{
 vi.stubEnv('VITE_MARKETPLACE_WORKSPACES_ENABLED','true');
 expect(workspaceClients([ozon,wb], 'OZON')).toEqual([ozon]);
 expect(connected(ozon,'OZON')).toBe(true);
});
it('keeps all staff tiles and only connected customer tiles',()=>{
 vi.stubEnv('VITE_MARKETPLACE_WORKSPACES_ENABLED','true');
 const session={user:{roleCodes:['CLIENT'],permissionCodes:[]}} as unknown as AuthSession;
 expect(visibleMarket(session,[ozon],'OZON')).toBe(true);
 expect(visibleMarket(session,[ozon],'WILDBERRIES')).toBe(false);
 expect(visibleMarket({...session,user:{...session.user,roleCodes:['WORKER']}},[],'LAMODA')).toBe(true);
});
it('respects Lamoda modes and leaves sold deployment unchanged',()=>{
 const c={lamodaAccounts:[{isActive:true,fboEnabled:true,fbsEnabled:false}]} as ClientSummary;
 expect(connected(c,'LAMODA','fbo')).toBe(true);
 expect(connected(c,'LAMODA','fbs')).toBe(false);
 vi.stubEnv('VITE_MARKETPLACE_WORKSPACES_ENABLED','false');
 expect(workspaceClients([ozon,wb],'OZON')).toEqual([ozon,wb]);
});
