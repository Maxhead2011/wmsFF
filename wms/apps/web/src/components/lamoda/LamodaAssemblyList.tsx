import type {ClientSummary,LamodaOverview} from '../../lib/api';
import {RequestRemovalButton} from '../client-requests/RequestRemoval';
import './lamoda-assembly-list.css';

type Plan=LamodaOverview['plans'][number];
const statusLabels:Record<string,string>={SUBMITTED:'Новая',IN_REVIEW:'На проверке',APPROVED:'Согласована',IN_WORK:'В работе',PACKED:'Упакована',DONE:'Сдана',CANCELLED:'Отменена',REJECTED:'Отклонена'};

// FIX: reuse the existing account-scoped overview; its quantities describe the source plan.
export function LamodaAssemblyList({plans,client,disabled,canWrite,selectedId,onOpen,onReview}:{
 plans:Plan[];client?:Pick<ClientSummary,'code'|'name'>;disabled:boolean;canWrite:boolean;selectedId?:string;
 onOpen:(requestId:string)=>void;onReview:(plan:Plan)=>void;
}){
 return <div className="lamoda-assembly-table-wrap"><table className="lamoda-assembly-table">
  <thead><tr><th>Заявка</th><th>Состав</th><th>Срок / статус</th><th>Склад</th><th>Действия</th></tr></thead>
  <tbody>{plans.map(plan=><tr key={plan.id} data-selected={!!selectedId&&plan.assembly?.requestId===selectedId||undefined}>
   <td data-label="Заявка"><strong className="lamoda-row-number">{plan.assembly?.request?`№${String(plan.assembly.request.number).padStart(6,'0')}`:'Черновик'}</strong><p>{plan.title}</p><small>Создана: {new Date(plan.createdAt).toLocaleString('ru-RU')}</small></td>
   <td data-label="Состав"><div className="lamoda-row-client"><strong>{client?.code}</strong> {client?.name??'—'}</div><p><strong>По плану: {plan.items.reduce((sum,item)=>sum+item.quantity,0)} шт. · строк: {plan.items.length}</strong></p><p>{plan.items.slice(0,3).map(item=>`ШК ${item.barcode||'не указан'} × ${item.quantity}`).join(', ')}{plan.items.length>3&&` · ещё ${plan.items.length-3}`}</p></td>
   <td data-label="Срок / статус"><span className="lamoda-row-status">{plan.assembly?.request?(statusLabels[plan.assembly.request.status]??plan.assembly.request.status):'Черновик'}</span></td>
   <td data-label="Склад"><strong>{plan.warehouse.name}</strong><div className="lamoda-row-buttons">{plan.assembly?<button type="button" disabled={disabled} onClick={()=>onOpen(plan.assembly!.requestId)}>Открыть сборку</button>:<button type="button" disabled={disabled||!canWrite} onClick={()=>onReview(plan)}>Проверить соответствия и остатки</button>}</div></td>
   <td data-label="Действия">{plan.assembly?.request&&<RequestRemovalButton request={{id:plan.assembly.requestId,number:plan.assembly.request.number,title:plan.title,type:'OUTBOUND',status:plan.assembly.request.status}}/>}</td>
  </tr>)}</tbody>
 </table></div>;
}
