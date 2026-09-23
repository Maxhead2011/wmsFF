import { describe, expect, it } from 'vitest';
import { buildLocalSkuPrintHtml } from './localSkuPrint';

describe('local SKU printing', () => {
  it('creates one 40 × 60 mm page for every requested copy', () => {
    const html = buildLocalSkuPrintHtml([
      { imageBase64: 'AAAA', copies: 2 },
      { imageBase64: 'BBBB', copies: 1 },
    ]);

    expect(html).toContain('@page { size: 40mm 60mm; margin: 0; }');
    expect(html.match(/class="label-page"/g)).toHaveLength(3);
    expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2);
    expect(html.match(/data:image\/png;base64,BBBB/g)).toHaveLength(1);
  });
});
