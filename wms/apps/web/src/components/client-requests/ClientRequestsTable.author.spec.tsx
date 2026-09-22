import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClientRequestsTable } from './ClientRequestsTable';
// TEST: automatic and manual authors use the actual persisted identity in the request list.
it.each(['WMS', 'Администратор'])('shows author %s', name => {
  const props: any = { items: [{ id: 'r', number: 1264, type: 'OUTBOUND', status: 'SUBMITTED', priority: 'NORMAL',
    title: 'FBS WB · Москва Вешки', destinationCity: 'Маркетплейс FBS · Москва Вешки', createdAt: '2026-09-22T10:00:00Z',
    createdBy: { id: 'author', name }, client: { id: 'c', name: 'Клиент' }, items: [], files: [], packages: [] }] };
  const html = renderToStaticMarkup(<ClientRequestsTable {...props} />);
  expect(html).toContain(`Автор: ${name}`); expect(html).toContain('Москва Вешки');
});
