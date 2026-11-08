import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// TEST: the WB order has exactly the four requested document actions.
describe('WB document actions', () => {
 it('keeps download-all, printer selection, individual download and pick list', () => {
 const source=readFileSync(new URL('./FbsPanel.tsx',import.meta.url),'utf8');
 const tree=ts.createSourceFile('FbsPanel.tsx',source,99,true,ts.ScriptKind.TSX);
 let block='';
 function visit(n:ts.Node){if(ts.isJsxElement(n)&&n.openingElement.attributes.getText(tree).includes('className="fbs-order-documents"'))block=n.getText(tree);ts.forEachChild(n,visit)}visit(tree);
 expect(block).not.toBe('');
 expect((block.match(/<button\b/g)||[]).length).toBe(4);
 for(const label of ['Скачать все ШК','Печать всех ШК','Скачать ШК','Лист подбора'])expect(block).toContain(label);
 expect(block).not.toContain('ШК для ПВЗ');expect(block).not.toContain('ШК для СЦ');
 expect(block).toContain("onDownloadSticker('print')");
 });
});
