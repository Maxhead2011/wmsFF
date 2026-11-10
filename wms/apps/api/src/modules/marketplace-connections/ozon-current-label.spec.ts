import { describe,it,expect,vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { currentOzonLabel } from './ozon-current-label';
const init={headers:{'Api-Key':'secret','Client-Id':'seller'},body:JSON.stringify({posting_number:['p1']})};
const done=()=>({error:null,file_url:'https://ir.ozone.ru/s3/label.pdf',status:{code:'completed',postings_count:1,printed_postings_count:1,unprinted_postings:[]}});
const create={tasks:[{task_type:'small_label',task_id:1}]};
describe('current Ozon labels',()=>{
 // TEST: preserve the shorter TSD/caller deadline and cancellation.
 it('does not create a task after caller cancellation',async()=>{
  const controller=new AbortController();controller.abort(new Error('caller cancelled'));
  const json=vi.fn();
  await expect(currentOzonLabel({...init,signal:controller.signal},json)).rejects.toThrow('caller cancelled');
  expect(json).not.toHaveBeenCalled();
 });
 // TEST: real observed API shapes, polling and credential-free PDF download.
 it('creates the current task and downloads its completed PDF',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
  const json=vi.fn().mockResolvedValueOnce(create).mockResolvedValueOnce({status:{code:'pending'}}).mockResolvedValueOnce(done());
  const download=vi.fn().mockResolvedValue(new Response(bytes));const pause=vi.fn().mockResolvedValue(undefined);
  const result=await currentOzonLabel(init,json,download,pause);
  expect(result.buffer.length).toBe(bytes.length);expect(json.mock.calls[0][0]).toContain('/v3/posting/fbs/package-label/create');
  expect(JSON.parse(json.mock.calls[0][1].body)).toEqual({posting_numbers:['p1']});
  expect(download.mock.calls[0][1].headers).toBeUndefined();expect(pause).toHaveBeenCalledTimes(1);
 });
 it('bounds pending polls and does not recreate the task in the same request',async()=>{
  const json=vi.fn().mockResolvedValueOnce(create).mockResolvedValue({status:{code:'pending'}});
  await expect(currentOzonLabel(init,json,vi.fn(),vi.fn().mockResolvedValue(undefined))).rejects.toThrow('ещё формирует');
  expect(json).toHaveBeenCalledTimes(13);
 });
 it.each(['failed','partial','foreign','invalid'])('rejects %s without returning a bad label',async mode=>{
  const result=done();if(mode==='failed')result.status.code='failed';if(mode==='partial')result.status.printed_postings_count=0;if(mode==='foreign')result.file_url='https://example.com/a.pdf';
  const json=vi.fn().mockResolvedValueOnce(create).mockResolvedValue(result);const download=vi.fn().mockResolvedValue(new Response('not pdf'));
  await expect(currentOzonLabel(init,json,download)).rejects.toThrow();if(mode!=='invalid')expect(download).not.toHaveBeenCalled();
 });
});
