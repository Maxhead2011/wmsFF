import { useEffect, useRef, useState } from 'react';
import { fetchProductLinks, enableCatalogReconciliation, type MarketplaceConnectionSummary, type ProductLinkRow } from '../../lib/api';
import { auditLinks, linksForSku } from './marketplaceOverview';

export type CatalogLink=ProductLinkRow & {account:string;connectionId:string};
const label=(marketplace:string)=>marketplace==='WILDBERRIES'?'WB':marketplace==='OZON'?'Ozon':marketplace;
// FIX: discard stale client responses and never show a failed/partial audit as success.
export function useCatalogMarketplaceOverview(token:string,clientId:string,connections:MarketplaceConnectionSummary[]){
 const [state,setState]=useState<{key:string;rows:CatalogLink[];error:string;busy:boolean;checked:boolean;disabled:number}>({key:'',rows:[],error:'',busy:false,checked:false,disabled:0});
 const [revision,setRevision]=useState(0);const checked=useRef(false);
 const key=JSON.stringify([token,clientId,connections.map(c=>[c.id,c.marketplace,c.accountName])]);
 const currentKey=useRef(key);currentKey.current=key;
 useEffect(()=>{let active=true;const runCheck=checked.current;checked.current=false;
  setState({key,rows:[],error:'',busy:true,checked:false,disabled:0});
  const eligible=connections.filter(c=>c.clientId===clientId&&['WILDBERRIES','OZON'].includes(c.marketplace));
  if(!clientId||!eligible.length){setState({key,rows:[],error:'',busy:false,checked:false,disabled:0});return;}
  void Promise.all(eligible.map(async c=>{const data=await fetchProductLinks(token,c.id);return {enabled:data.enabled,rows:data.items.map(r=>({...r,account:c.accountName||c.id,connectionId:c.id}))};})).then(results=>{
   if(active)setState({key,rows:results.flatMap(r=>r.rows),error:'',busy:false,checked:runCheck,disabled:results.filter(r=>!r.enabled).length});
  }).catch(e=>{if(active)setState({key,rows:[],error:e instanceof Error?e.message:'Не удалось загрузить связи',busy:false,checked:false,disabled:0});});
  return()=>{active=false;};
 },[key,revision]);
 const current=state.key===key?state:{key,rows:[],error:'',busy:true,checked:false,disabled:0};
 async function enable(){
  const connection=connections.find(c=>c.clientId===clientId&&['WILDBERRIES','OZON'].includes(c.marketplace));if(!connection)return;
  const started=key;setState(s=>({...s,busy:true,error:''}));
  try{await enableCatalogReconciliation(token,connection.id);if(currentKey.current===started){checked.current=true;setRevision(r=>r+1);}}
  catch(e){if(currentKey.current===started)setState(s=>({...s,busy:false,error:e instanceof Error?e.message:'Не удалось включить сверку'}));}
 }
 return {...current,issues:current.checked?auditLinks(current.rows):[],enable,check:()=>{checked.current=true;setRevision(r=>r+1);}};
}
export function CatalogMarketplaceCell({rows,skuId}:{rows:CatalogLink[];skuId:string}){
 const links=linksForSku(rows,skuId);
 return <>{links.map(r=><div key={r.connectionId+':'+r.id} style={{marginBottom:8}}><strong>{label(r.marketplace)} · {r.account}</strong><span style={{display:"block"}}>Артикул: {r.offerId||'—'} · ID: {r.productId}</span><span style={{display:"block"}}>ШК: {r.barcodes?.length?r.barcodes.join(', '):'нет данных'}</span></div>)}</>;
}
