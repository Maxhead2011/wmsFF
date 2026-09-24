import { describe, expect, it } from 'vitest';
import { chooseStickerDestination, serialBoxLayout } from './StickerSetPanel';
import { buildStickerTspl } from '../../lib/stickerLayout';

describe('serial box print destination', () => {
  it('does not silently route a new session to the local Bluetooth printer', () => {
    // TEST: the former loader assigned NIIMBOT_B1_BROWSER whenever no destination was selected.
    expect(chooseStickerDestination('', [], [])).toBe('');
  });
});

describe('serial box label layout', () => {
  it('keeps the client, QR and movable FFL caption inside 60 × 40 mm', () => {
    // TEST: changing printer or size must not retain the old portrait coordinates.
    const layout = serialBoxLayout(60, 40, 'qr');
    expect(layout.boxes!.number.y).toBeGreaterThan(layout.boxes!.qr.y + layout.boxes!.qr.height);
    expect(buildStickerTspl({ ...layout, font: 3, qrLevel: 'M', qrModule: 4, barcodeHeight: 70, topText: '', bottomText: '' })).toContain('SIZE 60 mm,40 mm');
  });
});
