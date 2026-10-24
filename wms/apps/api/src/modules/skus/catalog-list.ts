import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { productLinksEnabled,readProductLinks } from '../marketplace-connections/marketplace-product-links';
import { catalogReconciliationEnabled } from '../marketplace-connections/catalog-reconciliation';
export type CatalogQuery={sort:'updated'|'article'|'color'|'stock';direction:'asc'|'desc';inStock:boolean;correspondence:'all'|'linked'|'missing'|'unknown';page:number;pageSize:number};
export function parseCatalogQuery(raw:Record<string,string|undefined>):CatalogQuery{
 const choice=<T extends string>(key:string,values:T[],fallback:T):T=>{const v=raw[key]??fallback;if(!values.includes(v as T))throw new BadRequestException('Некорректный параметр: '+key);return v as T;};
 const integer=(key:string,fallback:number,max:number)=>{const v=raw[key]??String(fallback);if(!/^\d+$/.test(v)||Number(v)<1||!Number.isSafeInteger(Number(v))||Number(v)>max)throw new BadRequestException('Некорректный параметр: '+key);return Number(v);};
 return {sort:choice('sort',['updated','article','color','stock'],'updated'),direction:choice('direction',['asc','desc'],raw.sort&&raw.sort!=='updated'?'asc':'desc'),inStock:choice('inStock',['true','false'],'false')==='true',correspondence:choice('correspondence',['all','linked','missing','unknown'],'all'),page:integer('page',1,1000000),pageSize:integer('pageSize',100,200)};
}
type Row={id:string;name:string;article:string|null;color:string|null;updatedAt:Date;stockQuantity:number;correspondence:'linked'|'missing'|'unknown'};
// FIX: sort the complete authorized result before taking a page; zero is distinct from unknown links.
export function selectCatalogPage<T extends Row>(rows:T[],q:CatalogQuery){
 const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'}),sign=q.direction==='asc'?1:-1;
 const items=rows.filter(r=>(!q.inStock||r.stockQuantity>0)&&(q.correspondence==='all'||r.correspondence===q.correspondence));
 items.sort((a,b)=>{let cmp=0;if(q.sort==='stock')cmp=a.stockQuantity-b.stockQuantity;else if(q.sort==='updated')cmp=a.updatedAt.getTime()-b.updatedAt.getTime();else{const x=a[q.sort]?.trim()??'',y=b[q.sort]?.trim()??'';if(!x!==!y)return x?-1:1;cmp=collator.compare(x,y);}return sign*cmp||collator.compare(a.name,b.name)||a.id.localeCompare(b.id);});
 const total=items.length,page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
 return {items:items.slice((page-1)*q.pageSize,page*q.pageSize),total,page,pageSize:q.pageSize};
}
export async function readCatalogPage(db:Prisma.TransactionClient,where:Prisma.SkuWhereInput,warehouseId:string|null,q:CatalogQuery){
 const [skus,balances]=await Promise.all([
  db.sku.findMany({where,select:{id:true,clientId:true,name:true,article:true,color:true,updatedAt:true}}),
  db.stockBalance.groupBy({by:['skuId'],where:{sku:where,...(warehouseId?{warehouseId}:{}),status:{not:'IN_TRANSIT'}},_sum:{quantity:true}}),
 ]);
 const quantities=new Map(balances.map(b=>[b.skuId,b._sum.quantity??0]));
 const states=new Map<string,Row['correspondence']>();
 await Promise.all([...new Set(skus.map(s=>s.clientId))].map(async clientId=>{
  const operational=productLinksEnabled(clientId),enabled=operational||await catalogReconciliationEnabled(db,clientId);
  const markets=new Map<string,Set<string>>();
  if(operational){const [links,accounts]=await Promise.all([readProductLinks(db,clientId),db.clientMarketplaceConnection.findMany({where:{clientId,isActive:true},select:{id:true}})]);const ids=new Set(accounts.map(c=>c.id));for(const link of links){if(link.status!=='LINKED'||!link.skuId||!ids.has(link.connectionId))continue;const set=markets.get(link.skuId)??new Set<string>();set.add(link.marketplace);markets.set(link.skuId,set);}}
  for(const sku of skus.filter(s=>s.clientId===clientId)){const m=markets.get(sku.id);states.set(sku.id,!enabled?'unknown':m?.has('WILDBERRIES')&&m.has('OZON')?'linked':'missing');}
 }));
 return selectCatalogPage(skus.map(s=>({...s,stockQuantity:Math.max(0,quantities.get(s.id)??0),correspondence:states.get(s.id)!})),q);
}
