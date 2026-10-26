import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {OzonEditCountdown,deadlineDisplay} from './OzonEditCountdown';
// TEST: countdown boundaries, missing deadlines and per-order clocks.
describe('Ozon deadline countdown',()=>{
 const now=Date.parse('2026-10-26T12:00:00Z');
 it('does not guess an absent or invalid deadline',()=>{expect(deadlineDisplay(null,now).tone).toBe('unknown');expect(deadlineDisplay('bad',now).tone).toBe('unknown');});
 it('expires at the deadline without displaying negative time',()=>{expect(deadlineDisplay('2026-10-26T12:00:00Z',now).tone).toBe('expired');expect(deadlineDisplay('2026-10-25T12:00:00Z',now).text).not.toContain('-');});
 it('changes urgency while time passes',()=>{const at='2026-10-27T15:00:00Z';expect(deadlineDisplay(at,now).tone).toBe('normal');expect(deadlineDisplay(at,now+4*3600000).tone).toBe('warning');expect(deadlineDisplay(at,now+26*3600000).tone).toBe('urgent');});
 it('rounds seconds upward so an active minute is not shown as expired',()=>{expect(deadlineDisplay('2026-10-26T12:00:01Z',now).text).toBe('До дедлайна: 0 ч. 1 мин.');});
 it('shows every order and explicitly labels Moscow timezone',()=>{const html=renderToStaticMarkup(<OzonEditCountdown enabled orders={[{orderId:'1',orderNumber:'A',editDeadlineAt:'2026-10-26T15:00:00Z'},{orderId:'2',orderNumber:'B',editDeadlineAt:null}]}/>);expect(html).toContain('Ozon №A');expect(html).toContain('Ozon №B');expect(html).toContain('18:00:00');expect(html).toContain('МСК');expect(html).toContain('Дедлайн неизвестен');});
 it('does not expose the new UI on a disabled deployment',()=>{expect(renderToStaticMarkup(<OzonEditCountdown enabled={false}/>)).toBe('');});
});
