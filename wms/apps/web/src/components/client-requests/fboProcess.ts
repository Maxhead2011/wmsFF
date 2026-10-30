import type {ClientRequestSummary} from '../../lib/api';
import {requestStatusOptions} from './clientRequestMeta';
export function isFboProcess(r:Pick<ClientRequestSummary,'type'|'title'|'comment'|'_count'>){return r.type==='OUTBOUND'&&!(r._count?.fbsOrderLinks)&&!/^FBS|^DBS/i.test(r.title)&&!r.comment?.includes('Создано из FBS-заказов:');}
// FIX: shipment loading is a distinct, non-terminal projection; old states remain readable.
export function fboProcessValue(r:ClientRequestSummary){return isFboProcess(r)?r.status==='DONE'?'DONE':r.status==='CANCELLED'||r.status==='REJECTED'?'CANCELLED':r.fboDispatchAt?'SHIPPED':['IN_REVIEW','APPROVED'].includes(r.status)?'SUBMITTED':r.status:r.status;}
export function fboProcessOptions(r:ClientRequestSummary){return isFboProcess(r)?[
 {value:'SUBMITTED',label:'Новая'},{value:'IN_WORK',label:'В работе'},{value:'PACKED',label:'Упакована'},
 {value:'SHIPPED',label:'Отгружено'},{value:'DONE',label:'Сдано'},{value:'CANCELLED',label:'Отменена'}]:requestStatusOptions;}
