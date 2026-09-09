package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.WmsApi;
import retrofit2.Response;

// ADDED: dedicated native screen; all authoritative changes use the same API as the web.
public final class PalletSortingScreen {
    private final Activity activity;
    private final TsdSession session;
    private final WmsApi api;
    private final Runnable back;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final PalletSortingCommand command = new PalletSortingCommand();
    private final PalletSortingRestoreConsent restoreConsent = new PalletSortingRestoreConsent(); // ADDED
    // FIX: local to this LOGOFF-only screen; other scanner workflows are unchanged.
    private final Handler scanHandler = new Handler(Looper.getMainLooper());
    private final PalletSortingAutoSubmit autoSubmit = new PalletSortingAutoSubmit(new PalletSortingAutoSubmit.Scheduler() {
        public void post(Runnable job, long delay) { scanHandler.postDelayed(job, delay); }
        public void remove(Runnable job) { scanHandler.removeCallbacks(job); }
    }, this::submit);
    private Map<String, Object> state;
    private List<Map<String, Object>> sessions = new ArrayList<>();
    private EditText input, palletInput, sourceInput;
    private String barcode = "", pallet = "", source = "", message = "";
    private boolean busy, closed, confirming;
    private LinearLayout root;
    private static final String BASE = "api/v1/pallet-sorting";

    public PalletSortingScreen(Activity activity, TsdSession session, WmsApi api, Runnable back) {
        this.activity = activity; this.session = session; this.api = api; this.back = back;
        render(); loadList();
    }
    public boolean canLeave() { return !busy && !command.pending() && !restoreConsent.pending() && barcode.isEmpty() && !confirming; }
    public void close() { closed = true; restoreConsent.clear(); autoSubmit.cancel(); executor.shutdown(); }
    public EditText scannerField() {
        View focused = activity.getCurrentFocus();
        return focused instanceof EditText ? (EditText) focused : input;
    }
    private boolean active() { return !closed && !activity.isDestroyed(); }
    public void render() {
        if (!active()) return;
        autoSubmit.cancel(); // FIX: a callback from a replaced barcode field cannot submit the next KIZ.
        root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(20, 16, 20, 24);
        root.setBackgroundColor(Color.WHITE);
        label("Сортировка и перемещение", 24);
        label("Администратор · " + session.deviceName, 15);
        if (!message.isEmpty()) label(message, 18);
        if (busy) label("Сохраняю / проверяю… Не сканируйте повторно.", 18);
        if (command.pending() && !busy) {
            label("Ответ не подтверждён. Повторяем ту же операцию, без повторного перемещения.", 18);
            button("Повторить тот же запрос", this::sendPending, true);
        }
        if (state == null) {
            for (Map<String, Object> row : sessions) button("Продолжить " + text(row, "sourceCode"), () -> open(text(row, "id")), true);
        } else {
            label(text(state, "sourceCode") + " · " + ("CHECKING".equals(stage()) ? "Сверка коробов" : "FORMING".equals(stage()) ? "Формирование новых коробов" : "Завершено"), 21);
            // FIX: found stock is a +1 adjustment, not a balanced movement from a fictional box.
            int recovered = PalletSortingProblemFormatter.recovered(state);
            label("Перемещено: " + (rows(state, "moves").size() - recovered) + " ед. · Оприходовано найденных: " + recovered + " ед.", 19);
            for (Map<String, Object> box : rows(state, "problemSources")) label(PalletSortingProblemFormatter.source(box), 18);
            // FIX: permanent storage remains active; completion must not be labelled as archival.
            for (Map<String, Object> box : rows(state, "sources")) label(PalletSortingProblemFormatter.sourceState(box), 16); // FIX
            if (!rows(state, "pendingRoutes").isEmpty()) {
                label("Перестроение FBS ещё не завершено.", 18);
                for (Map<String, Object> row : rows(state, "pendingRoutes")) if (!text(row, "error").isEmpty()) label(text(row, "error"), 16);
                button("Повторить перестроение маршрутов", this::routes, true);
            }
        }
        Map<String, Object> target = target();
        palletInput = null; sourceInput = null; input = null;
        if ("FORMING".equals(stage()) && target == null) {
            palletInput = field("Фактический паллет-сорт целевого короба", pallet);
            palletInput.setOnEditorActionListener((v, id, event) -> { pallet = palletInput.getText().toString().trim(); if (input != null) input.requestFocus(); return true; });
        }
        if (target != null) {
            label("Заполняется " + text(target, "code") + " · " + number(target, "quantity") + " ед.", 20);
            sourceInput = field("Исходный короб (если КИЗ ещё не привязан)", source);
            label("Для учтённого КИЗа исходный короб не нужен. Если КИЗ ещё не привязан, укажите фактический короб; совпадение с исходным паллетом не требуется.", 15);
            sourceInput.setOnEditorActionListener((v, id, event) -> { source = sourceInput.getText().toString().trim(); if (input != null) input.requestFocus(); return true; });
        }
        if (!"COMPLETED".equals(stage())) {
            String hint = state == null ? "Паллет-сорт или короб" : "CHECKING".equals(stage()) ? "Исходный короб" : target == null ? "Целевой короб — новый или закрытый" : barcode.isEmpty() ? "ШК товара" : "КИЗ товара"; // FIX
            if (!barcode.isEmpty()) {
                label("ШК: " + barcode, 18);
                button("Отменить текущую единицу", () -> { barcode = ""; render(); }, true);
            }
            input = field(hint, "");
            input.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                public void onTextChanged(CharSequence s, int start, int before, int count) {}
                public void afterTextChanged(Editable value) {
                    autoSubmit.changed(value.toString(), "FORMING".equals(stage()) && target() != null && barcode.isEmpty(),
                        active() && !busy && !confirming && !command.pending());
                }
            });
            input.setOnEditorActionListener((v, id, event) -> { if (event == null || event.getAction() == KeyEvent.ACTION_UP) submit(); return true; });
            button(state == null ? "Начать сортировку" : "Подтвердить скан", this::submit, true);
        }
        if ("CHECKING".equals(stage())) {
            long missing = rows(state, "sources").stream().filter(b -> !yes(b, "scanned") && !yes(b, "archived") && !yes(b, "preservedOnPallet")).count();
            if (missing > 0) button("Расхождения по коробам: " + missing, () -> preview("ARCHIVE_MISSING"), true);
            button("Приступить к формированию новых коробов", () -> action("BEGIN_FORMING", new LinkedHashMap<>()), missing == 0);
        }
        if ("FORMING".equals(stage())) {
            button("Закрыть короб", () -> action("CLOSE_TARGET", new LinkedHashMap<>()), target != null && barcode.isEmpty());
            button("Завершить сортировку", () -> preview("COMPLETE"), target == null && barcode.isEmpty());
        }
        if (state != null) for (Map<String, Object> box : rows(state, "targets")) {
            label(text(box, "code") + " · " + number(box, "quantity") + " ед. · " + text(box, "palletCode") + (yes(box, "closed") ? " · закрыт" : " · открыт"), 16);
            // FIX: reopen the same target through the versioned/idempotent server command.
            if ("FORMING".equals(stage()) && yes(box, "closed")) button("Доложить в " + text(box, "code"), () -> {
                Map<String,Object> body = new LinkedHashMap<>();
                body.put("code", text(box, "code")); body.put("palletCode", text(box, "palletCode"));
                action("OPEN_TARGET", body);
            }, target == null && barcode.isEmpty());
        }
        button("В главное меню (сессия сохранена)", () -> { if (canLeave()) { close(); back.run(); } }, barcode.isEmpty());
        ScrollView scroll = new ScrollView(activity); scroll.addView(root); activity.setContentView(scroll);
        if (input != null && !busy && !command.pending()) {
            // FIX: scroll/focus after layout, including transition from barcode to the replacement KIZ field.
            EditText next = input;
            next.requestFocus();
            next.post(() -> {
                if (active() && input == next && !busy && !command.pending() && !confirming) {
                    next.requestFocus();
                    next.requestRectangleOnScreen(new android.graphics.Rect(0, 0, next.getWidth(), next.getHeight()));
                }
            });
        }
    }
    public void submit() {
        autoSubmit.cancel(); // FIX: Enter/button and automatic submission share one scan, never two.
        if (closed || busy || confirming || command.pending() || input == null) return;
        if (palletInput != null) {
            pallet = palletInput.getText().toString().trim();
            if (palletInput.hasFocus()) { input.requestFocus(); return; }
        }
        if (sourceInput != null) {
            source = sourceInput.getText().toString().trim();
            if (sourceInput.hasFocus()) { input.requestFocus(); return; }
        }
        String value = input.getText().toString().trim(); input.setText("");
        if (value.isEmpty()) return;
        Map<String, Object> body = new LinkedHashMap<>();
        if (state == null) {
            body.put("id", UUID.randomUUID().toString()); body.put("code", value);
            if (command.begin("", body)) sendPending();
        } else if ("CHECKING".equals(stage())) { body.put("code", value); action("SCAN_SOURCE", body); }
        else if (target() == null) { body.put("code", value); body.put("palletCode", pallet); action("OPEN_TARGET", body); }
        else if (barcode.isEmpty()) { barcode = value; render(); }
        else {
            body.put("barcode", barcode); body.put("kiz", value);
            if (!source.isEmpty()) body.put("sourceBoxCode", source);
            action("MOVE", body);
        }
    }
    private void action(String name, Map<String, Object> body) {
        if (busy || state == null || command.pending()) return;
        body.put("action", name); body.put("version", number(state, "version"));
        if (command.begin("/" + text(state, "id") + "/actions", body)) sendPending();
    }
    private void sendPending() {
        if (busy || !command.pending()) return;
        String path = command.path(); Map<String, Object> body = command.body();
        work(() -> {
            Response<Map<String, Object>> response = api.postPalletSorting(session.authorizationHeader(), BASE + path, body).execute();
            if (!response.isSuccessful() || response.body() == null) {
                // FIX: read the body once. A confirmation challenge is not an automatic stock mutation.
                String failureBody = response.errorBody() == null ? "" : response.errorBody().string();
                if (response.code() >= 400 && response.code() < 500) {
                    command.confirmed();
                    if (state != null) state = require(api.getPalletSorting(session.authorizationHeader(), BASE + "/" + text(state, "id")).execute());
                } else command.uncertain();
                try {
                    JSONObject failure = new JSONObject(failureBody);
                    if (response.code() == 409 && restoreConsent.offer(failure.optString("code"), failure.optString("fingerprint"), failure.optString("message"), body)) return;
                    throw new IOException(failure.optString("message", "Ошибка " + response.code()));
                } catch (org.json.JSONException invalid) { throw new IOException("Ошибка сервера " + response.code() + ". Повторите проверку."); }
            }
            int before = state == null ? 0 : PalletSortingProblemFormatter.recovered(state);
            state = response.body(); command.confirmed(); barcode = "";
            message = PalletSortingProblemFormatter.recovered(state) > before
                ? "Найденная единица учтена в целевом коробе. История операции сохранена."
                : "Действие сохранено.";
            if (!rows(state, "pendingRoutes").isEmpty()) state = require(api.postPalletSorting(session.authorizationHeader(), BASE + "/" + text(state, "id") + "/routes", new LinkedHashMap<>()).execute());
        });
    }
    private void loadList() { work(() -> {
        Response<List<Map<String, Object>>> response = api.listPalletSortings(session.authorizationHeader()).execute();
        if (!response.isSuccessful() || response.body() == null) throw new IOException(error(response));
        sessions = response.body();
    }); }
    private void open(String id) { work(() -> { state = require(api.getPalletSorting(session.authorizationHeader(), BASE + "/" + id).execute()); }); }
    private void routes() { if (state != null) work(() -> { state = require(api.postPalletSorting(session.authorizationHeader(), BASE + "/" + text(state, "id") + "/routes", new LinkedHashMap<>()).execute()); }); }
    private void preview(String action) {
        work(() -> {
            Map<String, Object> data = require(api.getPalletSorting(session.authorizationHeader(), BASE + "/" + text(state, "id") + "/preview?kind=" + ("ARCHIVE_MISSING".equals(action) ? "missing" : "remaining")).execute());
            activity.runOnUiThread(() -> { if (active()) confirm(action, data); });
        });
    }
    private void confirm(String action, Map<String, Object> preview) {
        confirming = true;
        LinearLayout content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(20, 10, 20, 10);
        TextView report = new TextView(activity); StringBuilder text = new StringBuilder("К списанию: " + number(preview, "quantity") + " ед.\n");
        text.append("Оприходовано найденных: ").append(number(preview, "recoveredQuantity")).append(" ед.\n");
        for (Map<String, Object> box : rows(preview, "problemSources")) text.append(PalletSortingProblemFormatter.source(box)).append("\n");
        for (Map<String, Object> box : rows(preview, "boxes")) {
            text.append("\n").append(text(box, "code")).append(PalletSortingProblemFormatter.disposition(box)); // FIX
            for (Map<String, Object> balance : rows(box, "balances")) {
                Map<String, Object> sku = map(balance.get("sku"));
                text.append(text(sku, "article")).append(" / ").append(text(sku, "size")).append(" / ").append(text(sku, "color")).append(": ").append(number(balance, "quantity")).append(" ед.\n");
            }
        }
        report.setText(text); report.setTextSize(18); content.addView(report);
        CheckBox consent = new CheckBox(activity); consent.setText("Подтверждаю отсутствие товара и его списание"); content.addView(consent);
        ScrollView scroll = new ScrollView(activity); scroll.addView(content);
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Подтверждение расхождений").setView(scroll)
            .setNegativeButton("Отмена", (d, w) -> {})
            .setPositiveButton("Применить решение", (d, w) -> {
                Map<String, Object> body = new LinkedHashMap<>(); body.put("fingerprint", text(preview, "fingerprint")); body.put("confirmWriteOff", consent.isChecked());
                action(action, body);
            }).create();
        dialog.setOnDismissListener(d -> { confirming = false; });
        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(number(preview, "quantity") == 0);
            consent.setOnCheckedChangeListener((v, checked) -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(checked || number(preview, "quantity") == 0));
        });
        dialog.show();
    }
    private void work(Job job) {
        if (busy || closed) return;
        busy = true; message = ""; render();
        executor.execute(() -> {
            try { job.run(); } catch (Exception error) { message = error.getMessage() == null ? "Ошибка сети. Повторите запрос." : error.getMessage(); }
            activity.runOnUiThread(() -> { busy = false; if (active()) { render(); showRestoreConsent(); } });
        });
    }
    // ADDED: touch-only confirmation; scanner Enter must never approve a +1 inventory adjustment.
    private void showRestoreConsent() {
        if (!active() || busy || confirming || !restoreConsent.pending()) return;
        confirming = true; autoSubmit.cancel();
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Найден ранее списанный товар")
            .setMessage(restoreConsent.message()).setCancelable(false)
            .setNegativeButton("Отмена", (d,w) -> { restoreConsent.clear(); message="Восстановление отменено. Остатки не изменены."; })
            .setPositiveButton("Товар у меня — восстановить 1 шт.", (d,w) -> {
                Map<String,Object> confirmed = restoreConsent.confirm(); confirming=false;
                if (active() && confirmed != null) action("MOVE",confirmed);
            }).create();
        dialog.setOnKeyListener((d,key,event) -> true);
        dialog.setOnDismissListener(d -> { confirming=false; if(active() && !busy) render(); });
        dialog.show();
    }
    private void label(String text, int size) { TextView view = new TextView(activity); view.setText(text); view.setTextSize(size); view.setTextColor(Color.rgb(25, 35, 45)); view.setPadding(0, 8, 0, 8); root.addView(view); }
    private EditText field(String hint, String value) { EditText view = new EditText(activity); view.setHint(hint); view.setText(value); view.setSingleLine(true); view.setTextSize(20); view.setEnabled(!busy && !command.pending()); root.addView(view); return view; }
    private void button(String title, Runnable action, boolean enabled) { Button view = new Button(activity); view.setText(title); view.setAllCaps(false); view.setMinHeight(68); view.setEnabled(enabled && !busy && (!command.pending() || title.startsWith("Повторить тот же"))); view.setOnClickListener(v -> action.run()); root.addView(view); }
    private String stage() { return text(state, "stage"); }
    private Map<String, Object> target() { for (Map<String, Object> row : rows(state, "targets")) if (text(row, "id").equals(text(state, "activeTargetId"))) return row; return null; }
    private static String text(Map<String, Object> value, String key) { Object result = value == null ? null : value.get(key); return result == null ? "" : String.valueOf(result); }
    private static int number(Map<String, Object> value, String key) { Object result = value == null ? null : value.get(key); return result instanceof Number ? ((Number) result).intValue() : 0; }
    private static boolean yes(Map<String, Object> value, String key) { return Boolean.TRUE.equals(value.get(key)); }
    @SuppressWarnings("unchecked") private static Map<String, Object> map(Object value) { return value instanceof Map ? (Map<String, Object>) value : Collections.emptyMap(); }
    @SuppressWarnings("unchecked") private static List<Map<String, Object>> rows(Map<String, Object> value, String key) { Object result = value == null ? null : value.get(key); return result instanceof List ? (List<Map<String, Object>>) result : Collections.emptyList(); }
    private static Map<String, Object> require(Response<Map<String, Object>> response) throws IOException { if (!response.isSuccessful() || response.body() == null) throw new IOException(error(response)); return response.body(); }
    private static String error(Response<?> response) throws IOException {
        String body = response.errorBody() == null ? "" : response.errorBody().string();
        try { return new JSONObject(body).optString("message", "Ошибка " + response.code()); }
        catch (Exception ignored) { return "Ошибка сервера " + response.code() + ". Повторите проверку."; }
    }
    private interface Job { void run() throws Exception; }
}
