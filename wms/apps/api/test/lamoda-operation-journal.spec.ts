import { expect, it, vi } from 'vitest';
import { LamodaOperationJournal } from '../src/modules/lamoda/lamoda-operation-journal';
// TEST: replay, changed payload and simultaneous callers cannot send a shipment twice.
function fixture() {
 let row:any; const store:any={
  upsert:vi.fn(async({create}:any)=>row??(row={...create})),
  updateMany:vi.fn(async({where,data}:any)=>{if(row.status!==where.status)return {count:0};Object.assign(row,data);return {count:1};}),
 };
 return {store,journal:new LamodaOperationJournal(store),row:()=>row};
}
it('replays success without a second external request',async()=>{
 const {journal}=fixture(),send=vi.fn(async()=>({id:'shipment'}));
 await journal.run('account','key',{quantity:1},send);
 expect(await journal.run('account','key',{quantity:1},send)).toMatchObject({status:'SUCCEEDED'});
 expect(send).toHaveBeenCalledTimes(1);
});
it('rejects changed input under the same key',async()=>{
 const {journal}=fixture(); await journal.run('a','k',{quantity:1},async()=>({}));
 await expect(journal.run('a','k',{quantity:2},async()=>({}))).rejects.toThrow('PAYLOAD_CHANGED');
});
it('only one simultaneous caller owns the send',async()=>{
 const {journal}=fixture(),send=vi.fn(async()=>({}));
 await Promise.allSettled([journal.run('a','k',{},send),journal.run('a','k',{},send)]);
 expect(send).toHaveBeenCalledTimes(1);
});
it('keeps ambiguous errors blocked across a new journal instance',async()=>{
 const {store,journal}=fixture(),send=vi.fn(async()=>{throw new Error('timeout')});
 await expect(journal.run('a','k',{},send)).rejects.toThrow('UNKNOWN_RESULT');
 await expect(new LamodaOperationJournal(store).run('a','k',{},send)).rejects.toThrow('RECONCILIATION_REQUIRED');
 expect(send).toHaveBeenCalledTimes(1);
});
it('does not retry after losing the database acknowledgement',async()=>{
 const {store,journal}=fixture(),send=vi.fn(async()=>({}));
 store.updateMany.mockImplementationOnce(async({data}:any)=>{Object.assign((await store.upsert({create:{}})),data);return {count:1}}).mockRejectedValueOnce(new Error('database unavailable'));
 await expect(journal.run('a','k',{},send)).rejects.toThrow();
 await expect(journal.run('a','k',{},send)).rejects.toThrow('RECONCILIATION_REQUIRED');
 expect(send).toHaveBeenCalledTimes(1);
});
