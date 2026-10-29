import type {OzonCustomerRequest} from '../../lib/api';
import {RequestRemovalButton} from '../client-requests/RequestRemoval';
import {OzonEditCountdown} from './OzonEditCountdown';
import './ozon-assembly-list.css';

// FIX: use the WB row arrangement while retaining Ozon deadlines and operations.
export function OzonAssemblyList({rows,active,selectedId,onOpen,onCargo}:{rows:OzonCustomerRequest[];active:boolean;selectedId?:string;onOpen:(id:string)=>void;onCargo:(id:string)=>void}) {
 const date=(value?:string|null)=>value?new Date(value).toLocaleDateString('ru-RU'): '—';
 return <div className="ozfbo-assembly-table-wrap"><table className="ozfbo-assembly-table">
  <thead><tr><th>Заявка</th><th>Состав</th><th>Срок / статус</th><th>Склад</th><th>Действия</th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.id} data-selected={selectedId===r.id||undefined}>
   <td data-label="Заявка"><strong className="ozfbo-row-number">№{String(r.number).padStart(6,'0')}</strong><p>{r.title}</p>{r.createdAt&&<small>Создана: {date(r.createdAt)}</small>}</td>
   <td data-label="Состав"><div className="ozfbo-row-client"><strong>{r.clientCode}</strong> {r.clientName??'—'}</div><p><strong>{r.itemCount??'—'} позиций · {r.quantity} шт.</strong></p>
    <p>{r.itemsPreview?.map(i=>`${i.name||i.barcode||'Товар'} × ${i.quantity}`).join(', ')}{(r.itemCount??0)>(r.itemsPreview?.length??0)&&` · ещё ${(r.itemCount??0)-(r.itemsPreview?.length??0)}`}</p><small>{r.directions} направлений</small></td>
   <td data-label="Срок / статус"><p>{date(r.desiredDate)}</p>{active&&<OzonEditCountdown orders={r.editDeadlines}/>}<p className="ozfbo-row-status">{r.status==='DONE'?'Сдано':r.status==='CANCELLED'?'Отменена':r.status==='REJECTED'?'Отклонена':r.phase==='COMPLETED'?'Упаковано, ожидает сдачи':r.phase==='NOT_STARTED'?'Ожидает сборки':'Сборка в работе'}</p></td>
   <td data-label="Склад"><strong>{r.warehouseName??'—'}</strong><p>{r.destinationCity}</p><div className="ozfbo-row-buttons"><button type="button" onClick={()=>onOpen(r.id)}>Открыть сборку</button><button type="button" onClick={()=>onCargo(r.id)}>Поставка и грузоместа Ozon</button></div></td>
   <td data-label="Действия"><RequestRemovalButton request={r}/></td>
  </tr>)}</tbody>
 </table></div>;
}
