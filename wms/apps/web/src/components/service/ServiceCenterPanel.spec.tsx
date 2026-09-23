import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ServiceCenterPanel } from './ServiceCenterPanel';

// TEST: service opens as a tile hub, without the duplicate KIZ search or an open operation.
it('opens Service as tiles without duplicate KIZ navigation', () => {
  const html = renderToStaticMarkup(createElement(ServiceCenterPanel, {
    session: { accessToken: 'test', user: { id: 'owner', roleCodes: ['OWNER'], permissionCodes: ['system:admin'] } } as never,
  }));
  expect(html).toContain('service-tiles');
  expect(html).not.toContain('role="tab"');
  expect(html).not.toContain('Поиск КИЗ');
  expect(html).not.toContain('<span>КИЗ</span>');
  expect(html).not.toContain('Вход открыт');
  for (const title of ['Режим', 'Сессии', 'Telegram', 'Оптимизация хранения', 'Остатки', 'Заявки']) expect(html).toContain(title);
});
