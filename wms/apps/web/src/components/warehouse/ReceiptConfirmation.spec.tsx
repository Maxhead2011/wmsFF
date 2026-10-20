import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ReceiptConfirmation } from './ReceiptConfirmation';

// TEST: both previously inline confirmations must use the top-layer modal.
it('routes both receipt confirmations through the modal without changing save callbacks', () => {
  const source = readFileSync(new URL('./ReceiptDirectionsPanel.tsx', import.meta.url), 'utf8');
  expect(source).toContain('{approval&&<ReceiptConfirmation');
  expect(source).toContain('{preview&&<ReceiptConfirmation');
  expect(source).toContain('confirmApproval(approval.row,approval.available,true)');
  expect(source).toContain('onClick={()=>void save()}');
});

// TEST: accessible title and server error stay inside the confirmation.
it('renders a labelled dialog containing the save error and controls', () => {
  const html = renderToStaticMarkup(<ReceiptConfirmation title="Подтверждение" busy={false}
    message="Не удалось сохранить" onCancel={() => {}}><button>Подтвердить</button></ReceiptConfirmation>);
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain('role="status"');
  expect(html).toContain('Не удалось сохранить');
});
