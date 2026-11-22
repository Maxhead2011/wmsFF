import { useEffect, useRef, useState } from 'react';
import { clientFulfillmentSettings, type FulfillmentSettings, type FulfillmentRule } from '../../lib/api';
import { ClientStoresSettings } from './ClientStoresSettings';
import { ClientProductDisplaySettings } from './ClientProductDisplaySettings';
import { ClientKizPolicySettings } from './ClientKizPolicySettings';
import './ClientSettingsDialog.css';

type Props = { accessToken:string; clientId:string; canEdit:boolean };
const rules: Record<FulfillmentRule,string> = {
  pickKiz:'Привязывать КИЗ при отборе ФБО и ФБС',
  zones:'Учитывать зоны размещения при упаковке ФБО Ozon',
};
function FulfillmentRules({accessToken,clientId,canEdit}:Props) {
  const [settings,setSettings] = useState<FulfillmentSettings>();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  useEffect(() => {
    let active = true;
    clientFulfillmentSettings(accessToken,clientId).then(value => { if(active) setSettings(value); })
      .catch(e => { if(active) setMessage(String(e)); });
    return () => {active=false;};
  },[accessToken,clientId]);
  async function change(rule:FulfillmentRule, enabled:boolean) {
    setBusy(true);setMessage('');
    try { setSettings(await clientFulfillmentSettings(accessToken,clientId,{rule,enabled}));setMessage('Настройка сохранена.'); }
    catch(e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  if (settings && !Object.values(settings.available).some(Boolean)) return null;
  return <section><h3>Отбор и упаковка</h3>
    {settings ? (Object.keys(rules) as FulfillmentRule[]).filter(rule => settings.available[rule]).map(rule =>
      <label className="client-rule" key={rule}><span>{rules[rule]}</span>
        <input type="checkbox" role="switch" checked={settings[rule]} disabled={!canEdit || busy}
          onChange={e => void change(rule,e.target.checked)}/></label>) : !message && <p>Загрузка настроек…</p>}
    <span role="status">{message}</span></section>;
}
export function ClientSettingsDialog(props:Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open,setOpen] = useState(false);
  return <><button className="client-settings-launch" onClick={() => {setOpen(true);dialog.current?.showModal();}}>Настройки клиента</button>
    <dialog ref={dialog} className="client-settings-dialog" aria-labelledby="client-settings-title" onClose={() => setOpen(false)}>
      <header><h2 id="client-settings-title">Настройки клиента</h2><button aria-label="Закрыть" onClick={() => dialog.current?.close()}>Закрыть</button></header>
      {open && <>{!props.canEdit && <p className="settings-readonly">Настройки доступны для просмотра.</p>}<fieldset disabled={!props.canEdit} className="client-settings-fields">
        <ClientProductDisplaySettings {...props}/><ClientKizPolicySettings {...props}/><FulfillmentRules {...props}/>
        {import.meta.env.VITE_CLIENT_STORES_ENABLED === 'true' && <ClientStoresSettings {...props}/>}
      </fieldset></>}
    </dialog></>;
}
