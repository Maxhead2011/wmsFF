export type ShopShare = { connectionId: string; percent: number; priority: number; marketplaceWarehouseId?: string };
export type ShopStockMode = 'ALLOCATED' | 'SHARED';
export type ShopGroup = { id: string; name: string; warehouseId: string; lowStockThreshold: number; members: ShopShare[]; mode?: ShopStockMode; safetyReserve?: number };
export type ShopAssignment = { skuId: string; groupId: string };

function integer(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}: нужно неотрицательное целое число.`);
  return value;
}
function identity(value: string, label: string) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200) {
    throw new Error(`${label}: неверный идентификатор.`);
  }
}
function validateGroup(group: ShopGroup) {
  identity(group.id, 'Группа');
  identity(group.warehouseId, 'Склад');
  identity(group.name, 'Название');
  integer(group.lowStockThreshold, 'Порог малого остатка');
  if (group.mode !== undefined && group.mode !== 'ALLOCATED' && group.mode !== 'SHARED') throw new Error('Неизвестный режим распределения.');
  integer(group.safetyReserve === undefined ? 0 : group.safetyReserve, 'Страховой запас');
  if (!Array.isArray(group.members) || !group.members.length || group.members.length > 100) throw new Error('Выберите от 1 до 100 магазинов.');
  const seen = new Set<string>();
  const priorities = new Set<number>();
  for (const member of group.members) {
    identity(member.connectionId, 'Магазин');
    integer(member.percent, 'Доля');
    integer(member.priority, 'Приоритет');
    if (member.marketplaceWarehouseId !== undefined && (!/^\d+$/.test(member.marketplaceWarehouseId) || !Number.isSafeInteger(Number(member.marketplaceWarehouseId)) || Number(member.marketplaceWarehouseId) <= 0)) throw new Error('Неверный ID склада маркетплейса.');
    if (member.percent > 100 || seen.has(member.connectionId) || priorities.has(member.priority)) throw new Error('Магазины и приоритеты не должны повторяться; доля не больше 100%.');
    seen.add(member.connectionId);
    priorities.add(member.priority);
  }
  if (group.mode !== 'SHARED' && group.members.reduce((sum, m) => sum + m.percent, 0) !== 100) throw new Error('Сумма долей группы должна быть 100%.');
}

// FIX: validate one assignment per canonical SKU, never independently per marketplace barcode.
export function validateShopGroups(groups: ShopGroup[], assignments: ShopAssignment[], connections: { id: string; warehouseId: string | null }[]) {
  if (!Array.isArray(groups) || !Array.isArray(assignments) || groups.length > 100 || assignments.length > 100_000) throw new Error('Превышен размер настроек.');
  const byGroup = new Map<string, ShopGroup>();
  const byConnection = new Map(connections.map(c => [c.id, c]));
  for (const group of groups) {
    validateGroup(group);
    if (byGroup.has(group.id)) throw new Error('Группа повторяется.');
    byGroup.set(group.id, group);
    for (const member of group.members) {
      if (byConnection.get(member.connectionId)?.warehouseId !== group.warehouseId) throw new Error('Магазин недоступен или использует другой физический склад.');
    }
  }
  const assigned = new Set<string>();
  for (const assignment of assignments) {
    identity(assignment.skuId, 'Товар');
    if (assigned.has(assignment.skuId)) throw new Error('Товар уже назначен в группу.');
    if (!byGroup.has(assignment.groupId)) throw new Error('Группа товара не найдена.');
    assigned.add(assignment.skuId);
  }
}

// FIX: exact largest-remainder split; a missing product link must keep its quota blocked,
// not redistribute it to shops that happen to have a link.
export function allocateShopStock(amount: number, group: ShopGroup) {
  integer(amount, 'Остаток');
  validateGroup(group);
  // FIX: reserve once against the physical pool, before splitting or mirroring it.
  amount = Math.max(0, amount - (group.safetyReserve ?? 0));
  const prioritized = [...group.members].filter(m => group.mode === 'SHARED' || m.percent > 0).sort((a, b) => a.priority - b.priority);
  if (amount <= group.lowStockThreshold) return group.members.map(m => ({ connectionId: m.connectionId, amount: m === prioritized[0] ? amount : 0 }));
  if (group.mode === 'SHARED') return group.members.map(m => ({ connectionId: m.connectionId, amount }));
  const rows = group.members.map(m => {
    const numerator = BigInt(amount) * BigInt(m.percent);
    return { connectionId: m.connectionId, amount: Number(numerator / 100n), remainder: Number(numerator % 100n), priority: m.priority };
  });
  let remaining = amount - rows.reduce((sum, row) => sum + row.amount, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.priority - b.priority)) {
    if (!remaining) break;
    row.amount++;
    remaining--;
  }
  return rows.map(({ connectionId, amount }) => ({ connectionId, amount }));
}

export type ShopTransition = { phase: 'VERIFY' | 'DECREASE' | 'INCREASE' | 'DONE'; writes: { destination: string; amount: number }[] };

// FIX: observations must cover the persisted union of old and new destinations.
// Caller must re-read after each phase and serialize writers; an ACK is not an observation.
export function planShopTransition(budget: number, observed: Record<string, number | null>, desired: Record<string, number>, mode: ShopStockMode = 'ALLOCATED'): ShopTransition {
  integer(budget, 'Доступный остаток');
  if (mode !== 'ALLOCATED' && mode !== 'SHARED') throw new Error('Неизвестный режим распределения.');
  let total = 0n;
  for (const amount of Object.values(desired)) {
    total += BigInt(integer(amount, 'Назначенный остаток'));
    if (amount > budget) throw new Error('Распределение превышает доступный остаток.');
  }
  if (mode === 'ALLOCATED' && total > BigInt(budget)) throw new Error('Распределение превышает доступный остаток.');
  const destinations = [...new Set([...Object.keys(observed), ...Object.keys(desired)])].sort();
  for (const destination of destinations) {
    if (!Object.prototype.hasOwnProperty.call(observed, destination) || observed[destination] === null) return { phase: 'VERIFY', writes: [] };
    integer(observed[destination]!, 'Подтверждённый остаток');
  }
  const decreases = destinations.filter(id => observed[id]! > (desired[id] ?? 0));
  if (decreases.length) return { phase: 'DECREASE', writes: decreases.map(destination => ({ destination, amount: desired[destination] ?? 0 })) };
  const increases = destinations.filter(id => observed[id]! < (desired[id] ?? 0));
  return { phase: increases.length ? 'INCREASE' : 'DONE', writes: increases.map(destination => ({ destination, amount: desired[destination] })) };
}
