import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { moscowDay, StatisticsTable } from './OperationsStatisticsPanel';
import { canOpenWorkspace, workspaceNav } from '../../lib/workspaces';
import { spaceSectionForWorkspace } from '../../lib/spaceNavigation';
import type { AuthUser, OperationsStatisticsReport } from '../../lib/api';

const summary = { total: 1, timedShipped: 1, pending: 0, pendingOver24h: 0, cancelled: 0, unknown: 0, averageHours: 14,
  buckets: ['green', 'yellow', 'orange', 'red', 'darkred'].map((color, i) => ({ color, label: ['0–14 ч', '14–18 ч', '18–24 ч', '24–48 ч', '48+ ч'][i], count: i === 1 ? 1 : 0, percent: i === 1 ? 100 : 0 })) };
const report = { summary, branches: [{ id: 'msk', name: 'Филиал Москва', summary,
  warehouses: [{ id: 'seller', name: 'Склад продавца 42', marketplace: 'OZON', clientName: 'Клиент', accountName: 'Кабинет', summary }] }] } as OperationsStatisticsReport;
describe('statistics table and navigation // TEST', () => {
  it('starts with branch totals and expands to seller warehouses', () => {
    const collapsed = renderToStaticMarkup(<StatisticsTable data={report} expanded={[]} onToggle={() => {}} />);
    expect(collapsed).toContain('Филиал Москва'); expect(collapsed).not.toContain('Склад продавца 42'); expect(collapsed).toContain('aria-expanded="false"');
    const expanded = renderToStaticMarkup(<StatisticsTable data={report} expanded={['msk']} onToggle={() => {}} />);
    expect(expanded).toContain('Склад продавца 42'); expect(expanded).toContain('Ozon'); expect(expanded).toContain('100%'); expect(expanded).toContain('48+ ч');
  });
  it('uses labels/counts as well as colors, with a real accessible table', () => {
    const html = renderToStaticMarkup(<StatisticsTable data={report} expanded={[]} onToggle={() => {}} />);
    expect(html).toContain('<caption>'); expect(html).toContain('scope="col"'); expect(html).toContain('ops-zone--yellow'); expect(html).toContain('Нет данных');
  });
  it('appears under warehouse operations without requiring OWNER or analytics permission', () => {
    const item = workspaceNav.find(v => v.id === 'operations-statistics')!;
    expect(spaceSectionForWorkspace(item.id)).toBe('warehouse');
    const user = { roleCodes: ['MANAGER'], permissionCodes: ['stock:read'], isDemo: false } as AuthUser;
    expect(canOpenWorkspace(user, item)).toBe(true);
    expect(canOpenWorkspace({ ...user, roleCodes: ['CLIENT'] }, item)).toBe(false);
    expect(canOpenWorkspace({ ...user, isDemo: true }, item)).toBe(false);
    expect(canOpenWorkspace({ ...user, permissionCodes: [] }, item)).toBe(false);
  });
  it('defaults to Moscow calendar day regardless of browser timezone', () => {
    expect(moscowDay(new Date('2026-09-01T21:30:00Z'))).toBe('2026-09-02');
  });
});
