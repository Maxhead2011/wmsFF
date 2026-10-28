import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';

describe('FBO workspace style dependencies',()=>{
  // TEST: reproduce the release build with external lazy panels, not Vite's CSS preloader.
  it('keeps modal, sorting and request action styling when lazy panels are external',async()=>{
    const require=createRequire(import.meta.url);
    const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');
    const entry=fileURLToPath(new URL('./FboWorkspace.tsx',import.meta.url));
    const result=await build({entryPoints:[entry],bundle:true,write:false,outfile:'fixture.js',format:'esm',plugins:[{
      name:'external-lazy-panels',setup(b:any){
        b.onResolve({filter:/.*/},(a:any)=>a.kind==='entry-point'||a.path.endsWith('.css')?undefined:{path:a.path,external:true});
      },
    }]});
    const css=result.outputFiles.find((f:any)=>f.path.endsWith('.css'))?.text??'';
    expect(/\.online-execution-modal\s*\{\s*position:\s*fixed/.test(css), 'modal positioning CSS').toBe(true);
    expect(/\.client-request-sortbar\s*\{[^}]*display:\s*flex/.test(css), 'sortbar layout CSS').toBe(true);
    expect(css.includes('.client-request-action-button'), 'request button CSS').toBe(true);
    expect(css.includes('.request-action-menu'), 'request disclosure CSS').toBe(true);
  },30000);
});
