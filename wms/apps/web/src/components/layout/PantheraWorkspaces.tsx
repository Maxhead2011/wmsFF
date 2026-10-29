import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './panthera-windows.css';

type Props = { activeId: string; onOpen: (id: string) => void; render: (id: string) => ReactNode };
type WindowEntry = { element: HTMLElement; button: HTMLButtonElement; title: string; minimized: boolean };

// FIX: retain only pages with minimized windows. Their forms stay mounted in React.
export function PantheraWorkspaces({ activeId, onOpen, render }: Props) {
  const serial = useRef(0);
  const [state, setState] = useState<{ selected: Record<string, string>; retained: Record<string, string> }>({ selected: {}, retained: {} });
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const activeKey = state.selected[activeId] || `${activeId}:0`;
  // FIX: each minimized page instance owns its own hooks, form state and callbacks.
  const retain = (key: string, workspace: string, needed: boolean) => {
    const nextKey = `${workspace}:${++serial.current}`;
    setState(old => {
      if (needed === Boolean(old.retained[key])) return old;
      const retained = { ...old.retained };
      if (needed) retained[key] = workspace; else delete retained[key];
      const selected = { ...old.selected };
      if (needed && (selected[workspace] || `${workspace}:0`) === key) selected[workspace] = nextKey;
      return { selected, retained };
    });
  };
  const pages = { ...state.retained, [activeKey]: activeId };
  return <>{Object.entries(pages).map(([key, workspace]) =>
    <PantheraWindowSurface key={key} dock={dock} active={key === activeKey} onOpen={() => {
      setState(old => ({ ...old, selected: { ...old.selected, [workspace]: key } }));
      onOpen(workspace);
    }} onRetain={needed => retain(key, workspace, needed)}>{render(workspace)}</PantheraWindowSurface>)}
    {createPortal(<aside ref={setDock} className="panthera-window-dock" aria-label="Свёрнутые окна" />, document.body)}</>;
}

function PantheraWindowSurface({ active, onOpen, onRetain, children, dock }: {
  active: boolean; onOpen: () => void; onRetain: (needed: boolean) => void; children: ReactNode; dock: HTMLElement | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const callbacks = useRef({ onOpen, onRetain });
  callbacks.current = { onOpen, onRetain };
  useEffect(() => {
    const surface = root.current!;
    const entries = new Map<HTMLElement, WindowEntry>();
    const publish = () => {
      setWindows([...entries.values()]);
      callbacks.current.onRetain([...entries.values()].some(entry => entry.minimized));
    };
    const sync = () => {
      let changed = false;
      for (const [element, entry] of entries) if (!surface.contains(element)) {
        entry.button.remove(); entries.delete(element); changed = true;
      }
      // Explicit operational dialogs only: confirmations and native date pickers keep their behavior.
      surface.querySelectorAll<HTMLElement>('.online-execution-modal, .fbs-assembly-dialog-backdrop').forEach(element => {
        // FIX: marketplace shells retain the embedded assembly's guarded close header.
        const header = element.querySelector<HTMLElement>('.online-execution-modal__header, .fbs-assembly-dialog__heading, .fbo-inline-execution__header');
        if (!header) return;
        const existing = entries.get(element);
        if (existing) {
          // FIX: loading can replace the header; keep this window's minimized state and button.
          if (!header.contains(existing.button)) {
            const close = header.querySelector<HTMLButtonElement>('button[title="Закрыть"], button[aria-label="Закрыть"]');
            if (close?.parentElement) close.parentElement.insertBefore(existing.button, close);
            else header.append(existing.button);
          }
          return;
        }
        const title = header.querySelector('h2,h3')?.textContent?.trim() || element.getAttribute('aria-label') || 'Окно WMS';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'icon-button panthera-window-minimize';
        button.textContent = '−'; button.title = 'Свернуть окно'; button.setAttribute('aria-label', 'Свернуть окно');
        const entry: WindowEntry = { element, button, title, minimized: false };
        button.onclick = () => {
          entry.minimized = true; element.classList.add('panthera-window-minimized');
          (document.activeElement as HTMLElement | null)?.blur(); publish();
        };
        // FIX: insert beside the existing close button, including nested action toolbars.
        const close = header.querySelector<HTMLButtonElement>('button[title="Закрыть"], button[aria-label="Закрыть"]');
        if (close?.parentElement) close.parentElement.insertBefore(button, close);
        else header.append(button);
        entries.set(element, entry); changed = true;
      });
      if (changed) publish();
    };
    const observer = new MutationObserver(sync);
    observer.observe(surface, { childList: true, subtree: true }); sync();
    return () => {
      observer.disconnect();
      entries.forEach(entry => { entry.button.remove(); entry.element.classList.remove('panthera-window-minimized'); });
    };
  }, []);
  const minimized = windows.filter(entry => entry.minimized);
  return <><div ref={root} hidden={!active} className="panthera-window-surface">{children}</div>
    {dock && minimized.length > 0 && createPortal(<>
      {minimized.map((entry, index) => <button type="button" key={index} title={`Развернуть: ${entry.title}`} onClick={() => {
        callbacks.current.onOpen(); entry.minimized = false; entry.element.classList.remove('panthera-window-minimized');
        setWindows([...windows]); callbacks.current.onRetain(windows.some(item => item.minimized));
        requestAnimationFrame(() => entry.button.focus());
      }}><span aria-hidden="true">▣</span><span>{entry.title}</span><span aria-hidden="true">↗</span></button>)}
    </>, dock)}
  </>;
}
