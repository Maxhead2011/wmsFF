import { randomUUID } from 'crypto';

export type FabricColor = { id: string; material: string; name: string };
export type FabricMaterial = { id: string; name: string };
export const BASE_FABRIC_MATERIALS: Record<string,string> = { SATIN: 'Атлас / сатин', GABARDINE: 'Габардин' };
export const BASE_FABRIC_COLORS: Record<string, string> = { black: 'Чёрный', white: 'Белый', green: 'Зелёный', red: 'Красный', ivory: 'Айвори / шампань', blue: 'Синий' };
export const colorNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const customMaterialId=(id:unknown):id is string=>typeof id==='string'&&/^material-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const validName=(name:unknown):name is string=>typeof name==='string'&&!!name.trim()&&name.length<=80&&!/[\x00-\x1f\x7f]/.test(name);
export const isFabricMaterial=(id:string,materials:FabricMaterial[]=[])=>Object.prototype.hasOwnProperty.call(BASE_FABRIC_MATERIALS,id)||materials.some(m=>customMaterialId(m.id)&&m.id===id&&validName(m.name));
// FIX: material IDs are client-scoped catalog identities; names never substitute for stock identity.
export function addFabricMaterial(materials:FabricMaterial[],name:string){
  if(!validName(name))throw new Error('Название ткани: от 1 до 80 символов.');
  name=name.normalize('NFKC').trim().replace(/\s+/g,' ');
  const normalized=colorNameKey(name),alias=normalized.replace(/[\s/\\]+/g,'');
  const base=['атлас','сатин','атлассатин','сатинатлас'].includes(alias)?'SATIN':normalized==='габардин'?'GABARDINE':null;
  const existing=materials.find(m=>colorNameKey(m.name)===normalized);
  const material=base?{id:base,name:BASE_FABRIC_MATERIALS[base]}:existing??{id:'material-'+randomUUID(),name};
  return {material,materials:base||existing?[...materials]:[...materials,material],reused:!!(base||existing)};
}

// FIX: preserve warehouse-owned metadata during marketplace synchronization.
export function preserveFabricBinding(incoming: unknown, previous: unknown): Record<string, unknown> {
  const payload = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? { ...incoming } as Record<string, unknown> : {};
  delete payload.fabricRollBinding;
  const binding = readFabricBinding(previous);
  return binding ? { ...payload, fabricRollBinding: binding } : payload;
}

// FIX: colors belong to one client registry and one material; duplicate names reuse the existing color.
export function addFabricColor(colors: FabricColor[], material: string, name: string, materials:FabricMaterial[]=[]) {
  if (!isFabricMaterial(material,materials) || typeof name !== 'string') throw new Error('Укажите ткань и название цвета.');
  name = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Название цвета: от 1 до 80 символов.');
  const base = Object.entries(BASE_FABRIC_COLORS).find(([, label]) => colorNameKey(label) === colorNameKey(name));
  const existing = colors.find(c => c.material === material && colorNameKey(c.name) === colorNameKey(name));
  const color = base ? { id: base[0], material, name: base[1] } : existing ?? { id: 'custom-' + randomUUID(), material, name };
  return { color, colors: base || existing ? [...colors] : [...colors, color], reused: Boolean(base || existing) };
}

export type FabricBinding = { version: 1; material: string; materialName?:string; color: string; colorName: string; lengthMm: number };
// FIX: the SKU remains the marketplace identity; its explicit binding supplies exact material consumption.
export function readFabricBinding(payload: unknown): FabricBinding | null {
  const b = (payload as { fabricRollBinding?: FabricBinding } | null)?.fabricRollBinding;
  return b?.version === 1 && (['SATIN', 'GABARDINE'].includes(b.material)||(customMaterialId(b.material)&&validName(b.materialName))) && typeof b.color === 'string' &&
    typeof b.colorName === 'string' && Number.isSafeInteger(b.lengthMm) && b.lengthMm > 0 && b.lengthMm <= 100000 ? b : null;
}

export function createFabricBinding(colors: FabricColor[], material: string, colorId: string, lengthMm: number, materials:FabricMaterial[]=[]): FabricBinding {
  const colorName = BASE_FABRIC_COLORS[colorId] ?? colors.find(c => c.id === colorId && c.material === material)?.name;
  if (!isFabricMaterial(material,materials) || !colorName || !Number.isSafeInteger(lengthMm) || lengthMm < 1 || lengthMm > 100000) {
    throw new Error('Выберите цвет этой ткани и длину отреза от 0,001 до 100 м.');
  }
  return { version: 1, material, ...(customMaterialId(material)?{materialName:materials.find(m=>m.id===material)!.name}:{}), color: colorId, colorName, lengthMm };
}
