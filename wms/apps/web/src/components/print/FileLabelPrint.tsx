import type { AuthSession } from '../../lib/api';
import { openLabelAgent } from './freeLabelAgent';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { fitImage, labelPages } from './fileLabel';

export function FileLabelPrint({session,width,height}:{session:AuthSession;width:number;height:number}){
  const [file,setFile]=useState<File|null>(null),[count,setCount]=useState(0),[selection,setSelection]=useState(''),[preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copies,setCopies]=useState(1);
  const pdf=useRef<PDFDocumentProxy|null>(null),image=useRef<HTMLImageElement|null>(null),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;void pdf.current?.destroy();},[]);
  async function load(next?:File){
    const g=++generation.current;setBusy(true);setError('');setPreview('');setCount(0);setFile(next??null);setSelection('');await pdf.current?.destroy();pdf.current=null;image.current=null;
    try{if(!next)return;if(next.size>40*1024*1024)throw new Error('Файл должен быть не больше 40 МБ.');
      if(next.type==='application/pdf'||/\.pdf$/i.test(next.name)){
        const lib=await import('pdfjs-dist');lib.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        const doc=await lib.getDocument({data:await next.arrayBuffer(),isEvalSupported:false}).promise;
        if(g!==generation.current){await doc.destroy();return;}if(doc.numPages>100){await doc.destroy();throw new Error('В PDF допускается до 100 страниц.');}pdf.current=doc;setCount(doc.numPages);
      }else{if(!['image/png','image/jpeg','image/webp'].includes(next.type))throw new Error('Выберите PDF, PNG, JPG или WebP.');
        const url=URL.createObjectURL(next),im=new Image();try{im.src=url;await im.decode();}finally{URL.revokeObjectURL(url);}if(g!==generation.current)return;if(im.naturalWidth*im.naturalHeight>40000000)throw new Error('Изображение слишком большое (максимум 40 Мп).');image.current=im;setCount(1);
      }
    }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Не удалось открыть файл.');}finally{if(g===generation.current)setBusy(false);}
  }
  async function render(page:number){
    if(pdf.current){const p=await pdf.current.getPage(page);const base=p.getViewport({scale:1});const scale=Math.min(width*300/25.4/base.width,height*300/25.4/base.height);const viewport=p.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await p.render({canvas,viewport}).promise;return fitImage(canvas,canvas.width,canvas.height,width,height);}
    const im=image.current;if(!im)throw new Error('Сначала выберите файл.');return fitImage(im,im.naturalWidth,im.naturalHeight,width,height);
  }
  useEffect(()=>{let alive=true;setPreview('');if(count&&!busy){try{const page=labelPages(selection,count)[0];void render(page).then(v=>{if(alive){setPreview(v);setError('');}}).catch(e=>{if(alive)setError(e.message);});}catch(e){setError(e instanceof Error?e.message:'Проверьте страницы.');}}return()=>{alive=false;};},[width,height,count,selection,busy]);
  async function print(){
    let pages:number[];try{pages=labelPages(selection,count);if(!Number.isInteger(copies)||copies<1||copies*pages.length>100)throw new Error('Всего допускается от 1 до 100 этикеток.');}catch(e){setError((e as Error).message);return;}
    const w=window.open('','_blank');if(!w){setError('Разрешите открытие окна печати.');return;}w.document.body.textContent='Подготовка…';setBusy(true);
    try{const d=w.document,urls=[];for(const page of pages)urls.push(await render(page));d.body.replaceChildren();d.title='Печать из файла';const style=d.createElement('style');style.textContent=`@page{size:${width}mm ${height}mm;margin:0}body{margin:0}img{display:block;width:${width}mm;height:${height}mm;break-after:page}img:last-child{break-after:auto}button,p{margin:12px;font:16px system-ui}@media print{button,p{display:none}}`;d.head.append(style);const b=d.createElement('button');b.textContent='Выбрать принтер и печатать';b.disabled=true;b.onclick=()=>w.print();d.body.append(b);const hint=d.createElement('p');hint.textContent='Масштаб 100%, без полей. Копии уже включены: в диалоге печати укажите 1 копию.';d.body.append(hint);for(let n=0;n<copies;n++)for(const src of urls){const im=d.createElement('img');im.src=src;im.alt='Страница этикетки';d.body.append(im);await im.decode();}b.disabled=false;w.focus();}catch(e){w.close();setError(e instanceof Error?e.message:'Ошибка подготовки.');}finally{setBusy(false);}
  }
  return <div><label>Выберите файл<input disabled={busy} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>void load(e.target.files?.[0])}/></label><p>PDF, PNG, JPG, WebP · до 40 МБ. Полное содержимое вписывается в {width} × {height} мм с сохранением пропорций.</p>{file&&<p>{file.name} · страниц: {count}</p>}<div className="free-label__grid"><label>Страницы (пусто — все)<input disabled={busy} placeholder="1, 3-5" value={selection} onChange={e=>setSelection(e.target.value)}/></label><label>Копий каждого комплекта<input disabled={busy} type="number" min="1" max="100" value={copies} onChange={e=>setCopies(Number(e.target.value))}/></label></div>{preview&&<img className="free-label__file-preview" src={preview} alt="Файл в выбранном размере этикетки"/>}<p>Предпросмотр первой выбранной страницы. В окне печати можно проверить весь комплект.</p>{error&&<p role="alert" className="free-label__error">{error}</p>}<button disabled={busy||!preview||!!error} onClick={()=>void print()}>{busy?'Подготовка…':'Предпросмотр и выбор принтера'}</button><button disabled={busy||!preview||!!error} onClick={()=>void openLabelAgent(session,width,height,async()=>{const pages=labelPages(selection,count);if(!Number.isInteger(copies)||copies<1||copies*pages.length>100)throw new Error('Всего допускается от 1 до 100 этикеток.');const images:string[]=[];for(let n=0;n<copies;n++)for(const page of pages)images.push(await render(page));return images;})}>Печать через агент</button></div>;
}
