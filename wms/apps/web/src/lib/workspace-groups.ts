type Item = {id: string};
type Group<T extends Item> = {id: string; title: string; items: T[]};

// FIX: regroup only already-authorized navigation items, never create permissions.
export function regroupWorkspaces<T extends Item>(groups: Group<T>[], hostname: string): Group<T>[] {
  if (!['wms.logoff.pro', 'localhost', '127.0.0.1'].includes(hostname)) return groups;
  const layout = [
    ['main', 'Главное', 'overview'],
    ['client', 'Клиентский контур', 'cabinet contracts analytics catalog'],
    ['marketplaces', 'Маркетплейсы', 'requests fbs fbo-ozon dbs operations-statistics'],
    ['operations', 'Склад и операции', 'warehouse storage-zones returns inventory kiz kiz-circulation turnover fbs-packed order-assembly relabeling'],
    ['management', 'Управление', 'access monitoring integration-api branches imports services own-companies factory print'],
    ['control', 'Контроль', 'ai administration service debug data'],
    ['logistics', 'Логистика', 'logistics'],
    ['finance', 'Финансы', 'billing expenses'],
  ];
  const assigned = new Set(layout.flatMap(([, , ids]) => ids.split(' ')));
  const available = new Map(groups.flatMap(g => g.items.map(item => [item.id, item] as const)));
  const result = layout.map(([id, title, ids]) => ({
    id, title,
    items: [
      ...ids.split(' ').flatMap(key => available.has(key) ? [available.get(key)!] : []),
      ...groups.filter(g => g.id === id).flatMap(g => g.items.filter(item => !assigned.has(item.id))),
    ],
  }));
  return [...result, ...groups.filter(g => !layout.some(([id]) => g.id === id)).map(g => ({...g, items: g.items.filter(item => !assigned.has(item.id))}))].filter(g => g.items.length > 0);
}
