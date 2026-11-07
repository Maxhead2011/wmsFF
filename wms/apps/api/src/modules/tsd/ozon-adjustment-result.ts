// FIX: ERROR is Ozon's terminal asynchronous failure, not a pending response.
export function adjustmentResultState(status:unknown):'SUCCESS'|'FAILED'|'ACCEPTED' {
 return status==='SUCCESS'?'SUCCESS':['ERROR','FAILED'].includes(String(status))?'FAILED':'ACCEPTED';
}
export function adjustmentError(error:unknown):string|undefined {
 if(!error)return undefined;
 const text=typeof error==='string'?error:JSON.stringify(error);
 if(text.includes('INBOUND_NO_CAPACITY'))return 'Ozon отклонил изменение: недостаточно места для приёмки на выбранном направлении (INBOUND_NO_CAPACITY). Уточните доступность поставки в кабинете Ozon. Короба в ВМС сохранены.';
 return text;
}
