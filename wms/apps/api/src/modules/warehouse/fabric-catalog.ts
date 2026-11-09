import { randomUUID } from 'crypto';

export type FabricColor = { id: string; material: string; name: string };
export const BASE_FABRIC_COLORS: Record<string, string> = { black: 'Чёрный', white: 'Белый', green: 'Зелёный', red: 'Красный', ivory: 'Айвори / шампань', blue: 'Синий' };
export const colorNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

// FIX: preserve warehouse-owned metadata during marketplace synchronization.
export function preserveFabricBinding(incoming: unknown, previous: unknown): Record<string, unknown> {
  const payload = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? { ...incoming } as Record<string, unknown> : {};
  delete payload.fabricRollBinding;
  const binding = readFabricBinding(previous);
  return binding ? { ...payload, fabricRollBinding: binding } : payload;
}

// FIX: colors belong to one client registry and one material; duplicate names reuse the existing color.
export function addFabricColor(colors: FabricColor[], material: string, name: string) {
  if (!['SATIN', 'GABARDINE'].includes(material) || typeof name !== 'string') throw new Error('Укажите ткань и название цвета.');
  name = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Название цвета: от 1 до 80 символов.');
  const base = Object.entries(BASE_FABRIC_COLORS).find(([, label]) => colorNameKey(label) === colorNameKey(name));
  const existing = colors.find(c => c.material === material && colorNameKey(c.name) === colorNameKey(name));
  const color = base ? { id: base[0], material, name: base[1] } : existing ?? { id: 'custom-' + randomUUID(), material, name };
  return { color, colors: base || existing ? [...colors] : [...colors, color], reused: Boolean(base || existing) };
}

export type FabricBinding = { version: 1; material: string; color: string; colorName: string; lengthMm: number };
// FIX: the SKU remains the marketplace identity; its explicit binding supplies exact material consumption.
export function readFabricBinding(payload: unknown): FabricBinding | null {
  const b = (payload as { fabricRollBinding?: FabricBinding } | null)?.fabricRollBinding;
  return b?.version === 1 && ['SATIN', 'GABARDINE'].includes(b.material) && typeof b.color === 'string' &&
    typeof b.colorName === 'string' && Number.isSafeInteger(b.lengthMm) && b.lengthMm > 0 && b.lengthMm <= 100000 ? b : null;
}

export function createFabricBinding(colors: FabricColor[], material: string, colorId: string, lengthMm: number): FabricBinding {
  const colorName = BASE_FABRIC_COLORS[colorId] ?? colors.find(c => c.id === colorId && c.material === material)?.name;
  if (!['SATIN', 'GABARDINE'].includes(material) || !colorName || !Number.isSafeInteger(lengthMm) || lengthMm < 1 || lengthMm > 100000) {
    throw new Error('Выберите цвет этой ткани и длину отреза от 0,001 до 100 м.');
  }
  return { version: 1, material, color: colorId, colorName, lengthMm };
}
