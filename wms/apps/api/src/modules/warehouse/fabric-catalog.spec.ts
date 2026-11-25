import { describe, it, expect } from 'vitest';
import { addFabricMaterial, addFabricColor, createFabricBinding, readFabricBinding, preserveFabricBinding } from './fabric-catalog';

// TEST: names are deduplicated without merging materials or clients.
describe('fabric catalog', () => {
  // TEST: a new client material survives receipt identity and marketplace refresh without joining another material.
  it('creates tulle once, scopes its colors and preserves its named binding', () => {
    const first=addFabricMaterial([], ' Фатин ');
    expect(addFabricMaterial(first.materials, 'ФАТИН').material.id).toBe(first.material.id);
    expect(addFabricMaterial([], 'Фатин').material.id).not.toBe(first.material.id);
    const color=addFabricColor([],first.material.id,'Пудровый',first.materials);
    const binding=createFabricBinding(color.colors,first.material.id,color.color.id,3000,first.materials);
    expect(binding.materialName).toBe('Фатин');expect(readFabricBinding({fabricRollBinding:binding})).toEqual(binding);
    expect(preserveFabricBinding({}, {fabricRollBinding:binding})).toEqual({fabricRollBinding:binding});
    expect(()=>createFabricBinding(color.colors,first.material.id,color.color.id,3000,[])).toThrow();
    expect(()=>addFabricColor([],first.material.id,'Белый',[])).toThrow();
  });
  it('reuses satin and atlas aliases and rejects invalid material names',()=>{
    for(const name of ['Атлас','Сатин','атлас / сатин'])expect(addFabricMaterial([],name)).toMatchObject({material:{id:'SATIN'},reused:true});
    expect(()=>addFabricMaterial([],' ')).toThrow();expect(()=>addFabricMaterial([],'x'.repeat(81))).toThrow();
  });
  it('retains warehouse binding across marketplace refreshes and ignores remote-injected bindings', () => {
    const binding = createFabricBinding([], 'SATIN', 'black', 5000);
    expect(preserveFabricBinding({ offer: 1 }, { fabricRollBinding: binding })).toEqual({ offer: 1, fabricRollBinding: binding });
    expect(preserveFabricBinding({ fabricRollBinding: binding, offer: 1 }, null)).toEqual({ offer: 1 });
  });
  it('adds a color before any marketplace SKU exists and reuses normalized names', () => {
    const first = addFabricColor([], 'SATIN', ' Пудровый ');
    expect(first.colors).toHaveLength(1);
    expect(addFabricColor(first.colors, 'SATIN', 'ПУДРОВЫЙ').color.id).toBe(first.color.id);
    expect(addFabricColor(first.colors, 'GABARDINE', 'Пудровый').colors).toHaveLength(2);
    expect(addFabricColor([], 'SATIN', 'пудровый').color.id).not.toBe(first.color.id);
  });
  it('retains existing colors and validates names', () => {
    expect(addFabricColor([], 'SATIN', 'черный').color.id).toBe('black');
    expect(() => addFabricColor([], 'OTHER', 'Белый')).toThrow();
    expect(() => addFabricColor([], 'SATIN', ' ')).toThrow();
  });
  it('binds different cut lengths to the same raw material', () => {
    const { color, colors } = addFabricColor([], 'SATIN', 'Пудровый');
    const a = createFabricBinding(colors, 'SATIN', color.id, 5000);
    const b = createFabricBinding(colors, 'SATIN', color.id, 10000);
    expect(a.color).toBe(b.color);
    expect(readFabricBinding({ fabricRollBinding: a })).toEqual(a);
    expect(() => createFabricBinding([], 'SATIN', color.id, 5000)).toThrow();
    expect(() => createFabricBinding(colors, 'GABARDINE', color.id, 5000)).toThrow();
    expect(() => createFabricBinding(colors, 'SATIN', color.id, 0)).toThrow();
  });
});
