import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReceiptDuplicateNotice, receiptDuplicateFromError } from './ReceiptDuplicateNotice';

// TEST: old generic errors and a lost reply must not be labelled duplicate stock.
it('requires a structured server duplicate and retains evidence', () => {
  expect(receiptDuplicateFromError(new Error('ДУБЛЬ КИЗ'))).toBeNull();
  expect(receiptDuplicateFromError(new Error('offline'))).toBeNull();
  const error = Object.assign(new Error('blocked'), { code: 'KIZ_DUPLICATE', duplicateInfo: { firstBoxCode: 'ORIGINAL' } });
  expect(receiptDuplicateFromError(error)).toEqual({ firstBoxCode: 'ORIGINAL' });
});

it('shows a red stop, original box and separate current location without inventing a date', () => {
  const html = renderToStaticMarkup(<ReceiptDuplicateNotice info={{ firstBoxCode: 'ORIGINAL', currentBoxCode: 'CURRENT', productName: 'Костюм', currentStatus: 'SHIPPING' }} onContinue={() => {}} onReview={() => {}} />);
  for (const text of ['role="alert"', '#fecaca', 'ОТЛОЖИТЕ ТОВАР', 'ТОВАР НЕ ПРИНЯТ', 'первоначальная приёмка не установлена', 'ORIGINAL', 'CURRENT', 'подготовлен к отгрузке', 'Передать на проверку']) expect(html).toContain(text);
});

it('escapes product evidence and displays Moscow receipt time', () => {
  const html = renderToStaticMarkup(<ReceiptDuplicateNotice info={{ firstReceivedAt: '2026-10-29T12:01:02Z', productName: '<script>alert(1)</script>' }} onContinue={() => {}} />);
  expect(html).toContain('15:01:02'); expect(html).toContain('МСК'); expect(html).not.toContain('<script>');
});
