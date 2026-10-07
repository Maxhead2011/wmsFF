import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingSettlementsPanel, settlementLines } from './BillingSettlementsPanel';
import type { SettlementRow } from '../../lib/billing-settlements-api';
const hooks = vi.hoisted(() => ({ values: [] as any[], index: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual('react'), useEffect: () => {},
  useState: (initial: any) => { const index = hooks.index++; return [index in hooks.values ? hooks.values[index] : typeof initial === 'function' ? initial() : initial, vi.fn()]; } }));
const session: any = { accessToken: 'test', user: { activeWarehouseId: 'w1' } };
const line: any = { id: 'ch', kind: 'CHARGE', date: '2026-10-01', description: 'Упаковка', requestNumber: 1244,
  orderIds: ['123'], quantity: '2', unitPriceRub: '50', totalRub: 100, invoices: [], buckets: ['unbilled'] };
const row: SettlementRow = { client: { id: 'c1', code: 'CL1', name: 'Лукин' }, warehouseId: 'w1', warehouseName: 'Москва',
  unbilledRub: 100, draftRub: 0, reviewRub: 0, debtRub: 75, overdueRub: 75, clientAdvanceRub: 90, missingWorkCount: 1, lines: [line] };
beforeEach(() => { hooks.index = 0; hooks.values = []; });
// TEST: financial drilldown never mixes debt, draft and unbilled amounts.
describe('settlements workspace', () => {
  // TEST: an empty filtered report describes settled clients without implying their historical invoices disappeared.
  it('explains that no clients have debt or unfinished calculations', () => {
    hooks.values[4] = { enabled: true, warehouseName: 'Москва', calculatedAt: '2026-10-03', rows: [], issues: [] };
    hooks.values[5] = 'ready';
    expect(renderToStaticMarkup(<BillingSettlementsPanel session={session} clients={[]} />)).toContain('Нет клиентов с задолженностью или незавершёнными расчётами');
  });
  it('renders register, known-operation chain and missing-work review without inventing a tariff', () => {
    hooks.values[4] = { enabled: true, warehouseName: 'Москва', calculatedAt: '2026-10-02', rows: [row], issues: [{ id: 'work', code: 'WORK_WITHOUT_CHARGE',
      clientId: 'c1', clientName: 'Лукин', reason: 'Обработка выполнена, начисление не найдено.', action: 'Проверить тариф', line: { ...line, id: 'work', totalRub: null, unitPriceRub: undefined } }] };
    hooks.values[5] = 'ready';
    hooks.values[7] = { row, bucket: 'unbilled', label: 'Не выставлено' };
    const html = renderToStaticMarkup(<BillingSettlementsPanel session={session} clients={[]} />);
    expect(html).toContain('Клиенты и расчёты'); expect(html).toContain('Требует проверки');
    expect(html).toContain('№1244'); expect(html).toContain('123'); expect(html).toContain('Сумма не определена');
    expect(html).toContain('Аванс клиента · все филиалы'); expect(html).toContain('не вычитается из долга филиала');
  });
  it('does not render previous amounts during refresh/error or disabled mode', () => {
    hooks.values[5] = 'error'; hooks.values[6] = 'Нет доступа к филиалу';
    expect(renderToStaticMarkup(<BillingSettlementsPanel session={session} clients={[]} />)).toContain('Нет доступа к филиалу');
    hooks.index = 0; hooks.values[5] = 'disabled';
    expect(renderToStaticMarkup(<BillingSettlementsPanel session={session} clients={[]} />)).toContain('пока не включён');
  });
  it('selects only the clicked amount bucket', () => {
    expect(settlementLines({ ...row, lines: [line, { ...line, id: 'debt', buckets: ['debt', 'overdue'] }] }, 'unbilled').map(x => x.id)).toEqual(['ch']);
  });
});
