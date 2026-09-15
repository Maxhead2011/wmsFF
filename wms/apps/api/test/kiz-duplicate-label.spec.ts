import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { buildKizDuplicateLabel } from '../src/modules/print/kiz-duplicate-label';

prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
describe('58 × 40 duplicate label round trip', () => {
  // TEST: decode the final printed image, including literal encoder-like sequences.
  it.each(['AbCd/0123+xyz=', '^FNC1^029test', ',;()%<>!?+ABC'])('retains exact bytes and GS1 symbology: %s', async crypto => {
    const raw = '0104680992597663215(bfrY!Bf.IME\u001d91EE12\u001d92' + crypto;
    const image = await buildKizDuplicateLabel(raw, { id: 'sku', name: 'Костюм женский', article: 'Ностальджи_молочнокоричневый', size: 'L / 48', color: 'молочный, коричневый' });
    const codes = await readBarcodes(Buffer.from(image, 'base64'), { formats: ['DataMatrix'], textMode: 'Plain', tryHarder: true });
    expect(codes).toHaveLength(1);
    expect(Buffer.from(codes[0].bytes).toString('ascii')).toBe(raw);
    expect(codes[0].symbologyIdentifier).toBe(']d2');
  }, 15000);
});
