import { labelFormatOptions } from './freeLabelAgent';
import {expect,it} from 'vitest';
import {compatibleLabelStations,labelAgentPayload} from './freeLabelAgent';
// TEST: arbitrary labels retain size and order and cannot reach an offline or wrong-format station.
it('offers only online matching stations',()=>{const s={id:'a',name:'A',printerName:'P',labelWidthMm:58,labelHeightMm:40};expect(compatibleLabelStations([s,{...s,id:'b'},{...s,id:'c',labelWidthMm:60}],[{id:'a'},{id:'c'}],58,40)).toEqual([s]);});
it('prepares exactly one ordered series without order or stock identifiers',()=>{expect(labelAgentPayload('client','station',58,40,['data:image/png;base64,QQ==','data:image/png;base64,Qg=='])).toEqual({clientId:'client',stationId:'station',widthMm:58,heightMm:40,pages:[{value:'Этикетка 1',imageBase64:'QQ=='},{value:'Этикетка 2',imageBase64:'Qg=='}]});});
it('rejects incomplete images and unsupported agent sizes before enqueueing',()=>{expect(()=>labelAgentPayload('c','s',58,40,[])).toThrow();expect(()=>labelAgentPayload('c','s',58,40,['bad'])).toThrow();expect(()=>labelAgentPayload('c','s',200,40,['data:image/png;base64,QQ=='])).toThrow();});

// TEST: Ozon media comes from the station even when no matching template exists.
it('offers printer media absent from templates, without duplicates',()=>{
 const options=labelFormatOptions([{id:'t',name:'Template',widthMm:58,heightMm:40,isActive:true}], [{id:'oz',name:'ОЗОН',printerName:'TSC',labelWidthMm:70,labelHeightMm:120},{id:'s',name:'Small',printerName:'TSC',labelWidthMm:58,labelHeightMm:40}]);
 expect(options).toHaveLength(2);expect(options[1]).toMatchObject({id:'station:oz',widthMm:70,heightMm:120});
});
