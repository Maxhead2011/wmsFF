import { describe, expect, it } from 'vitest';
import { parseDuplicateKiz, duplicateBarcodeOptions } from '../src/modules/print/kiz-duplicate-code';

const raw = "0104680992597663215(bfrY!Bf.IME\u001d91EE12\u001d92AbCd/0123+xyz=";
describe('duplicate KIZ preserves the scanner payload', () => {
  // TEST: copying must never merge two marks, truncate punctuation or repair unknown bytes.
  it('preserves punctuation, case and GS byte for byte', () => {
    expect(parseDuplicateKiz(raw)).toMatchObject({ raw, gtin: '04680992597663', identity: raw.split('\u001d')[0] });
    expect(parseDuplicateKiz(']d2' + raw + '\r\n').raw).toBe(raw);
  });
  it.each([raw.split('\u001d')[0], raw.replace(/\u001d/g, ' '), raw + '\n' + raw, raw.toLowerCase().replace('ee12', 'ее12'), raw.replace('04680992597663', '04680992597664')])('rejects incomplete or corrupted input', code => {
    expect(() => parseDuplicateKiz(code)).toThrow();
  });
  it('does not let literal encoder escapes become control commands', () => {
    const code = raw.replace('AbCd/0123+xyz=', '^FNC1^029test');
    expect(duplicateBarcodeOptions(code).text).not.toContain('92^FNC1');
  });
});
