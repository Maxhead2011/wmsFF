import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FbsPanel, FbsStocksView, FbsHistoryOrdersView } from './FbsPanel';
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, stock: null as any }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
 useState(initial:any) { const i=h.cursor++; if(!(i in h.slots)){const v=typeof initial==='function'?initial():initial;h.slots[i]=v?.status==='loading'&&v?.data===null&&h.stock?{status:'ready',data:h.stock,error:''}:v;}return [h.slots[i],(v:any)=>h.slots[i]=typeof v==='function'?v(h.slots[i]):v]; },
 useMemo:(f:any)=>f(),useCallback:(f:any)=>f,useEffect:()=>{},useRef:(v:any)=>({current:v}) }));
vi.mock('../../lib/rememberedClient',()=>({useRememberedClientId:()=>['client',vi.fn()]}));
const session={accessToken:'test',user:{id:'user',clientIds:['client'],permissionCodes:[],roleCodes:['CLIENT']}} as any;
function nodes(n:any):any[]{if(!n||typeof n!=='object')return [];return Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
function text(n:any):string{if(Array.isArray(n))return n.map(text).join('');return typeof n==='object'?text(n?.props?.children??''):String(n??'');}
function panel(){h.cursor=0;return FbsPanel({session});}
function tabs(t:any){return nodes(t).filter(n=>n.type==='button'&&n.props.role==='tab');}
function stock(){h.cursor=0;return FbsStocksView({session,clientId:'client',search:''});}
beforeEach(()=>{h.slots=[];h.cursor=0;h.stock=null;vi.stubGlobal('React',React);vi.stubGlobal('window',{localStorage:{getItem:()=>null}});vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED','true');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
// TEST: the real menu must expose the merged sections rather than obsolete duplicate tiles.
it('groups WB stock and history tiles, removes cargo, and numbers remaining tiles consecutively',()=>{
 h.slots[0]='WILDBERRIES';const t=panel();const names=tabs(t).map(text);
 expect(names.some(n=>n.includes('Управление автоматическим распределением остатков'))).toBe(true);
 expect(names.some(n=>n.includes('Архив заявок'))).toBe(true);
 for(const old of ['Товары FBS','Распределение остатков','Короба WMS','Отменённые заказы'])expect(names.some(n=>n.includes(old))).toBe(false);
 const numbers=nodes(t).filter(n=>n.props?.className==='fbs-tile__number').map(n=>n.props.children);expect(numbers).toEqual(numbers.map((_,i)=>i+1));
});
it('preserves the old menu when the own-WMS flag is disabled',()=>{vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED','false');h.slots[0]='WILDBERRIES';const names=tabs(panel()).map(text);for(const name of ['Товары FBS','Распределение остатков','Короба WMS','Отменённые заказы'])expect(names.some(n=>n.includes(name))).toBe(true);});
it('keeps WB stock controls hidden for Ozon and Yandex but provides history',()=>{for(const marketplace of ['OZON','YANDEX_MARKET']){h.slots=[];h.slots[0]=marketplace;const names=tabs(panel()).map(text);expect(names.some(n=>n.includes('Управление автоматическим'))).toBe(false);expect(names.some(n=>n.includes('Архив заявок'))).toBe(true);}});
it('opens cancelled orders within the history tile without losing its active state',()=>{
 h.slots[0]='WILDBERRIES';h.slots[1]='cancelled';const t=panel();expect(tabs(t).find(n=>text(n).includes('Архив заявок'))?.props['aria-selected']).toBe(true);
 const cancelled=nodes(t).find(n=>n.type==='button'&&n.props['aria-pressed']===true&&text(n).startsWith('Отменённые заказы'));expect(cancelled).toBeDefined();
});
it('binds embedded allocation settings to the cabinet selected in the stock table',()=>{
 h.stock={connected:true,connections:[{id:'shop-2',accountName:'Second'}],selectedConnectionId:'shop-2',warehouses:[{id:'wh',name:'Warehouse'}],selectedWarehouseId:'wh',summary:{products:0,enabled:0,disabled:0,unmanaged:0,sellable:0,differences:0,excessProducts:0,shortages:0},items:[]};
 const section=nodes(stock()).find(n=>n.type?.name==='FbsStockAllocationSection');expect(section).toBeDefined();expect(section.props.connectionId).toBe('shop-2');expect(section.props.clientId).toBe('client');
});

// TEST: received orders keep their original read-only view; cancelled export remains separate.
it('retains both shipped and received records under shipped history',()=>{
 const t=FbsHistoryOrdersView({view:'shipped',data:{orders:[{category:'shipped'},{category:'archive'}]}} as any);
 expect(nodes(t).filter(n=>n.type?.name==='FbsOrdersView').map(n=>n.props.view)).toEqual(['shipped','archive']);
 const cancelled=FbsHistoryOrdersView({view:'cancelled',data:{orders:[]}} as any);expect(cancelled.props.view).toBe('cancelled');
 vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED','false');expect(FbsHistoryOrdersView({view:'archive'} as any).props.view).toBe('archive');
});
it('cost settings keep tariff editing restricted and calculator gated',()=>{
 h.slots[0]='WILDBERRIES';h.slots[1]='cost';let t=panel();expect(tabs(t).some(n=>text(n).includes('Настройки стоимости'))).toBe(true);
 expect(nodes(t).some(n=>n.type==='button'&&text(n)==='Назначение стоимости обработки')).toBe(false);
 expect(nodes(t).some(n=>n.type==='button'&&text(n)==='Калькулятор стоимости')).toBe(false);
 h.slots=[];h.slots[0]='WILDBERRIES';h.slots[1]='cost';h.cursor=0;t=FbsPanel({session:{...session,user:{...session.user,roleCodes:['ADMIN']}}});
 const calculator=nodes(t).find(n=>n.type==='button'&&text(n)==='Калькулятор стоимости');expect(calculator).toBeDefined();calculator.props.onClick();expect(h.slots[1]).toBe('calculator');
 expect(nodes(t).some(n=>n.type==='button'&&text(n)==='Назначение стоимости обработки')).toBe(true);
});
it('groups auto-cancellation and reshipment under problems and keeps the selected subview',()=>{
 h.slots[0]='WILDBERRIES';h.slots[1]='deadlines';let t=panel();expect(tabs(t).some(n=>text(n).includes('Проблемные заявки'))).toBe(true);
 const reship=nodes(t).find(n=>n.type==='button'&&text(n)==='Повторный довоз');expect(reship).toBeDefined();reship.props.onClick();
 t=panel();expect(tabs(t).find(n=>text(n).includes('Проблемные заявки'))?.props['aria-selected']).toBe(true);
 expect(nodes(t).some(n=>n.type?.name==='FbsReshipmentPanel')).toBe(true);
});
it('allocation rules are lazy and retain drafts when collapsed',async()=>{
 const {FbsStockAllocationSection}=await import('./FbsStockAllocationSection');const render=()=>{h.cursor=0;return FbsStockAllocationSection({session,clientId:'client',connectionId:'shop-2'});};
 let t=render();expect(nodes(t).some(n=>n.type?.name==='FbsStockAllocationView')).toBe(false);
 nodes(t).find(n=>n.type==='details').props.onToggle({currentTarget:{open:true}});t=render();expect(nodes(t).find(n=>n.type?.name==='FbsStockAllocationView')?.props.connectionId).toBe('shop-2');
 nodes(t).find(n=>n.type==='details').props.onToggle({currentTarget:{open:false}});expect(nodes(render()).some(n=>n.type?.name==='FbsStockAllocationView')).toBe(true);
});

// TEST: seven-tile layout keeps penalties reachable from problems with the existing WB scope.
it('groups penalties under problems and marks the seven-tile WB layout',()=>{
 h.slots[0]='WILDBERRIES';h.slots[1]='deadlines';let t=panel();expect(tabs(t)).toHaveLength(7);
 expect(nodes(t).find(n=>n.props?.className==='fbs-tiles')?.props['data-menu-layout']).toBe('seven');
 expect(tabs(t).some(n=>text(n).includes('Штрафы'))).toBe(false);
 const penalty=nodes(t).find(n=>n.type==='button'&&text(n)==='Штрафы по FBS');expect(penalty).toBeDefined();penalty.props.onClick();
 t=panel();expect(tabs(t).find(n=>text(n).includes('Проблемные заявки'))?.props['aria-selected']).toBe(true);
 expect(nodes(t).find(n=>n.type==='button'&&text(n)==='Штрафы по FBS')?.props['aria-pressed']).toBe(true);
});
it('keeps penalties WB-only and preserves the original layout with the flag off',()=>{
 for(const marketplace of ['OZON','YANDEX_MARKET']){h.slots=[];h.slots[0]=marketplace;h.slots[1]='deadlines';const t=panel();expect(nodes(t).some(n=>n.type==='button'&&text(n)==='Штрафы по FBS')).toBe(false);expect(nodes(t).find(n=>n.props?.className==='fbs-tiles')?.props['data-menu-layout']).toBeUndefined();}
 vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED','false');h.slots=[];h.slots[0]='WILDBERRIES';const t=panel();expect(tabs(t).some(n=>text(n).includes('Штрафы по FBS'))).toBe(true);expect(nodes(t).find(n=>n.props?.className==='fbs-tiles')?.props['data-menu-layout']).toBeUndefined();
});
// TEST: official local icons must preserve marketplace navigation.
it('uses local brand images and keeps each marketplace click target',()=>{
 vi.stubGlobal('window',{localStorage:{getItem:()=>null},history:{state:{},pushState:vi.fn()}});
 const t=panel();
 for(const [kind,file,market] of [['wb','wb.svg','WILDBERRIES'],['ozon','ozon.png','OZON'],['yandex','yandex-market.png','YANDEX_MARKET']]){
  const button=nodes(t).find(n=>n.type==='button'&&n.props.className===`fbs-marketplace-card fbs-marketplace-card--${kind}`);
  expect(button).toBeDefined();
  expect(nodes(button).find(n=>n.type==='img')?.props.src).toBe(`/brand/${file}`);
  button.props.onClick();expect(h.slots[0]).toBe(market);
 }
});
