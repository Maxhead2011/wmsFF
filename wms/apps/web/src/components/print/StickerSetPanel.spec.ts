import { describe, expect, it } from 'vitest';
import { chooseStickerDestination } from './StickerSetPanel';

describe('serial box print destination', () => {
  it('does not silently route a new session to the local Bluetooth printer', () => {
    // TEST: the former loader assigned NIIMBOT_B1_BROWSER whenever no destination was selected.
    expect(chooseStickerDestination('', [], [])).toBe('');
  });
});
