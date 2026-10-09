import {useEffect,useState} from 'react';
import {ozonCustomerImportEnabled,previewOzonCustomerFile,createOzonCustomerFile,type AuthSession,type ClientSummary,type OzonCustomerPreview} from '../../lib/api';
// FIX: a single request is created from the complete customer allocation, never a filtered availability subset.
export function OzonCustomerImport({session,clients,onCreated}:{session:AuthSession;clients:ClientSummary[];onCreated:()=>void}) {
  const [enabled,setEnabled]=useState(false),[clientId,setClient]=useState(''),[destinationCity,setDestination]=useState(''),[desiredDate,setDate]=useState(''),[title,setTitle]=useState('');
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<OzonCustomerPreview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;void ozonCustomerImportEnabled(session.accessToken).then(r=>{if(active)setEnabled(r.enabled);}).catch(()=>{});return()=>{active=false;};},[session.accessToken]);
  if(!enabled)return null;
  const change=(fn:()=>void)=>{fn();setPreview(null);setMessage('');};
  async function run(commit:boolean){if(!file||!clientId||!destinationCity)return;setBusy(true);setMessage('');try{
    const payload={file,clientId,destinationCity,title,desiredDate:desiredDate||undefined};
    if(commit){const r=await createOzonCustomerFile(session.accessToken,payload);setMessage(`Сборка №${r.request.number} ${r.existing?'уже существует':'создана'}. Все направления внутри одной заявки.`);setPreview(null);onCreated();}
    else setPreview(await previewOzonCustomerFile(session.accessToken,payload));
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <details className="client-request-excel-collapse"><summary>ФБО Ozon — файл клиента по направлениям</summary>
    <fieldset disabled={busy}><label>Клиент<select value={clientId} onChange={e=>change(()=>setClient(e.target.value))}><option value="">Выберите клиента</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Название общей сборки<input value={title} onChange={e=>change(()=>setTitle(e.target.value))}/></label>
    <label>Место общей отгрузки<input value={destinationCity} onChange={e=>change(()=>setDestination(e.target.value))}/></label>
    <label>Дата отгрузки<input type="date" value={desiredDate} onChange={e=>change(()=>setDate(e.target.value))}/></label>
    <label>Файл клиента<input type="file" accept=".xlsx,.xls" onChange={e=>change(()=>setFile(e.target.files?.[0]??null))}/></label>
    <p>Колонки: Склад хранения · Артикул · ШК · Поставка, шт. Количества берутся из файла. Остальной товар остаётся на складе.</p>
    <button type="button" disabled={!file||!clientId||!destinationCity.trim()} onClick={()=>void run(false)}>Проверить файл</button>
    {preview&&<><p>Одна сборка · {preview.directions.length} направлений · {preview.totalQuantity} шт.</p><ul>{preview.directions.map(d=><li key={d.name}>{d.name}: {d.items.reduce((s,i)=>s+i.quantity,0)} шт.</li>)}</ul><button type="button" onClick={()=>void run(true)}>Создать единую сборку</button></>}
    </fieldset>{message&&<p role="status">{message}</p>}</details>;
}
