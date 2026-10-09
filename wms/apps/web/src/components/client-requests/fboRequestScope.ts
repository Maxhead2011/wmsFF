import type { ClientRequestSummary } from '../../lib/api';
// FIX: Excel and manual outbound requests share the WB FBO queue; linked/legacy FBS never enter it.
export function isWbFboRequest(r:ClientRequestSummary) {
  // FIX: Ozon assemblies are outbound too; their persisted relation excludes them from WB.
  return r.type==='OUTBOUND' && !r.ozonShipment && !(r._count?.fbsOrderLinks) &&
    !/^(FBS|DBS)/i.test(r.title.trim()) && !r.comment?.toLocaleLowerCase('ru-RU').includes('создано из fbs-заказов:');
}
