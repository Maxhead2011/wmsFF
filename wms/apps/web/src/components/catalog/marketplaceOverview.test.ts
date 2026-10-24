import { describe, expect, it } from 'vitest';
import { auditLinks, linksForSku } from './marketplaceOverview';

// TEST: a warehouse product must retain both marketplace identities and their own barcodes.
const row = (id:string, marketplace:string, barcodes:string[], extra:object={}) => ({id,marketplace,barcodes,skuId:'sku',status:'LINKED',size:'50',color:'серый',sku:{id:'sku',name:'Товар',article:'a',size:'50',color:'серый',barcodes:[{value:'001'}]},...extra});
describe('marketplace overview',()=>{
 it('shows both marketplaces without replacing their barcode identities',()=>{
  const rows=[row('wb','WILDBERRIES',['001']),row('oz','OZON',['002'])];
  expect(linksForSku(rows,'sku').map(x=>x.barcodes)).toEqual([['001'],['002']]);
  expect(auditLinks(rows).some(x=>x.message.includes('ШК'))).toBe(true);
 });
 it('does not match different products by article or barcode',()=>{
  expect(linksForSku([row('foreign','OZON',['001'],{skuId:'other'})],'sku')).toEqual([]);
 });
 it('flags one barcode linked to different warehouse products without merging them',()=>{
  expect(auditLinks([row('wb','WILDBERRIES',['001']),row('oz','OZON',['001'],{skuId:'other'})])).toHaveLength(2);
 });
 it('reports mismatched variants and unresolved links',()=>{
  const result=auditLinks([row('bad','OZON',['001'],{size:'52'}),row('review','WILDBERRIES',['001'],{status:'REVIEW',skuId:null})]);
  expect(result).toHaveLength(2);
 });
 it('does not treat missing API fields as success',()=>{
  expect(auditLinks([row('old','OZON',undefined as unknown as string[])])).toHaveLength(1);
 });
 it('does not mark different marketplace barcodes as an automatic merge',()=>{
  const rows=[row('wb','WILDBERRIES',['001']),row('oz','OZON',['002'])];const before=JSON.stringify(rows);
  auditLinks(rows);expect(JSON.stringify(rows)).toBe(before);
 });
 it('accepts exact linked variants and preserves leading zeros',()=>{
  expect(auditLinks([row('wb','WILDBERRIES',['001']),row('oz','OZON',['001'])])).toEqual([]);
  expect(auditLinks([row('wb','WILDBERRIES',['1'])])).toHaveLength(1);
 });
});
