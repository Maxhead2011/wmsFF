import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ClientStoresSettings} from './ClientStoresSettings';
const hooks=vi.hoisted(()=>({index:0,values:[] as unknown[]}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:()=>{},useState:(initial:unknown)=>[hooks.values[hooks.index++]??initial,vi.fn()]}));
function render(values:unknown[]){hooks.index=0;hooks.values=values;return renderToStaticMarkup(<ClientStoresSettings accessToken="test" clientId="c"/>);}
// TEST: one physical SKU can visibly belong to two shops, existing bindings cannot be removed casually.
describe('store settings',()=>{
 it('shows loading and permission failures',()=>{expect(render([])).toContain('Загружаю магазины');expect(render([null,[],'Нет доступа'])).toContain('role="alert"');});
 it('hides disabled installations',()=>{expect(render([null,[],'Магазины клиента не включены.'])).toBe('');});
 it('shows both permissions on the same selected product',()=>{
  const stores=[{id:'m',name:'Монларти',connectionIds:['mw']},{id:'b',name:'Брайбо',connectionIds:['bw']}];
  const directory={clientId:'c',stores,connections:[{id:'mw',marketplace:'WB',accountName:'Монларти',isActive:true},{id:'bw',marketplace:'WB',accountName:'Брайбо',isActive:true}]};
  const html=render([directory,stores,'','',false,'',[],{sku:{id:'s',name:'КостюмБомбер',size:'M'},original:['m','b'],ids:['m','b']}]);
  expect(html).toContain('КостюмБомбер');expect(html).toContain('Количество и КИЗы не дублируются');
  expect((html.match(/checked=""/g)||[]).length).toBe(4);
 });
});
