import {it,expect} from 'vitest';
import {formatTimelineTime} from './ClientRequestTimelineModal';
// TEST: history preserves the click second and Moscow date even across UTC midnight.
it('shows exact Moscow time rather than only a date',()=>{
 expect(formatTimelineTime('2026-10-30T07:08:33.462Z')).toBe('30.10.2026, 10:08:33 МСК');
 expect(formatTimelineTime('2026-10-30T22:08:33Z')).toBe('31.10.2026, 01:08:33 МСК');
});
