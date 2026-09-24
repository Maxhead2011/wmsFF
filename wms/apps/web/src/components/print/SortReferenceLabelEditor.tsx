import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { defaultSortReferenceText, renderSortReferencePng, sortReferenceTextScale, type SortReferenceKind, type SortReferenceText } from '../../lib/sortReferenceLabel';

type Side = keyof SortReferenceText;

// FIX: editable DOM captions and printed PNG/TSPL use the same dot coordinates.
export function SortReferenceLabelEditor({ code, kind, fields, onChange }: {
  code: string; kind: SortReferenceKind; fields: SortReferenceText; onChange: (next: SortReferenceText) => void;
}) {
  const [baseImage, setBaseImage] = useState('');
  const [selected, setSelected] = useState<Side>('left');
  const drag = useRef<{ side: Side; mode: 'move' | 'resize'; x: number; y: number; originalX: number; originalY: number; originalWidth: number; originalHeight: number } | null>(null);
  const inputs = useRef<{ left: HTMLInputElement | null; right: HTMLInputElement | null }>({ left: null, right: null });

  useEffect(() => {
    if (!code.trim()) { setBaseImage(''); return; }
    let active = true;
    renderSortReferencePng(code, kind, defaultSortReferenceText(code), false)
      .then(image => { if (active) setBaseImage(image); })
      .catch(() => { if (active) setBaseImage(''); });
    return () => { active = false; };
  }, [code, kind]);

  function update(side: Side, patch: Partial<SortReferenceText[Side]>) {
    const next = { ...fields[side], ...patch };
    next.width = clamp(Math.round(next.width), 40, 290);
    next.height = clamp(Math.round(next.height), 18, 60);
    next.x = clamp(Math.round(next.x), 8, 472 - next.height);
    next.y = clamp(Math.round(next.y), next.width + 8, 310);
    onChange({ ...fields, [side]: next });
  }

  function pointerDown(event: PointerEvent<HTMLElement>, side: Side, mode: 'move' | 'resize') {
    event.preventDefault(); event.stopPropagation();
    setSelected(side);
    drag.current = { side, mode, x: event.clientX, y: event.clientY, originalX: fields[side].x, originalY: fields[side].y, originalWidth: fields[side].width, originalHeight: fields[side].height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { side, mode, x, y, originalX, originalY, originalWidth, originalHeight } = drag.current;
    if (mode === 'resize') update(side, { width: originalWidth - (event.clientY - y), height: originalHeight + event.clientX - x });
    else update(side, { x: originalX + event.clientX - x, y: originalY + event.clientY - y });
  }

  return <div className="sort-reference-editor">
    <p>Выберите подпись слева или справа. Перетащите её мышью; синий угол изменяет размер поля. Дважды нажмите на подпись, чтобы перейти к вводу её текста. QR и штрихкоды всегда содержат настоящий код объекта.</p>
    <div className="sort-reference-editor__scroll"><div className="sort-reference-editor__canvas">
      {baseImage ? <img src={`data:image/png;base64,${baseImage}`} alt="Основа этикетки с QR и штрихкодами" draggable={false} /> : null}
      {(['left', 'right'] as const).map(side => <div key={side}
        className={`sort-reference-editor__caption${selected === side ? ' is-selected' : ''}${fields[side].text.length * 11 > fields[side].width ? ' is-overflow' : ''}`}
        style={{ left: fields[side].x, top: fields[side].y, width: fields[side].width, height: fields[side].height, fontSize: 20 * sortReferenceTextScale(fields[side]), textAlign: fields[side].align ?? 'left', fontWeight: fields[side].bold ? 900 : 500 }}
        title={side === 'left' ? 'Текст слева — перетащите' : 'Текст справа — перетащите'}
        onDoubleClick={() => inputs.current[side]?.focus()}
        onPointerDown={event => pointerDown(event, side, 'move')} onPointerMove={pointerMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {fields[side].text || (side === 'left' ? 'Текст слева' : 'Текст справа')}
        <i aria-label={`Изменить размер поля: ${side === 'left' ? 'текст слева' : 'текст справа'}`} onPointerDown={event => pointerDown(event, side, 'resize')} />
      </div>)}
    </div></div>
    <div className="sort-reference-editor__fields">
      {(['left', 'right'] as const).map(side => <fieldset key={side} className={selected === side ? 'is-selected' : ''} onClick={() => setSelected(side)}><legend>{side === 'left' ? 'Текст слева' : 'Текст справа'}</legend>
        <label>Надпись<input ref={element => { inputs.current[side] = element; }} maxLength={24} value={fields[side].text} onFocus={() => setSelected(side)} onChange={event => update(side, { text: event.target.value })} /></label>
        <label>Слева, точек<input type="number" min="8" max="450" value={fields[side].x} onChange={event => update(side, { x: Number(event.target.value) })} /></label>
        <label>Сверху, точек<input type="number" min="20" max="310" value={fields[side].y} onChange={event => update(side, { y: Number(event.target.value) })} /></label>
        <label>Ширина поля<input type="number" min="40" max="290" value={fields[side].width} onChange={event => update(side, { width: Number(event.target.value) })} /></label>
        <label>Высота поля<input type="number" min="18" max="60" value={fields[side].height} onChange={event => update(side, { height: Number(event.target.value) })} /></label>
        <label>Выравнивание<select value={fields[side].align ?? 'left'} onChange={event => update(side, { align: event.target.value as 'left' | 'center' | 'right' })}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select></label>
        <label className="sticker-set__check"><input type="checkbox" checked={fields[side].bold ?? false} onChange={event => update(side, { bold: event.target.checked })} />Жирный</label>
      </fieldset>)}
    </div>
  </div>;
}

function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)); }
