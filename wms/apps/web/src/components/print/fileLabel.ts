// FIX: fit the whole source on one label, never stretch or crop it.
export function fitLabel(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  if (![sourceWidth,sourceHeight,width,height].every(n=>Number.isFinite(n)&&n>0)) throw new Error('Некорректный размер страницы.');
  const scale=Math.min(width/sourceWidth,height/sourceHeight),w=sourceWidth*scale,h=sourceHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function labelPages(value: string, count: number) {
  if(!Number.isInteger(count)||count<1||count>100)throw new Error('Допускается до 100 страниц.');
  if(!value.trim())return Array.from({length:count},(_,i)=>i+1);
  const result=new Set<number>();
  for(const part of value.split(',')){
    const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('Укажите страницы: например 1, 3-5.');
    const a=Number(m[1]),b=Number(m[2]??m[1]);if(a<1||b<a||b>count)throw new Error('Номер страницы вне файла.');for(let i=a;i<=b;i++)result.add(i);
  }
  return [...result];
}
export function fitImage(source: CanvasImageSource, sourceWidth:number,sourceHeight:number,width:number,height:number){
  const c=document.createElement('canvas');c.width=Math.round(width*300/25.4);c.height=Math.round(height*300/25.4);const ctx=c.getContext('2d');if(!ctx)throw new Error('Не удалось подготовить страницу.');
  ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const r=fitLabel(sourceWidth,sourceHeight,c.width,c.height);ctx.drawImage(source,r.x,r.y,r.width,r.height);return c.toDataURL('image/png');
}
