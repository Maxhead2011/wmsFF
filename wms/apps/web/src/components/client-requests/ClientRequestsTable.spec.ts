import { describe, expect, it } from 'vitest';
import type { ClientRequestSummary } from '../../lib/api';
import { requestDisplayTypeLabel } from './ClientRequestsTable';

describe('ClientRequestsTable FBS type label', () => {
  // TEST: FBS requests are persisted as OUTBOUND and previously appeared as plain "Отгрузка".
  it('shows FBS when the request has marketplace-order links', () => {
    const request = {
      type: 'OUTBOUND',
      title: 'Отгрузка по поставке',
      comment: null,
      _count: { fbsOrderLinks: 3 },
    } as ClientRequestSummary;

    expect(requestDisplayTypeLabel(request)).toBe('FBS');
  });

  it('keeps the regular label for a non-FBS outbound request', () => {
    const request = {
      type: 'OUTBOUND',
      title: 'Обычная отгрузка',
      comment: null,
      _count: { fbsOrderLinks: 0 },
    } as ClientRequestSummary;

    expect(requestDisplayTypeLabel(request)).toBe('Отгрузка');
  });
});
