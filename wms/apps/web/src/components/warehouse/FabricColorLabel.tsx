import React from 'react';
const SHADES: Record<string, string> = { синий: '#2563eb', красный: '#dc3545', черный: '#202733', белый: '#ffffff', 'айвори / шампань': '#eee0bc', зеленый: '#27845b', айвори: '#eee0bc', шампань: '#eee0bc', пудровый: '#e7bdc6', розовый: '#e7a9bd', серый: '#929aa6', бежевый: '#d5bea0', желтый: '#edc64a', голубой: '#83bce4', коричневый: '#80563e', фиолетовый: '#8757aa' };
// FIX: display-only palette; unknown names never acquire an arbitrary colour.
export function fabricColorValue(name: string): string | null {
  return SHADES[name.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')] ?? null;
}
export function FabricColorLabel({ name }: { name: string }) {
  const shade = fabricColorValue(name);
  return <span className="fabric-color-label"><span aria-hidden="true" title={shade ? `Условный образец: ${name}` : 'Оттенок не задан'} className={`fabric-color-swatch${shade ? '' : ' fabric-color-swatch--unknown'}`} style={shade ? { backgroundColor: shade } : undefined} />{name}</span>;
}
