import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdministrationNavigation } from './AdministrationPanel';
import type { AuthSession } from '../../lib/api';

const session = { user: { permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } } as AuthSession;
// TEST: tile migration must preserve destinations, findings, and access restrictions.
describe('Administration navigation', () => {
  it('renders all existing destinations and Autosborka as accessible buttons', () => {
    const html = renderToStaticMarkup(<AdministrationNavigation session={session} activeTab={null} phantomCount={7} onSelect={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(14);
    expect(html).toContain('admin-topic-grid');
    expect(html).toContain('Автосборка');
    expect(html).toContain('API и склады');
    expect(html).toContain('Журнал изменений');
    expect(html).toContain('7 расхождений');
    expect(html).not.toContain('admin-tabs');
  });
  it('keeps marketplace stock control hidden from unauthorized users', () => {
    const html = renderToStaticMarkup(<AdministrationNavigation session={{ user: { permissionCodes: [], roleCodes: ['CLIENT'] } } as unknown as AuthSession} activeTab={null} phantomCount={0} onSelect={() => {}} />);
    expect(html).not.toContain('Контроль остатков на МП');
    expect(html).not.toContain('расхождений</b>');
  });
});
