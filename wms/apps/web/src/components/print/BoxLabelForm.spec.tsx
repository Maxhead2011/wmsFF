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
  // TEST: the box-label screen exposes code kind and a movable caption, without the obsolete row count.
  it('offers a 60 × 40 editable QR or barcode layout with client and FFL code only', () => {
    const html = renderToStaticMarkup(<BoxLabelForm session={session} />);
    expect(html).toContain('Вид кода');
    expect(html).toContain('QR-код');
    expect(html).toContain('Штрихкод Code 128');
    expect(html).toContain('Макет этикетки');
    expect(html).toContain('60 × 40');
    expect(html).not.toContain('Кол-во строк');
  });
  it('offers the reference-style layout without removing the regular layout', () => {
    // TEST: style selection is explicit for box printing.
    expect(renderToStaticMarkup(<BoxLabelForm session={session} />)).toContain('Как образец WB');
  });
  it('also offers the installed local printer in both layout modes', () => {
    // TEST: the operator can choose the browser print dialog without an agent station.
    expect(renderToStaticMarkup(<BoxLabelForm session={session} />)).toContain('value="LOCAL_BROWSER"');
  });
});
