import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { SidebarRequestBadge } from './SidebarRequestCounts';
import { SoulWorkspace } from './SoulWorkspace';
import { usageKey } from './soulUsage';

// TEST: Soul displays the existing exact navigation counts only for the sections that have them.
test('Soul renders scoped request counts beside navigation labels', () => {
  const groups = [{ id: 'client', title: 'Клиенты', items: [
    { id: 'requests', title: 'Заявки' }, { id: 'fbs', title: 'FBS' },
    { id: 'fbo-ozon', title: 'FBO Ozon' }, { id: 'turnover', title: 'Товарооборот' },
  ] }];
  const state = { scope: 'warehouse', value: {
    requests: { total: 1260, inWork: 387 }, fbs: { total: 0, inWork: 0 },
    fbo: { total: 135, inWork: 18 },
  } };
  const render = (activeId: string, allowed: boolean) => renderToStaticMarkup(
    <SoulWorkspace groups={groups} activeId={activeId} onOpen={() => {}}
      renderBadge={(id: string) => <SidebarRequestBadge id={id} state={allowed ? state : null} />}>
      <p>Содержимое</p>
    </SoulWorkspace>,
  );
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === usageKey('local') ? JSON.stringify({ requests: { count: 2, last: 1 } }) : null,
  });
  try {
    const button = (html: string, attribute: string) => html.match(new RegExp(`${attribute}[\\s\\S]*?</button>`))?.[0];
    for (const activeId of ['overview', 'requests']) {
      const html = render(activeId, true);
      expect(html.match(/class="workspace-nav__badge"/g)).toHaveLength(activeId === 'overview' ? 4 : 3);
      expect(button(html, 'data-soul-open="requests"')).toContain('1260 (387)');
      expect(button(html, 'data-soul-open="fbs"')).toContain('0 (0)');
      expect(button(html, 'data-soul-open="fbo-ozon"')).toContain('135 (18)');
      expect(button(html, 'data-soul-open="turnover"')).not.toContain('workspace-nav__badge');
      expect(render(activeId, false)).not.toContain('workspace-nav__badge');
    }
    expect(button(render('overview', true), 'data-soul-quick="requests"')).toContain('1260 (387)');
  } finally {
    vi.unstubAllGlobals();
  }
});
