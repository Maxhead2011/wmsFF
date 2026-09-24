import { useEffect, useRef, useState, type PointerEvent } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { fitStickerText, moveStickerBox, type StickerBoxes, type StickerCodeKind, type StickerTextStyles } from '../../lib/stickerLayout';

type Key = keyof StickerBoxes;
const labels: Record<Key, string> = { client: 'Клиент', top: 'Текст сверху', qr: 'QR', barcode: 'Штрихкод', number: 'Номер', bottom: 'Текст снизу' };

export function StickerCanvasEditor({ width, height, boxes, onChange, clientName, topText, bottomText, value, codeKind, qrLevel, font, valueLabel = 'Номер', safeMarginMm, textStyles, onTextStylesChange }: {
  width: number; height: number; boxes: StickerBoxes; onChange: (boxes: StickerBoxes) => void;
  clientName: string; topText: string; bottomText: string; value: string; codeKind: StickerCodeKind; qrLevel: 'L' | 'M' | 'Q' | 'H'; font: number; valueLabel?: string;
  safeMarginMm?: number; textStyles?: StickerTextStyles; onTextStylesChange?: (next: StickerTextStyles) => void;
}) {
  const [selected, setSelected] = useState<Key>('number');
  const [qrImage, setQrImage] = useState('');
  const [barcodeImage, setBarcodeImage] = useState('');
  const gesture = useRef<{ key: Key; mode: 'move' | 'resize'; x: number; y: number; original: StickerBoxes } | null>(null);
  const pageWidth = width * 8;
  const pageHeight = height * 8;
  useEffect(() => {
    let active = true;
    if (value) void QRCode.toDataURL(value, { margin: 0, width: 256, errorCorrectionLevel: qrLevel }).then((data) => { if (active) setQrImage(data); }).catch(() => setQrImage(''));
    else setQrImage('');
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 100 });
      setBarcodeImage(canvas.toDataURL('image/png'));
    } catch { setBarcodeImage(''); }
    return () => { active = false; };
  }, [value, qrLevel]);
  const entries: { key: Key; text: string }[] = [
    ...(clientName ? [{ key: 'client' as const, text: clientName }] : []),
    ...(topText ? [{ key: 'top' as const, text: topText }] : []),
    ...(codeKind !== 'code128' ? [{ key: 'qr' as const, text: '▦' }] : []),
    ...(codeKind !== 'qr' ? [{ key: 'barcode' as const, text: '||||||||||||||||' }] : []),
    { key: 'number', text: value || valueLabel },
    ...(bottomText ? [{ key: 'bottom' as const, text: bottomText }] : []),
  ];

  function pointerDown(event: PointerEvent<HTMLElement>, key: Key, mode: 'move' | 'resize') {
    event.preventDefault(); event.stopPropagation();
    setSelected(key);
    gesture.current = { key, mode, x: event.clientX, y: event.clientY, original: boxes };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) return;
    let next = moveStickerBox(current.original[current.key], event.clientX - current.x, event.clientY - current.y, pageWidth, pageHeight, current.mode === 'resize');
    if (current.key === 'qr' && current.mode === 'resize') {
      const side = Math.max(25, Math.floor(Math.min(next.width, next.height, pageWidth - next.x, pageHeight - next.y) / 25) * 25);
      next = { ...next, width: side, height: side };
    }
    onChange({ ...current.original, [current.key]: next });
  }

  return <div className="sticker-set__editor">
    <div className="sticker-set__canvas-wrap"><div className="sticker-set__canvas" style={{ width: pageWidth, height: pageHeight }} aria-label="Макет этикетки; перетащите объект или потяните за угол для изменения размера">
      {safeMarginMm ? <div className="sticker-set__safe-area" style={{ inset: safeMarginMm * 8 }} aria-label={`Безопасное поле ${safeMarginMm} мм`} /> : null}
      {entries.map(({ key, text }) => {
        const box = boxes[key];
        let fitted: { size: number; lines: string[] } | null = null;
        if (key !== 'qr' && key !== 'barcode') {
          try {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            fitted = fitStickerText(text, box, Math.max(18, font * 6), (line, size) => {
              if (!context) return line.length * size * .65;
              context.font = `700 ${size}px Arial`;
              return context.measureText(line).width;
            });
          } catch { /* The warning below remains visible until the field fits. */ }
        }
        return <div key={key} className={`sticker-set__object sticker-set__object--${key}${selected === key ? ' is-selected' : ''}${!fitted && key !== 'qr' && key !== 'barcode' ? ' is-overflow' : ''}`}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height, fontSize: fitted?.size, textAlign: textStyles?.[key as keyof StickerTextStyles]?.align ?? 'left', fontWeight: textStyles?.[key as keyof StickerTextStyles]?.bold ? 900 : 700 }}
          title={key === 'number' ? valueLabel : labels[key]} onPointerDown={(event) => pointerDown(event, key, 'move')} onPointerMove={pointerMove} onPointerUp={() => { gesture.current = null; }}>
          {key === 'qr' && qrImage ? <img src={qrImage} alt="" draggable={false} /> : key === 'barcode' && barcodeImage ? <img src={barcodeImage} alt="" draggable={false} /> : <span>{fitted ? fitted.lines.map((line, index) => <span key={index}>{line}<br /></span>) : text}</span>}
          <i onPointerDown={(event) => pointerDown(event, key, 'resize')} aria-label={`Изменить размер: ${key === 'number' ? valueLabel : labels[key]}`} />
        </div>;
      })}
    </div></div>
    <div className="sticker-set__positions"><b>Расположение и размер</b><p>Чтобы передвинуть подпись FFL, зажмите её прямо на белой этикетке и перетащите мышью. Синий угол меняет размер поля. Ниже можно выбрать любой элемент и точно задать его положение.</p>
      <label>Элемент<select value={selected} onChange={(event) => setSelected(event.target.value as Key)}>{entries.map(({ key }) => <option key={key} value={key}>{key === 'number' ? valueLabel : labels[key]}</option>)}</select></label>
      {(['x', 'y', 'width', 'height'] as const).map((property) => <label key={property}>{({ x: 'X', y: 'Y', width: 'Ширина', height: 'Высота' })[property]}<input type="number" min="0" value={boxes[selected][property]} onChange={(event) => onChange({ ...boxes, [selected]: { ...boxes[selected], [property]: Number(event.target.value) } })} /></label>)}
      {onTextStylesChange && selected !== 'qr' && selected !== 'barcode' ? <><label>Выравнивание<select value={textStyles?.[selected]?.align ?? 'left'} onChange={event => onTextStylesChange({ ...textStyles, [selected]: { align: event.target.value as 'left' | 'center' | 'right', bold: textStyles?.[selected]?.bold ?? false } })}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select></label><label className="sticker-set__check"><input type="checkbox" checked={textStyles?.[selected]?.bold ?? false} onChange={event => onTextStylesChange({ ...textStyles, [selected]: { align: textStyles?.[selected]?.align ?? 'left', bold: event.target.checked } })} />Жирный</label></> : null}
    </div>
  </div>;
}
