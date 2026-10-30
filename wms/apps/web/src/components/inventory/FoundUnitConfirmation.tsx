import { useState } from 'react';
import { confirmInventoryFoundUnit } from '../../lib/api';

// FIX: an explicit per-unit decision; this never approves the whole box silently.
export function FoundUnitConfirmation({accessToken,boxId,onChanged}:{accessToken:string;boxId:string;onChanged:()=>Promise<unknown>}) {
  const [kiz,setKiz]=useState(''); const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  return <details className="inventory-found-unit"><summary>Подтвердить найденную единицу</summary>
    <p>Для КИЗа, найденного при пересчёте, когда его исходный короб пуст. Система проверит сканы, резервы и историю отгрузок. Количество повторно не добавляется.</p>
    <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage('');try {
      await confirmInventoryFoundUnit(accessToken,boxId,kiz,reason,confirmed);
      setKiz('');setReason('');setConfirmed(false);setMessage('Привязка подтверждена. Можно продолжить актуализацию короба.');await onChanged();
    }catch(error){setMessage(error instanceof Error?error.message:'Не удалось подтвердить единицу.');}finally{setBusy(false);}}}>
      <label className="inventory-field">КИЗ найденного товара<input value={kiz} onChange={e=>setKiz(e.target.value)} maxLength={512} required disabled={busy}/></label>
      <label className="inventory-field">Причина подтверждения<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1000} required disabled={busy}/></label>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>Подтверждаю физическое наличие этой единицы в проверяемом коробе</label>
      <button type="submit" className="primary-button" disabled={busy||!confirmed||!kiz.trim()||reason.trim().length<10}>{busy?'Проверяю…':'Подтвердить найденную единицу'}</button>
      {message&&<p role="status">{message}</p>}
    </form>
  </details>;
}
