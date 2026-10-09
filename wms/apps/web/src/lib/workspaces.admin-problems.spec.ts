import {afterEach, expect, it, vi} from 'vitest';
import {canOpenWorkspace, workspaceNav} from './workspaces';
import {canUseOperationalProblems} from '../components/administration/OperationalProblemsPanel';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AdministrationPanel} from '../components/administration/AdministrationPanel';
const menu=workspaceNav.find(x=>x.id==='administration')!;
const user={roleCodes:['ADMIN'],permissionCodes:['stock:write'],administrationEnabled:false,workspaceVisibility:{administration:false}} as any;
afterEach(()=>vi.unstubAllEnvs());
// TEST: ADMIN sees the operational entries without owner-only configuration.
it.each(['ADMIN','OWNER'])('offers receiving and FBO problems to %s',role=>{
 vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','true');
 const session={accessToken:'token',user:{...user,roleCodes:[role]}} as any;
 expect(canOpenWorkspace(session.user,menu)).toBe(true);
 const html=renderToStaticMarkup(createElement(AdministrationPanel,{session,onOpenWorkspace:()=>{}}));
 expect(html).toContain('Проблемы приёмки');expect(html).toContain('Проблемы ФБО');
 expect(html).not.toContain('Настройки системы');expect(html).not.toContain('Видимость разделов');
});
it.each([{isDemo:true},{roleCodes:['WORKER']},{roleCodes:['CLIENT']},{permissionCodes:[]}])('keeps scope restrictions %j',override=>{
 vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','true');expect(canOpenWorkspace({...user,...override},menu)).toBe(false);
});
it('does not change sold WMS menus',()=>{
 vi.stubEnv('VITE_ADMIN_PROBLEMS_ENABLED','false');expect(canOpenWorkspace(user,menu)).toBe(false);
});
it('does not offer operational actions to demo or worker',()=>{
 expect(canUseOperationalProblems({user:{...user,isDemo:true}} as any)).toBe(false);
 expect(canUseOperationalProblems({user:{...user,roleCodes:['WORKER']}} as any)).toBe(false);
});
