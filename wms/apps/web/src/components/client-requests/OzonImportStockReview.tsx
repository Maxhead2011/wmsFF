import {previewClientRequestAvailability,type ClientRequestAvailabilityPreview,type OzonCustomerPreview} from '../../lib/api';

// FIX: use the WB availability endpoint, once per SKU across all Ozon destinations.
export async function checkOzonImportStock(token:string,clientId:string,warehouseId:string,preview:OzonCustomerPreview & {existingRequest?:{id:string}|null}) {
 const items=new Map<string,{skuId:string;barcode:string;name?:string;quantity:number}>();
 for(const d of preview.directions)for(const row of d.items){const old=items.get(row.skuId);items.set(row.skuId,{...row,name:preview.items?.find(i=>i.skuId===row.skuId)?.name,quantity:(old?.quantity??0)+row.quantity});}
 return previewClientRequestAvailability(token,{clientId,warehouseId,type:'OUTBOUND',excludeRequestId:preview.existingRequest?.id,items:[...items.values()]});
}

export function OzonImportStockReview({stock,busy,source,onAdjust,onCreate}:{stock:ClientRequestAvailabilityPreview;busy:boolean;source:'file'|'link';onAdjust:()=>void;onCreate:()=>void}) {
 return <section aria-label="Проверка остатков Ozon" className="ozfbo-stock-review">
  <h3>Остатки для этой сборки</h3>
  <p role="status">Нужно: {stock.summary.requestedQuantity} шт. · Не хватает: {stock.summary.shortageQuantity} шт.</p>
  <div className="online-execution-table-wrap"><table className="online-execution-table"><thead><tr><th>Товар / ШК</th><th>Нужно</th><th>На складе</th><th>В резервах</th><th>Доступно</th><th>Принято, не размещено</th><th>Не хватает</th></tr></thead><tbody>{stock.lines.map((r,i)=><tr key={r.skuId??i}><td>{r.name}<br/>{r.barcode}</td><td>{r.requestedQuantity}</td><td>{r.stockQuantity}</td><td>{r.reservedQuantity}</td><td>{r.availableQuantity}</td><td>{r.pendingPlacementQuantity??0}</td><td>{r.shortageQuantity>0?<strong>{r.shortageQuantity}</strong>:0}</td></tr>)}</tbody></table></div>
  <p>Общий остаток проверяется по всем направлениям с вычетом чужих резервов. Принятый, но не размещённый товар учтён отдельно; ожидаемый непринятый приход не включён.</p>
  <p>«Сформировать как есть» сохраняет полное количество, даже при дефиците — например, если ожидается приход.</p>
  <p>Для корректировки сначала создаётся заявка WMS с исходным составом. Затем проверьте уменьшение по направлениям и подтвердите изменение WMS и Ozon.{source==='file'?' Для файла потребуется привязать поставку Ozon по ссылке и сопоставить направления.':''}</p>
  <div className="ozfbo-create-methods"><button type="button" disabled={busy||stock.canCommit} onClick={onAdjust}>Скорректировать по фактическим остаткам</button><button type="button" disabled={busy} onClick={onCreate}>Сформировать как есть</button></div>
 </section>;
}
