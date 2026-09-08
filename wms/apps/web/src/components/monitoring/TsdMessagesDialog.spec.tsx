import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { TsdMessageHistory, TsdMessagesDialog } from './TsdMessagesDialog';

// TEST: delivery/HTTP success must not be labelled read without explicit readAt.
describe('monitor message UI', () => {
  const message = { id: 'one', text: '<script>test</script>', senderName: 'Диспетчер', recipientUserId: 'worker', createdAt: '2026-09-08T10:00:00Z', readAt: null };
  it('shows unread and escapes message HTML', () => {
    const html = renderToStaticMarkup(<TsdMessageHistory messages={[message]} />);
    expect(html).toContain('Ожидает прочтения');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('shows explicit confirmation time', () => {
    expect(renderToStaticMarkup(<TsdMessageHistory messages={[{ ...message, readAt: '2026-09-08T10:01:00Z' }]} />)).toContain('Прочитано');
  });
  it('starts with sending disabled while terminal capability is loading', () => {
    const html = renderToStaticMarkup(<TsdMessagesDialog token="test" deviceCode="TSD-1" name="Шохида" onClose={() => {}} />);
    expect(html).toContain('Сообщение сотруднику');
    expect(html).toContain('disabled');
    expect(html).toContain('Шохида');
  });
});
