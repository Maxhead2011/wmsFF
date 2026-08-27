import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Plus,
  Settings2,
  X,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import {
  buildSpaceNavigation,
  loadSpaceWidgetIds,
  moveSpaceWidget,
  moveSpaceWidgetByOffset,
  saveSpaceWidgetIds,
  selectSpaceWidgets,
  spaceSectionDefinitions,
  spaceSectionForWorkspace,
} from '../../lib/spaceNavigation';
import type { WorkspaceId, WorkspaceNavItem } from '../../lib/workspaces';

type SpaceServiceShelfProps = {
  userId: string;
  items: WorkspaceNavItem[];
  onOpen: (id: WorkspaceId) => void;
};

// FIX: Space is now a user-arranged workspace instead of an automatic list of frequent links.
export function SpaceServiceShelf({ userId, items, onOpen }: SpaceServiceShelfProps) {
  const [widgetIds, setWidgetIds] = useState<WorkspaceId[]>(() => loadSpaceWidgetIds(userId));
  const [isEditing, setEditing] = useState(false);
  const [isCatalogOpen, setCatalogOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<WorkspaceId | null>(null);

  const widgets = useMemo(() => selectSpaceWidgets(items, widgetIds), [items, widgetIds]);
  const selectedSet = new Set(widgets.map((item) => item.id));
  const catalogSections = useMemo(
    () => buildSpaceNavigation(items.filter((item) => item.id !== 'overview'))
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !widgetIds.includes(item.id)),
      }))
      .filter((section) => section.items.length > 0),
    [items, widgetIds],
  );

  function updateWidgets(next: WorkspaceId[]) {
    setWidgetIds(next);
    saveSpaceWidgetIds(userId, next);
  }

  function addWidget(id: WorkspaceId) {
    if (selectedSet.has(id)) return;
    updateWidgets([...widgetIds, id]);
  }

  function removeWidget(id: WorkspaceId) {
    updateWidgets(widgetIds.filter((candidate) => candidate !== id));
  }

  function moveWidget(id: WorkspaceId, offset: -1 | 1) {
    updateWidgets(moveSpaceWidgetByOffset(widgetIds, id, offset));
  }

  function handleDragStart(event: DragEvent<HTMLElement>, id: WorkspaceId) {
    if (!isEditing) return;
    setDraggingId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: WorkspaceId) {
    event.preventDefault();
    const sourceId = draggingId ?? event.dataTransfer.getData('text/plain') as WorkspaceId;
    if (sourceId) updateWidgets(moveSpaceWidget(widgetIds, sourceId, targetId));
    setDraggingId(null);
  }

  function toggleEditing() {
    setEditing((current) => {
      if (current) setCatalogOpen(false);
      return !current;
    });
  }

  return (
    <section className="space-services" aria-label="Моё рабочее пространство">
      <header>
        <div>
          <h2>Моё рабочее пространство</h2>
          <p>{isEditing ? 'Перетаскивайте, добавляйте и удаляйте виджеты' : 'Ваши рабочие модули в нужном порядке'}</p>
        </div>
        <div className="space-services__actions">
          {isEditing ? (
            <button
              className={isCatalogOpen ? 'is-active' : ''}
              type="button"
              aria-expanded={isCatalogOpen}
              onClick={() => setCatalogOpen((current) => !current)}
            >
              <Plus size={16} aria-hidden="true" />
              Добавить виджеты
            </button>
          ) : null}
          <button
            className={isEditing ? 'is-active' : ''}
            type="button"
            aria-pressed={isEditing}
            onClick={toggleEditing}
          >
            <Settings2 size={16} aria-hidden="true" />
            {isEditing ? 'Готово' : 'Настроить'}
          </button>
        </div>
      </header>

      {isEditing && isCatalogOpen ? (
        <div className="space-widget-catalog" aria-label="Каталог виджетов">
          <div className="space-widget-catalog__heading">
            <strong>Добавить из разделов WMS</strong>
            <span>Показаны только доступные вам модули</span>
          </div>
          <div className="space-widget-catalog__sections">
            {catalogSections.map((section) => (
              <section className="space-widget-catalog__section" key={section.id}>
                <h3>{section.title}</h3>
                <div>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.id} type="button" onClick={() => addWidget(item.id)}>
                        <Icon size={17} aria-hidden="true" />
                        <span>{item.title}</span>
                        <Plus size={15} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          {!catalogSections.length ? <p className="space-widget-catalog__empty">Все доступные модули уже добавлены.</p> : null}
        </div>
      ) : null}

      <div className="space-services__grid">
        {widgets.map((item, index) => {
          const Icon = item.icon;
          const sectionTitle = spaceSectionDefinitions.find(
            (section) => section.id === spaceSectionForWorkspace(item.id),
          )?.title;
          return (
            <article
              className={`${isEditing ? 'is-editing' : ''}${draggingId === item.id ? ' is-dragging' : ''}`}
              key={item.id}
              draggable={isEditing}
              onDragStart={(event) => handleDragStart(event, item.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, item.id)}
            >
              <button className="space-services__open" type="button" onClick={() => onOpen(item.id)}>
                <Icon size={22} aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{isEditing ? 'Перетащите в нужное место' : sectionTitle}</small>
                </span>
              </button>
              {isEditing ? (
                <div className="space-widget-controls" aria-label={`Настройка виджета ${item.title}`}>
                  <GripVertical className="space-widget-controls__handle" size={17} aria-hidden="true" />
                  <button
                    type="button"
                    title="Сдвинуть влево"
                    aria-label={`Сдвинуть ${item.title} влево`}
                    disabled={index === 0}
                    onClick={() => moveWidget(item.id, -1)}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title="Сдвинуть вправо"
                    aria-label={`Сдвинуть ${item.title} вправо`}
                    disabled={index === widgets.length - 1}
                    onClick={() => moveWidget(item.id, 1)}
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="is-remove"
                    type="button"
                    title="Удалить виджет"
                    aria-label={`Удалить виджет ${item.title}`}
                    onClick={() => removeWidget(item.id)}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {!widgets.length ? (
        <div className="space-services__empty">
          <strong>Рабочее пространство пока пустое</strong>
          <span>Нажмите «Настроить», затем добавьте нужные виджеты.</span>
        </div>
      ) : null}
    </section>
  );
}
