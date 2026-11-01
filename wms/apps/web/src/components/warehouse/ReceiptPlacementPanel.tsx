import { useEffect, useRef, useState, type ReactNode } from "react";
import "./receipt-placement.css";
type Row = {
  id: string;
  code: string;
  clientId: string;
  client: string;
  receipt: string | null;
  receiptAt: string | null;
};
type Report = {
  enabled: boolean;
  summary: { pallets: number; boxes: number; awaiting: number };
  items: Row[];
  nextCursor: string | null;
};
async function read(
  token: string,
  cursor?: string,
  summaryOnly = false,
  signal?: AbortSignal,
): Promise<Report> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (summaryOnly) params.set("summaryOnly", "true");
  const response = await fetch(
    "/api/v1/warehouse/storage-locations/placement-report?" + params,
    { headers: { Authorization: "Bearer " + token }, signal },
  );
  if (!response.ok) throw Error("Не удалось загрузить размещение коробов.");
  return response.json();
}
// FIX: cancel reads when the user or warehouse changes, and never retain another scope's counts.
export function ReceiptPlacementPanel({
  token,
  warehouseId,
  revision,
  fallback,
}: {
  token: string;
  warehouseId?: string | null;
  revision?: unknown;
  fallback?: ReactNode;
}) {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const scope = useRef(0);
  useEffect(() => {
    const generation = ++scope.current;
    const controller = new AbortController();
    setBusy(false);
    setReport(null);
    setError("");
    dialog.current?.close();
    const load = () => {
      if (document.hidden || dialog.current?.open) return;
      read(token, undefined, false, controller.signal)
        .then((v) => {
          if (scope.current === generation) setReport(v);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      controller.abort();
      scope.current++;
      clearInterval(timer);
    };
  }, [token, warehouseId, revision]);
  if (!report?.enabled)
    return (
      <>
        {error && <p role="alert">{error}</p>}
        {fallback}
      </>
    );
  const rows = report.items.filter((r) =>
    [r.code, r.client, r.receipt ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.clientId,
      row.receipt,
      row.receiptAt?.slice(0, 10),
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <section className="receipt-placement" aria-label="Размещение коробов">
      <div className="receipt-placement__metrics">
        <div>
          <strong>{report.summary.pallets}</strong>
          <span>Палет с коробами</span>
        </div>
        <div>
          <strong>{report.summary.boxes}</strong>
          <span>Коробов на складе</span>
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
        >
          <strong>{report.summary.awaiting}</strong>
          <span>Ожидают размещения</span>
        </button>
      </div>
      <dialog
        ref={dialog}
        className="receipt-placement__dialog"
        aria-label="Ожидают размещения"
      >
        <header>
          <h2>Ожидают размещения · {report.summary.awaiting}</h2>
          <button
            type="button"
            aria-label="Закрыть окно"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <label>
          Поиск среди загруженных коробов
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        {Array.from(groups, ([key, items]) => (
          <section key={key}>
            <h3>
              {items[0].receipt?.replace(/^SERIES:\d{4}:/, "") ??
                "Приёмка не определена"}
            </h3>
            <p>
              {items[0].client} ·{" "}
              {items[0].receiptAt
                ? new Date(items[0].receiptAt).toLocaleDateString("ru-RU", {
                    timeZone: "Europe/Moscow",
                  })
                : "Дата приёмки не определена"}
            </p>
            <ul>
              {items.map((r) => (
                <li key={r.id}>{r.code}</li>
              ))}
            </ul>
          </section>
        ))}
        {!rows.length && (
          <p>
            {report.summary.awaiting
              ? "Поиск не дал результатов на загруженной странице."
              : "Все короба размещены."}
          </p>
        )}
        {report.nextCursor && (
          <button
            disabled={busy}
            type="button"
            onClick={async () => {
              const generation = scope.current;
              setBusy(true);
              try {
                const next = await read(token, report.nextCursor!);
                if (scope.current === generation)
                  setReport((v) =>
                    v
                      ? {
                          ...next,
                          items: [
                            ...v.items,
                            ...next.items.filter(
                              (n) => !v.items.some((o) => o.id === n.id),
                            ),
                          ],
                        }
                      : v,
                  );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                if (scope.current === generation) setBusy(false);
              }
            }}
          >
            Показать ещё короба
          </button>
        )}
      </dialog>
    </section>
  );
}
export function ReceiptPlacementBadge({
  token,
  warehouseId,
}: {
  token: string;
  warehouseId?: string | null;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    const controller = new AbortController();
    setCount(0);
    const load = () => {
      if (document.hidden) return;
      const current = ++request;
      read(token, undefined, true, controller.signal)
        .then((v) => {
          if (active && current === request)
            setCount(v.enabled ? v.summary.awaiting : 0);
        })
        .catch(() => undefined);
    };
    window.addEventListener("storage-layout-changed", load);
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      window.removeEventListener("storage-layout-changed", load);
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [token, warehouseId]);
  return count > 0 ? (
    <strong
      className="receipt-placement__badge"
      title={"Ожидают размещения: " + count}
      aria-label={"Ожидают размещения: " + count}
    >
      !
    </strong>
  ) : null;
}
