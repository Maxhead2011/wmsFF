import type { WbStockReserve } from '../../lib/api';

type Rule = WbStockReserve['lowStock'];

export function isValidLowStockReserve(rule: Rule) {
  return rule === undefined || (Number.isSafeInteger(rule.threshold) && rule.threshold >= 1 && rule.threshold <= 1000000 &&
    Number.isSafeInteger(rule.reserveUnits) && rule.reserveUnits >= 0 && rule.reserveUnits <= 1000000);
}

// FIX: client and administrator editors use identical low-stock fields and strict threshold wording.
export function WbLowStockReserveFields({ value, onChange, disabled }: { value: Rule; onChange: (rule: Rule) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} style={{ display: 'grid', gap: 12, margin: '12px 0', minWidth: 0 }}>
    <legend>Малый остаток</legend>
    <label><input type="checkbox" checked={value !== undefined} onChange={e => onChange(e.target.checked ? { threshold: 5, reserveUnits: 1 } : undefined)} />Особый резерв при малом остатке</label>
    {value && <>
      <label style={{ display: 'grid', gap: 4 }}>Если доступно меньше, шт.<input type="number" min={1} max={1000000} step={1} value={value.threshold} onChange={e => onChange({ ...value, threshold: Number(e.target.value) })} /></label>
      <label style={{ display: 'grid', gap: 4 }}>Оставлять резерв, шт.<input type="number" min={0} max={1000000} step={1} value={value.reserveUnits} onChange={e => onChange({ ...value, reserveUnits: Number(e.target.value) })} /></label>
      <p>Этот резерв заменяет основной. При остатке, равном порогу или выше, действует основной резерв. Применяется до распределения по складам WB.</p>
      {!isValidLowStockReserve(value) && <p role="alert">Порог: целое число от 1 до 1000000. Резерв: от 0 до 1000000 штук.</p>}
    </>}
  </fieldset>;
}

export function WbLowStockReserveSummary({ rule }: { rule: Rule }) {
  return rule ? <p>При доступном остатке меньше {rule.threshold} шт. резерв — {rule.reserveUnits} шт. вместо основного.</p> : null;
}
