import type { AuthSession } from '../../lib/api';
import { canCancelSorting } from './AdministrationSortingCancellation';
import './administration-operational-tiles.css';
export type OperationalTool = 'receipt-problems' | 'sorting-cancellation' | 'fbo-problems';
export const canReviewReceipts = (session: AuthSession) => import.meta.env.VITE_ADMIN_PROBLEMS_ENABLED === 'true'
  && !session.user.isDemo && session.user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER');
// FIX: both operational tools are ordinary tiles in the shared administration grid.
export function AdministrationOperationalTiles({ session, active, onSelect, includeFbo = false, offset = 0 }: {
  session: AuthSession; active?: string; onSelect: (tool: OperationalTool) => void; includeFbo?: boolean; offset?: number;
}) {
  const tiles = [
    ...(canReviewReceipts(session) ? [{ id: 'receipt-problems' as const, title: 'Проблемы приёмки', description: 'Проверка штрихкодов и исправление расхождений при приёмке', tone: 1 }] : []),
    ...(canCancelSorting(session) ? [{ id: 'sorting-cancellation' as const, title: 'Незавершённые сортировки', description: 'Снятие пустых сессий с сохранением товара и размещения', tone: 2 }] : []),
    ...(includeFbo && canReviewReceipts(session) ? [{ id: 'fbo-problems' as const, title: 'Проблемы ФБО', description: 'Проверка сборки, коробов и этапов поставки', tone: 0 }] : []),
  ];
  return <>{tiles.map((tile, index) => <button key={tile.id} type="button" className={`admin-topic-tile admin-topic-tile--${tile.tone} admin-operational-tile`}
    aria-current={active === tile.id ? 'page' : undefined} onClick={() => onSelect(tile.id)}>
    <span className="admin-topic-tile__icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tile.id === 'sorting-cancellation' ? <><path d="M4 8a8 8 0 1 1-1 8M4 3v5h5"/><path d="M12 8v5l3 2"/></> : <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7 6l9 5"/></>}
    </svg></span>
    <span className="admin-topic-tile__content"><small>{String(offset + index + 1).padStart(2, '0')}</small><strong>{tile.title}</strong><span>{tile.description}</span></span>
  </button>)}</>;
}
