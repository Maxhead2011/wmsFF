import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FboPickerStatistics } from './FboPickerStatistics';

// TEST: FBO stages remain distinct; timestamps must not become work durations.
it('shows picking and packing independently for unfinished requests', () => {
  const html = renderToStaticMarkup(<FboPickerStatistics period="30 октября" statistics={{
    summary: { workers: 1, requests: 1, pickedUnits: 12, packedUnits: 9 },
    workers: [{ workerId: 'w', workerName: 'Соня', requests: 1, pickedUnits: 12, packedUnits: 9,
      requestDetails: [{ requestId: 'r', requestNumber: 2531, title: 'ФБО Ozon', clientName: 'Елецкая',
        pickedUnits: 12, packedUnits: 9, firstActionAt: '2026-10-30T07:00:00Z', lastActionAt: '2026-10-30T08:00:00Z' }] }],
  }} />);
  for (const text of ['Соня', '002531', 'Елецкая', 'Отобрано: 12', 'Упаковано: 9', '10:00:00', '11:00:00', 'Включая незавершённые']) expect(html).toContain(text);
  expect(html).not.toContain('Среднее время');
});
it('shows the selected period empty state', () => {
  expect(renderToStaticMarkup(<FboPickerStatistics period="30 октября" statistics={{summary:{workers:0,requests:0,pickedUnits:0,packedUnits:0},workers:[]}} />)).toContain('За выбранный период действий ФБО нет');
});
