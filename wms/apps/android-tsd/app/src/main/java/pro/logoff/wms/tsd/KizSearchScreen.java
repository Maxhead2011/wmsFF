package pro.logoff.wms.tsd;

import android.app.Activity;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizSearch;
import pro.logoff.wms.tsd.network.WmsApi;
import retrofit2.Response;

// FIX: scan a box, then its Data Matrices; the API records findings without re-picking stock.
final class KizSearchScreen {
    private final Activity activity;
    private final TsdSession session;
    private final WmsApi api;
    private final Runnable back;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Runnable autoSubmit = this::submit;
    private final LinearLayout root;
    private EditText input;
    private TextView feedback, progress, contents;
    private TsdKizSearch task;
    private String box = "";
    private volatile boolean closed;
    private boolean busy;

    KizSearchScreen(Activity activity, TsdSession session, WmsApi api, Runnable back) {
        this.activity = activity; this.session = session; this.api = api; this.back = back;
        root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(20, 16, 20, 20); root.setBackgroundColor(Color.WHITE);
        ScrollView scroll = new ScrollView(activity); scroll.addView(root); activity.setContentView(scroll);
        list();
    }
    EditText scannerField() { return input; }
    boolean belongsTo(TsdSession current) { return session.hasSameAccessToken(current) && KizSearchPolicy.canOpen(BuildConfig.FLAVOR, current); }
    void close() { closed = true; handler.removeCallbacks(autoSubmit); executor.shutdownNow(); }
    private TextView text(String value, int size) {
        TextView view = new TextView(activity); view.setText(value); view.setTextSize(size); view.setTextColor(Color.BLACK); view.setPadding(0, 10, 0, 10); root.addView(view); return view;
    }
    private void button(String value, Runnable action) {
        Button button = new Button(activity); button.setText(value); button.setOnClickListener(v -> { if (!busy) action.run(); }); root.addView(button);
    }
    private boolean alive() { return !closed && !activity.isDestroyed(); }
    private static <T> T body(Response<T> response) throws Exception {
        if (response.isSuccessful() && response.body() != null) return response.body();
        String message = "Не удалось получить ответ ВМС. Повторите попытку.";
        if (response.errorBody() != null) {
            try { Object detail = new JSONObject(response.errorBody().string()).opt("message"); if (detail instanceof String) message = (String) detail; } catch (Exception ignored) {}
        }
        throw new Exception(message);
    }
    private void fail(Exception error) {
        handler.post(() -> { if (!alive()) return; busy = false; feedback.setText(error.getMessage() == null ? "Нет связи с ВМС. Повторите сканирование." : error.getMessage()); feedback.setTextColor(Color.RED); if (input != null) { input.setEnabled(true); input.requestFocus(); } });
    }
    private void list() {
        task = null; input = null; box = ""; root.removeAllViews(); text("Поиск КИЗ", 26);
        feedback = text("Загружаю назначенные вам заявки…", 18); button("Обновить", this::list); button("В меню", () -> { close(); back.run(); }); busy = true;
        executor.execute(() -> {
            try {
                List<TsdKizSearch> tasks = body(api.listKizSearch(session.authorizationHeader()).execute());
                handler.post(() -> {
                    if (!alive()) return; busy = false; feedback.setText(tasks.isEmpty() ? "Нет активных заявок поиска." : "Выберите заявку. Найденный товар откладывайте отдельно.");
                    for (TsdKizSearch item : tasks) button("№" + item.number + " · найдено " + item.found + " из " + item.total + "\n" + item.title, () -> open(item.id));
                });
            } catch (Exception error) { fail(error); }
        });
    }
    private void open(String id) {
        busy = true;
        executor.execute(() -> {
            try { TsdKizSearch loaded = body(api.getKizSearch(session.authorizationHeader(), id).execute());
                handler.post(() -> { if (!alive()) return; busy = false; task = loaded; box = ""; render(); });
            } catch (Exception error) { fail(error); }
        });
    }
    private void render() {
        root.removeAllViews(); text("Поиск · заявка №" + task.number, 24); progress = text("", 20);
        feedback = text("Сначала отсканируйте короб из списка, затем КИЗы товаров внутри.", 20);
        input = new EditText(activity); input.setSingleLine(true); input.setHint("Сканируйте короб или КИЗ"); input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); input.setImeOptions(EditorInfo.IME_ACTION_DONE); root.addView(input);
        button("Проверить скан", this::submit); button("Список заявок", this::list);
        contents = text("", 17); refresh();
        input.setOnEditorActionListener((v, action, event) -> { if (action == EditorInfo.IME_ACTION_DONE || (event != null && event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { submit(); return true; } return false; });
        input.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {}
            public void afterTextChanged(Editable value) { handler.removeCallbacks(autoSubmit); if (!busy && !closed && KizSearchPolicy.ready(value.toString())) handler.postDelayed(autoSubmit, 500); }
        });
        input.requestFocus();
    }
    private void refresh() {
        progress.setText("Найдено " + task.found + " из " + task.total + (box.isEmpty() ? "" : "\nКороб: " + box) + (task.found == task.total ? "\nПоиск завершён. Отложите найденные товары отдельно." : ""));
        StringBuilder lines = new StringBuilder();
        for (TsdKizSearch.Item item : task.items) {
            lines.append(item.found ? "✓ Найден · " : "Найти · ").append(item.pallet == null ? "Паллет-сорт не указан" : item.pallet).append("\n").append(item.boxCode).append("\n").append(item.name).append("\nШК: ").append(item.barcode).append(" · WB ").append(item.order).append("\n\n");
        }
        contents.setText(lines.toString());
    }
    void submit() {
        handler.removeCallbacks(autoSubmit);
        if (closed || busy || input == null || task == null) return;
        String scan = input.getText().toString().trim(); if (scan.isEmpty()) return;
        if (KizSearchPolicy.containsBox(task, scan)) {
            box = scan; input.setText(""); feedback.setText("Короб открыт. Сканируйте КИЗы внутри. Нужный товар отложите отдельно."); feedback.setTextColor(Color.BLACK); refresh(); input.requestFocus(); return;
        }
        if (box.isEmpty()) { feedback.setText("Сначала отсканируйте нужный короб из списка."); feedback.setTextColor(Color.RED); input.setText(""); return; }
        if (scan.startsWith("FFL_")) { feedback.setText("Этот короб не входит в заявку поиска."); feedback.setTextColor(Color.RED); input.setText(""); return; }
        busy = true; input.setEnabled(false); feedback.setText("Проверяю КИЗ…"); feedback.setTextColor(Color.BLACK);
        Map<String, String> payload = new HashMap<>(); payload.put("boxCode", box); payload.put("kiz", scan);
        executor.execute(() -> {
            try {
                TsdKizSearch.ScanResult result = body(api.scanKizSearch(session.authorizationHeader(), task.id, payload).execute());
                handler.post(() -> {
                    if (!alive()) return; busy = false; task.found = result.found;
                    if (result.itemId != null) for (TsdKizSearch.Item item : task.items) if (result.itemId.equals(item.itemId)) item.found = true;
                    feedback.setText(result.message); feedback.setTextColor("FOUND".equals(result.result) ? Color.rgb(0, 115, 35) : Color.rgb(165, 65, 0));
                    refresh(); input.setEnabled(true); input.setText(""); input.requestFocus();
                });
            } catch (Exception error) { fail(error); }
        });
    }
}
