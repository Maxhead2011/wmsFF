import { renderToStaticMarkup } from 'react-dom/server';
import { it, expect, vi } from 'vitest';
import { ClientSettingsDialog } from './ClientSettingsDialog';
vi.mock('react', async () => ({...await vi.importActual<typeof import('react')>('react'),
  useState:(initial:unknown)=>[initial === false ? true : initial,vi.fn()]}));
// TEST: read-only users see the same dialog, with a disabled editor.
it.each([false,true])('respects edit permission %s', canEdit => {
  const html = renderToStaticMarkup(<ClientSettingsDialog accessToken="test" clientId="client" canEdit={canEdit}/>);
  expect(html).toContain('aria-labelledby="client-settings-title"');
  expect(html.includes('<fieldset disabled="" class="client-settings-fields"')).toBe(!canEdit);
});
