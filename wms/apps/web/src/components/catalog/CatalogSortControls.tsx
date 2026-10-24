import type { CatalogFilter } from '../../lib/api';
export type CatalogSort=Pick<CatalogFilter,'sort'|'direction'|'inStock'|'correspondence'>;
// FIX: explicit stock and linkage semantics; unverified cards are not confirmed pairs.
export function CatalogSortControls({value,onChange,busy}:{value:CatalogSort;onChange:(value:CatalogSort)=>void;busy:boolean}){
 return <div className="catalog-sort-controls" aria-label="Сортировка каталога">
  <label>Сортировать по<select aria-label="Сортировать по" value={value.sort} onChange={e=>onChange({...value,sort:e.target.value as CatalogSort['sort'],direction:['stock','updated'].includes(e.target.value)?'desc':'asc'})}><option value="updated">Последнему обновлению</option><option value="article">Артикулу</option><option value="color">Цвету</option><option value="stock">Количеству на складе</option></select></label>
  <label>Порядок<select aria-label="Порядок" value={value.direction} onChange={e=>onChange({...value,direction:e.target.value as CatalogSort['direction']})}><option value="asc">По возрастанию</option><option value="desc">По убыванию</option></select></label>
  <label>Соответствия WB/Ozon<select aria-label="Соответствия WB/Ozon" value={value.correspondence} onChange={e=>onChange({...value,correspondence:e.target.value as CatalogSort['correspondence']})}><option value="all">Все товары</option><option value="linked">Есть подтверждённые WB и Ozon</option><option value="missing">Нет подтверждённой пары</option><option value="unknown">Не проверено</option></select></label>
  <label className="catalog-sort-controls__stock"><input type="checkbox" checked={value.inStock} onChange={e=>onChange({...value,inStock:e.target.checked})}/>Только в наличии</label>
  {busy&&<span role="status">Обновление списка…</span>}
 </div>;
}
