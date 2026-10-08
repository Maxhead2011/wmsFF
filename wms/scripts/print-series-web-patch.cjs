const ts=require('../node_modules/typescript');
// FIX: replace only the serial-label AGENT branch; preserve its actual PNG renderer and layout.
function patch(text) {
 const ast=ts.createSourceFile('runtime.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const matches=[];
 function walk(n){if(ts.isIfStatement(n)&&n.expression.getText(ast).includes('startsWith("AGENT:")')&&n.thenStatement.getText(ast).includes('for(const')&&n.thenStatement.getText(ast).includes('textStyles:'))matches.push(n);ts.forEachChild(n,walk);}walk(ast);
 if(matches.length!==1)throw Error('Expected exactly one verified serial-label branch');
 const block=matches[0].thenStatement,loop=block.statements.find(ts.isForOfStatement);
 const calls=[];function inspect(n){if(ts.isAwaitExpression(n)&&ts.isCallExpression(n.expression)&&n.expression.arguments.length===2&&ts.isObjectLiteralExpression(n.expression.arguments[1])&&n.expression.arguments[1].properties.some(p=>p.name?.getText(ast)==='stationId'))calls.push(n);ts.forEachChild(n,inspect);}inspect(loop);
 if(calls.length!==1)throw Error('Expected one per-label enqueue');
 const call=calls[0],payload=call.expression.arguments[1],token=call.expression.arguments[0].getText(ast);
 const field=name=>{const p=payload.properties.find(p=>p.name?.getText(ast)===name);if(!p||!ts.isPropertyAssignment(p))throw Error('Missing '+name);return p.initializer.getText(ast)};
 if(field('copies')!=='1')throw Error('Unexpected serial copies semantics');
 const append=`__seriesPages.push({value:${field('value')},imageBase64:${field('imageBase64')}})`;
 const body=loop.getText(ast),offset=call.getStart(ast)-loop.getStart(ast);
 const replaced=body.slice(0,offset)+append+body.slice(call.end-loop.getStart(ast));
 const submit=`await globalThis.LOGOFF_PRINT_SERIES.submit(${token},{stationId:${field('stationId')},clientId:${field('clientId')},widthMm:${field('widthMm')},heightMm:${field('heightMm')},pages:__seriesPages});`;
 return text.slice(0,loop.getStart(ast))+`const __seriesPages=[];${replaced}${submit}`+text.slice(loop.end);
}
module.exports={patch};
