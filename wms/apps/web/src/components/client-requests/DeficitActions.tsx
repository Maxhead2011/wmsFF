import React from 'react';

// FIX: zero stock requires an explicit exclusion rather than rounding up to one.
export function DeficitActions({ available, disabled, onAdjust, onExclude }: {
  available: number; disabled: boolean; onAdjust: (quantity: number) => void; onExclude: () => void;
}) {
  return <div>
    <button type="button" disabled={disabled || available <= 0} onClick={() => onAdjust(available)}>Учесть по фактическому остатку</button>
    <button type="button" disabled={disabled} onClick={onExclude}>Исключить позицию</button>
  </div>;
}
