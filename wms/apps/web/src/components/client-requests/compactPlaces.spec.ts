import { expect, it } from 'vitest';
import type { ClientRequestSummary } from '../../lib/api';
import { packagesSummary } from './ClientRequestsTable';

// TEST: the summary stays compact regardless of package count.
it('summarizes 159 places without printing identifiers', () => {
  const packages = Array.from({ length: 159 }, (_, index) => ({
    packageCode: 'BOX-' + index, items: [{ quantity: 10 }, { quantity: 1 }],
  }));
  expect(packagesSummary({ packages } as ClientRequestSummary)).toBe('Места: 159 · 1749 шт.');
});
