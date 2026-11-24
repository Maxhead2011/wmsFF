import { describe, expect, it } from 'vitest';
import { defaultLabel, parseLabel, validateLabel, freeLabelEnabled, moveBlock } from './freeLabel';

// TEST: free text is printable without SKU, client, barcode or warehouse mutations.
describe('free label', () => {
  it('starts with a 58x40 FBO label and preserves Unicode through a template roundtrip', () => {
    expect(defaultLabel().blocks[0].text).toBe('ФБО');
    const label=defaultLabel();expect(parseLabel(JSON.stringify(label))).toEqual(label);
    expect(validateLabel(defaultLabel())).toEqual([]);
  });
  it('rejects invalid dimensions, copies, coordinates and oversized templates', () => {
    for (const key of ['width', 'height', 'copies'] as const) {
      expect(() => parseLabel(JSON.stringify({ ...defaultLabel(), [key]: -1 }))).toThrow();
    }
    const label = defaultLabel(); label.blocks[0].x = 1000;
    expect(validateLabel(label).length).toBeGreaterThan(0);
    expect(() => parseLabel('x'.repeat(200001))).toThrow();
  });
  it('does not interpret arbitrary text as HTML and validates font settings', () => {
    const label = defaultLabel(); label.blocks[0].text = '<script>alert(1)</script>\nКириллица';
    expect(parseLabel(JSON.stringify(label)).blocks[0].text).toBe(label.blocks[0].text);
    label.blocks[0].fontSize = Number.NaN;
    expect(validateLabel(label).length).toBeGreaterThan(0);
  });
  it('keeps dragged blocks inside physical label bounds', () => {
    const label = defaultLabel();
    expect(moveBlock(label.blocks[0], -10, 200, label)).toMatchObject({ x: 0, y: label.height - label.blocks[0].height });
  });
  it('leaves sold installations disabled', () => {
    expect(freeLabelEnabled('sold.example')).toBe(false);
    expect(freeLabelEnabled('wms.logoff.pro')).toBe(true);
    expect(freeLabelEnabled('77.37.144.211')).toBe(true);
  });
});
