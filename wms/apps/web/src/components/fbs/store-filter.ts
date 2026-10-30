// FIX: filter by immutable connection identity; never match a seller by display name.
export type OrderStore = { id: string; name: string; connectionIds: string[] };
export function filterOrdersByStore<T extends {connectionId:string}>(orders:readonly T[], stores:readonly OrderStore[], selected:string):T[] {
  if(selected==='all')return [...orders];
  const known=new Set(stores.flatMap(s=>s.connectionIds));
  if(selected==='unassigned')return orders.filter(o=>!known.has(o.connectionId));
  const ids=new Set(stores.find(s=>s.id===selected)?.connectionIds??[]);
  return orders.filter(o=>ids.has(o.connectionId));
}
