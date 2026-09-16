import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FbsSyncStatus } from './FbsSyncStatus';
const render = (sync: any) => renderToStaticMarkup(createElement(FbsSyncStatus, { sync }));
// TEST: unknown/incomplete lists and failed refreshes are never silently presented as fresh.
describe('FBS snapshot status', () => {
  it('shows the cold-start limitation and background progress', () => {
    const html = render({ partial: true, refreshing: true, error: null });
    expect(html).toContain('Полный список заказов ещё не загружен');
    expect(html).toContain('Обновляем данные в фоне');
  });
  it('keeps the external API error visible after the refresh ends', () => {
    expect(render({ partial: false, refreshing: false, error: 'Проверьте API-ключ кабинета.' })).toContain('role="alert">Проверьте API-ключ кабинета.');
  });
  it('does not show warnings for completed successful refreshes or the legacy API', () => {
    expect(render({ partial: false, refreshing: false, error: null })).toBe('');
    expect(render(undefined)).toBe('');
  });
});
