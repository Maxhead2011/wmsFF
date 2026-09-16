import React from 'react';
import { createRoot } from 'react-dom/client';
import { BillingInvoiceServiceSummary } from '../src/components/billing/BillingInvoiceServiceSummary';
import '../src/styles.css';
import '../src/components/billing/billing.css';
// TEST: synthetic data, no API, no session and no real customer information.
const base = { description: 'Обработка товара', unit: 'PIECE', unitPriceRub: '10.00', serviceDate: '2026-08-01T00:00:00Z' };
const items = [{ ...base, id: 'one', quantity: '10', totalRub: '100' }, { ...base, id: 'two', quantity: '15', totalRub: '150', serviceDate: '2026-08-31T00:00:00Z' }, { ...base, id: 'three', description: 'Короб', unit: 'BOX', quantity: '2', unitPriceRub: '30', totalRub: '60' }] as any;
createRoot(document.getElementById('root')!).render(<main style={{ padding: 16, maxWidth: 1200, margin: 'auto' }}><h1>Тестовый счёт</h1><BillingInvoiceServiceSummary items={items} /><details><summary>Показать детализацию услуг</summary><p>Исходных строк: 3</p></details></main>);
