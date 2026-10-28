import { useEffect, useRef, useState } from 'react';
import { fetchLamodaAccounts, createLamodaAccount, updateLamodaAccount, checkLamodaAccount, type AuthSession, type LamodaAccount } from '../../lib/api';

const empty = () => ({ name: '', sellerId: '', oauthClientId: '', secret: '', fboEnabled: true, fbsEnabled: false });
// FIX: manage the existing Lamoda accounts in the client card without copying credentials.
export function ClientLamodaConnections({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [rows,setRows]=useState<LamodaAccount[]>([]),[form,setForm]=useState(empty),[open,setOpen]=useState(false);
  const [selected,setSelected]=useState<LamodaAccount|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const epoch=useRef(0), token=session.accessToken;
  const writable=!session.user.isDemo&&session.user.permissionCodes.some(p=>p==='system:admin'||p==='marketplace-api:write');
  useEffect(()=>{const id=++epoch.current;setRows([]);setOpen(false);setSelected(null);setForm(empty());setBusy(false);setLoading(true);setError('');setNotice('');
    fetchLamodaAccounts(token,clientId).then(v=>{if(id===epoch.current)setRows(v)}).catch(e=>{if(id===epoch.current)setError(e.message)}).finally(()=>{if(id===epoch.current)setLoading(false)});
    return()=>{epoch.current++};
  },[token,clientId,revision]);
  async function run(action:()=>Promise<unknown>,message:string){if(busy||!writable)return;const id=epoch.current;setBusy(true);setError('');setNotice('');
    try{await action();if(id===epoch.current){setOpen(false);setForm(empty());setNotice(message);const accounts=await fetchLamodaAccounts(token,clientId);if(id===epoch.current)setRows(accounts)}}
    catch(e){if(id===epoch.current)setError(e instanceof Error?e.message:'Не удалось сохранить подключение.')}
    finally{if(id===epoch.current)setBusy(false)}
  }
  function edit(row:LamodaAccount|null){setSelected(row);setForm(empty());setOpen(true);setError('');setNotice('')}
  return <section className="client-marketplace-panel" aria-label="Кабинеты Lamoda">
    <div className="client-marketplace-panel__heading"><div><h3>Lamoda</h3><span>Кабинеты этого клиента · Seller ID, Client ID и Client Secret</span></div>
      <div className="client-marketplace-panel__heading-actions"><button className="icon-text-button" disabled={busy||loading} onClick={()=>setRevision(v=>v+1)}>Обновить Lamoda</button><button className="primary-button" disabled={busy||!writable} onClick={()=>edit(null)}>Подключить Lamoda</button></div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
    {loading?<p>Загружаю кабинеты Lamoda…</p>:!rows.length?<p>Lamoda пока не подключена.</p>:rows.map(r=><div className="client-marketplace-panel" key={r.id}><strong>{r.name} · Seller ID {r.sellerId}</strong><p>{r.isActive?'Подключён':'Отключён'} · {r.checkedAt?'Проверен '+new Date(r.checkedAt).toLocaleString('ru-RU'):'Доступ ещё не проверен'}</p><div className="client-marketplace-panel__heading-actions">
      <button className="icon-text-button" disabled={busy||!writable||!r.isActive} onClick={()=>void run(()=>checkLamodaAccount(token,r.id),'Доступ Lamoda проверен.')}>Проверить подключение</button>
      <button className="icon-text-button" disabled={busy||!writable} onClick={()=>edit(r)}>Заменить Client Secret</button>
      <button className="icon-text-button" disabled={busy||!writable} onClick={()=>void run(()=>updateLamodaAccount(token,r.id,{isActive:!r.isActive}),r.isActive?'Подключение отключено.':'Подключение включено.')}>{r.isActive?'Отключить':'Включить'}</button>
    </div></div>)}
    {open&&<form className="client-marketplace-form" onSubmit={e=>{e.preventDefault();void run(()=>selected?updateLamodaAccount(token,selected.id,{secret:form.secret}):createLamodaAccount(token,{...form,clientId}),'Подключение сохранено. Проверьте доступ.')}}>
      <h4>{selected?`Новый секрет · ${selected.name}`:'Новый кабинет Lamoda'}</h4>
      {!selected&&(['name','sellerId','oauthClientId'] as const).map((key,i)=><label key={key}><span>{['Название кабинета Lamoda','Seller ID Lamoda','Client ID Lamoda'][i]}</span><input required value={form[key]} disabled={busy} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/></label>)}
      <label className="client-marketplace-form__wide"><span>Client Secret Lamoda</span><input required type="password" autoComplete="new-password" value={form.secret} disabled={busy} onChange={e=>setForm(v=>({...v,secret:e.target.value}))}/></label>
      {!selected&&<><label><input type="checkbox" checked={form.fboEnabled} disabled={busy} onChange={e=>setForm(v=>({...v,fboEnabled:e.target.checked}))}/>FBO</label><label><input type="checkbox" checked={form.fbsEnabled} disabled={busy} onChange={e=>setForm(v=>({...v,fbsEnabled:e.target.checked}))}/>FBS</label></>}
      <div className="client-marketplace-panel__heading-actions"><button type="submit" className="primary-button" disabled={busy||!writable}>Сохранить Lamoda</button><button type="button" className="icon-text-button" disabled={busy} onClick={()=>{setOpen(false);setForm(empty())}}>Отмена</button></div>
    </form>}
  </section>;
}
