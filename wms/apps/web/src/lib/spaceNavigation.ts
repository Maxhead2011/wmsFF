import type { WorkspaceId, WorkspaceNavItem } from './workspaces';

// ADDED: Space keeps every WMS workspace in one, and only one, top-level section.
export type SpaceSectionId =
  | 'home'
  | 'warehouse'
  | 'marketplaces'
  | 'turnover'
  | 'finance'
  | 'management';

export type SpaceSection = {
  id: SpaceSectionId;
  title: string;
  description: string;
  items: WorkspaceNavItem[];
};

export const spaceSectionDefinitions: ReadonlyArray<Omit<SpaceSection, 'items'>> = [
  {
    id: 'home',
    title: 'Главная',
    description: 'Операционный центр, личные сервисы и текущие задачи.',
  },
  {
    id: 'warehouse',
    title: 'Склад',
    description: 'Приёмка, короба, размещение, инвентаризация и печать.',
  },
  {
    id: 'marketplaces',
    title: 'Маркетплейсы',
    description: 'Заявки, сборка и отгрузки WB, Ozon и других площадок.',
  },
  {
    id: 'turnover',
    title: 'Товарооборот',
    description: 'Поиск товара, остатки, хранение, КИЗ и история движений.',
  },
  {
    id: 'finance',
    title: 'Финансы',
    description: 'Услуги, тарифы, начисления, расходы и документы.',
  },
  {
    id: 'management',
    title: 'Управление',
    description: 'Филиалы, доступы, API и системные настройки WMS.',
  },
];

const sectionMembership: Partial<Record<WorkspaceId, SpaceSectionId>> = {
  overview: 'home',
  cabinet: 'home',
  ai: 'home',

  warehouse: 'warehouse',
  'storage-zones': 'warehouse',
  inventory: 'warehouse',
  imports: 'warehouse',
  factory: 'warehouse',
  print: 'warehouse',

  requests: 'marketplaces',
  fbs: 'marketplaces',
  'fbs-packed': 'marketplaces',
  'order-assembly': 'marketplaces',
  monitoring: 'marketplaces',
  dbs: 'marketplaces',
  'fbo-ozon': 'marketplaces',
  relabeling: 'marketplaces',
  analytics: 'marketplaces',

  turnover: 'turnover',
  catalog: 'turnover',
  directories: 'turnover',
  kiz: 'turnover',
  data: 'turnover',

  billing: 'finance',
  expenses: 'finance',
  services: 'finance',
  logistics: 'finance',
  contracts: 'finance',

  branches: 'management',
  access: 'management',
  'integration-api': 'management',
  administration: 'management',
  'own-companies': 'management',
  service: 'management',
  debug: 'management',
};

export const defaultSpaceServiceIds: WorkspaceId[] = [
  'fbs',
  'monitoring',
  'turnover',
  'kiz',
  'warehouse',
  'requests',
];

export type SpaceUsage = Partial<Record<WorkspaceId, number>>;

export function spaceSectionForWorkspace(id: WorkspaceId): SpaceSectionId {
  return sectionMembership[id] ?? 'management';
}

export function buildSpaceNavigation(items: WorkspaceNavItem[]): SpaceSection[] {
  return spaceSectionDefinitions
    .map((definition) => ({
      ...definition,
      items: items.filter((item) => spaceSectionForWorkspace(item.id) === definition.id),
    }))
    .filter((section) => section.items.length > 0);
}

export function rankSpaceServices(
  items: WorkspaceNavItem[],
  pinnedIds: WorkspaceId[],
  usage: SpaceUsage,
  limit = 6,
) {
  const available = new Map(items.map((item) => [item.id, item]));
  const pinned = pinnedIds
    .map((id) => available.get(id))
    .filter((item): item is WorkspaceNavItem => Boolean(item));
  const pinnedSet = new Set(pinned.map((item) => item.id));
  const defaultOrder = new Map(defaultSpaceServiceIds.map((id, index) => [id, index]));

  const frequent = items
    .filter((item) => item.id !== 'overview' && !pinnedSet.has(item.id))
    .sort((left, right) => {
      const usageDelta = (usage[right.id] ?? 0) - (usage[left.id] ?? 0);
      if (usageDelta !== 0) return usageDelta;

      const leftDefault = defaultOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightDefault = defaultOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftDefault !== rightDefault) return leftDefault - rightDefault;

      return left.title.localeCompare(right.title, 'ru-RU');
    });

  return [...pinned, ...frequent].slice(0, limit);
}

// ADDED: widget order is explicit and permission-safe; unavailable workspaces are ignored.
export function selectSpaceWidgets(items: WorkspaceNavItem[], widgetIds: WorkspaceId[]) {
  const available = new Map(items.map((item) => [item.id, item]));
  return widgetIds
    .map((id) => available.get(id))
    .filter((item): item is WorkspaceNavItem => item !== undefined && item.id !== 'overview');
}

// ADDED: one pure reorder operation powers pointer drag-and-drop and regression tests.
export function moveSpaceWidget(
  widgetIds: WorkspaceId[],
  sourceId: WorkspaceId,
  targetId: WorkspaceId,
) {
  if (sourceId === targetId || !widgetIds.includes(sourceId) || !widgetIds.includes(targetId)) {
    return widgetIds;
  }

  const next = widgetIds.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

export function moveSpaceWidgetByOffset(
  widgetIds: WorkspaceId[],
  widgetId: WorkspaceId,
  offset: -1 | 1,
) {
  const sourceIndex = widgetIds.indexOf(widgetId);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= widgetIds.length) return widgetIds;

  const next = [...widgetIds];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

function pinsStorageKey(userId: string) {
  return `logoff-wms-space-pins:${userId}`;
}

function usageStorageKey(userId: string) {
  return `logoff-wms-space-usage:${userId}`;
}

function widgetsStorageKey(userId: string) {
  return `logoff-wms-space-widgets:${userId}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

export function loadSpacePins(userId: string): WorkspaceId[] {
  const stored = readJson<WorkspaceId[]>(pinsStorageKey(userId), defaultSpaceServiceIds);
  return Array.isArray(stored) ? stored : defaultSpaceServiceIds;
}

export function saveSpacePins(userId: string, ids: WorkspaceId[]) {
  window.localStorage.setItem(pinsStorageKey(userId), JSON.stringify(ids));
}

export function loadSpaceWidgetIds(userId: string): WorkspaceId[] {
  const stored = readJson<unknown>(widgetsStorageKey(userId), null);
  if (!Array.isArray(stored)) return loadSpacePins(userId);

  return [...new Set(stored.filter((id): id is WorkspaceId => typeof id === 'string'))];
}

export function saveSpaceWidgetIds(userId: string, ids: WorkspaceId[]) {
  window.localStorage.setItem(widgetsStorageKey(userId), JSON.stringify(ids));
}

export function loadSpaceUsage(userId: string): SpaceUsage {
  return readJson<SpaceUsage>(usageStorageKey(userId), {});
}

export function recordSpaceWorkspaceUse(userId: string, id: WorkspaceId) {
  if (id === 'overview') return;
  const usage = loadSpaceUsage(userId);
  usage[id] = (usage[id] ?? 0) + 1;
  window.localStorage.setItem(usageStorageKey(userId), JSON.stringify(usage));
}
