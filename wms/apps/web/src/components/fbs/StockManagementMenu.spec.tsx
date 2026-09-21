import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StockManagementMenu } from './StockManagementMenu';

// TEST: restyling keeps all five destinations and capability-based disabled controls.
describe('stock management navigation', () => {
  it('renders themed navigation with one unavailable destination', () => {
    const html = renderToStaticMarkup(<StockManagementMenu cabinetMessage="Подключён только 1 кабинет" duplicatesEnabled onSelect={() => {}} />);
    expect(html).toContain('Разделы управления остатками');
    expect(html.match(/<button /g)).toHaveLength(5);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain('Подключён только 1 кабинет');
    for (const name of ['Между маркетплейсами', 'Резервы и предпросмотр', 'Между артикулами', 'Между складами', 'Подтверждение остатков WB']) expect(html).toContain(name);
  });
  it('does not enable duplicate management when its capability is off', () => {
    const html = renderToStaticMarkup(<StockManagementMenu cabinetMessage="WB и Ozon" duplicatesEnabled={false} onSelect={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('Раздел ещё не включён');
  });
});
