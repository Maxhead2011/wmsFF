import { ArrowRight, Grid2X2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import './workspace-tile-gate.css';

export type WorkspaceTile = {
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: 'blue' | 'violet' | 'green' | 'orange' | 'red';
  onOpen?: () => void;
};

type WorkspaceTileGateProps = {
  eyebrow: string;
  title: string;
  description: string;
  tiles: WorkspaceTile[];
  children: ReactNode;
  initiallyOpen?: boolean;
  embedded?: boolean;
};

/**
 * A consistent first screen for operational workspaces.  It prevents a user
 * from landing on a wide table or a long form and keeps the actual workspace
 * one deliberate click away.
 */
export function WorkspaceTileGate({ eyebrow, title, description, tiles, children, initiallyOpen = false, embedded = false }: WorkspaceTileGateProps) {
  // ADDED: Embedded operational panels can bypass their own landing gate without changing the standalone route.
  const [isOpen, setOpen] = useState(initiallyOpen);

  if (embedded) return <>{children}</>;

  if (isOpen) {
    return <div className="workspace-tile-gate workspace-tile-gate--open">
      <button className="workspace-tile-gate__back" type="button" onClick={() => setOpen(false)}>
        <Grid2X2 size={16} />
        Разделы
      </button>
      {children}
    </div>;
  }

  return <section className="workspace-tile-gate" aria-label={title}>
    <header className="workspace-tile-gate__header">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
    <div className="workspace-tile-gate__grid">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return <button
          className={`workspace-tile-gate__tile workspace-tile-gate__tile--${tile.tone ?? 'blue'}`}
          key={tile.title}
          type="button"
          onClick={() => {
            tile.onOpen?.();
            setOpen(true);
          }}
        >
          <span className="workspace-tile-gate__icon"><Icon size={23} /></span>
          <span className="workspace-tile-gate__body"><strong>{tile.title}</strong><small>{tile.description}</small></span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>;
      })}
    </div>
  </section>;
}
