import '../ozon-fbo/ozon-workspace.css';
import {OzonLinkImport} from './OzonLinkImport';
import {useEffect,useState,type ReactNode} from 'react';
import {fetchOzonCustomerWarehouses,type OzonCustomerWarehouse,ozonCustomerImportEnabled,previewOzonCustomerFile,createOzonCustomerFile,type AuthSession,type ClientSummary,type OzonCustomerPreview} from '../../lib/api';
// FIX: a single request is created from the complete customer allocation, never a filtered availability subset.
export function OzonCustomerImport({session,clients,onCreated,onWarehouseChange,fixedClientId,embedded=false,compact=false,toolbar}:{session:AuthSession;clients:ClientSummary[];onCreated:()=>void;onWarehouseChange?:(clientId:string,warehouseId:string)=>void;fixedClientId?:string;embedded?:boolean;compact?:boolean;toolbar?:ReactNode}) {
  const [enabled,setEnabled]=useState(false),[selectedClient,setClient]=useState(''),[destinationCity,setDestination]=useState(''),[desiredDate,setDate]=useState(''),[title,setTitle]=useState('');
  // FIX: keep the importer mounted so branch selection works with the composer closed.
  const [creating,setCreating]=useState(false),[method,setMethod]=useState<'link'|'file'>('link');
  const clientId=fixedClientId??selectedClient;
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<OzonCustomerPreview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;void ozonCustomerImportEnabled(session.accessToken).then(r=>{if(active)setEnabled(r.enabled);}).catch(()=>{});return()=>{active=false;};},[session.accessToken]);
  // FIX: stale client/branch responses cannot retain an earlier preview or selection.
  const [branches,setBranches]=useState<{clientId:string;rows:OzonCustomerWarehouse[];selected:string}>({clientId:'',rows:[],selected:''});
  const warehouseId=branches.clientId===clientId?branches.selected:'';
  useEffect(()=>{let live=true;setPreview(null);setMessage('');setBranches({clientId,rows:[],selected:''});
    onWarehouseChange?.(clientId,'');
    if(enabled&&clientId)void fetchOzonCustomerWarehouses(session.accessToken,clientId).then(rows=>{
      if(!live)return;const selected=rows.length===1?rows[0].id:'';setBranches({clientId,rows,selected});onWarehouseChange?.(clientId,selected);
      if(!rows.length)setMessage('У клиента нет активного филиала.');
    }).catch(e=>{if(live)setMessage(e instanceof Error?e.message:String(e));});
    return()=>{live=false;};
  },[enabled,clientId,session.accessToken]);
  if(!enabled)return null;
  const change=(fn:()=>void)=>{fn();setPreview(null);setMessage('');};
  async function run(commit:boolean){if(!file||!clientId||!warehouseId||!destinationCity)return;setBusy(true);setMessage('');try{
    const payload={file,clientId,warehouseId,destinationCity,title,desiredDate:desiredDate||undefined};
    if(commit){const r=await createOzonCustomerFile(session.accessToken,payload);setMessage(`Сборка №${r.request.number} ${r.existing?'уже существует':'создана'}. Все направления внутри одной заявки.`);setPreview(null);onCreated();}
    else setPreview(await previewOzonCustomerFile(session.accessToken,payload));
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const branchPicker=<label>Филиал<select disabled={busy} value={warehouseId} onChange={e=>{const selected=e.target.value;change(()=>setBranches(old=>({...old,selected})));onWarehouseChange?.(clientId,selected);}}>
      <option value="">Выберите филиал</option>{branches.clientId===clientId&&branches.rows.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
    </select></label>;
  return <div className={"ozfbo-customer-import"+(compact?" ozfbo-compact-import":"")}>
    {compact&&<div className="ozfbo-create-toolbar">{toolbar}{branchPicker}<button type="button" aria-expanded={creating} onClick={()=>setCreating(v=>!v)}>{creating?"Скрыть создание":"Создать сборку"}</button></div>}
    {compact&&creating&&<div className="ozfbo-create-methods" role="group" aria-label="Способ создания"><button type="button" aria-pressed={method==='link'} onClick={()=>setMethod('link')}>По ссылке Ozon</button><button type="button" aria-pressed={method==='file'} onClick={()=>setMethod('file')}>Из файла</button></div>}
    <details hidden={compact&&(!creating||method!=='file')} open={embedded||undefined} className="client-request-excel-collapse"><summary>ФБО Ozon — файл клиента по направлениям</summary>
    <fieldset className="ozfbo-import-fields" disabled={busy}>{!fixedClientId&&<label>Клиент<select value={clientId} onChange={e=>change(()=>setClient(e.target.value))}><option value="">Выберите клиента</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {!compact&&branchPicker}
    <label>Дата отгрузки<input type="date" value={desiredDate} onChange={e=>change(()=>setDate(e.target.value))}/></label>
    <label className="ozfbo-wide-field">Название общей сборки<input value={title} onChange={e=>change(()=>setTitle(e.target.value))}/></label>
    <label className="ozfbo-wide-field">Место общей отгрузки<input value={destinationCity} onChange={e=>change(()=>setDestination(e.target.value))}/></label>

    {/* FIX: download and upload belong to the same customer-file row. */}
    <div className="ozfbo-upload-row"><label>Файл клиента<input type="file" accept=".xlsx,.xls" onChange={e=>change(()=>setFile(e.target.files?.[0]??null))}/></label><a href="/downloads/ozon-fbo-template.xlsx" download="Шаблон-ФБО-Ozon.xlsx">Скачать шаблон</a></div>
    <p>Колонки: Направление / склад назначения Ozon · ШК · Поставка, шт · Артикул (необязательно). При кросс-докинге в файле указываются конечные направления, а выше — общая точка сдачи. Остальной товар остаётся на складе.</p>
    <button type="button" disabled={!file||!clientId||!warehouseId||!destinationCity.trim()} onClick={()=>void run(false)}>Проверить файл</button>
    {preview&&<><p>Одна сборка · {preview.directions.length} направлений · {preview.totalQuantity} шт.</p><ul>{preview.directions.map(d=><li key={d.name}>{d.name}: {d.items.reduce((s,i)=>s+i.quantity,0)} шт.</li>)}</ul><button type="button" onClick={()=>void run(true)}>Создать единую сборку</button></>}
    </fieldset>{message&&<p role="status">{message}</p>}</details><div hidden={compact&&(!creating||method!=='link')}><OzonLinkImport key={clientId+":"+warehouseId} session={session} clientId={clientId} clientName={clients.find(c=>c.id===clientId)?.name} warehouseId={warehouseId} onCreated={onCreated}/></div></div>;
}
