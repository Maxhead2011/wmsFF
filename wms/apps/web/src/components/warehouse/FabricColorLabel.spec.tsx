import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FabricColorLabel, fabricColorValue } from './FabricColorLabel';
// TEST: visible colour samples retain names and never guess custom shades.
describe('fabric colour labels', () => {
  it.each([['Синий', '#2563eb'], ['Красный', '#dc3545'], ['Чёрный', '#202733'], ['Белый', '#ffffff'], ['Айвори / шампань', '#eee0bc'], ['Зелёный', '#27845b']])('%s has its sample', (name, hex) => {
    expect(fabricColorValue(name)).toBe(hex);
    const html = renderToStaticMarkup(<FabricColorLabel name={name} />);
    expect(html).toContain(name); expect(html).toContain(`background-color:${hex}`);
    expect(html).toContain('aria-hidden="true"');
  });
  it('keeps unknown colours explicit instead of inventing a shade', () => {
    expect(fabricColorValue('Новый авторский цвет')).toBeNull();
    const html = renderToStaticMarkup(<FabricColorLabel name="Новый авторский цвет" />);
    expect(html).toContain('fabric-color-swatch--unknown');
    expect(html).toContain('Оттенок не задан');
  });
  it('normalizes case and ё', () => { expect(fabricColorValue('  ЧЕРНЫЙ ')).toBe('#202733'); });
});
