import {useState} from 'react';
import type {OzonSupplyView,OzonPlannedBox} from '../../lib/api';
type Row={direction:string;skuId:string;barcode:string;quantity:number;zone:string;boxCode:string};
// FIX: the explicit plan is reviewed before upload and remains separate from physical packing.
export function OzonPackingPlan({data,busy,action}:{data:OzonSupplyView;busy:boolean;action:(name:string,body:unknown)=>Promise<void>}){
 const [rows,setRows]=useState<Row[]|null>(null),[confirmed,setConfirmed]=useState(false),[replaceEmpty,setReplaceEmpty]=useState(false),[error,setError]=useState('');
 const plan=data.link?.packingPlan;
 if(!data.plannedPackingSupported&&!plan)return null;
 function edit(){
  const existing=plan?.boxes.flatMap(b=>b.items.map(i=>({...i,direction:b.direction,boxCode:b.boxCode})));
  setRows(existing??data.directions.flatMap((d,index)=>d.items.map(i=>({...i,direction:d.name,zone:data.link?.supplies.find(s=>s.id===data.link?.mapping[d.name])?.items.find(v=>v.barcode===i.barcode)?.placementZone??'',boxCode:`FFL_OZ_${data.requestId.slice(0,8)}_${String(index+1).padStart(3,'0')}`}))));
 }
 async function save(){
  if(!rows)return;setError('');const boxes:OzonPlannedBox[]=[];
  for(const row of rows){
   if(!row.boxCode.trim()||!Number.isSafeInteger(row.quantity)||row.quantity<=0){setError('Укажите ШК короба и целое положительное количество в каждой строке.');return;}
   let box=boxes.find(b=>b.boxCode===row.boxCode.trim());
   if(box&&box.direction!==row.direction){setError('Один короб не может принадлежать разным направлениям.');return;}
   if(!box){box={key:crypto.randomUUID(),boxCode:row.boxCode.trim(),direction:row.direction,supplyId:data.link!.mapping[row.direction],items:[]};boxes.push(box);}
   box.items.push({skuId:row.skuId,barcode:row.barcode,quantity:row.quantity,zone:row.zone});
  }
  await action('packing-plan',{confirm:true,boxes});
 }
 return <section aria-label="Предварительный план грузомест"><h3>Упаковка по плану Ozon</h3>
 <p>Распределите товары по коробам и передайте состав заранее. При упаковке ТСД укажет нужный короб и проверит каждое вложение. План не означает, что товар уже собран.</p>
 {error&&<p role="alert">{error}</p>}
 {plan&&<><p>Версия {plan.version} · {plan.state==='ACTIVE'?'Состав подтверждён Ozon':plan.state==='DRAFT'?'Черновик':'Ожидается подтверждение Ozon'}</p><table><thead><tr><th>Короб</th><th>Направление</th><th>Грузоместо Ozon</th><th>Состав</th></tr></thead><tbody>{plan.boxes.map(b=><tr key={b.key}><td>{b.boxCode}</td><td>{b.direction}</td><td>{b.cargoId??'Ожидается'}</td><td>{b.items.map(i=><div key={i.skuId}>{i.barcode} · {i.quantity} шт. · {i.zone}</div>)}</td></tr>)}</tbody></table></>}
 {/* FIX: use the shared primary action style for the plan editor. */}
 {!data.link?.frozenHash&&<button type="button" className="primary-button" disabled={busy||data.differences.length>0} onClick={edit}>{plan?'Изменить черновик':'Подготовить план коробов'}</button>}
 {rows&&!data.link?.frozenHash&&<fieldset disabled={busy}><legend>Состав каждого короба</legend><p>Проверьте вместимость коробов. SORT и NON_SORT размещайте отдельно. При разделении SKU на два короба распределите его общее количество между строками.</p><table><thead><tr><th>Направление / товар</th><th>Зона</th><th>ШК короба FFL</th><th>Штук</th><th>Разделение</th></tr></thead><tbody>{rows.map((r,index)=><tr key={index}><td>{r.direction}<br/>{r.barcode}</td><td>{r.zone||'Нет данных Ozon'}</td><td><input aria-label={`Короб для ${r.barcode}`} value={r.boxCode} onChange={e=>setRows(rows.map((x,j)=>j===index?{...x,boxCode:e.target.value}:x))}/></td><td><input aria-label={`Количество ${r.barcode}`} type="number" min="1" step="1" value={r.quantity} onChange={e=>setRows(rows.map((x,j)=>j===index?{...x,quantity:Number(e.target.value)}:x))}/></td><td><button type="button" onClick={()=>setRows([...rows,{...r,quantity:1,boxCode:''}])}>Ещё короб</button><button type="button" onClick={()=>setRows(rows.filter((_,j)=>j!==index))}>Убрать строку</button></td></tr>)}</tbody></table><button type="button" onClick={()=>void save()}>Проверить и сохранить черновик</button></fieldset>}
 {plan?.state==='DRAFT'&&<fieldset disabled={busy}><legend>Передача состава</legend><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Проверены товары, количества и вместимость коробов</label><label><input type="checkbox" checked={replaceEmpty} onChange={e=>setReplaceEmpty(e.target.checked)}/>Разрешаю заменить существующие пустые грузоместа. После замены распечатаю новые этикетки</label><button disabled={!confirmed} onClick={()=>void action('packing-plan/upload',{confirm:true,replaceEmpty})}>Передать план в Ozon</button></fieldset>}
 {plan&&plan.state!=='DRAFT'&&plan.state!=='ACTIVE'&&<p role="status">Нажмите «Проверить результат отправки». До подтверждения полного состава упаковка заблокирована; повторная отправка неподтверждённой операции не выполняется.</p>}
 </section>;
}
