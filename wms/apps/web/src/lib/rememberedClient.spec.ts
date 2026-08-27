import { describe, expect, it } from 'vitest';
import { rememberedClientIdFromSameTabEvent } from './rememberedClient';

describe('remembered client synchronization', () => {
  // TEST: a selection written by another browser tab must not restart the
  // current branch-scoped workspace with a client unavailable in this tab.
  it('ignores cross-tab storage events', () => {
    const event = {
      type: 'storage',
      key: 'logoff-wms:last-client:user-1',
      newValue: 'client-from-another-branch',
    } as unknown as Event;

    expect(
      rememberedClientIdFromSameTabEvent(event, 'logoff-wms:last-client:user-1'),
    ).toBe('');
  });

  // TEST: selectors mounted inside one workspace still share an explicit user choice.
  it('accepts the WMS same-tab change event for the same user', () => {
    const event = {
      type: 'logoff-wms:last-client-change',
      detail: {
        storageKey: 'logoff-wms:last-client:user-1',
        clientId: ' client-1 ',
      },
    } as unknown as Event;

    expect(
      rememberedClientIdFromSameTabEvent(event, 'logoff-wms:last-client:user-1'),
    ).toBe('client-1');
  });
});
