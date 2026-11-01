import { useEffect, useRef, useState } from "react";
type Task = {
  id: string;
  clientId: string;
  client: string;
  document: string;
  total: number;
  placed: number;
  remaining: string[];
  status: string;
  previouslyPlaced?: string[];
  excluded?: string[];
  exclusions?: Array<{ boxCode: string; reason: string }>;
  requests?: number[];
  history: Array<{
    action: string;
    worker: string;
    at: string;
    boxCode?: string;
  }>;
};
export function ReceiptPlacementTasks({
  token,
  warehouseId,
  canManage,
}: {
  token: string;
  warehouseId?: string | null;
  canManage: boolean;
}) {
  const [items, setItems] = useState<Task[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Task | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    const controller = new AbortController();
    setItems([]);
    dialog.current?.close();
    setSelected(null);
    const load = async () => {
      if (document.hidden || dialog.current?.open) return;
      try {
        const r = await fetch(
          "/api/v1/warehouse/storage-locations/receipt-placement",
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          },
        );
        if (!r.ok) throw Error("Не удалось загрузить приёмки для размещения.");
        const v = await r.json();
        if (active && generation.current === current) {
          setItems(v.items);
          setError("");
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError((e as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(load, 15000);
    window.addEventListener("storage-layout-changed", load);
    return () => {
      active = false;
      generation.current++;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("storage-layout-changed", load);
    };
  }, [token, warehouseId]);
  async function action(task: Task, action: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    try {
      const r = await fetch(
        "/api/v1/warehouse/storage-locations/receipt-placement/action",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            placementClientId: task.clientId,
            placementDocument: task.document,
          }),
        },
      );
      const v = await r.json();
      if (!r.ok) throw Error(v.message || "Ошибка размещения.");
      if (generation.current !== current) return;
      setItems((old) => old.map((t) => (t.id === v.id ? v : t)));
      if (action === "FINISH" && !v.canFinish) {
        setSelected(v);
        dialog.current?.showModal();
      } else {
        dialog.current?.close();
        setSelected(null);
        window.dispatchEvent(new Event("storage-layout-changed"));
      }
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  const captions: Record<string, string> = {
    START: "Начато размещение",
    PLACED: "Размещён короб",
    FINISH: "Проверка завершения",
    DEFER: "Размещение отложено",
    COMPLETED: "Размещение завершено",
  };
  return (
    <section aria-label="Приёмки для размещения">
      <h3>Приёмки для размещения</h3>
      {error && <p role="alert">{error}</p>}
      {items.map((t) => (
        <details key={t.id}>
          <summary>
            {t.client} · {t.document.replace(/^SERIES:\d{4}:/, "")} · размещено{" "}
            {t.placed} из {t.total}
            {t.status === "DEFERRED"
              ? " · отложено"
              : t.status === "COMPLETED"
                ? " · завершено"
                : ""}
          </summary>
          {!!t.requests?.length && (
            <p role="status">
              Короба связаны с активными заявками {t.requests.join(", ")}
            </p>
          )}
          <ul>
            {t.remaining.map((code) => (
              <li key={code}>
                {code}
                {t.previouslyPlaced?.includes(code)
                  ? " · ранее размещался, сейчас палета не указана"
                  : ""}
              </li>
            ))}
          </ul>
          {!!t.excluded?.length && (
            <p>
              Выбыли из складского хранения ·{" "}
              {t.exclusions
                ?.map((e) => e.boxCode + " — " + e.reason)
                .join("; ") ?? t.excluded.join(", ")}
            </p>
          )}
          <details>
            <summary>История размещения · последние 200 действий</summary>
            <ul>
              {t.history.map((h, i) => (
                <li key={i}>
                  {new Date(h.at).toLocaleString("ru-RU", {
                    timeZone: "Europe/Moscow",
                  })}{" "}
                  МСК · {h.worker} · {captions[h.action] ?? h.action}{" "}
                  {h.boxCode}
                </li>
              ))}
            </ul>
          </details>
          {canManage && t.status !== "COMPLETED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => action(t, "FINISH")}
            >
              Завершить размещение
            </button>
          )}
        </details>
      ))}
      <dialog
        ref={dialog}
        className="receipt-placement__dialog"
        aria-label="Не все короба размещены"
      >
        <h2>Не все короба приёмки размещены</h2>
        <p>
          {selected?.client} · осталось {selected?.remaining.length}
        </p>
        <ul>
          {selected?.remaining.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button
          type="button"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          Продолжить размещение
        </button>
        <button
          type="button"
          disabled={busy || !selected}
          onClick={() => selected && action(selected, "DEFER")}
        >
          Отложить
        </button>
      </dialog>
    </section>
  );
}
