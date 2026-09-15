import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TsdMonitoringPanel } from './TsdMonitoringPanel';
import type { AuthSession } from '../../lib/api';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: vi.fn(actual.useState) };
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const admin = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], administrationEnabled: false, isDemo: false };
function render(user = admin) {
  vi.mocked(useState).mockReturnValueOnce([{
    devices: [{ deviceCode: 'TSD-1', online: true, workloads: [], errors: [], activity: [], liveState: { screen: 'INVENTORY_COUNT' } }],
    summary: { onlineDevices: 1, busyDevices: 0, tasks: 0 },
    pickerStatistics: { workers: [], period: { label: 'Сегодня' }, summary: { workers: 0, orders: 0, units: 0 } },
  }, vi.fn()]);
  return renderToStaticMarkup(<TsdMonitoringPanel session={{ accessToken: 'test', user } as AuthSession} />);
}
// TEST: render the actual monitoring panel for ADMIN, owner and restricted identities.
describe('ADMIN monitoring buttons', () => {
  it('shows task release, inventory release and messages for ADMIN', () => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    const html = render();
    for (const label of ['Снять все задания', 'Завершить инвентаризацию', '>Сообщение<']) expect(html).toContain(label);
    expect(html).not.toContain('Тихое обновление');
  });
  // TEST: requested commands must be visible on the real ADMIN monitoring panel.
  it.each(['Перезагрузить заявку', 'Выйти из аккаунта'])('shows %s for ADMIN', label => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    expect(render()).toContain(label);
  });
  it('preserves owner controls', () => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    const html = render({ ...admin, administrationEnabled: true });
    for (const label of ['Снять все задания', 'Завершить инвентаризацию', '>Сообщение<', 'Тихое обновление', 'Перезагрузить заявку', 'Выйти из аккаунта']) expect(html).toContain(label);
  });
  // TEST: flag-off installations preserve the original controls for owner.
  it.each([undefined, 'false'])('preserves sold installation owner controls with flag %s', flag => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', flag);
    const html = render({ ...admin, administrationEnabled: true });
    for (const label of ['Снять все задания', 'Завершить инвентаризацию', '>Сообщение<', 'Тихое обновление', 'Перезагрузить заявку', 'Выйти из аккаунта']) expect(html).toContain(label);
  });
  it.each([{ roleCodes: ['MANAGER'] }, { roleCodes: ['ADMIN', 'CLIENT'] }, { permissionCodes: [] }, { isDemo: true }])('hides controls for %j', override => {
    vi.stubEnv('VITE_ADMIN_MONITORING_ENABLED', 'true');
    const html = render({ ...admin, ...override });
    for (const label of ['Снять все задания', 'Завершить инвентаризацию', '>Сообщение<', 'Перезагрузить заявку', 'Выйти из аккаунта']) expect(html).not.toContain(label);
  });
});
