import { useEffect, useRef, useState } from 'react';
import { createFbsRepeatAssembly, fetchFbsRepeatCapabilities, lookupFbsOriginalSticker, type AuthSession } from '../../lib/api';
type Preview=Awaited<ReturnType<typeof lookupFbsOriginalSticker>>;
// FIX: preview and explicit confirmation bind one order/attempt to its old sticker.
export function FbsOriginalStickerPanel({session,clientId}:{session:AuthSession;clientId:string}) {
 const [enabled,setEnabled]=useState(false),[order,setOrder]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null),[created,setCreated]=useState<{id:string;number:number}|null>(null);
 const [pvzEnabled,setPvzEnabled]=useState(false),[pvz,setPvz]=useState(false),[reason,setReason]=useState('');
 const alive=useRef(true),working=useRef(false);
 useEffect(()=>{alive.current=true;fetchFbsRepeatCapabilities(session.accessToken).then(x=>{if(alive.current){setEnabled(x.originalStickerEnabled===true);setPvzEnabled(x.pvzLossSettlementEnabled===true);}}).catch(()=>{if(alive.current)setError('Не удалось проверить доступ.');});return()=>{alive.current=false;};},[session.accessToken]);
 async function check(){if(working.current)return;working.current=true;setBusy(true);setError('');setPreview(null);setCreated(null);setConfirmed(false);try{const result=await lookupFbsOriginalSticker(session.accessToken,clientId,order.trim(),pvz,reason.trim());if(alive.current)setPreview(result);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Не удалось проверить заказ.');}finally{working.current=false;if(alive.current)setBusy(false);}}
 async function create(){if(!preview||!confirmed||working.current)return;working.current=true;setBusy(true);setError('');try{const result=await createFbsRepeatAssembly(session.accessToken,{...preview.selection,preserveOriginalSticker:true,previewToken:preview.previewToken,confirmAdditionalStockConsumption:true});if(alive.current){setCreated(result.request);setPreview(null);setConfirmed(false);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Заявка не создана.');}finally{working.current=false;if(alive.current)setBusy(false);}}
 return <section className="surface-card" aria-label="Повторная сборка со старым стикером" style={{padding:20}}>
  <h3>Повторная сборка со старым стикером</h3>
  <p>Новая единица со склада по прежнему заказу WB. Заявка получит высокий приоритет. Товар и новый КИЗ списываются при фактической сборке; первая отгрузка остаётся в истории.</p>
  {!enabled&&<p role="status">Функция недоступна или ещё не включена для этой WMS.</p>}
  {pvzEnabled&&<div><label><input type="checkbox" checked={pvz} disabled={busy} onChange={e=>{setPvz(e.target.checked);setPreview(null);setCreated(null);setConfirmed(false);}}/>Довоз для урегулирования потерь ПВЗ</label>{pvz&&<label>Основание довоза<input value={reason} maxLength={1000} disabled={busy} onChange={e=>{setReason(e.target.value);setPreview(null);setConfirmed(false);}}/></label>}{pvz&&<p>Допускаются отменённые заказы с подтверждённой прежней отгрузкой. Статусы и КИЗ в WB не меняются.</p>}</div>}
  <label>Номер прежнего заказа WB<input inputMode="numeric" value={order} disabled={busy} onChange={e=>{setOrder(e.target.value);setPreview(null);setCreated(null);setConfirmed(false);}} placeholder="Например, 6049802274"/></label>
  <button className="button-secondary" disabled={!enabled||!clientId||!/^\d{1,20}$/.test(order.trim())||busy||(pvz&&!reason.trim())} onClick={()=>void check()}>{busy?'Проверяем…':'Найти заказ и проверить'}</button>
  {!clientId&&<p>Выберите клиента вверху раздела.</p>}{error&&<p role="alert">{error}</p>}
  {preview&&<div aria-label="Проверенный заказ">{preview.orders.map(row=><div key={row.assemblyId}><p><strong>Заказ {row.id} · {row.productName}</strong><br/>{row.article} · исходная заявка №{row.sourceRequestNumber}</p><p>Прежний стикер: <strong>{row.originalStickerNumber}</strong><br/>Отбор: {row.boxCode ? `${row.boxCode} · ${row.palletCode||'Без паллет-сорта'}` : 'Нет свободного остатка — заявка будет ждать точный товар'}</p></div>)}
   <p>Новая сборка: 1 шт. Приоритет: высокий. Стикер останется прежним.</p>
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Подтверждаю отбор другой единицы и дополнительное списание товара с новым КИЗ</label>
   <button className="button-primary" disabled={!confirmed||busy} onClick={()=>void create()}>Создать приоритетное задание ФБС</button>
  </div>}
  {created&&<p role="status">Создана заявка №{created.number}. Высокий приоритет. Для печати закреплён прежний стикер.</p>}
 </section>;
}
