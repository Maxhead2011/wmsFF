import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { WarehouseOpsPanel } from './WarehouseOpsPanel';
import { GoodsArrivalPanel } from './GoodsArrivalPanel';
import { ShipmentHistoryPanel } from './ShipmentHistoryPanel';
import { canOpenWorkspace, workspaceNav } from '../../lib/workspaces';
const session:any={accessToken:'test',user:{id:'client',roleCodes:['CLIENT'],permissionCodes:['stock:read'],clientIds:['own']}};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
// TEST: clients get exactly the requested four warehouse entries, without stock mutation authority.
it('opens four scoped warehouse topics for a client',()=>{
 vi.stubEnv('VITE_CLIENT_WAREHOUSE_ENABLED','true');vi.stubGlobal('window',{location:{hostname:'wms.logoff.pro'}});
 expect(canOpenWorkspace(session.user,workspaceNav.find(i=>i.id==='warehouse')!)).toBe(true);
 const html=renderToStaticMarkup(createElement(WarehouseOpsPanel,{session}));
 for(const title of ['Онлайн-приёмка','Приход товара','Приёмки','Отгруженные КИЗ'])expect(html).toContain(title);
 for(const title of ['Волны сборки','Перемещения и сборка','Проверка коробов','Черновики приёмки'])expect(html).not.toContain(title);
});
it('does not expose mutation controls in client arrivals and shipment history',()=>{
 const arrivals=renderToStaticMarkup(createElement(GoodsArrivalPanel,{session}));
 expect(arrivals).not.toContain('Записать приход');expect(arrivals).not.toContain('Сформировать счет ППР');
 const history=renderToStaticMarkup(createElement(ShipmentHistoryPanel,{session}));expect(history).not.toContain('Обновить историю');expect(history).toContain('Показать');
});
it('preserves sold installation and explicit visibility restrictions',()=>{
 vi.stubEnv('VITE_CLIENT_WAREHOUSE_ENABLED','false');expect(canOpenWorkspace(session.user,workspaceNav.find(i=>i.id==='warehouse')!)).toBe(false);
 vi.stubEnv('VITE_CLIENT_WAREHOUSE_ENABLED','true');expect(canOpenWorkspace({...session.user,workspaceVisibility:{warehouse:false}},workspaceNav.find(i=>i.id==='warehouse')!)).toBe(false);
});
