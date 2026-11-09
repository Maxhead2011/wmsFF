import { describe, expect, it } from 'vitest';
import { resolveFbsPrimaryServiceMatch } from '../src/modules/marketplace-connections/marketplace-connections.service';

const clientId = '1757a389-c0d4-49b5-9347-2bde0c549260';
const rules = [1, 3, 5, 10, 20, 30, 50].map(length => ({
  serviceId: `cut-${length}`, serviceCode: `NOM_ОТРЕЗ_${length}М`, matchKeywords: `old-code-${length}`,
}));

describe('Bushkova automatic cut tariffs', () => {
  // TEST: new articles and barcodes use measured cut length without editing saved keyword lists.
  it.each([
    ['Ткань розовая 20 метров', 'pink_new_20', 20],
    ['Фатин белый 1 метр * 3 метра', 'new_fatin_1', 1],
    ['Фатин белый 50 метров × 3 метра', 'new_fatin_50', 50],
    ['Фатин 10×3 м', 'UNKNOWN', 10],
    ['Ткань 5 * 1,5 метра', 'UNKNOWN', 5],
    ['Ткань 10м * 150 см', 'NEW2026', 10],
    ['Ткань 20 метров', 'NEW_2026', 20],
    ['Отрез длиной 3 метра', 'UNKNOWN', 3],
    ['Ткань ширина 3 м, длина 1 м', 'NEW', 1],
    ['Ширина 1,5 м, длина 20 м', 'NEW', 20],
    ['Новая ткань', 'rose_30', 30],
  ])('matches %s to the %s cut tariff', (name, article, length) => {
    expect(resolveFbsPrimaryServiceMatch([name, article, '2099999999999'], rules,
      { clientId, productName: name, articles: [article] })).toBe(`cut-${length}`);
  });

  // TEST: width, unsupported lengths and conflicting metadata cannot select an arbitrary tariff.
  it.each([
    ['Отрез 50 см × 3 м', 'NEW'],
    ['Отрез 1,5 м × 3 м', 'NEW'],
    ['Ткань 2 метра', 'NEW'],
    ['Новый товар без карточки: 2099999999999', 'NEW'],
    ['Ткань 10 метров', 'pink_20'],
    ['Ткань 10 метров или 20 метров', 'NEW'],
    ['Ткань ширина 3 метра', 'NEW'],
  ])('does not guess a price for %s', (name, article) => {
    expect(resolveFbsPrimaryServiceMatch([name, article], rules,
      { clientId, productName: name, articles: [article] })).toBeNull();
  });

  // TEST: other clients and existing exact matches retain their previous behavior.
  it('isolates the fallback to Bushkova and keeps exact saved matches first', () => {
    const context = { productName: 'Ткань 20 метров', articles: ['new_20'] };
    expect(resolveFbsPrimaryServiceMatch(['Ткань 20 метров'], rules, { ...context, clientId: 'other-client' })).toBeNull();
    expect(resolveFbsPrimaryServiceMatch(['Ткань 20 метров'], rules)).toBeNull();
    expect(resolveFbsPrimaryServiceMatch(['old-code-3', 'Ткань 20 метров'], rules, { ...context, clientId })).toBe('cut-3');
  });

  // TEST: an inactive/unselected tariff is absent from the eligible rules and must not be invented.
  it('requires exactly one eligible service for the recognized length', () => {
    const context = { clientId, productName: 'Ткань 20 метров', articles: ['new_20'] };
    expect(resolveFbsPrimaryServiceMatch(['Ткань 20 метров'], rules.filter(r => r.serviceId !== 'cut-20'), context)).toBeNull();
    expect(resolveFbsPrimaryServiceMatch(['Ткань 20 метров'], [...rules, { ...rules[4], serviceId: 'duplicate-20' }], context)).toBeNull();
  });
});
