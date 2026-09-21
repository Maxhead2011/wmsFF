import type { ReactNode } from 'react';
import { ShieldCheck, Send, ChartNoAxesCombined, ArrowRight } from 'lucide-react';
import './WbStockSettingsCards.css';

// FIX: keep reserve, publication and recommendations readable without changing their controls.
export function WbStockSettingsCards({ reserve, publicationEnabled, recommendations, onOpenConfirmation }: {
  reserve: ReactNode; publicationEnabled: boolean; recommendations: ReactNode; onOpenConfirmation?: () => void;
}) {
  return <div className="wb-stock-settings">
    <section className="wb-stock-settings__card"><h4><ShieldCheck size={20} /> Страховой резерв</h4>{reserve}</section>
    <section className="wb-stock-settings__card"><h4><Send size={20} /> Отправка в WB</h4>
      <strong className={`wb-stock-settings__status ${publicationEnabled ? 'is-enabled' : ''}`}>{publicationEnabled ? 'Отправка разрешена' : 'Отправка выключена'}</strong>
      <p>{publicationEnabled ? 'Изменения доступного остатка учитываются при фоновом пересчёте.' : 'Сохранённые доли не будут выгружены.'}</p>
      <details><summary>Как обновляются остатки</summary><p>При включённом автоуправлении учитываются сохранённые изменения после инвентаризации, актуализации короба, сортировки и перемещения. Перемещение между коробами одного склада не увеличивает общий остаток.</p></details>
      {onOpenConfirmation && <button type="button" className="secondary-button" onClick={onOpenConfirmation}>Подтверждение остатков WB <ArrowRight size={16} /></button>}
    </section>
    <section className="wb-stock-settings__card"><h4><ChartNoAxesCombined size={20} /> Рекомендации по долям</h4>{recommendations}</section>
  </div>;
}
