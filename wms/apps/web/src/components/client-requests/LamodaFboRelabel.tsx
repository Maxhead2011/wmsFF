import {useState} from 'react';
import {fetchLamodaRelabelStations,printLamodaRelabel,type FboPlan,type FboAction} from '../../lib/api';

// FIX: labels and progress are server-owned; a browser refresh never confirms a physical scan.
export function LamodaFboRelabel({plan,accessToken,disabled,command,refresh}:{plan:FboPlan;accessToken:string;disabled:boolean;command:(action:string,extra:Partial<FboAction>)=>Promise<void>;refresh:()=>Promise<void>}) {
 const [selected,setSelected]=useState(''),[stations,setStations]=useState<Array<{id:string;name:string;printerName:string}>>([]),[station,setStation]=useState('');
 const [barcode,setBarcode]=useState(''),[kiz,setKiz]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const units=plan.relabelUnits??[],unit=units.find(u=>u.id===selected)??units[0];
 async function load(){setBusy(true);setError('');try{setStations(await fetchLamodaRelabelStations(accessToken,plan.requestId));}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function print(){if(!unit||!station)return;setBusy(true);setError('');try{await printLamodaRelabel(accessToken,plan.requestId,{unitId:unit.id,stationId:station,printId:crypto.randomUUID()});await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 if(!plan.relabelRequired)return null;
 return <section aria-label="Переклейка Lamoda"><h3>Переклейка Lamoda</h3><p>Ожидает проверки: {units.length} шт. Напечатайте этикетку, наклейте её на товар и отсканируйте новый ШК. Для маркированного товара также сканируйте КИЗ.</p>
 {error&&<p role="alert">{error}</p>}
 {unit&&<fieldset disabled={disabled||busy}><label>Отобранная единица<select value={unit.id} onChange={e=>{setSelected(e.target.value);setBarcode('');setKiz('');}}>{units.map((u,i)=><option key={u.id} value={u.id}>{i+1}. {u.label?.name} · размер {u.label?.size??'—'} · {u.label?.barcode}</option>)}</select></label>
 <p>Артикул Lamoda: {unit.label?.article}. Печать: {unit.printStatus??'не отправлена'}.</p>
 <button type="button" onClick={()=>void load()}>Найти станции печати</button><select aria-label="Станция печати" value={station} onChange={e=>setStation(e.target.value)}><option value="">Выберите станцию</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name} · {s.printerName}</option>)}</select>
 <button type="button" disabled={!station||!!unit.printStatus&&unit.printStatus!=='FAILED'} onClick={()=>void print()}>Напечатать 2 этикетки 58 × 40</button>
 <button type="button" onClick={()=>void refresh()}>Проверить печать</button>
 <label>Новый ШК Lamoda<input value={barcode} onChange={e=>setBarcode(e.target.value)} autoComplete="off"/></label>
 {unit.kiz&&<label>КИЗ этой единицы<input value={kiz} onChange={e=>setKiz(e.target.value)} autoComplete="off"/></label>}
 <button type="button" disabled={unit.printStatus!=='PRINTED'||!barcode||!!unit.kiz&&!kiz} onClick={()=>{void command('RELABEL_UNIT',{relabelUnitId:unit.id,barcode,kiz:unit.kiz?kiz:undefined}).then(()=>{setBarcode('');setKiz('');});}}>Подтвердить переклейку</button></fieldset>}</section>;
}
