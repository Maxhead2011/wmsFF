import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchTurnoverBoxDetails, type TurnoverBoxDetails } from '../../lib/api';
import './storageBoxContentsPopover.css';

type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: TurnoverBoxDetails } | { status: 'error'; error: string };

// FIX: lazy reads only; coalesce duplicate events and discard responses from an old session/box.
export function createBoxPreviewLoader(fetcher: () => Promise<TurnoverBoxDetails>, publish: (state: PreviewState) => void) {
  let generation = 0;
  let pending: Promise<void> | null = null;
  return {
    load() {
      if (pending) return pending;
      const current = generation;
      publish({ status: 'loading' });
      pending = fetcher().then(data => {
        if (generation === current) publish({ status: 'ready', data });
      }).catch((error: unknown) => {
        if (generation === current) publish({ status: 'error', error: error instanceof Error ? error.message : 'Не удалось загрузить состав короба.' });
      }).finally(() => { if (generation === current) pending = null; });
      return pending;
    },
    invalidate() { generation += 1; pending = null; },
  };
}

// FIX: portal positioning is independent of the pallet list's clipping/scroll containers.
export function positionBoxPreview(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, viewportWidth: number, viewportHeight: number) {
  const width = Math.min(440, Math.max(0, viewportWidth - 24));
  const maxHeight = Math.min(400, Math.max(0, viewportHeight - 24));
  const preferred = rect.right + 10 + width <= viewportWidth - 12 ? rect.right + 10 : rect.left - width - 10;
  return { width, maxHeight, left: Math.max(12, Math.min(preferred, viewportWidth - width - 12)),
    top: Math.max(12, Math.min(rect.top, viewportHeight - maxHeight - 12)) };
}

export function BoxContentsCard({ state }: { state: PreviewState }) {
  if (state.status === 'idle' || state.status === 'loading') return <p role="status">Загружаю товары…</p>;
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  if (state.data.contents.length === 0) return <p>По данным WMS в коробе нет товаров.</p>;
  return <>
    <p className="storage-box-preview__total">Всего по WMS: <strong>{`${state.data.totals.quantity} шт.`}</strong></p>
    <ul className="storage-box-preview__items">
      {state.data.contents.map(item => <li key={item.balanceId}>
        <div className="storage-box-preview__product"><strong>{item.name}</strong><b>{`${item.quantity} шт.`}</b></div>
        <p>{[item.article || item.clientSku || item.internalSku, item.color, item.size].filter(Boolean).join(' · ')}</p>
        <p className="storage-box-preview__barcode">ШК: {item.barcode || 'Не указан'}</p>
        <small>{item.statusLabel}</small>
      </li>)}
    </ul>
  </>;
}

export function StorageBoxContentsPopover({ accessToken, warehouseId, clientId, boxCode, exists, revision, children }: {
  accessToken: string; warehouseId?: string | null; clientId: string; boxCode: string; exists: boolean;
  revision?: unknown; children: ReactNode;
}) {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const suppressFocus = useRef(false);
  const id = useId();
  const loader = useMemo(() => createBoxPreviewLoader(async () => {
    if (!exists) throw new Error('Короб не найден в WMS. Состав недоступен.');
    const result = await fetchTurnoverBoxDetails(accessToken, boxCode, { clientId });
    if (result.box.code.toLocaleUpperCase('ru-RU') !== boxCode.toLocaleUpperCase('ru-RU') || result.box.client.id !== clientId) {
      throw new Error('Получены данные другого короба. Повторите загрузку.');
    }
    return result;
  }, setState), [accessToken, warehouseId, clientId, boxCode, exists, revision]);
  const [opened, setOpened] = useState<typeof loader | null>(null);
  const isOpen = opened === loader;
  const [position, setPosition] = useState({ left: 12, top: 12, width: 440, maxHeight: 400 });
  const [theme, setTheme] = useState<CSSProperties>({});

  function cancelTimers() { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); }
  function close(restoreFocus = false) {
    cancelTimers(); setOpened(null);
    if (restoreFocus) {
      suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false;
    }
  }
  function show() {
    cancelTimers();
    if (isOpen || !trigger.current) return;
    // FIX: the body portal must retain variables defined on the current app theme container.
    const computed = getComputedStyle(trigger.current);
    setTheme(Object.fromEntries(['--surface', '--text', '--ink', '--line', '--muted']
      .map(name => [name, computed.getPropertyValue(name)]).filter(([, value]) => value.trim())) as CSSProperties);
    setPosition(positionBoxPreview(trigger.current.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    // FIX: a keyboard-focused preview must not stack with a newly hovered box.
    window.dispatchEvent(new CustomEvent('wms:box-preview-open', { detail: id }));
    setOpened(loader); void loader.load();
  }
  function scheduleClose() {
    cancelTimers();
    closeTimer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement) && !trigger.current?.contains(document.activeElement)) close();
    }, 180);
  }

  useEffect(() => () => { loader.invalidate(); cancelTimers(); }, [loader]);
  useEffect(() => {
    if (!isOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(Boolean(panel.current?.contains(document.activeElement))); }
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const reposition = () => {
      if (trigger.current) setPosition(positionBoxPreview(trigger.current.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    const replacePreview = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('wms:box-preview-open', replacePreview);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('wms:box-preview-open', replacePreview);
    };
  }, [isOpen, loader]);

  return <>
    <button ref={trigger} type="button" className="storage-box-preview__trigger"
      aria-label={`Товары в коробе ${boxCode}`} aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={isOpen ? id : undefined}
      onMouseEnter={() => { cancelTimers(); openTimer.current = setTimeout(show, 250); }}
      onMouseLeave={scheduleClose} onFocus={() => { if (!suppressFocus.current) show(); }} onBlur={scheduleClose} onClick={show}>
      {children}
    </button>
    {isOpen && createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`}
      className="storage-box-preview" style={{ ...theme, ...position, position: 'fixed' }}
      onMouseEnter={cancelTimers} onMouseLeave={scheduleClose} onFocus={cancelTimers} onBlur={scheduleClose}>
      <header><div><strong id={`${id}-title`}>{boxCode}</strong><small>Товары в коробе</small></div>
        <button type="button" aria-label="Закрыть состав короба" onClick={() => close(true)}>×</button></header>
      <div className="storage-box-preview__body" tabIndex={0} aria-label="Перечень товаров">
        <BoxContentsCard state={state} />
        {state.status === 'error' && <button type="button" className="storage-box-preview__retry" onClick={() => void loader.load()}>Повторить загрузку</button>}
      </div>
    </div>, document.body)}
  </>;
}
