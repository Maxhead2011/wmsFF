// FIX: pure material ledger; persist its result only inside the client fabric lock.
export interface FabricRoll {
  id: string; warehouseId: string; material: string; color: string;
  remainingMm: number; cutMm: number; createdAt: string; writtenOffAt?: string;
}
export interface FabricDemand {
  key: string; warehouseId: string; material: string; color: string;
  skuId: string; lengthMm: number; units: number;
}
export interface FabricReservation extends FabricDemand {
  rollIds: string[]; confirmedUnits: number; released: boolean;
  operations: Array<{ id: string; units: number }>;
}
export interface FabricLedger {
  rolls: FabricRoll[];
  fbsReservations?: FabricReservation[];
}
function integer(n: number, min: number, max: number) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Invalid fabric quantity');
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
// FIX: refuse corrupt persisted allocations rather than confirming phantom cuts.
export function validateFabricLedger(state: FabricLedger): void {
  const validInt = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
  const text = (s: string) => typeof s === 'string' && !!s.trim();
  const fail = () => { throw new Error('Invalid fabric ledger'); };
  if (!state || !Array.isArray(state.rolls)) fail();
  const rolls = new Map<string, FabricRoll>();
  for (const r of state.rolls) {
    if (!r || ![r.id, r.warehouseId, r.material, r.color].every(text) || rolls.has(r.id) ||
        !validInt(r.remainingMm) || !validInt(r.cutMm) || !Number.isFinite(Date.parse(r.createdAt))) fail();
    rolls.set(r.id, r);
  }
  if (state.fbsReservations !== undefined && !Array.isArray(state.fbsReservations)) fail();
  const keys = new Set<string>();
  for (const r of state.fbsReservations ?? []) {
    if (!r || ![r.key, r.skuId, r.warehouseId, r.material, r.color].every(text) || keys.has(r.key) ||
        !validInt(r.units, 1) || r.units > 500 || !validInt(r.lengthMm, 1) || r.lengthMm > 100000 ||
        !validInt(r.confirmedUnits) || r.confirmedUnits > r.units || typeof r.released !== 'boolean' ||
        !Array.isArray(r.rollIds) || r.rollIds.length !== r.units || !Array.isArray(r.operations)) fail();
    keys.add(r.key);
    for (const id of r.rollIds) {
      const roll = rolls.get(id);
      if (!roll || roll.warehouseId !== r.warehouseId || roll.material !== r.material || roll.color !== r.color) fail();
    }
    const ops = new Set<string>();
    for (const op of r.operations) {
      if (!op || !text(op.id) || ops.has(op.id) || !validInt(op.units, 1) || op.units > r.confirmedUnits) fail();
      ops.add(op.id);
    }
  }
}
function same(a: FabricDemand, b: FabricDemand) {
  return a.key === b.key && a.warehouseId === b.warehouseId && a.material === b.material &&
    a.color === b.color && a.skuId === b.skuId && a.lengthMm === b.lengthMm && a.units === b.units;
}
export function reservedFabricMm(state: FabricLedger, rollId: string): number {
  return (state.fbsReservations ?? []).reduce((sum, r) => sum + (r.released ? 0 :
    r.rollIds.slice(r.confirmedUnits).filter(id => id === rollId).length * r.lengthMm), 0);
}
export function reserveFabric(state: FabricLedger, demand: FabricDemand): FabricLedger {
  validateFabricLedger(state);
  integer(demand.lengthMm, 1, 100000); integer(demand.units, 1, 500);
  if (![demand.key, demand.warehouseId, demand.material, demand.color, demand.skuId].every(v => typeof v === 'string' && v.trim())) {
    throw new Error('Incomplete fabric identity');
  }
  const existing = state.fbsReservations?.find(r => r.key === demand.key);
  if (existing) {
    if (!same(existing, demand) || existing.released) throw new Error('Fabric reservation conflict');
    return copy(state);
  }
  const next = copy(state);
  const rolls = next.rolls.filter(r => !r.writtenOffAt && r.warehouseId === demand.warehouseId &&
    r.material === demand.material && r.color === demand.color)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const rollIds: string[] = [];
  for (const roll of rolls) {
    integer(roll.remainingMm, 0, Number.MAX_SAFE_INTEGER);
    const free = roll.remainingMm - reservedFabricMm(next, roll.id);
    const count = Math.min(demand.units - rollIds.length, Math.max(0, Math.floor(free / demand.lengthMm)));
    for (let i = 0; i < count; i++) rollIds.push(roll.id);
    if (rollIds.length === demand.units) break;
  }
  if (rollIds.length !== demand.units) throw new Error('Insufficient continuous fabric');
  (next.fbsReservations ??= []).push({ ...demand, rollIds, confirmedUnits: 0, released: false, operations: [] });
  return next;
}
// FIX: absolute confirmed count plus durable operation ID prevents retry debits.
// Caller must atomically persist returned ledger with the delta's PACKING proof and audit.
export function confirmFabricCut(state: FabricLedger, key: string, units: number, operationId: string) {
  validateFabricLedger(state);
  if (!operationId.trim()) throw new Error('Missing operation ID');
  const next = copy(state);
  const r = next.fbsReservations?.find(item => item.key === key);
  if (!r) throw new Error('Fabric reservation missing');
  integer(units, 1, r.units);
  const previous = r.operations.find(op => op.id === operationId);
  if (previous) {
    if (previous.units !== units) throw new Error('Operation payload conflict');
    return { state: next, cutUnits: 0, cutMm: 0, replay: true };
  }
  if (r.released || units < r.confirmedUnits) throw new Error('Fabric reservation changed');
  const delta = units - r.confirmedUnits;
  // FIX: validate total outstanding commitments once before any debit. An
  // external adjustment must not make this order spend another order's fabric.
  for (const id of new Set(r.rollIds.slice(r.confirmedUnits, units))) {
    const roll = next.rolls.find(item => item.id === id);
    if (!roll || !Number.isSafeInteger(roll.remainingMm) ||
        roll.remainingMm < reservedFabricMm(next, id)) throw new Error('Reserved fabric unavailable');
  }
  for (const id of r.rollIds.slice(r.confirmedUnits, units)) {
    const roll = next.rolls.find(item => item.id === id);
    if (!roll || roll.writtenOffAt || roll.warehouseId !== r.warehouseId || roll.material !== r.material ||
      roll.color !== r.color || roll.remainingMm < r.lengthMm) throw new Error('Reserved fabric unavailable');
    roll.remainingMm -= r.lengthMm;
    roll.cutMm += r.lengthMm;
  }
  r.confirmedUnits = units;
  r.operations.push({ id: operationId, units });
  return { state: next, cutUnits: delta, cutMm: delta * r.lengthMm, replay: false };
}
// FIX: use only for real cancellation; worker postponement must retain the reservation.
export function releaseUncutFabric(state: FabricLedger, key: string): FabricLedger {
  validateFabricLedger(state);
  const next = copy(state);
  const r = next.fbsReservations?.find(item => item.key === key);
  if (!r) throw new Error('Fabric reservation missing');
  r.released = true;
  return next;
}
