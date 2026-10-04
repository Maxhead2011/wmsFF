import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { BillingPanel } from './BillingPanel';
import * as api from '../../lib/api';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => unknown)[], deps: [] as any[], effectCursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: any) => { const n=hooks.cursor++; if (!(n in hooks.values)) hooks.values[n]=typeof initial==='function'?initial():initial; return [hooks.values[n],(next:any)=>{hooks.values[n]=typeof next==='function'?next(hooks.values[n]):next;}]; },
  useRef: (initial:any) => {const n=hooks.cursor++; return hooks.values[n] ?? (hooks.values[n]={current:initial});},
  useEffect: (fn:()=>unknown,deps:any[]) => {const n=hooks.effectCursor++;if(!hooks.deps[n]||deps.some((d,i)=>d!==hooks.deps[n][i])){hooks.deps[n]=deps;hooks.effects.push(fn);}},
}));
vi.mock('../../lib/rememberedClient',()=>({useRememberedClientId:()=>['',vi.fn()],validRememberedClientId:(id:string)=>id}));
vi.mock('../../lib/api',async()=>({...await vi.importActual<typeof api>('../../lib/api'),
  fetchBillingInvoices:vi.fn(),fetchBillingCharges:vi.fn(),fetchBillingServices:vi.fn(),fetchClients:vi.fn(),fetchClientRequests:vi.fn(),fetchBillingReconciliation:vi.fn(),
}));
const session:any={accessToken:'test',user:{id:'test',permissionCodes:['billing:read','billing:write']}};
function render(){hooks.cursor=0;hooks.effectCursor=0;return BillingPanel({session});}
async function flush(){for(const fn of hooks.effects.splice(0))fn();for(let n=0;n<8;n++)await Promise.resolve();}
function nodes(node:any):any[]{return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
beforeEach(()=>{
 hooks.values=[];hooks.deps=[];hooks.effects=[];vi.clearAllMocks();
 vi.stubGlobal('window',{location:{hostname:'wms.logoff.pro'}});
 for(const key of ['fetchBillingInvoices','fetchBillingCharges','fetchBillingServices','fetchClients','fetchClientRequests'] as const)vi.mocked(api[key]).mockResolvedValue([] as any);
 vi.mocked(api.fetchBillingReconciliation).mockResolvedValue({} as any);
});
afterEach(()=>vi.unstubAllGlobals());
// TEST: invoices must not start unrelated heavy requests or duplicate the registry on mount.
it('opens invoices without charges, requests or reconciliation and requests the registry once',async()=>{
 render();await flush();render();await flush();
 expect(api.fetchBillingCharges).not.toHaveBeenCalled();expect(api.fetchClientRequests).not.toHaveBeenCalled();expect(api.fetchBillingReconciliation).not.toHaveBeenCalled();
 expect(vi.mocked(api.fetchBillingInvoices).mock.calls.filter(call=>call[1]!==undefined)).toHaveLength(1);
});
// TEST: opening the FBO registry must not invoke legacy loaders that initialize service defaults.
it('does not reload legacy clients, services or invoices for the FBO composition form',async()=>{
 render();await flush();vi.clearAllMocks();
 nodes(render()).find(n=>n.type==='button'&&n.props.children==='Первоначальная обработка').props.onClick();
 render();await flush();
 expect(api.fetchBillingServices).not.toHaveBeenCalled();expect(api.fetchClients).not.toHaveBeenCalled();expect(api.fetchBillingInvoices).not.toHaveBeenCalled();
});
it('loads heavy data when its tab is selected',async()=>{
 render();await flush();const tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='Обзор').props.onClick();render();await flush();
 expect(api.fetchBillingCharges).toHaveBeenCalledTimes(1);expect(api.fetchBillingReconciliation).toHaveBeenCalledTimes(1);expect(api.fetchClientRequests).not.toHaveBeenCalled();
});
it('does not hold client controls behind slow invoices',async()=>{
 vi.mocked(api.fetchBillingInvoices).mockReturnValue(new Promise(()=>{}));render();await flush();
 expect(hooks.values[5].status).toBe('ready');
});
it('preserves the sold host load path',async()=>{
 vi.stubGlobal('window',{location:{hostname:'sold.example'}});render();await flush();
 expect(api.fetchBillingCharges).toHaveBeenCalled();expect(api.fetchClientRequests).toHaveBeenCalled();expect(api.fetchBillingReconciliation).toHaveBeenCalled();
});
// TEST: deferred request data must still be available to manual charge creation.
it('loads requests only for the creation form',async()=>{
 render();await flush();nodes(render()).find(n=>n.type==='button'&&n.props.children==='Создать счет').props.onClick();render();await flush();
 expect(api.fetchClientRequests).toHaveBeenCalledTimes(1);expect(api.fetchBillingCharges).not.toHaveBeenCalled();
});
it('isolates failed resources without hiding clients or the registry',async()=>{
 vi.mocked(api.fetchBillingServices).mockRejectedValue(new Error('services unavailable'));render();await flush();
 expect(hooks.values[4].status).toBe('error');expect(hooks.values[5].status).toBe('ready');expect(hooks.values[2].status).toBe('ready');
});
it('ignores an obsolete response after changing tabs',async()=>{
 let finish!:(data:any)=>void;
 vi.mocked(api.fetchClients).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 render();await flush();nodes(render()).find(n=>n.type==='button'&&n.props.children==='Обзор').props.onClick();render();await flush();
 finish([{id:'obsolete'}]);await flush();expect(hooks.values[5].data).toEqual([]);
});
