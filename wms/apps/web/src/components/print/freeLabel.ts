export type TextBlock = { id: string; text: string; x: number; y: number; width: number; height: number; font: string; fontSize: number; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right'; rotation: number; counter: boolean; start: number; step: number; digits: number };
export type FreeLabel = { width: number; height: number; copies: number; blocks: TextBlock[] };
// FIX: standalone labels have no SKU, request, stock or billing dependency.
export function freeLabelEnabled(host: string) { return ['wms.logoff.pro', '77.37.144.211', '192.168.0.45', 'localhost', '127.0.0.1'].includes(host); }
export function defaultBlock(): TextBlock { return { id: crypto.randomUUID(), text: 'ФБО', x: 3, y: 8, width: 52, height: 24, font: 'Times New Roman', fontSize: 56, bold: false, italic: false, align: 'center', rotation: 0, counter: false, start: 1, step: 1, digits: 3 }; }
export function defaultLabel(): FreeLabel { return { width: 58, height: 40, copies: 1, blocks: [defaultBlock()] }; }
export function blockText(b: TextBlock, index: number) { return b.counter ? b.text + String(b.start + b.step * index).padStart(b.digits, '0') : b.text; }
export function moveBlock(b: TextBlock, x: number, y: number, l: FreeLabel) { return { ...b, x: Math.max(0, Math.min(x, l.width - b.width)), y: Math.max(0, Math.min(y, l.height - b.height)) }; }
export function validateLabel(l: FreeLabel): string[] {
  const valid = (n: number, a: number, b: number) => Number.isFinite(n) && n >= a && n <= b;
  const errors: string[] = [];
  if (!valid(l.width, 10, 200) || !valid(l.height, 10, 200)) errors.push('Размер этикетки должен быть от 10 до 200 мм.');
  if (!Number.isInteger(l.copies) || !valid(l.copies, 1, 100)) errors.push('Количество этикеток: от 1 до 100.');
  if (!Array.isArray(l.blocks) || !l.blocks.length || l.blocks.length > 30) return [...errors, 'Добавьте от 1 до 30 текстовых полей.'];
  for (const b of l.blocks) {
    if (!b || typeof b.id !== 'string' || typeof b.text !== 'string' || b.text.length > 4000 || typeof b.font !== 'string' || !b.font.trim() || b.font.length > 100 || /[";{}\\]/.test(b.font) ||
      !valid(b.fontSize, 4, 200) || !valid(b.width, 1, l.width) || !valid(b.height, 1, l.height) || !valid(b.x, 0, l.width - b.width + 0.001) || !valid(b.y, 0, l.height - b.height + 0.001) ||
      ![0,90,180,270].includes(b.rotation) || !['left','center','right'].includes(b.align) || !Number.isSafeInteger(b.start) || b.start < 0 || !Number.isSafeInteger(b.step) || b.step < 0 || !Number.isSafeInteger(b.start + b.step * (l.copies - 1)) || !Number.isInteger(b.digits) || !valid(b.digits,1,12) ||
      typeof b.counter !== 'boolean' || typeof b.bold !== 'boolean' || typeof b.italic !== 'boolean') errors.push('Проверьте размеры, положение и настройки текстовых полей.');
  }
  return [...new Set(errors)];
}
export function parseLabel(text: string): FreeLabel {
  if (text.length > 200000) throw new Error('Макет слишком большой.');
  const l = JSON.parse(text); if (!l || validateLabel(l).length) throw new Error('Некорректный макет этикетки.'); return l;
}
export function wrapText(text: string, width: number, measure: (s: string) => number) {
  return text.split('\n').flatMap(line => {
    const lines: string[] = []; let current = '';
    for (const char of line) { if (current && measure(current + char) > width) { lines.push(current); current = ''; } current += char; }
    lines.push(current); return lines;
  });
}
// FIX: preview and printing use the same raster; fonts cannot silently change on another printer.
export async function renderFreeLabel(l: FreeLabel, index = 0) {
  const errors = validateLabel(l); if (errors.length) throw new Error(errors.join(' '));
  for (const b of l.blocks) {
    if(b.font.startsWith('UserFont-') && ![...document.fonts].some(f=>f.family===b.font)) throw new Error('Загрузите шрифт, использованный в сохранённом макете.');
    await document.fonts.load(`${b.bold ? 'bold ' : ''}${b.italic ? 'italic ' : ''}${b.fontSize}px "${b.font}"`);
  }
  await document.fonts.ready;
  const scale = 300 / 25.4, c = document.createElement('canvas'); c.width = Math.round(l.width * scale); c.height = Math.round(l.height * scale);
  const ctx = c.getContext('2d'); if (!ctx) throw new Error('Не удалось создать предпросмотр.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.scale(scale,scale);
  for (const b of l.blocks) {
    ctx.save(); ctx.translate(b.x+b.width/2,b.y+b.height/2); ctx.rotate(b.rotation*Math.PI/180);
    const width = b.rotation % 180 ? b.height : b.width, height = b.rotation % 180 ? b.width : b.height;
    ctx.translate(-width/2,-height/2); ctx.fillStyle='#000'; const size=b.fontSize*25.4/72;
    ctx.font=`${b.italic?'italic ':''}${b.bold?'bold ':''}${size}px "${b.font}"`; ctx.textBaseline='top'; ctx.textAlign=b.align;
    const lines=wrapText(blockText(b,index),width,s=>ctx.measureText(s).width), lineHeight=size*1.15;
    if (lines.length * lineHeight > height + 0.01 || lines.some(s=>ctx.measureText(s).width>width+0.01)) throw new Error('Текст не помещается в поле. Увеличьте поле или уменьшите шрифт.');
    lines.forEach((s,n)=>ctx.fillText(s,b.align==='center'?width/2:b.align==='right'?width:0,(height-lines.length*lineHeight)/2+n*lineHeight));ctx.restore();
  }
  return c.toDataURL('image/png');
}
export async function openFreeLabelPrint(l: FreeLabel) {
  const errors=validateLabel(l);if(errors.length)throw new Error(errors.join(' '));
  const w=window.open('', '_blank');if(!w)throw new Error('Разрешите открытие окна печати в браузере.');
  w.document.title='Свободная этикетка';w.document.body.textContent='Подготавливаю этикетки…';
  try {
    const urls=[];for(let i=0;i<l.copies;i++)urls.push(await renderFreeLabel(l,i));
    const d=w.document;d.body.replaceChildren();const style=d.createElement('style');style.textContent=`@page{size:${l.width}mm ${l.height}mm;margin:0}body{margin:0;background:#eee}img{display:block;width:${l.width}mm;height:${l.height}mm;break-after:page}img:last-child{break-after:auto}button,p{font:16px system-ui;margin:12px}@media print{button,p{display:none}body{background:white}}`;d.head.append(style);
    const button=d.createElement('button');button.disabled=true;button.textContent='Выбрать принтер и печатать';button.onclick=()=>w.print();d.body.append(button);
    const hint=d.createElement('p');hint.textContent='Масштаб 100%, без полей. Количество уже учтено в страницах; копии в диалоге — 1. Можно выбрать «Сохранить в PDF».';d.body.append(hint);
    for(const src of urls){const im=d.createElement('img');im.src=src;im.alt='Этикетка';d.body.append(im);await im.decode();}
    button.disabled=false;w.focus();
  } catch(e) {w.close();throw e;}
}
