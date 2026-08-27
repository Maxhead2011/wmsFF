import { ChevronDown, CircleHelp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSpaceNavigation, type SpaceSectionId } from '../../lib/spaceNavigation';
import type { WorkspaceId, WorkspaceNavItem } from '../../lib/workspaces';

type SpaceTopNavProps = {
  items: WorkspaceNavItem[];
  activeWorkspaceId: WorkspaceId;
  kizUnread: number;
  onOpen: (id: WorkspaceId) => void;
};

// ADDED: Space uses one horizontal navigation tree instead of the legacy sidebar.
export function SpaceTopNav({ items, activeWorkspaceId, kizUnread, onOpen }: SpaceTopNavProps) {
  const groups = useMemo(() => buildSpaceNavigation(items), [items]);
  const [openGroupId, setOpenGroupId] = useState<SpaceSectionId | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openGroupId) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpenGroupId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenGroupId(null);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openGroupId]);

  return (
    <header className="space-topbar" ref={rootRef}>
      <button className="space-topbar__brand" type="button" onClick={() => onOpen('overview')}>
        <span>LOGOFF</span>
        <strong>WMS</strong>
        <small>Space</small>
      </button>

      <nav className="space-topbar__nav" aria-label="Главное меню Space">
        {groups.map((group) => {
          const isActive = group.items.some((item) => item.id === activeWorkspaceId);
          const isOpen = group.id === openGroupId;
          return (
            <div className={`space-topbar__group${isActive ? ' is-active' : ''}`} key={group.id}>
              <button
                className="space-topbar__trigger"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                onClick={() => setOpenGroupId((current) => current === group.id ? null : group.id)}
              >
                <span>{group.title}</span>
                <CircleHelp className="space-topbar__help" size={15} aria-hidden="true" />
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              {isOpen ? (
                <section className="space-topbar__popover" role="dialog" aria-label={`О разделе ${group.title}`}>
                  <header>
                    <strong>{group.title}</strong>
                    <p>{group.description}</p>
                  </header>
                  <div className="space-topbar__items">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const itemActive = item.id === activeWorkspaceId;
                      return (
                        <button
                          className={itemActive ? 'is-active' : ''}
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onOpen(item.id);
                            setOpenGroupId(null);
                          }}
                        >
                          <Icon size={18} aria-hidden="true" />
                          <span>
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                          {item.id === 'kiz' && kizUnread > 0 ? (
                            <em aria-label={`Проблем КИЗ: ${kizUnread}`}>{kizUnread > 99 ? '99+' : kizUnread}</em>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          );
        })}
      </nav>
    </header>
  );
}
