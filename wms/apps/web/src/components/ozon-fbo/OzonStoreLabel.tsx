import type {OzonCustomerRequest} from '../../lib/api';
// FIX: the payer stays visible; shop identity comes from its marketplace connection.
export function OzonStoreLabel({request}:{request:OzonCustomerRequest}) {
 if(!request.storeState)return null;
 return <p className="ozfbo-store-label"><strong>{request.storeState==='UNASSIGNED'?'Магазин не определён':`Магазин: ${request.storeNames?.join(', ')||'не определён'}`}</strong>{request.storeState==='MIXED'?' · требуется разделение заявки':''}</p>;
}
