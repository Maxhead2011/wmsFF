import { expect, it } from 'vitest';
import { buildTsdRelabelLabel } from '../src/modules/tsd/tsd-relabel-label';

it('renders a single 58 × 40 mm Lukin-style target barcode label', async () => {
  // TEST: the barcode, EAC and product fields must fit one PNG for the 2409 station.
  const base64 = await buildTsdRelabelLabel('2042312098168', {
    name: 'Трикотажный спортивный костюм с брюками', article: 'Костюм_баленсиага_белый',
    color: 'белый', size: 'S', brand: 'LOOK (IN)',
  }, 'Лукин И.И.');
  const png = Buffer.from(base64, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(696);
  expect(png.readUInt32BE(20)).toBe(480);
}, 15000);
