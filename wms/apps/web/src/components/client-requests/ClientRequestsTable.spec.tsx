import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClientRequestSummary } from '../../lib/api';
import { ClientRequestsTable } from './ClientRequestsTable';

function renderRequest(overrides: Partial<ClientRequestSummary> = {}) {
  const request: ClientRequestSummary = {
    id: 'qa-request', number: 1000, clientId: 'qa-client', type: 'OUTBOUND',
    status: 'IN_WORK', priority: 'NORMAL', title: 'FBS тестовая заявка',
    comment: null, contactName: null, contactPhone: null, destinationCity: 'Тестовый склад',
    deliveryAddress: null, desiredDate: null, managerComment: null,
    createdAt: '2026-09-16T07:00:00Z', updatedAt: '2026-09-16T07:00:00Z',
    client: { id: 'qa-client', code: 'QA', name: 'Тестовый клиент' },
    createdBy: null, assignedTo: null, items: [], files: [], packages: [],
    ...overrides,
  };
  const props: ComponentProps<typeof ClientRequestsTable> = {
    items: [request], canChangeStatus: false, canPickOutbound: false,
    canCancelRequests: false, canEditAnyRequest: false, canRefreshPickInstruction: false,
    onStatusChange: vi.fn(), onCancelRequest: vi.fn(), onEditRequest: vi.fn(),
    onPickOutbound: vi.fn(), onPackageOutbound: vi.fn(), onShipOutbound: vi.fn(),
  };
  return renderToStaticMarkup(createElement(ClientRequestsTable, props));
}

// TEST: never highlight only the last three digits of a four-or-more-digit number.
describe('request list number and WB supply display', () => {
  it.each([
    [1, '000', '001'], [999, '000', '999'], [1000, '00', '1000'],
    [1001, '00', '1001'], [10000, '0', '10000'], [100000, '', '100000'],
    [1000000, '', '1000000'],
  ])('keeps the complete number %s in the bold accent', (number, prefix, accent) => {
    const html = renderRequest({ number });
    expect(html).toContain(`class="client-request-number__prefix">№${prefix}</span>`);
    expect(html).toContain(`class="client-request-number__accent">${accent}</strong>`);
    expect(html).toContain(`aria-label="Заявка №${String(number).padStart(6, '0')}"`);
  });

  // TEST: supplies are visible below the warehouse even without warehouse-action permissions.
  it.each(['SUBMITTED', 'IN_WORK', 'PACKED', 'DONE', 'CANCELLED'] as const)(
    'shows the supply directly below the warehouse for %s', status => {
      const html = renderRequest({ status, wbSupplyIds: ['WB-GI-123'] });
      expect(html).toMatch(/class="client-request-city"><span>Склад<\/span><strong>Тестовый склад<\/strong><\/span><span class="client-request-wb-supplies/);
      expect(html).toContain('<span>Поставка WB</span><strong>WB-GI-123</strong>');
      expect(html.split('WB-GI-123')).toHaveLength(2);
      expect(html.includes('client-request-wb-supplies--pending')).toBe(status !== 'DONE');
    },
  );

  it('shows all supplies without shortening their identifiers', () => {
    const html = renderRequest({ wbSupplyIds: ['WB-GI-123456789', 'WB-GI-987654321'] });
    expect(html).toContain('<span>Поставки WB</span><strong>WB-GI-123456789</strong><strong>WB-GI-987654321</strong>');
  });

  it.each([undefined, []])('does not invent a missing supply (%s)', wbSupplyIds => {
    expect(renderRequest({ wbSupplyIds })).not.toContain('client-request-wb-supplies');
  });
});
