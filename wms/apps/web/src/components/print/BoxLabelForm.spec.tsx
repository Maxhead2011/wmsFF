import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthSession } from '../../lib/api';
import { BoxLabelForm } from './BoxLabelForm';

const session = { accessToken: 'test', user: { id: 'operator' } } as AuthSession;

describe('box label printing', () => {
  it('shows an explicit destination and print action instead of preview only', () => {
    // TEST: the former form offered only a TSPL preview and could not target the FBS printer.
    const html = renderToStaticMarkup(<BoxLabelForm session={session} />);
    expect(html).toContain('Куда печатать');
    expect(html).toContain('Напечатать');
  });
});
