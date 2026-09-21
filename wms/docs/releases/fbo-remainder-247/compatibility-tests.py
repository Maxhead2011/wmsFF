import pathlib
r=pathlib.Path('/opt/logoff-wms-releases/fbo-remainder-20260921')
p=r/'candidate/wms/apps/api/test/fbo-two-stage.integration.spec.ts'
s=p.read_text();anchor='    // TEST: splitting a partial pick conserves demand'
extra='''    // TEST: the merged release preserves explicit close and parallel packing.
    it('retains STOP_PICK with remainder transfer disabled', async () => {
        vi.stubEnv('WMS_FBO_CLOSE_PICK_ENABLED', 'true');
        vi.stubEnv('WMS_FBO_REMAINDER_TRANSFER_ENABLED', 'false');
        await act('START'); await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        const result = await act('STOP_PICK');
        expect(result).toMatchObject({ phase: 'PACKING', needed: 2, picked: 2, pickClosed: true, unpicked: 2 });
        expect(await p.clientRequest.count({ where: { clientId: client } })).toBe(1);
    });
    it('retains packed units when splitting a parallel packing request', async () => {
        vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED', 'true');
        vi.stubEnv('WMS_FBO_REMAINDER_TRANSFER_ENABLED', 'true');
        await act('START'); await act('PICK_BOX', { sourceBoxCode: 'FFL_' + whole });
        await act('PACK_BOX', { sourceBoxCode: 'FFL_' + whole });
        const stockBefore = await p.stockBalance.findMany({ where: { clientId: client }, orderBy: { id: 'asc' } });
        const result = await act('TRANSFER_REMAINDER');
        expect(result).toMatchObject({ phase: 'PACKING', needed: 2, picked: 2, packed: 2, compositionChanged: false });
        expect(await p.fboAssemblyUnit.count({ where: { requestId: request, state: 'PACKED' } })).toBe(2);
        expect(await p.stockBalance.findMany({ where: { clientId: client }, orderBy: { id: 'asc' } })).toEqual(stockBefore);
    });
'''
assert s.count(anchor)==1 and 'retains STOP_PICK' not in s
p.write_text(s.replace(anchor,extra+anchor))
print('Added two release compatibility tests')
