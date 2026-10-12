import {afterEach,expect,it,vi} from 'vitest';
import {TelegramNotificationService} from '../src/modules/client-notifications/telegram-notification.service';
function setup(topic:number|null=144){
 const current={enabled:true,chatId:'-1003961789026',sections:['SYSTEM'],messageThreadId:topic};
 const db={auditLog:{findFirst:vi.fn().mockImplementation(({where})=>Promise.resolve({payload:where.entity==='telegram'?{enabled:true,botToken:'test-token',sections:['SYSTEM']}:current}))}};
 const audit={write:vi.fn().mockResolvedValue({})};const service=new TelegramNotificationService(db as any,audit as any);
 const fetch=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',fetch);return {service,audit,fetch};
}
afterEach(()=>vi.unstubAllGlobals());
// TEST: persisted forum topic must be included in both automatic and test sends.
it('routes client notifications into the configured forum topic',async()=>{const s=setup();await s.service.notifyClient('c','event','SYSTEM');expect(JSON.parse(s.fetch.mock.calls[0][1].body)).toMatchObject({chat_id:'-1003961789026',message_thread_id:144});await s.service.sendTestToClient('c');expect(JSON.parse(s.fetch.mock.calls[1][1].body).message_thread_id).toBe(144);});
it('preserves topic when legacy settings UI saves the same group',async()=>{const s=setup();await s.service.updateClientSettings('c',{enabled:true,chatId:'-1003961789026',sections:['SYSTEM']},{} as any);expect(s.audit.write.mock.calls[0][0].payload.messageThreadId).toBe(144);});
it('never carries a topic into a different group',async()=>{const s=setup();await s.service.updateClientSettings('c',{enabled:true,chatId:'-100999',sections:['SYSTEM']},{} as any);expect(s.audit.write.mock.calls[0][0].payload.messageThreadId??null).toBeNull();});
it('rejects invalid topic IDs before saving or sending',async()=>{const s=setup();await expect(s.service.updateClientSettings('c',{enabled:true,chatId:'-1003961789026',sections:['SYSTEM'],messageThreadId:-1} as any,{} as any)).rejects.toThrow();expect(s.audit.write).not.toHaveBeenCalled();});
it('keeps ordinary group delivery unchanged without a topic',async()=>{const s=setup(null);await s.service.notifyClient('c','event','SYSTEM');expect(JSON.parse(s.fetch.mock.calls[0][1].body)).not.toHaveProperty('message_thread_id');});
it('does not send when the client section is disabled',async()=>{const s=setup();expect((await s.service.notifyClient('c','event','FBS')).sent).toBe(false);expect(s.fetch).not.toHaveBeenCalled();});
