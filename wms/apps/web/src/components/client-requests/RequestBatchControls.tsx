import { useRef, useState } from 'react';
import type { ClientRequestSummary, fetchClientRequestManualBoxSelection, updateClientRequestStatus } from '../../lib/api';
import { batchDonePayload, canBatchComplete, needsManualStockClose, runRequestBatch } from './requestBatch';

type Props = {
  marketControl?: (busy:boolean)=>import('react').ReactNode; checkingMarkets?: boolean;
  items: ClientRequestSummary[]; enabled: boolean; token: string;
  fetchSelection: typeof fetchClientRequestManualBoxSelection;
  updateStatus: typeof updateClientRequestStatus;
  reload: () => Promise<unknown>;
};
// FIX: this controller is theme-independent and uses the existing status endpoint.
export function useRequestBatch({ marketControl, checkingMarkets=false, items, enabled, token, fetchSelection, updateStatus, reload }: Props) {
  const [mode,setMode]=useState(false),[selected,setSelected]=useState<Set<string>>(()=>new Set());
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[boxes,setBoxes]=useState('1');
  const [results,setResults]=useState<Array<{id:string;number:number;ok:boolean;error?:string}>>([]),[error,setError]=useState('');
  const lock=useRef(false);
  const chosen=items.filter(r=>selected.has(r.id)&&canBatchComplete(r));
  async function submit() {
    if(checkingMarkets || lock.current || !enabled || !mode || !chosen.length)return;
    const count=Number(boxes);
    if(!Number.isInteger(count)||count<1){setError('Укажите целое число коробов, не меньше одного.');return;}
    lock.current=true;setBusy(true);setError('');setResults([]);
    try {
      const outcome=await runRequestBatch(chosen,async request=>{
        const selection=needsManualStockClose(request)?await fetchSelection(token,request.id):null;
        await updateStatus(token,request.id,batchDonePayload(request,count,selection));
      });
      setResults(outcome.map(r=>({...r,number:chosen.find(i=>i.id===r.id)!.number})));
      setSelected(new Set(outcome.filter(r=>!r.ok).map(r=>r.id)));setConfirm(false);
      await reload();
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally{lock.current=false;setBusy(false);}
  }
  const active=enabled&&mode;
  const controls=enabled?<section className="request-batch-actions" aria-busy={busy}>
    <label><input type="checkbox" checked={mode} disabled={checkingMarkets||busy} onChange={event=>{setMode(event.target.checked);setSelected(new Set());setResults([]);setConfirm(false);}}/>Выбрать несколько заявок для сдачи</label>
    {marketControl?.(busy)}
    {active?<><span>Выбрано: {chosen.length}</span><button className="secondary-button" type="button" disabled={checkingMarkets||busy||!chosen.length} onClick={()=>setConfirm(true)}>Перевести выбранные в «Сдано»</button></>:null}
    {results.length?<div role="status"><p>Сдано: {results.filter(r=>r.ok).length}. Не закрыто: {results.filter(r=>!r.ok).length}.</p>{results.filter(r=>!r.ok).map(r=><p key={r.id}>Заявка №{r.number}: {r.error}</p>)}</div>:null}
    {error?<p role="alert" className="form-error">{error}</p>:null}
    {confirm?<section role="region" aria-label="Подтверждение массовой сдачи" className="request-batch-confirm">
      <h3>Сдать выбранные заявки: {chosen.length}</h3>
      <p>Остатки будут списаны и начисления сформированы по обычным правилам. Найденные короба сохраняются. «Без короба» — только если источник хранения не найден.</p>
      <label>Коробов на заявку без сохранённой упаковки<input type="number" min="1" value={boxes} disabled={checkingMarkets||busy} onChange={event=>setBoxes(event.target.value)}/></label>
      <p>Существующая упаковка будет сохранена. Заявки с ошибками останутся незакрытыми.</p>
      <button className="primary-button" type="button" disabled={checkingMarkets||busy||!chosen.length} onClick={()=>void submit()}>{busy?'Закрываю…':'Подтвердить сдачу'}</button>
      <button className="secondary-button" type="button" disabled={checkingMarkets||busy} onClick={()=>setConfirm(false)}>Отмена</button>
    </section>:null}
  </section>:null;
  return {active,busy,selected,selectable:new Set(items.filter(canBatchComplete).map(r=>r.id)),setSelected:(ids:Set<string>)=>{if(!lock.current)setSelected(ids);},controls};
}
