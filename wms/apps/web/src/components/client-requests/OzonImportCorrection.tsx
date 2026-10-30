import {useCallback,useState} from 'react';
import {OzonAssemblySupply} from '../ozon-fbo/OzonAssemblySupply';
import {OzonStockAdjustment} from './OzonStockAdjustment';
// FIX: keep the created request visible if remote correction is rejected or needs reconciliation.
export function OzonImportCorrection({request,accessToken,linked,onChanged}:{request:{id:string;number:number};accessToken:string;linked:boolean;onChanged:()=>void}) {
 const [ready,setReady]=useState(linked),[locked,setLocked]=useState(false),[revision,setRevision]=useState(0);
 const bound=useCallback((value:boolean)=>setReady(value),[]);
 return <section aria-label="Корректировка созданной заявки"><h3>Заявка WMS №{request.number}: корректировка</h3>
  <p>Исходная заявка сохранена. Количество изменится только после подтверждённого ответа Ozon. Повторно создавать сборку не нужно.</p>
  {!linked&&!locked&&<OzonAssemblySupply key={revision} requestId={request.id} accessToken={accessToken} onBindingReady={bound} bindingOnly/>}
  {ready?<OzonStockAdjustment key={request.id} requestId={request.id} accessToken={accessToken} disabled={false} onLockChange={setLocked} onChanged={()=>{setRevision(v=>v+1);onChanged();}} autoPreview/>:<p>Привяжите поставку Ozon и сохраните соответствия направлений, чтобы перейти к расчёту уменьшения.</p>}
 </section>;
}
