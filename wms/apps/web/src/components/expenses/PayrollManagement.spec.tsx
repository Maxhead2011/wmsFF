import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollManagement } from './PayrollManagement';
import type { AuthSession } from '../../lib/api';
// TEST: no new payroll form is visible before the server explicitly enables it.
describe('payroll feature isolation', () => {
  it('retains the current workspace while capability is unavailable', () => {
    const session = { accessToken: 'test', user: { id: 'admin', roleCodes: ['ADMIN'] } } as AuthSession;
    const html = renderToStaticMarkup(<PayrollManagement session={session} legacy={<p>Existing payroll</p>} />);
    expect(html).toContain('Existing payroll'); expect(html).not.toContain('Телефон для перевода');
  });
});
