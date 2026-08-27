import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoxManagementPanel, groupWithoutPalletItems } from './BoxManagementPanel';

describe('boxes without pallet-sort', () => {
  // ADDED: the operational entry point must remain visible in the boxes section.
  it('renders the dedicated view button', () => {
    const html = renderToStaticMarkup(createElement(BoxManagementPanel, { session: {
      accessToken: 'test-token',
      tokenType: 'Bearer',
      user: {
        id: 'user-1', email: 'test@example.com', name: 'Test', roleCodes: [],
        permissionCodes: ['stock:read', 'stock:write'], clientScopeMode: 'ALL',
        clientIds: [], writableClientIds: [],
      },
    } }));

    expect(html).toContain('Без паллет-сорта');
  });

  // ADDED: contents from different boxes must never be mixed or dropped.
  it('groups every content row under its physical box', () => {
    const groups = groupWithoutPalletItems([
      {
        boxCode: 'BOX-1', warehouse: 'Москва', location: 'Зона А', status: 'available',
        barcode: '111', article: 'ART-1', quantity: 2, boxTotal: 5,
      },
      {
        boxCode: 'BOX-1', warehouse: 'Москва', location: 'Зона А', status: 'available',
        barcode: '222', article: 'ART-2', quantity: 3, boxTotal: 5,
      },
      {
        boxCode: 'BOX-2', warehouse: 'Москва', location: 'Зона Б', status: 'receiving',
        barcode: '333', article: 'ART-3', quantity: 1, boxTotal: 1,
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ boxCode: 'BOX-1', boxTotal: 5 });
    expect(groups[0].contents.map((item) => item.barcode)).toEqual(['111', '222']);
    expect(groups[1].contents.map((item) => item.barcode)).toEqual(['333']);
  });
});
