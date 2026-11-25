import {describe,it,expect} from 'vitest';
import {requestActionExplanation} from './FbsRequestActionDialog';
// TEST: raw Ozon error from3319 and enriched server replies both have actionable explanations.
describe('request print explanations',()=>{
 it('explains incomplete exemplars and the explicit missing-GTD option',()=>{const r=requestActionExplanation('Ozon вернул HTTP 400 (3): EXEMPLAR_INFO_NOT_FILLED_COMPLETELY.');expect(r.title).toContain('экземплярах');expect(r.next).toContain('ГТД отсутствует');expect(r.next).toContain('Пустое поле');});
 it('retains the actual posting and article from the server',()=>{const r=requestActionExplanation('Отправление 0214691742-0254-3: red_50: ГТД. Код: EXEMPLAR_INFO_NOT_FILLED_COMPLETELY.');expect(r.detail).toContain('0214691742-0254-3');expect(r.detail).toContain('red_50');expect(r.detail).not.toContain('EXEMPLAR_INFO');});
 it('keeps other errors specific without pretending to know missing documents',()=>{expect(requestActionExplanation('Нет доступного принтера').detail).toBe('Нет доступного принтера');});
});
