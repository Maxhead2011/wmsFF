import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {checkMarketBatch,MarketStatusBatch} from './MarketStatusBatch';
import {useRequestBatch} from './RequestBatchControls';

it('places one global check next to the unchecked batch selection, including an empty filtered table',()=>{
  function Panel(){return useRequestBatch({items:[],enabled:true,token:'test',fetchSelection:vi.fn(),updateStatus:vi.fn(),
    reload:vi.fn(),marketControl:busy=><MarketStatusBatch token="test" reload={vi.fn()} disabled={busy} onBusy={vi.fn()}/>}).controls;}
  const html=renderToStaticMarkup(<Panel/>);
  expect(html.match(/Проверить статусы всех заявок/g)).toHaveLength(1);
  expect(html.indexOf('Выбрать несколько заявок для сдачи')).toBeLessThan(html.indexOf('Проверить статусы всех заявок'));
});
// TEST: an unbound supply does not prevent later requests from being checked.
it('keeps individual successes and errors and checks remaining requests',async()=>{
  const check=vi.fn().mockResolvedValueOnce({status:'DONE',message:'WB',checkedAt:''})
    .mockRejectedValueOnce(new Error('Привяжите поставку')).mockResolvedValueOnce({status:'PACKED',message:'Ozon',checkedAt:''});
  const targets=['1','2','3'].map(id=>({id,number:Number(id)}));
  const results=await checkMarketBatch(targets,check,vi.fn(),()=>true);
  expect(results.map(r=>r.kind)).toEqual(['done','error','pending']);
  expect(check.mock.calls.map(c=>c[0])).toEqual(['1','2','3']);
});
