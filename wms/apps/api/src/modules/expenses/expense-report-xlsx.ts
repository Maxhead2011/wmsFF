import * as XLSX from 'xlsx';

export const expenseReportXlsxMimeType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExpenseReport = {
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  totals: Record<string, number>;
  byCategory: Array<{
    category: string;
    amountRub: number;
    entriesCount: number;
  }>;
  byWorker: Array<{
    workerName: string;
    totalRub: number;
    payrollPickersRub: number;
    handlingPprRub: number;
    contractWorkRub: number;
    entriesCount: number;
  }>;
  entries: Array<{
    expenseDate: string;
    category: string;
    description: string;
    client: { code: string; name: string } | null;
    request: { number: number; title: string } | null;
    workerName: string | null;
    quantity: number | null;
    unit: string | null;
    unitPriceRub: number | null;
    amountRub: number;
    comment: string | null;
  }>;
};

type DebtReport = {
  clients: Array<{
    client: { code: string; name: string };
    debtRub: number;
    overdueRub: number;
    advanceRub: number;
    invoices: Array<{
      number: string;
      remainingRub: number;
      dueDate: string | null;
      items: Array<{
        description: string;
        quantity: number;
        unitPriceRub: number;
        totalRub: number;
      }>;
    }>;
  }>;
};

export function buildExpenseReportWorkbook(
  report: ExpenseReport,
  debts: DebtReport,
) {
  const workbook = XLSX.utils.book_new();
  const summaryRows: Array<Array<string | number>> = [
    ['Отчёт по расходам LOGOFF WMS'],
    ['Период', formatDate(report.periodFrom), formatDate(report.periodTo)],
    ['Сформирован', formatDateTime(report.generatedAt)],
    [],
    ['Показатель', 'Сумма, ₽'],
    ['Всего расходов', report.totals.totalRub ?? 0],
    ['Расходные материалы', report.totals.materialsRub ?? 0],
    ['Логистика', report.totals.logisticsRub ?? 0],
    ['ФОТ сборщиков', report.totals.payrollPickersRub ?? 0],
    ['ПРР', report.totals.handlingPprRub ?? 0],
    ['Отдельные работы', report.totals.contractWorkRub ?? 0],
    ['Привязано к клиентам', report.totals.linkedToClientsRub ?? 0],
    ['Общехозяйственные расходы', report.totals.overheadRub ?? 0],
    [],
    ['Категория', 'Количество записей', 'Сумма, ₽'],
    ...report.byCategory
      .filter((row) => row.entriesCount > 0)
      .map((row) => [
        expenseCategoryLabel(row.category),
        row.entriesCount,
        row.amountRub,
      ]),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary['!cols'] = [{ wch: 34 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, summary, 'Сводка');

  const expenseRows: Array<Array<string | number>> = [
    [
      'Дата',
      'Категория',
      'Описание',
      'Клиент',
      'Заявка',
      'Сотрудник / исполнитель',
      'Количество',
      'Ед.',
      'Цена, ₽',
      'Сумма, ₽',
      'Комментарий',
    ],
    ...report.entries.map((entry) => [
      formatDate(entry.expenseDate),
      expenseCategoryLabel(entry.category),
      entry.description,
      entry.client
        ? `${entry.client.name} (${entry.client.code})`
        : 'Общий расход',
      entry.request
        ? `№${String(entry.request.number).padStart(6, '0')} — ${entry.request.title}`
        : '',
      entry.workerName ?? '',
      entry.quantity ?? '',
      entry.unit ?? '',
      entry.unitPriceRub ?? '',
      entry.amountRub,
      entry.comment ?? '',
    ]),
  ];
  const expenses = XLSX.utils.aoa_to_sheet(expenseRows);
  expenses['!cols'] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 42 },
    { wch: 30 },
    { wch: 34 },
    { wch: 24 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 42 },
  ];
  XLSX.utils.book_append_sheet(workbook, expenses, 'Расходы');

  const workerRows: Array<Array<string | number>> = [
    [
      'Сборщик / исполнитель',
      'ФОТ, ₽',
      'ПРР, ₽',
      'Отдельные работы, ₽',
      'Всего, ₽',
      'Записей',
    ],
    ...report.byWorker.map((worker) => [
      worker.workerName,
      worker.payrollPickersRub,
      worker.handlingPprRub,
      worker.contractWorkRub,
      worker.totalRub,
      worker.entriesCount,
    ]),
  ];
  const workers = XLSX.utils.aoa_to_sheet(workerRows);
  workers['!cols'] = [
    { wch: 30 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, workers, 'ФОТ и работы');

  const debtRows: Array<Array<string | number>> = [
    [
      'Клиент',
      'Общий долг, ₽',
      'Просрочено, ₽',
      'Аванс, ₽',
      'Счёт',
      'За что',
      'Остаток по счёту, ₽',
      'Срок оплаты',
    ],
  ];
  debts.clients.forEach((client) => {
    const openInvoices = client.invoices.filter(
      (invoice) => invoice.remainingRub > 0,
    );
    if (openInvoices.length === 0) {
      debtRows.push([
        `${client.client.name} (${client.client.code})`,
        client.debtRub,
        client.overdueRub,
        client.advanceRub,
        '',
        '',
        '',
        '',
      ]);
      return;
    }
    openInvoices.forEach((invoice, index) => {
      debtRows.push([
        index === 0
          ? `${client.client.name} (${client.client.code})`
          : '',
        index === 0 ? client.debtRub : '',
        index === 0 ? client.overdueRub : '',
        index === 0 ? client.advanceRub : '',
        invoice.number,
        invoice.items.map((item) => item.description).join('; '),
        invoice.remainingRub,
        invoice.dueDate ? formatDate(invoice.dueDate) : '',
      ]);
    });
  });
  const debtSheet = XLSX.utils.aoa_to_sheet(debtRows);
  debtSheet['!cols'] = [
    { wch: 32 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 58 },
    { wch: 20 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(workbook, debtSheet, 'Долги клиентов');

  return Buffer.from(
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  );
}

function expenseCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    MATERIALS: 'Расходные материалы',
    LOGISTICS: 'Логистика',
    PAYROLL_PICKERS: 'ФОТ сборщиков',
    HANDLING_PPR: 'ПРР',
    CONTRACT_WORK: 'Отдельные работы',
    RENT: 'Аренда',
    UTILITIES: 'Коммунальные услуги',
    TAXES: 'Налоги',
    SOFTWARE: 'ПО и сервисы',
    EQUIPMENT: 'Оборудование',
    MARKETING: 'Маркетинг',
    OTHER: 'Прочее',
  };
  return labels[category] ?? category;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
  });
}
