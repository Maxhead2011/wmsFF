import { useEffect, useState } from 'react';
import { fetchFboRecoveryCapabilities, fetchReceiptBarcodeSummary, type AuthSession } from '../../lib/api';
import { AdministrationFboProblems } from './AdministrationFboProblems';
import { ReceiptBarcodeProblems } from './ReceiptBarcodeProblems';
export const canUseOperationalProblems=(session: AuthSession)=>!session.user.isDemo&&session.user.roleCodes.some(r=>r==='ADMIN'||r==='OWNER');
// FIX: operational ADMIN access does not unlock owner-only settings or privileged background reads.
export function OperationalProblemsPanel({session}:{session:AuthSession}){
  const [tab,setTab]=useState<'receipt'|'fbo'>('receipt'),[count,setCount]=useState<number|null>(null),[fbo,setFbo]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;setCount(null);setFbo(false);setError('');
    Promise.allSettled([fetchReceiptBarcodeSummary(session.accessToken),fetchFboRecoveryCapabilities(session.accessToken)]).then(([r,f])=>{
      if (!active) return;
      if (r.status==='fulfilled') setCount(r.value.pending);
      if (f.status==='fulfilled') setFbo(f.value.enabled);
      if (f.status==='rejected') setError('Не удалось проверить доступ к проблемам ФБО. Обновите страницу.');
    });
    return()=>{active=false;};},[session.accessToken,session.user.activeWarehouseId]);
  if(!canUseOperationalProblems(session))return null;
  return <section className="administration receipt-problems-hub"><h2>Администрирование · Разбор проблем</h2><nav className="admin-tabs" aria-label="Разбор проблем">
    <button onClick={()=>setTab('receipt')}>Проблемы приёмки{count===null?'':` (${count})`}</button>
    <button disabled={!fbo} onClick={()=>setTab('fbo')}>Проблемы ФБО</button></nav>
    {error&&<p role="alert">{error}</p>}{!fbo&&<p>Доступность разбора ФБО проверяется сервером по правам и закреплённому филиалу.</p>}
    {tab==='receipt'?<ReceiptBarcodeProblems key={`${session.accessToken}:${session.user.activeWarehouseId}`} session={session} onCount={setCount}/>:fbo?<AdministrationFboProblems key={`${session.accessToken}:${session.user.activeWarehouseId}`} session={session}/>:null}
  </section>;
}
