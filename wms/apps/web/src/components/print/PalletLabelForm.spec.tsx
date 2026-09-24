import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuthSession } from '../../lib/api';
import { PalletLabelForm } from './PalletLabelForm';

describe('pallet-sort label', () => {
  it('offers reference-style printing on a selected station', () => {
    // TEST: pallet labels must be printable, not only downloadable as TSPL previews.
    const html = renderToStaticMarkup(<PalletLabelForm session={{ accessToken: 'test', user: { id: 'operator' } } as AuthSession} />);
    expect(html).toContain('Как образец WB');
    expect(html).toContain('Куда печатать');
    expect(html).toContain('value="LOCAL_BROWSER"');
  });
});
