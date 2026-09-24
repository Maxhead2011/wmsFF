import { describe, expect, it } from 'vitest';
import { chooseStickerDestination, serialBoxLayout, validateSerialSafeMargin } from './StickerSetPanel';
import { buildStickerTspl } from '../../lib/stickerLayout';

describe('serial box print destination', () => {
  it('does not silently route a new session to the local Bluetooth printer', () => {
    // TEST: the former loader assigned NIIMBOT_B1_BROWSER whenever no destination was selected.
    expect(chooseStickerDestination('', [], [])).toBe('');
  });
  it('keeps an explicitly chosen installed local printer', () => {
    // TEST: both serial layout modes can open the local browser print dialog.
    expect(chooseStickerDestination('LOCAL_BROWSER', [], [])).toBe('LOCAL_BROWSER');
  });
});

describe('serial box label layout', () => {
  it('keeps text inside a 4 mm print-safe inset and rejects a caption moved into the cut zone', () => {
    // TEST: the old 2 mm offset was visibly clipped on a physical P2 label.
    const layout = serialBoxLayout(50, 30, 'qr', 4);
    expect(layout.boxes!.client.x).toBeGreaterThanOrEqual(32);
    expect(layout.boxes!.number.x).toBeGreaterThanOrEqual(32);
    expect(() => validateSerialSafeMargin(layout.boxes!, 50, 30, 4, 'qr', true)).not.toThrow();
    expect(() => validateSerialSafeMargin({ ...layout.boxes!, number: { ...layout.boxes!.number, x: 8 } }, 50, 30, 4, 'qr', true)).toThrow(/поле/);
    expect(() => validateSerialSafeMargin({ ...layout.boxes!, client: { ...layout.boxes!.client, x: 8 } }, 50, 30, 4, 'qr', false)).not.toThrow();
  });
  it('keeps the client, QR and movable FFL caption inside 60 × 40 mm', () => {
    // TEST: changing printer or size must not retain the old portrait coordinates.
    const layout = serialBoxLayout(60, 40, 'qr');
    expect(layout.boxes!.number.y).toBeGreaterThan(layout.boxes!.qr.y + layout.boxes!.qr.height);
    expect(buildStickerTspl({ ...layout, font: 3, qrLevel: 'M', qrModule: 4, barcodeHeight: 70, topText: '', bottomText: '' })).toContain('SIZE 60 mm,40 mm');
  });
});
