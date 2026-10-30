import {useEffect, useRef, useState} from 'react';
import {fetchClientStores, saveClientStores, fetchSkuStores, saveSkuStores, fetchSkus,
  type ClientStoreDirectory, type ClientStoreSummary, type SkuSummary} from '../../lib/api';

// FIX: store configuration changes metadata only; one SKU may serve several shops.
export function ClientStoresSettings({accessToken, clientId}: {accessToken:string;clientId:string}) {
  const [directory,setDirectory]=useState<ClientStoreDirectory|null>(null);
  const [stores,setStores]=useState<ClientStoreSummary[]>([]);
  const [error,setError]=useState(''); const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false); const [search,setSearch]=useState('');
  const [products,setProducts]=useState<SkuSummary[]>([]);
  const [selected,setSelected]=useState<{sku:SkuSummary;original:string[];ids:string[]}|null>(null);
  const generation=useRef(0);
  useEffect(()=>{
    let active=true;
    fetchClientStores(accessToken,clientId).then(data=>{if(active){setDirectory(data);setStores(data.stores);}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Не удалось загрузить магазины.');});
    return()=>{active=false;generation.current++;};
  },[accessToken,clientId]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('');setMessage('');
    try {await action();} catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить.');}
    finally{setBusy(false);}
  }
  async function find() {
    const current=++generation.current;setSelected(null);
    await run(async()=>{const rows=await fetchSkus(accessToken,{clientId,search:search.trim()});if(current===generation.current)setProducts(rows);});
  }
  async function choose(sku:SkuSummary) {
    const current=++generation.current;setSelected(null);
    await run(async()=>{const result=await fetchSkuStores(accessToken,clientId,sku.id);
      if(current===generation.current)setSelected({sku,original:result.storeIds,ids:result.storeIds});});
  }
  const occupied=new Set(stores.flatMap(s=>s.connectionIds));
  if(error.includes('Магазины клиента не включены'))return null;
  return <section style={{padding:20,margin:'16px 0',border:'1px solid var(--line)',borderRadius:12}} aria-label="Магазины клиента">
    <h3>Магазины одного плательщика</h3>
    <p>У каждого магазина свои подключения WB и Ozon. Общий товар остаётся на одном складском остатке.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!directory?<p>Загружаю магазины…</p>:<>
      <fieldset disabled={busy}><legend>Подключения магазинов</legend>
      {stores.map((store,index)=><div key={index} style={{padding:12,borderBottom:'1px solid var(--line)'}}>
        <label>Код магазина <input aria-label={`Код магазина ${index+1}`} value={store.id}
          disabled={Boolean(directory.stores[index])} placeholder="monlarti"
          onChange={e=>setStores(rows=>rows.map((s,i)=>i===index?{...s,id:e.target.value}:s))}/></label>
        <label>Название <input aria-label={`Название магазина ${index+1}`} value={store.name} placeholder="Монларти"
          onChange={e=>setStores(rows=>rows.map((s,i)=>i===index?{...s,name:e.target.value}:s))}/></label>
        {!directory.stores[index]&&<button type="button" onClick={()=>setStores(rows=>rows.filter((_,i)=>i!==index))}>Убрать несохранённый магазин</button>}
        <div>{directory.connections.map(connection=>{
          const checked=store.connectionIds.includes(connection.id);
          const established=directory.stores.some(s=>s.connectionIds.includes(connection.id));
          return <label key={connection.id} style={{display:'block',marginTop:8}}><input type="checkbox" checked={checked}
            disabled={established||(!checked&&occupied.has(connection.id))}
            onChange={e=>setStores(rows=>rows.map((s,i)=>i===index?{...s,connectionIds:e.target.checked?[...s.connectionIds,connection.id]:s.connectionIds.filter(id=>id!==connection.id)}:s))}/>
            {connection.marketplace} · {connection.accountName||connection.id}{!connection.isActive?' · неактивно':''}</label>;
        })}</div>
      </div>)}
      <button type="button" onClick={()=>setStores(rows=>[...rows,{id:'',name:'',connectionIds:[]}])}>Добавить магазин</button>
      <button type="button" disabled={!stores.length} onClick={()=>void run(async()=>{
        await saveClientStores(accessToken,clientId,stores);
        const data=await fetchClientStores(accessToken,clientId);setDirectory(data);setStores(data.stores);setMessage('Магазины сохранены.');
      })}>Сохранить магазины</button>
      </fieldset>
      {directory.stores.length>0&&<fieldset disabled={busy}><legend>Товары магазинов</legend>
        <label>Артикул или ШК <input value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <button type="button" disabled={!search.trim()} onClick={()=>void find()}>Найти товар</button>
        <ul>{products.map(sku=><li key={sku.id}><button type="button" onClick={()=>void choose(sku)}>
          {sku.name} · {sku.article} · {sku.size} · {sku.barcodes.map(b=>b.value).join(', ')}
        </button></li>)}</ul>
        {selected&&<div><h4>{selected.sku.name} · {selected.sku.size}</h4>
          <p>Отметьте оба магазина, если это один общий физический товар. Количество и КИЗы не дублируются.</p>
          {directory.stores.map(store=><label key={store.id} style={{display:'block'}}><input type="checkbox"
            checked={selected.ids.includes(store.id)} disabled={selected.original.includes(store.id)}
            onChange={e=>setSelected(row=>row?{...row,ids:e.target.checked?[...row.ids,store.id]:row.ids.filter(id=>id!==store.id)}:null)}/>{store.name}</label>)}
          <button type="button" disabled={!selected.ids.length} onClick={()=>void run(async()=>{
            const saved=await saveSkuStores(accessToken,clientId,selected.sku.id,selected.ids,selected.original);
            setSelected({...selected,ids:saved.storeIds,original:saved.storeIds});setMessage('Разрешения товара сохранены. Остаток не изменён.');
          })}>Сохранить разрешения товара</button>
        </div>}
      </fieldset>}
    </>}
  </section>;
}
