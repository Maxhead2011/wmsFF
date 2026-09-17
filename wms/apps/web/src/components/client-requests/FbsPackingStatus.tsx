// FIX: packaging progress is independent from marketplace and inventory status.
export function FbsPackingStatus({packing}:{packing:{stage:'FOUND'|'PACKED';foundAt:string|null;foundBy:string|null;packedAt:string|null;packedBy:string|null}}) {
 const when=(v:string|null)=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'';
 return <><span className={`online-execution-pill ${packing.stage==='PACKED'?'is-done':'is-open'}`} style={{whiteSpace:'nowrap'}}>{packing.stage==='PACKED'?'Упаковано':'Найдено'}</span>
 <span>Отбор: {packing.foundBy??'Не установлен'} · {when(packing.foundAt)}</span>
 {packing.stage==='PACKED'?<span>Упаковка: {packing.packedBy??'Не установлен'} · {when(packing.packedAt)}</span>:null}</>;
}
