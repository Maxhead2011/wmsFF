import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DeficitActions } from './DeficitActions';
// TEST: at zero the only available resolution is explicit exclusion.
it('disables adjustment for zero stock but keeps exclusion available', () => {
  const html = renderToStaticMarkup(<DeficitActions available={0} disabled={false} onAdjust={() => {}} onExclude={() => {}} />);
  expect(html).toMatch(/disabled="">Учесть/);
  expect(html).toContain('<button type="button">Исключить позицию</button>');
});
