import { Activity, MoveRight, PackageCheck, Printer, RefreshCw, Tags, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchPickInstruction,
  fetchTsdAssemblyPlan,
  type AuthSession,
  type ClientRequestSummary,
  type PickInstructionDocument,
  type TsdAssemblyPlan,
} from '../../lib/api';
import { requestStatusLabel } from './clientRequestMeta';

type ClientRequestOnlineModalProps = {
  session: AuthSession;
  request: ClientRequestSummary;
  onClose: () => void;
};

type OnlineState =
  | { status: 'loading'; data: null; error?: undefined }
  | { status: 'ready'; data: OnlineData; error?: undefined }
  | { status: 'error'; data: OnlineData | null; error: string };

type OnlineData = {
  plan: TsdAssemblyPlan | null;
  instruction: PickInstructionDocument | null;
};

type MovementTask = {
  sourceBox: string;
  targetBox: string;
  barcode?: string;
  name?: string;
  size?: string;
  quantity: number;
  note?: string;
};

type RelabelTask = {
  sourceBox: string;
  oldBarcode?: string;
  newBarcode?: string;
  barcode?: string;
  name?: string;
  size?: string;
  quantity: number;
  note?: string;
};

type PrintLabel = {
  key: string;
  barcode: string;
  name?: string;
  sourceBox?: string;
  quantity: number;
  note?: string;
};

type SearchBoxStatus = {
  code: string;
  found: boolean;
};

export function ClientRequestOnlineModal({ session, request, onClose }: ClientRequestOnlineModalProps) {
  const [state, setState] = useState<OnlineState>({ status: 'loading', data: null });

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), 5000);
    return () => window.clearInterval(timer);
  }, [request.id, session.accessToken]);

  async function load(showLoading = true) {
    if (showLoading) {
      setState({ status: 'loading', data: null });
    }

    const [planResult, instructionResult] = await Promise.allSettled([
      fetchTsdAssemblyPlan(session.accessToken, request.id),
      fetchPickInstruction(session.accessToken, request.id),
    ]);

    const plan = planResult.status === 'fulfilled' ? planResult.value : null;
    const instruction = instructionResult.status === 'fulfilled' ? instructionResult.value : null;

    if (!plan && !instruction) {
      setState({
        status: 'error',
        data: null,
        error: errorMessage(planResult.status === 'rejected' ? planResult.reason : instructionResult.status === 'rejected' ? instructionResult.reason : null),
      });
      return;
    }

    setState({
      status: planResult.status === 'rejected' || instructionResult.status === 'rejected' ? 'error' : 'ready',
      data: { plan, instruction },
      error:
        planResult.status === 'rejected' || instructionResult.status === 'rejected'
          ? 'Часть онлайн-данных недоступна, показываю доступный план заявки.'
          : undefined,
    } as OnlineState);
  }

  const summary = useMemo(() => onlineSummary(state.data, request), [state.data, request]);

  return (
    <div className="client-request-online-backdrop" role="dialog" aria-modal="true" aria-label="Онлайн выполнение заявки">
      <div className="client-request-online-modal">
        <header className="client-request-online-modal__header">
          <div>
            <p className="eyebrow">Онлайн выполнение</p>
            <h3>{request.title}</h3>
            <span>
              {request.client.name}
              {request.destinationCity ? ` · ${request.destinationCity}` : ''}
            </span>
          </div>
          <div className="client-request-online-modal__tools">
            <button className="icon-button" type="button" onClick={() => void load()} aria-label="Обновить онлайн-данные">
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть онлайн-окно">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {state.status === 'loading' ? <p className="panel-message">Загружаю онлайн-состояние заявки.</p> : null}
        {state.status === 'error' && state.error ? <p className="form-error">{state.error}</p> : null}

        {state.data ? (
          <div className="client-request-online-modal__body">
            <section className="client-request-online-progress" aria-label="Общий прогресс выполнения заявки">
              <div className="client-request-online-progress__head">
                <div>
                  <span>Прогресс выполнения</span>
                  <strong>{summary.progressLabel}</strong>
                </div>
                <b>{summary.progressPercent}%</b>
              </div>
              <div className="client-request-online-progress__bar" aria-hidden="true">
                <span style={{ width: `${summary.progressPercent}%` }} />
              </div>
            </section>

            <section className="client-request-online-stage-grid" aria-label="Стадии выполнения">
              <StageCard icon={<Activity size={18} />} label="Статус WMS" value={requestStatusLabel(request.status)} tone={summary.done ? 'ready' : 'work'} />
              <StageCard
                icon={<PackageCheck size={18} />}
                label="Поиск коробов"
                value={`${summary.foundBoxes} из ${summary.searchBoxes.length}`}
                tone={summary.searchBoxes.length === 0 || summary.searchDone ? 'ready' : summary.foundBoxes > 0 ? 'work' : 'plan'}
              />
              <StageCard
                icon={<Tags size={18} />}
                label="Переклейка"
                value={summary.relabelTasks.length ? `${summary.relabelUnits} шт.` : 'Не требуется'}
                tone={summary.relabelTasks.length ? (summary.done ? 'ready' : 'work') : 'ready'}
              />
              <StageCard
                icon={<MoveRight size={18} />}
                label="Перемещения"
                value={summary.movementTasks.length ? `${summary.movementUnits} шт.` : 'Не требуется'}
                tone={summary.movementTasks.length ? (summary.done ? 'ready' : 'work') : 'ready'}
              />
            </section>

            <section className="client-request-online-section">
              <div className="client-request-online-section__head">
                <h4>Короба для поиска</h4>
                <span>
                  {summary.searchBoxes.length
                    ? `Найдено: ${summary.foundBoxes} из ${summary.searchBoxes.length} · Осталось: ${summary.searchRemaining}`
                    : 'Не требуется'}
                </span>
              </div>
              {summary.searchBoxes.length ? (
                <div className="client-request-online-chip-list">
                  {summary.searchBoxes.map((box) => (
                    <span
                      key={box.code}
                      className={`client-request-online-chip client-request-online-chip--${box.found ? 'found' : 'missing'}`}
                      title={box.found ? 'Короб найден' : 'Короб еще не найден'}
                    >
                      {box.code}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="client-request-online-empty">По этой заявке поиск коробов не требуется или этап уже закрыт.</p>
              )}
            </section>

            <section className="client-request-online-section">
              <div className="client-request-online-section__head">
                <h4>Предполагаемые перемещения</h4>
                <span>{summary.movementTasks.length} строк</span>
              </div>
              {summary.movementTasks.length ? (
                <OnlineTable
                  headers={['Откуда', 'Куда', 'ШК товара', 'Товар', 'Кол-во']}
                  rows={summary.movementTasks.map((task) => [
                    task.sourceBox,
                    task.targetBox,
                    task.barcode || '-',
                    compactText([task.name, task.size, task.note]),
                    formatNumber(task.quantity),
                  ])}
                />
              ) : (
                <p className="client-request-online-empty">Перемещений по текущей инструкции нет.</p>
              )}
            </section>

            <section className="client-request-online-section">
              <div className="client-request-online-section__head">
                <h4>ШК коробов для печати</h4>
                <span>{summary.movementLabels.length} шт.</span>
              </div>
              {summary.movementLabels.length ? (
                <LabelList labels={summary.movementLabels} />
              ) : (
                <p className="client-request-online-empty">Новые короба для перемещения не требуются.</p>
              )}
            </section>

            <section className="client-request-online-section">
              <div className="client-request-online-section__head">
                <h4>Короба с переклейкой</h4>
                <span>{summary.relabelBoxes.length} коробов</span>
              </div>
              {summary.relabelBoxes.length ? (
                <OnlineTable
                  headers={['Короб', 'Старый ШК', 'Новый ШК', 'Товар', 'Кол-во']}
                  rows={summary.relabelTasks.map((task) => [
                    task.sourceBox,
                    task.oldBarcode || task.barcode || '-',
                    task.newBarcode || task.barcode || '-',
                    compactText([task.name, task.size, task.note]),
                    formatNumber(task.quantity),
                  ])}
                />
              ) : (
                <p className="client-request-online-empty">Переклейка по текущей инструкции не требуется.</p>
              )}
            </section>

            <section className="client-request-online-section">
              <div className="client-request-online-section__head">
                <h4>ШК для печати по переклейке</h4>
                <span>{summary.relabelPrintLabels.length} строк</span>
              </div>
              {summary.relabelPrintLabels.length ? (
                <LabelList labels={summary.relabelPrintLabels} />
              ) : (
                <p className="client-request-online-empty">Нет новых ШК для печати по переклейке.</p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StageCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: 'ready' | 'work' | 'plan' }) {
  return (
    <div className={`client-request-online-stage client-request-online-stage--${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OnlineTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="client-request-online-table-wrap">
      <table className="data-table client-request-online-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row.join('|')}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>{cell || '-'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LabelList({ labels }: { labels: PrintLabel[] }) {
  return (
    <div className="client-request-online-label-list">
      {labels.map((label) => (
        <div key={label.key} className="client-request-online-label">
          <Printer size={16} aria-hidden="true" />
          <div>
            <strong>{label.barcode}</strong>
            <span>{compactText([label.name, label.sourceBox ? `короб ${label.sourceBox}` : null, label.note])}</span>
          </div>
          <b>{formatNumber(label.quantity)} шт.</b>
        </div>
      ))}
    </div>
  );
}

function onlineSummary(data: OnlineData | null, request: ClientRequestSummary) {
  const instruction = data?.instruction;
  const plan = data?.plan;
  const done = ['PACKED', 'DONE'].includes(request.status);
  const movementTasks = movementTasksFrom(plan, instruction);
  const relabelTasks = relabelTasksFrom(plan, instruction);
  const searchBoxes = searchBoxesFrom(plan, instruction, movementTasks);
  const exactFoundBoxes = searchBoxes.filter((box) => box.found).length;
  const foundBoxes = Math.min(
    searchBoxes.length,
    Math.max(0, Number(plan?.foundCount ?? 0), Number(plan?.activeTsdProcess?.foundCount ?? 0), exactFoundBoxes),
  );
  const movementLabels = movementLabelsFrom(instruction, movementTasks);
  const relabelPrintLabels = relabelPrintLabelsFrom(instruction, relabelTasks);
  const searchRemaining = Math.max(searchBoxes.length - foundBoxes, 0);
  const searchProgress = progressRatio(foundBoxes, searchBoxes.length, searchBoxes.length === 0);
  const relabelDone = done && relabelTasks.length > 0;
  const movementDone = done && movementTasks.length > 0;
  const relabelProgress = progressRatio(relabelDone ? relabelTasks.length : 0, relabelTasks.length, relabelTasks.length === 0);
  const movementProgress = progressRatio(movementDone ? movementTasks.length : 0, movementTasks.length, movementTasks.length === 0);
  const stageProgress = [
    ...(searchBoxes.length > 0 ? [searchProgress] : []),
    ...(relabelTasks.length > 0 ? [relabelProgress] : []),
    ...(movementTasks.length > 0 ? [movementProgress] : []),
  ];
  const progressPercent =
    done || stageProgress.length === 0 ? 100 : Math.round((stageProgress.reduce((sum, value) => sum + value, 0) / stageProgress.length) * 100);

  return {
    done,
    searchBoxes,
    foundBoxes,
    searchRemaining,
    searchDone: searchBoxes.length > 0 && foundBoxes >= searchBoxes.length,
    progressPercent,
    progressLabel: progressSummaryLabel(foundBoxes, searchBoxes.length, searchRemaining, relabelTasks.length, movementTasks.length, done),
    movementTasks,
    movementUnits: movementTasks.reduce((sum, task) => sum + numberValue(task.quantity), 0),
    movementLabels,
    relabelTasks,
    relabelUnits: relabelTasks.reduce((sum, task) => sum + numberValue(task.quantity), 0),
    relabelBoxes: unique(relabelTasks.map((task) => task.sourceBox).filter(Boolean)),
    relabelPrintLabels,
  };
}

function progressRatio(doneCount: number, totalCount: number, isNotRequired: boolean) {
  if (isNotRequired) {
    return 1;
  }
  if (totalCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(doneCount / totalCount, 1));
}

function progressSummaryLabel(foundBoxes: number, totalBoxes: number, remainingBoxes: number, relabelCount: number, movementCount: number, done: boolean) {
  if (done) {
    return 'Все этапы закрыты';
  }

  const parts = totalBoxes
    ? [`найдено коробов ${foundBoxes} из ${totalBoxes}`, `осталось ${remainingBoxes}`]
    : ['поиск коробов не требуется'];
  if (relabelCount) {
    parts.push(`переклейка: ${relabelCount} строк`);
  }
  if (movementCount) {
    parts.push(`перемещения: ${movementCount} строк`);
  }
  return parts.join(' · ');
}

function searchBoxesFrom(plan: TsdAssemblyPlan | null | undefined, instruction: PickInstructionDocument | null | undefined, movementTasks: MovementTask[]): SearchBoxStatus[] {
  const fromPlan = normalizeBoxStatuses([...(plan?.searchBoxes ?? []), ...(plan?.boxesToSearch ?? [])]);
  if (fromPlan.length) {
    return fromPlan;
  }

  const movementTargets = new Set(movementTasks.map((task) => normalizeKey(task.targetBox)).filter(Boolean));
  return normalizeBoxes([
    ...(instruction?.warehouseRows ?? []).map((row) => row.sourceBox),
    ...(instruction?.warehouseBalanceMoves ?? []).map((row) => row.sourceBox),
    ...(instruction?.warehouseWholeBoxes ?? []).map((row) => row.box),
  ])
    .filter((box) => !movementTargets.has(normalizeKey(box)))
    .map((box) => ({ code: box, found: false }));
}

function normalizeBoxStatuses(values: Array<{ boxCode?: string; code?: string; found?: boolean; isFound?: boolean }>) {
  const byCode = new Map<string, SearchBoxStatus>();
  for (const value of values) {
    const code = (value.boxCode || value.code || '').trim();
    if (!code) {
      continue;
    }
    const key = normalizeKey(code);
    const current = byCode.get(key);
    byCode.set(key, {
      code: current?.code ?? code,
      found: Boolean(current?.found || value.found || value.isFound),
    });
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code, 'ru', { numeric: true }));
}

function movementTasksFrom(plan: TsdAssemblyPlan | null | undefined, instruction: PickInstructionDocument | null | undefined): MovementTask[] {
  if (plan?.movementTasks?.length) {
    return plan.movementTasks.map((task) => ({
      sourceBox: task.sourceBox,
      targetBox: task.targetBox,
      barcode: task.barcode,
      name: task.name,
      size: task.size,
      quantity: numberValue(task.quantity),
      note: task.note,
    }));
  }

  return (instruction?.warehouseBalanceMoves ?? [])
    .filter((row) => row.sourceBox && row.newBox && numberValue(row.quantity) > 0)
    .map((row) => ({
      sourceBox: row.sourceBox,
      targetBox: row.newBox,
      barcode: row.barcodeOnBox,
      name: row.artOnBox,
      size: row.size,
      quantity: numberValue(row.quantity),
      note: row.note,
    }));
}

function relabelTasksFrom(plan: TsdAssemblyPlan | null | undefined, instruction: PickInstructionDocument | null | undefined): RelabelTask[] {
  if (plan?.relabelTasks?.length) {
    return plan.relabelTasks.map((task) => ({
      sourceBox: task.sourceBox,
      oldBarcode: task.oldBarcode,
      newBarcode: task.newBarcode,
      barcode: task.barcode,
      name: task.name,
      size: task.size,
      quantity: numberValue(task.quantity),
      note: task.note,
    }));
  }

  return (instruction?.warehouseRows ?? [])
    .filter((row) => row.sourceBox && numberValue(row.quantity) > 0 && row.rebrandNote)
    .map((row) => {
      const parsed = parseRelabelNote(row.rebrandNote);
      return {
        sourceBox: row.sourceBox,
        oldBarcode: parsed.oldBarcode || row.barcodeOnBox,
        newBarcode: parsed.newBarcode || row.barcodeOnBox,
        barcode: parsed.newBarcode || row.barcodeOnBox,
        name: row.artOnBox,
        size: row.size,
        quantity: numberValue(row.quantity),
        note: row.rebrandNote,
      };
    });
}

function movementLabelsFrom(instruction: PickInstructionDocument | null | undefined, movementTasks: MovementTask[]): PrintLabel[] {
  const labels = (instruction?.warehouseBalanceLabels ?? [])
    .filter((row) => row.newBox)
    .map((row) => ({
      key: `move-label:${row.newBox}:${row.sourceBox}`,
      barcode: row.newBox,
      sourceBox: row.sourceBox,
      quantity: 1,
      note: row.tspl ? 'Есть TSPL для печати' : undefined,
    }));

  if (labels.length) {
    return collapseLabels(labels);
  }

  return collapseLabels(
    movementTasks
      .filter((task) => task.targetBox)
      .map((task) => ({
        key: `move-label:${task.targetBox}`,
        barcode: task.targetBox,
        sourceBox: task.sourceBox,
        quantity: 1,
        note: 'Новый короб для остатков',
      })),
  );
}

function relabelPrintLabelsFrom(instruction: PickInstructionDocument | null | undefined, relabelTasks: RelabelTask[]): PrintLabel[] {
  const markRows = instruction?.warehouseMarkRows ?? [];
  if (markRows.length) {
    return collapseLabels(
      markRows
        .filter((row) => row.barcode)
        .map((row) => ({
          key: `mark:${row.barcode}:${row.sourceBox}:${row.name}`,
          barcode: row.barcode,
          name: compactText([row.name, row.color, row.size]),
          sourceBox: row.sourceBox,
          quantity: numberValue(row.quantity),
          note: row.comment,
        })),
    );
  }

  return collapseLabels(
    relabelTasks
      .filter((task) => task.newBarcode || task.barcode)
      .map((task) => ({
        key: `mark:${task.newBarcode || task.barcode}:${task.sourceBox}`,
        barcode: task.newBarcode || task.barcode || '',
        name: compactText([task.name, task.size]),
        sourceBox: task.sourceBox,
        quantity: numberValue(task.quantity),
        note: task.note,
      })),
  );
}

function collapseLabels(labels: PrintLabel[]) {
  const byBarcode = new Map<string, PrintLabel>();
  for (const label of labels) {
    const key = [label.barcode, label.name ?? '', label.sourceBox ?? '', label.note ?? ''].join('|');
    const current = byBarcode.get(key);
    if (current) {
      current.quantity += label.quantity;
    } else {
      byBarcode.set(key, { ...label, key });
    }
  }
  return [...byBarcode.values()].sort((left, right) => left.barcode.localeCompare(right.barcode, 'ru', { numeric: true }));
}

function parseRelabelNote(value: string) {
  const match = value.match(/([A-Za-zА-Яа-я0-9_-]+)\s*[-=]>?\s*([A-Za-zА-Яа-я0-9_-]+)/);
  return {
    oldBarcode: match?.[1] ?? '',
    newBarcode: match?.[2] ?? '',
  };
}

function normalizeBoxes(values: string[]) {
  return unique(values.map((value) => value?.trim()).filter(Boolean)).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function normalizeKey(value?: string | null) {
  return (value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function compactText(values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).filter(Boolean).join(' · ') || '-';
}

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось загрузить онлайн-состояние заявки.';
}
