import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import ts from 'typescript';

// TEST: execute the real panel handler, including confirmation/error/print sequencing.
function fixture(){
 const source=readFileSync(process.env.OZON_PRINT_TEST_SOURCE || new URL('./FbsPanel.tsx',import.meta.url),'utf8');
 const start=source.indexOf('  async function downloadSelectedOrderStickers(');
 const end=source.indexOf('  async function downloadSelectedSupplyStickers(',start);
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const deps:any={selectedClientId:'client',session:{accessToken:'token'},
  setOrderAction:vi.fn(),setRowActionKey:vi.fn(),setOrderActionMessage:vi.fn(),setOrderActionError:vi.fn(),
  fbsOrderSelectionKey:(o:any)=>o.id,window:{confirm:vi.fn().mockReturnValue(true)},
  prepareOzonFbsLabels:vi.fn().mockResolvedValue({prepared:1}),assembleFbsOrders:vi.fn().mockRejectedValue(Error('TSD required')),
  downloadFbsAllLabels:vi.fn().mockResolvedValue({warnings:[],pageCount:2}),openWbRibbonPrint:vi.fn().mockResolvedValue(undefined)};
 const handler=new Function(...Object.keys(deps),code+'; return downloadSelectedOrderStickers;')(...Object.values(deps));
 const pending={id:'posting',connectionId:'connection',marketplace:'OZON',supplierStatus:'awaiting_packaging'};
 return {deps,handler,pending};
}
describe('Ozon print before picking',()=>{
 it('preserves the verified assembly path for orders requiring mandatory marking',async()=>{
  const f=fixture();const selected=[{connectionId:'connection',id:'posting'}];
  f.deps.prepareOzonFbsLabels.mockResolvedValue({prepared:0,requiresPhysicalSubmission:selected});
  f.deps.assembleFbsOrders.mockResolvedValue({submitted:1});await f.handler([f.pending],'print');
  expect(f.deps.assembleFbsOrders).toHaveBeenCalledWith('token',{clientId:'client',orders:selected});expect(f.deps.openWbRibbonPrint).toHaveBeenCalled();
 });
 it('prepares stickers without invoking the physical assembly endpoint',async()=>{
  const f=fixture();await f.handler([f.pending],'print');
  expect(f.deps.prepareOzonFbsLabels).toHaveBeenCalledWith('token',{clientId:'client',orders:[{connectionId:'connection',id:'posting'}]});
  expect(f.deps.assembleFbsOrders).not.toHaveBeenCalled();expect(f.deps.openWbRibbonPrint).toHaveBeenCalled();
  expect(f.deps.prepareOzonFbsLabels.mock.invocationCallOrder[0]).toBeLessThan(f.deps.downloadFbsAllLabels.mock.invocationCallOrder[0]);
 });
 it('cancels before any mutation or label request',async()=>{
  const f=fixture();f.deps.window.confirm.mockReturnValue(false);await f.handler([f.pending],'print');
  expect(f.deps.prepareOzonFbsLabels).not.toHaveBeenCalled();expect(f.deps.downloadFbsAllLabels).not.toHaveBeenCalled();
 });
 it('shows a preparation error without printing a partial result',async()=>{
  const f=fixture();f.deps.prepareOzonFbsLabels.mockRejectedValue(Error('Ozon unavailable'));await f.handler([f.pending],'print');
  expect(f.deps.setOrderActionError).toHaveBeenCalledWith('Ozon unavailable');expect(f.deps.downloadFbsAllLabels).not.toHaveBeenCalled();
 });
 it('reprints a ready Ozon order without submitting it again',async()=>{
  const f=fixture();await f.handler([{...f.pending,supplierStatus:'awaiting_deliver'}],'print');
  expect(f.deps.prepareOzonFbsLabels).not.toHaveBeenCalled();expect(f.deps.openWbRibbonPrint).toHaveBeenCalled();
 });
 it('preserves WB printing without an Ozon mutation',async()=>{
  const f=fixture();await f.handler([{...f.pending,marketplace:'WILDBERRIES',supplierStatus:'confirm'}],'print');
  expect(f.deps.prepareOzonFbsLabels).not.toHaveBeenCalled();expect(f.deps.openWbRibbonPrint).toHaveBeenCalled();
 });
});
