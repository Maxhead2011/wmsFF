import { request } from './api';
export type KizSearchFilter={clientId:string;warehouseId:string;dateFrom:string;dateTo:string};
export type UnprintedKizRow={id:string;assemblyId:string;requestId:string;requestNumber:number;orderId:string;kiz:string;scannedAt:string;workerName:string;boxCode:string;barcode:string;productName:string;printState:string;blockedReason:string;searchRequestNumber:number|null;shippedAt:string|null};
export type UnprintedKizReport={rows:UnprintedKizRow[];checkedAt:string;timezone:string};
const query=(filter:KizSearchFilter)=>new URLSearchParams(filter).toString();
export const checkUnprintedKiz=(accessToken:string,filter:KizSearchFilter)=>request<UnprintedKizReport>('/service/unprinted-kiz?'+query(filter),{accessToken});
export const kizSearchAssignees=(accessToken:string,filter:KizSearchFilter)=>request<Array<{id:string;name:string}>>('/service/unprinted-kiz/assignees?'+query(filter),{accessToken});
export const createUnprintedKizSearch=(accessToken:string,input:KizSearchFilter & {scanIds:string[];assignedToUserId:string;operationId:string})=>request<{id:string;number:number}>('/service/unprinted-kiz/requests',{accessToken,method:'POST',body:input});
