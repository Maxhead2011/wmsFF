import { describe, expect, it, vi } from 'vitest';
import { buildLocalSkuPrintHtml, openLocalSkuPrint } from './localSkuPrint';

describe('local SKU printing', () => {
  it('creates one 60 × 40 mm landscape page for every requested copy', () => {
    const html = buildLocalSkuPrintHtml([
      { imageBase64: 'AAAA', copies: 2 },
      { imageBase64: 'BBBB', copies: 1 },
    ]);

    expect(html).toContain('@page { size: 60mm 40mm; margin: 0; }');
    expect(html.match(/class="label-page"/g)).toHaveLength(3);
    expect(html.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2);
    expect(html.match(/data:image\/png;base64,BBBB/g)).toHaveLength(1);
  });
  it('uses 40 × 30 mm pages for the compact marketplace template', () => {
    // TEST: a compact PNG must not be sent to a 60 × 40 printer page.
    expect(buildLocalSkuPrintHtml([{ imageBase64: 'AAAA', copies: 1 }], 40, 30)).toContain('@page { size: 40mm 30mm; margin: 0; }');
  });
  it('supports local serial box paper without accepting unsafe dimensions', () => {
    // TEST: both serial templates must open on the installed local printer at the selected paper size.
    expect(buildLocalSkuPrintHtml([{ imageBase64: 'AAAA', copies: 1 }], 50, 30)).toContain('@page { size: 50mm 30mm; margin: 0; }');
    expect(() => buildLocalSkuPrintHtml([{ imageBase64: 'AAAA', copies: 1 }], 0, 30)).toThrow();
  });
  it('opens the dialog even when the popup never fires load and keeps a manual print button', async () => {
    // TEST: about:blank may already be loaded before document.write; waiting only for load left labels on screen.
    let printClick: (() => void) | undefined;
    const popup = {
      addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn(),
      document: {
        images: [{ decode: () => Promise.resolve() }], open: vi.fn(), write: vi.fn(), close: vi.fn(),
        getElementById: () => ({ addEventListener: (_event: string, callback: () => void) => { printClick = callback; } }),
      },
    } as unknown as Window;
    openLocalSkuPrint([{ imageBase64: 'AAAA', copies: 1 }], 60, 40, popup);
    await vi.waitFor(() => expect(popup.print).toHaveBeenCalledTimes(1));
    expect(popup.focus).toHaveBeenCalled();
    expect(printClick).toBeTypeOf('function');
    printClick?.();
    expect(popup.print).toHaveBeenCalledTimes(2);
    expect(buildLocalSkuPrintHtml([{ imageBase64: 'AAAA', copies: 1 }])).toContain('id="local-print-action"');
  });
});
