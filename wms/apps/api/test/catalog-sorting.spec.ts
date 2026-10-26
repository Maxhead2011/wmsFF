import { describe,it,expect } from 'vitest';
import { selectCatalogPage,parseCatalogQuery } from '../src/modules/skus/catalog-list';
// TEST: sorting and filters run before pagination, with unknown linkage separate from missing.
describe('catalog sorting',()=>{
 const rows=Array.from({length:105},(_,i)=>({id:String(i),article:'A'+i,color:i%2?'Синий':'Белый',name:'Item',updatedAt:new Date(i),stockQuantity:i===104?8:0,correspondence:(i===104?'linked':i===103?'unknown':'missing') as 'linked'|'missing'|'unknown'}));
 it('finds stock beyond the old first 100 rows',()=>{const r=selectCatalogPage(rows,parseCatalogQuery({sort:'stock',direction:'desc',inStock:'true'}));expect(r.items.map(x=>x.id)).toEqual(['104']);});
 it('sorts article numbers naturally in both directions',()=>{expect(selectCatalogPage(rows,parseCatalogQuery({sort:'article'})).items.slice(0,3).map(r=>r.article)).toEqual(['A0','A1','A2']);expect(selectCatalogPage(rows,parseCatalogQuery({sort:'article',direction:'desc'})).items[0].article).toBe('A104');});
 it('sorts colors and keeps missing values last',()=>{const r=selectCatalogPage([...rows,{...rows[0],id:'blank',color:null}],parseCatalogQuery({sort:'color',direction:'desc',pageSize:'200'}));expect(r.items[0].color).toBe('Синий');expect(r.items.at(-1)?.id).toBe('blank');});
 it('distinguishes confirmed, missing and unknown correspondence',()=>{for(const key of ['linked','missing','unknown'])expect(selectCatalogPage(rows,parseCatalogQuery({correspondence:key,pageSize:'200'})).items.every(r=>r.correspondence===key)).toBe(true);});
 it('clamps page after filtering and rejects invalid query values',()=>{expect(selectCatalogPage(rows,parseCatalogQuery({page:'99',inStock:'true'})).page).toBe(1);expect(()=>parseCatalogQuery({sort:'sql'})).toThrow();expect(()=>parseCatalogQuery({page:'-1'})).toThrow();});
});
