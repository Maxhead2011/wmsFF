import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultSortReferenceText } from '../../lib/sortReferenceLabel';
import { SortReferenceLabelEditor } from './SortReferenceLabelEditor';

describe('reference label text editor', () => {
  it('shows both full box captions as editable fields', () => {
    // TEST: a fixed FFL caption on the left cannot be used to identify an individual box.
    const code = 'FFL_G_LKB0707_078';
    const html = renderToStaticMarkup(<SortReferenceLabelEditor code={code} kind="box" fields={defaultSortReferenceText(code)} onChange={() => undefined} />);
    expect(html).toContain('Текст слева');
    expect(html).toContain('Текст справа');
    expect(html).toContain('Ширина поля');
    expect(html).toContain('Высота поля');
    expect(html.match(/FFL_G_LKB0707_078/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
