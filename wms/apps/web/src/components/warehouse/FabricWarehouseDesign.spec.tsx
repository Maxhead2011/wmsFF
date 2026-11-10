import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { FabricWarehousePanel } from './FabricWarehousePanel';
import type { AuthSession } from '../../lib/api';
const fixture = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => [fixture.values[fixture.index++] ?? initial, vi.fn()] };
});
vi.mock('../../lib/rememberedClient', () => ({ useRememberedClientId: () => ['demo', vi.fn()], validRememberedClientId: vi.fn() }));
// TEST: exercise the actual panel with stock fixtures; no API or stock writes.
describe('fabric workspace presentation', () => {
  it('renders colour samples, stock counters and accessible receiving controls', () => {
    fixture.index = 0;
    const names = ['Синий', 'Красный', 'Чёрный', 'Айвори / шампань', 'Белый', 'Зелёный'];
    fixture.values = [[{ id: 'demo', name: 'Демонстрационный клиент' }], { enabled: true, version: null, groups: names.map((colorName, i) => ({ key: String(i), material: 'SATIN', colorName, whole: i, open: 1, rawMeters: 100 * i + 25, rawLiters: 25, rolls: [], ready: [], fbs: { pieces: 13, meters: 95 }, fbo: { pieces: 0, meters: 0 } })) }, { version: null, colors: [], baseColors: { black: 'Чёрный' }, skus: [] }];
    const html = renderToStaticMarkup(<FabricWarehousePanel session={{ accessToken: 'demo', user: { id: 'demo', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: 'demo' } } as AuthSession} />);
    expect(html.match(/class="fabric-color-swatch"/g)).toHaveLength(7);
    expect(html).toContain('fabric-intake'); expect(html).toContain('Принять рулоны');
    expect(html).toContain('FBS: 13 отрезов / 95 м'); expect(html).toContain('Готовые отрезы: 0 шт.');
    expect(html).toContain('fabric-toolbar');
    if (process.env.FABRIC_PREVIEW) {
      const css = readFileSync(new URL('./fabric-warehouse.css', import.meta.url), 'utf8');
      writeFileSync(process.env.FABRIC_PREVIEW, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ткани — предварительный просмотр</title><style>body{margin:0;padding:28px;background:#f2f6f4;font-family:Arial,sans-serif;color:#263b35}*{box-sizing:border-box}${css}</style>${html}</html>`);
    }
  });
});
