import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { FormEvent, useMemo, useRef, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import {
  askWmsAi,
  downloadWmsAiExport,
  teachWmsAi,
  type WmsAiResponse,
} from '../../lib/wms-ai-api';
import './wms-ai.css';

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; response: WmsAiResponse };

const starterPrompts = [
  'Покажи мне короба, которые не попали в палет-сорт',
  'Выведи неопознанные WMS короба в палет-сорте',
  'Покажи открытые проблемы КИЗ в выбранном городе',
  'Покажи межфилиальные перемещения за последние 30 дней',
  'Покажи товар «Корея_2голубой» по размерам с остатком до 30 штук и короба',
];

export function WmsAiPanel({ session }: { session: AuthSession }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const city = session.user.activeWarehouseId ? 'выбранный город' : 'город не выбран';
  const canTeach = useMemo(
    () =>
      session.user.permissionCodes.includes('system:admin') ||
      session.user.permissionCodes.includes('warehouse:write') ||
      session.user.permissionCodes.includes('stock:write'),
    [session.user.permissionCodes],
  );

  async function send(text: string) {
    const message = text.trim();
    if (!message || isSending) return;
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: message,
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError('');
    setSending(true);
    try {
      const response = await askWmsAi(session.accessToken, message);
      setMessages((current) => [
        ...current,
        { id: response.id, role: 'assistant', response },
      ]);
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ИИ не смог обработать запрос.');
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  async function download(response: WmsAiResponse) {
    if (!response.export) return;
    setDownloadingId(response.id);
    setError('');
    try {
      const blob = await downloadWmsAiExport(
        session.accessToken,
        response.export.tool,
        response.export.params,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.export.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось скачать Excel.');
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <div className="wms-ai-panel">
      <header className="wms-ai-hero">
        <span className="wms-ai-hero__icon"><BrainCircuit size={28} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Локальный WMS-ассистент</p>
          <h2>ИИ</h2>
          <p>Анализирует данные активного склада, готовит таблицы и запоминает подтверждённые решения.</p>
        </div>
        <div className="wms-ai-hero__badges">
          <span><ShieldCheck size={15} /> Данные WMS не уходят наружу</span>
          <span><Globe2 size={15} /> Интернет — только для неизвестных проблем</span>
        </div>
      </header>

      <section className="wms-ai-chat" aria-label="Чат с ИИ">
        <div className="wms-ai-chat__status">
          <span className="wms-ai-online-dot" />
          <strong>Ассистент готов</strong>
          <span>Контекст: {city}. Запросы автоматически ограничены активным складом.</span>
        </div>

        <div className="wms-ai-messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="wms-ai-welcome">
              <Bot size={34} aria-hidden="true" />
              <h3>Что проверить в WMS?</h3>
              <p>Можно писать обычными словами. Для найденных списков появится кнопка выгрузки Excel.</p>
              <div className="wms-ai-prompts">
                {starterPrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => void send(prompt)}>
                    <Sparkles size={15} aria-hidden="true" />
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message, index) =>
            message.role === 'user' ? (
              <article className="wms-ai-message wms-ai-message--user" key={message.id}>
                <strong>Вы</strong>
                <p>{message.text}</p>
              </article>
            ) : (
              <AssistantMessage
                key={message.id}
                response={message.response}
                question={findQuestion(messages, index)}
                canTeach={canTeach}
                isDownloading={downloadingId === message.id}
                accessToken={session.accessToken}
                onDownload={() => void download(message.response)}
                onError={setError}
              />
            ),
          )}

          {isSending ? (
            <article className="wms-ai-message wms-ai-message--assistant wms-ai-thinking">
              <LoaderCircle className="spin" size={19} />
              <span>Проверяю WMS и локальную базу знаний…</span>
            </article>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <div className="wms-ai-error">{error}</div> : null}

        <form className="wms-ai-composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Например: покажи короба, которые не попали в палет-сорт"
            rows={2}
            maxLength={1000}
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || input.trim().length < 2}>
            {isSending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            Отправить
          </button>
        </form>
        <p className="wms-ai-safety">
          Изменения данных и программных блоков выполняются только разрешённым инструментом после подтверждения администратора.
        </p>
      </section>
    </div>
  );
}

function AssistantMessage({
  response,
  question,
  canTeach,
  isDownloading,
  accessToken,
  onDownload,
  onError,
}: {
  response: WmsAiResponse;
  question: string;
  canTeach: boolean;
  isDownloading: boolean;
  accessToken: string;
  onDownload: () => void;
  onError: (message: string) => void;
}) {
  const [showTeach, setShowTeach] = useState(false);
  const [solution, setSolution] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveKnowledge() {
    if (solution.trim().length < 3) return;
    setSaving(true);
    onError('');
    try {
      await teachWmsAi(accessToken, {
        question,
        solution: solution.trim(),
        sourceUrls: response.sources?.map((source) => source.url),
      });
      setSaved(true);
      setShowTeach(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Не удалось сохранить решение.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="wms-ai-message wms-ai-message--assistant">
      <header>
        <span><Bot size={17} /> ИИ</span>
        <small>{engineLabel(response.engine)}</small>
      </header>
      <h3>{response.title}</h3>
      <p className="wms-ai-answer">{response.answer}</p>

      {response.summary ? (
        <div className="wms-ai-summary">
          <Summary label="Строк" value={response.summary.rows} />
          {response.summary.boxes !== undefined ? <Summary label="Коробов" value={response.summary.boxes} /> : null}
          {response.summary.pallets !== undefined ? <Summary label="Палет-сортов" value={response.summary.pallets} /> : null}
          {response.summary.skus !== undefined ? <Summary label="SKU" value={response.summary.skus} /> : null}
          {response.summary.clients !== undefined ? <Summary label="Клиентов" value={response.summary.clients} /> : null}
          {response.summary.requests !== undefined ? <Summary label="Заявок" value={response.summary.requests} /> : null}
          {response.summary.issues !== undefined ? <Summary label="Проблем" value={response.summary.issues} /> : null}
          {response.summary.transfers !== undefined ? <Summary label="Перемещений" value={response.summary.transfers} /> : null}
          {response.summary.totalQuantity !== undefined ? <Summary label="Единиц товара" value={response.summary.totalQuantity} /> : null}
        </div>
      ) : null}

      {response.columns?.length && response.rows?.length ? (
        <div className="wms-ai-table-wrap">
          <table>
            <thead>
              <tr>{response.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {response.rows.map((row, rowIndex) => (
                <tr key={`${response.id}-${rowIndex}`}>
                  {response.columns?.map((column) => <td key={column.key}>{String(row[column.key] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {response.sources?.length ? (
        <div className="wms-ai-sources">
          <strong><Globe2 size={16} /> Источники интернет-поиска</strong>
          {response.sources.map((source) => (
            <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
              <span>{source.title}</span>
              <small>{source.snippet}</small>
              <ExternalLink size={14} />
            </a>
          ))}
        </div>
      ) : null}

      <div className="wms-ai-actions">
        {response.export?.available ? (
          <button type="button" className="wms-ai-primary" onClick={onDownload} disabled={isDownloading}>
            {isDownloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            Скачать Excel
          </button>
        ) : null}
        {response.canTeach && canTeach && !saved ? (
          <button type="button" className="wms-ai-secondary" onClick={() => setShowTeach((value) => !value)}>
            <BrainCircuit size={17} />
            Научить ИИ решению
          </button>
        ) : null}
        {saved ? <span className="wms-ai-saved"><CheckCircle2 size={16} /> Решение запомнено</span> : null}
      </div>

      {showTeach ? (
        <div className="wms-ai-teach">
          <label>
            Подтверждённое решение
            <textarea
              rows={4}
              value={solution}
              maxLength={5000}
              onChange={(event) => setSolution(event.target.value)}
              placeholder="Опишите, что действительно помогло. Решение сохранится только для активного склада."
            />
          </label>
          <button type="button" onClick={() => void saveKnowledge()} disabled={isSaving || solution.trim().length < 3}>
            {isSaving ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
            Сохранить в базу знаний
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><strong>{value.toLocaleString('ru-RU')}</strong></span>;
}

function findQuestion(messages: ChatMessage[], assistantIndex: number) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return message.text;
  }
  return '';
}

function engineLabel(engine: WmsAiResponse['engine']) {
  if (engine === 'WMS_TOOL') return 'данные WMS';
  if (engine === 'LOCAL_KNOWLEDGE') return 'локальная база знаний';
  if (engine === 'LOCAL_MODEL') return 'локальная модель';
  return 'безопасный режим';
}
