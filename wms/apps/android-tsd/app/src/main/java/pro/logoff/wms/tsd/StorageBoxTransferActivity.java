package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;
import org.json.JSONArray;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.auth.TsdSessionStore;
import pro.logoff.wms.tsd.network.TsdTransferResponse;
import pro.logoff.wms.tsd.network.WmsApi;
import pro.logoff.wms.tsd.network.WmsApiFactory;
import retrofit2.Response;

/** FIX: isolated TSD workflow: source box -> barcode -> KIZ -> storage box. */
public final class StorageBoxTransferActivity extends Activity {
    public static final String AUTO_SOURCE = "autoSourceByKiz";
    private static final int RED = Color.rgb(215, 25, 32);
    private static final int GREEN = Color.rgb(22, 163, 74);
    private static final int TEXT = Color.rgb(30, 41, 59);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private StorageBoxTransferState state = new StorageBoxTransferState();
    private TsdSession session;
    private TsdTransferResponse.SourceBox sourceBox;
    private TsdTransferResponse.Item currentItem;
    private EditText scanInput;
    private String message = "Отсканируйте исходный короб";
    private boolean busy;
    private boolean success;
    // ADDED: only source-first logoff transfers expose explicit physical recount.
    private boolean recountEnabled;
    private StorageKizRecountState recount;
    private boolean recountPending;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        session = new TsdSessionStore(this).load();
        if (session == null || !"logoff".equals(BuildConfig.FLAVOR)) {
            finish();
            return;
        }
        // FIX: a pending operation always takes precedence over the newly selected mode.
        state = new StorageBoxTransferState(getIntent().getBooleanExtra(AUTO_SOURCE, false));
        if (state.autoSource()) message = "Сканируйте ШК товара, затем КИЗ. Исходный короб определит WMS.";
        restorePending();
        if (!state.hasPendingTransfer() && !busy) restoreRecount();
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        TsdSession current = new TsdSessionStore(this).load();
        if (session != null && !session.hasSameAccessToken(current)) {
            // FIX: never continue another employee's unfinished unit after account change.
            finish();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN) {
            submitScan();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void render() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(18), dp(16), dp(28));
        root.setBackgroundColor(Color.rgb(248, 250, 252));
        scroll.addView(root, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text(state.autoSource() ? "ШК → КИЗ → БОКС" : "КОРОБ → БОКС", 26, true);
        title.setTextColor(RED);
        root.addView(title);
        root.addView(text("Перемещение по одной единице", 16, true));
        root.addView(text("Сотрудник: " + session.userName + " · ТСД: " + session.deviceCode, 13, false));

        if (sourceBox != null) {
            root.addView(card("ИЗ КОРОБА", sourceBox.code + "\nКлиент: " +
                (sourceBox.client == null ? "—" : sourceBox.client.name) +
                "\nОстаток: " + sourceBox.totalQuantity + " ед.", Color.rgb(219, 234, 254)));
        }
        if (currentItem != null) {
            root.addView(card("ТОВАР", productText(currentItem), Color.rgb(220, 252, 231)));
        }

        root.addView(card("СЕЙЧАС", prompt(), success ? Color.rgb(220, 252, 231) : Color.WHITE));
        if (message != null && !message.isEmpty()) {
            TextView status = card(success ? "ГОТОВО" : "СТАТУС", message,
                success ? Color.rgb(187, 247, 208) : Color.rgb(254, 226, 226));
            root.addView(status);
        }

        scanInput = new EditText(this);
        scanInput.setHint(inputHint());
        scanInput.setTextSize(20);
        scanInput.setSingleLine(true);
        scanInput.setInputType(InputType.TYPE_CLASS_TEXT);
        scanInput.setEnabled(!busy && (recount == null || !recount.ready()));
        scanInput.setPadding(dp(14), dp(14), dp(14), dp(14));
        root.addView(scanInput, margins(dp(0), dp(12), dp(0), dp(8)));

        Button submit = button(busy ? "ПОДОЖДИТЕ…" : "ПОДТВЕРДИТЬ СКАН", RED);
        submit.setEnabled(!busy && (recount == null || !recount.ready()));
        submit.setOnClickListener(view -> submitScan());
        root.addView(submit);

        if (recount != null) {
            root.addView(card("СВЕРКА КИЗОВ", "Выбранный ШК: " + state.barcode() + "\nОтсканировано: " + recount.scans().size()
                + "\nСканируйте ВСЕ КИЗы только этого товара в исходном коробе. Остальные товары не пересчитываются.", Color.rgb(254, 243, 199)));
            Button finishCount = button(recount.adminAbort() ? "ПОВТОРИТЬ ОТМЕНУ СВЕРКИ" : recount.ready() ? "ПОДТВЕРДИТЬ СВЕРКУ" : "ВСЕ КИЗЫ ЭТОГО ТОВАРА ОТСКАНИРОВАНЫ", GREEN);
            finishCount.setEnabled(!busy && !recount.scans().isEmpty());
            finishCount.setOnClickListener(view -> {
                if (recount.ready()) {
                    if (recount.adminConfirmationRequired() && !recount.adminConfirmed()) {
                        new AlertDialog.Builder(this).setTitle("РЕШЕНИЕ АДМИНИСТРАТОРА")
                            .setMessage(message + "\n\nПодтверждаю физическое наличие всех отсканированных единиц и указанные изменения. Старые наклейки снятых сборок не использовать.")
                            .setPositiveButton("Подтверждаю", (dialog, which) -> { recount.confirmAdministrator(); sendRecount(true); })
                            .setNegativeButton("Отмена", null).show();
                    } else sendRecount(true);
                }
                else new AlertDialog.Builder(this).setTitle("Полный пересчёт товара")
                    .setMessage("Вы отсканировали все " + recount.scans().size() + " единиц товара с ШК " + state.barcode() + " в коробе " + state.sourceCode() + "?")
                    .setPositiveButton("Да, все", (dialog, which) -> sendRecount(false)).setNegativeButton("Продолжить сканы", null).show();
            });
            root.addView(finishCount, margins(0, dp(8), 0, 0));
            if (recountPending && recount.adminRelease() && !recount.adminAbort()) {
                Button abort = button("ОТМЕНИТЬ НЕЗАВЕРШЁННУЮ СВЕРКУ", RED);
                abort.setEnabled(!busy);
                abort.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Отменить сверку?")
                    .setMessage("Остатки не изменятся. Удерживаемые задания вернутся на проверку КИЗ. Если сверка уже применена, WMS только завершит обновление маршрутов. После отмены пересканируйте все КИЗы заново.")
                    .setPositiveButton("Отменить сверку", (dialog, which) -> { recount.abortAdministrator(); sendRecount(true); })
                    .setNegativeButton("Назад", null).show());
                root.addView(abort);
            }
        } else if (recountEnabled && !state.autoSource() && "KIZ".equals(state.stage())) {
            Button startCount = button("СВЕРИТЬ КИЗЫ ЭТОГО ТОВАРА", Color.rgb(180, 83, 9));
            startCount.setEnabled(!busy && !state.hasPendingTransfer());
            startCount.setOnClickListener(view -> {
                recount = new StorageKizRecountState();
                message = "Сканируйте по очереди все физические КИЗы выбранного товара. Затем подтвердите полный список.";
                render();
            });
            root.addView(startCount, margins(0, dp(8), 0, 0));
        }

        if (!"SOURCE".equals(state.stage())) {
            Button cancelUnit = button("ОТМЕНИТЬ ТЕКУЩУЮ ЕДИНИЦУ", Color.rgb(71, 85, 105));
            cancelUnit.setEnabled(!busy && !state.hasPendingTransfer() && !recountPending);
            cancelUnit.setOnClickListener(view -> {
                state.cancelUnit();
                recount = null;
                if (state.autoSource()) sourceBox = null;
                currentItem = null;
                message = "Текущая единица отменена. Сканируйте следующий ШК.";
                success = false;
                render();
            });
            root.addView(cancelUnit, margins(0, dp(8), 0, 0));

            Button anotherSource = button("ДРУГОЙ ИСХОДНЫЙ КОРОБ", Color.rgb(15, 23, 42));
            anotherSource.setEnabled(!busy && !state.hasPendingTransfer() && !recountPending);
            anotherSource.setOnClickListener(view -> resetSource());
            if (!state.autoSource()) root.addView(anotherSource, margins(0, dp(8), 0, 0));
        }
        setContentView(scroll);
        if (!busy) {
            scanInput.requestFocus();
        }
    }

    private void submitScan() {
        if (busy || scanInput == null) return;
        String scanned = scanInput.getText().toString().trim();
        scanInput.setText("");
        if (scanned.isEmpty()) {
            message = "Скан пустой. Повторите сканирование.";
            success = false;
            render();
            return;
        }
        if (recount != null) {
            try { message = recount.add(scanned) ? "КИЗ учтён. Сканируйте следующую единицу этого товара." : "Этот КИЗ уже учтён; повтор не добавлен."; }
            catch (Exception error) { message = error.getMessage(); }
            render(); return;
        }
        switch (state.stage()) {
            case "SOURCE": inspectSource(scanned); break;
            case "BARCODE": inspectItem(scanned, false); break;
            case "KIZ": inspectItem(scanned, true); break;
            case "TARGET": executeTransfer(scanned); break;
            default: resetSource();
        }
    }

    private void inspectSource(String code) {
        String authorization = session.authorizationHeader();
        runRequest(() -> WmsApiFactory.create(BuildConfig.API_BASE_URL)
            .inspectTransferSource(authorization, code).execute(), response -> {
                state.sourceAccepted(response.sourceBox.code);
                sourceBox = response.sourceBox;
                recountEnabled = response.kizRecountEnabled;
                currentItem = null;
                message = "Короб открыт. Сканируйте ШК товара.";
            });
    }

    private void inspectItem(String scanned, boolean isKiz) {
        String authorization = session.authorizationHeader();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("transferMode", state.autoSource() ? "KIZ_TO_STORAGE_BOX" : "BOX_TO_STORAGE_BOX");
        request.put("fromBoxCode", state.sourceCode());
        request.put("scanCode", scanned);
        if (isKiz) request.put("barcode", state.barcode());
        runRequest(() -> WmsApiFactory.create(BuildConfig.API_BASE_URL)
            .inspectTransferItem(authorization, request).execute(), response -> {
                currentItem = response.item;
                if (isKiz) {
                    if (state.autoSource()) {
                        sourceBox = response.sourceBox;
                        state.autoSourceAccepted(sourceBox.code);
                    }
                    state.kizAccepted(scanned);
                } else {
                    state.barcodeAccepted(scanned, "SCAN_KIZ".equals(response.state));
                }
                message = response.message;
            });
    }

    private void executeTransfer(String targetCode) {
        try {
            state.beginTransfer(targetCode);
            persistPending();
        } catch (Exception error) {
            message = error.getMessage();
            success = false;
            render();
            return;
        }
        String authorization = session.authorizationHeader();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("transferMode", state.autoSource() ? "KIZ_TO_STORAGE_BOX" : "BOX_TO_STORAGE_BOX");
        request.put("fromBoxCode", state.sourceCode());
        request.put("toBoxCode", targetCode);
        request.put("barcode", state.barcode());
        request.put("scanCode", state.scanCode());
        request.put("idempotencyKey", state.operationKey());
        runRequest(() -> WmsApiFactory.create(BuildConfig.API_BASE_URL)
            .executeTransfer(authorization, request).execute(), response -> {
                message = response.message + (response.sourceBoxArchived
                    ? " Исходный короб пуст и отправлен в архив."
                    : state.autoSource() ? " Сканируйте ШК следующей единицы — её источник определится заново."
                    : " Можно сканировать следующую единицу из этого же короба.");
                success = true;
                state.completed(response.sourceBoxArchived);
                clearPending();
                currentItem = null;
                if (response.sourceBoxArchived || state.autoSource()) {
                    sourceBox = null;
                } else if (sourceBox != null) {
                    sourceBox.totalQuantity = response.sourceRemaining;
                }
            });
    }

    // FIX: preview never changes stock; persist the exact confirmation before sending it.
    private void sendRecount(boolean confirm) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("fromBoxCode", state.sourceCode()); request.put("barcode", state.barcode());
        request.put("kizCodes", recount.scans()); request.put("allUnitsScanned", true);
        request.put("idempotencyKey", recount.operationKey()); request.put("snapshot", recount.snapshot());
        request.put("adminRelease", recount.adminRelease()); request.put("adminConfirmed", recount.adminConfirmed());
        request.put("adminAbort", recount.adminAbort());
        if (confirm) {
            try {
                JSONObject saved = new JSONObject(request);
                if (!getSharedPreferences("storage_recount_pending", MODE_PRIVATE).edit().putString(pendingKey(), saved.toString()).commit())
                    throw new IllegalStateException("Не удалось сохранить сверку. Подтверждение не отправлено.");
                recountPending = true;
            } catch (Exception error) { message = error.getMessage(); render(); return; }
        }
        WmsApi api = WmsApiFactory.create(BuildConfig.API_BASE_URL);
        runRequest(() -> (confirm ? api.confirmKizRecount(session.authorizationHeader(), request)
            : api.previewKizRecount(session.authorizationHeader(), request)).execute(), response -> {
                message = response.message;
                if ("RECOUNT_READY".equals(response.state)) recount.ready(response.snapshot, response.adminRelease, response.adminConfirmationRequired);
                else if ("RECOUNT_APPLIED".equals(response.state) || "RECOUNT_CANCELLED".equals(response.state) || "NEEDS_REVIEW".equals(response.state)) {
                    clearRecountPending(); recount = null; state.cancelUnit(); currentItem = null;
                    success = "RECOUNT_APPLIED".equals(response.state);
                } else message = "Неизвестный результат сверки. Повторите подтверждение; данные операции сохранены.";
            });
    }

    private void clearRecountPending() {
        getSharedPreferences("storage_recount_pending", MODE_PRIVATE).edit().remove(pendingKey()).commit();
        recountPending = false;
    }

    private void restoreRecount() {
        String saved = getSharedPreferences("storage_recount_pending", MODE_PRIVATE).getString(pendingKey(), null);
        if (saved == null) return;
        try {
            JSONObject value = new JSONObject(saved); JSONArray array = value.getJSONArray("kizCodes");
            ArrayList<String> codes = new ArrayList<>(); for (int i = 0; i < array.length(); i++) codes.add(array.getString(i));
            state = new StorageBoxTransferState(); state.sourceAccepted(value.getString("fromBoxCode"));
            state.barcodeAccepted(value.getString("barcode"), true);
            recount = StorageKizRecountState.restore(codes, value.getString("snapshot"), value.getString("idempotencyKey"));
            recount.restoreAdminDecision(value.optBoolean("adminRelease"), value.optBoolean("adminConfirmed"));
            if (value.optBoolean("adminAbort")) recount.abortAdministrator();
            recountEnabled = true; recountPending = true;
            sourceBox = new TsdTransferResponse.SourceBox(); sourceBox.code = state.sourceCode();
            message = "Есть неподтверждённая сверка. Нажмите ПОДТВЕРДИТЬ СВЕРКУ. Повторных изменений не будет.";
        } catch (Exception error) { busy = true; message = "Не удалось восстановить сверку. Нужна проверка менеджера перед новым перемещением."; }
    }

    private <T> void runRequest(RequestCall<T> request, Success<T> onSuccess) {
        TsdSession owner = session;
        busy = true;
        success = false;
        message = "Проверяем…";
        render();
        executor.execute(() -> {
            try {
                Response<T> response = request.execute();
                if (!response.isSuccessful() || response.body() == null) {
                    throw new HttpFailure(response.code(), errorMessage(response));
                }
                mainHandler.post(() -> {
                    if (!acceptsResponse(owner)) return;
                    busy = false;
                    onSuccess.accept(response.body());
                    render();
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    if (!acceptsResponse(owner)) return;
                    busy = false;
                    success = false;
                    if (error instanceof HttpFailure) {
                        int code = ((HttpFailure) error).code;
                        if (code >= 400 && code < 500 && code != 408) {
                            // FIX: a confirmed admin operation may already hold an order or have removed WB metadata.
                            if (recount != null && !(recountPending && recount.adminRelease())) { clearRecountPending(); recount.repeatPreview(); }
                            state.transferRejected();
                            clearPending();
                        }
                    }
                    message = error.getMessage() == null ? "Нет связи с WMS. Повторите скан." : error.getMessage();
                    // FIX: state and operation key survive an uncertain execute response; retry stays idempotent.
                    render();
                });
            }
        });
    }

    private static String errorMessage(Response<?> response) {
        try {
            String raw = response.errorBody() == null ? "" : response.errorBody().string();
            if (!raw.isEmpty()) {
                Object value = new JSONObject(raw).opt("message");
                if (value != null) return String.valueOf(value);
            }
        } catch (Exception ignored) {
            // The HTTP status below is still actionable when the body is not JSON.
        }
        return "WMS вернула ошибку HTTP " + response.code() + ". Повторите сканирование.";
    }

    private void resetSource() {
        if (busy || state.hasPendingTransfer() || recountPending) return;
        recount = null; recountEnabled = false;
        state = new StorageBoxTransferState(state.autoSource());
        sourceBox = null;
        currentItem = null;
        busy = false;
        success = false;
        message = state.autoSource() ? "Отсканируйте ШК товара" : "Отсканируйте исходный короб";
        render();
    }

    private String prompt() {
        if (recount != null) return recount.ready() ? "Проверьте результат и подтвердите сверку" : "Сканируйте все КИЗы выбранного товара";
        switch (state.stage()) {
            case "BARCODE": return "1. Сканируйте ШК товара";
            case "KIZ": return "2. Сканируйте КИЗ этой единицы";
            case "TARGET": return "3. Сканируйте бокс хранения";
            default: return "Отсканируйте исходный короб";
        }
    }

    private String inputHint() {
        if (recount != null) return "КИЗ следующей единицы";
        switch (state.stage()) {
            case "BARCODE": return "ШК товара";
            case "KIZ": return "КИЗ";
            case "TARGET": return "Бокс хранения";
            default: return "Исходный короб";
        }
    }

    private static String productText(TsdTransferResponse.Item item) {
        return safe(item.name) + "\nАртикул: " + safe(item.article) +
            "\nРазмер: " + safe(item.size) + " · Цвет: " + safe(item.color);
    }

    private TextView card(String heading, String body, int color) {
        TextView view = text(heading + "\n" + body, 17, false);
        view.setTextColor(TEXT);
        view.setBackgroundColor(color);
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        view.setLineSpacing(0, 1.1f);
        view.setLayoutParams(margins(0, dp(10), 0, 0));
        return view;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(TEXT);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private Button button(String value, int color) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(16);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(color);
        button.setMinHeight(dp(54));
        return button;
    }

    private LinearLayout.LayoutParams margins(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String safe(String value) { return value == null || value.isEmpty() ? "—" : value; }

    private boolean acceptsResponse(TsdSession owner) {
        return !isFinishing() && !isDestroyed() && owner.hasSameAccessToken(new TsdSessionStore(this).load());
    }

    private String pendingKey() { return session.userId + "|" + session.deviceCode; }

    private void persistPending() throws Exception {
        JSONObject value = new JSONObject();
        value.put("source", state.sourceCode());
        value.put("barcode", state.barcode());
        value.put("scan", state.scanCode());
        value.put("key", state.operationKey());
        value.put("target", state.pendingTarget());
        value.put("autoSource", state.autoSource());
        if (!getSharedPreferences("storage_transfer_pending", MODE_PRIVATE).edit()
            .putString(pendingKey(), value.toString()).commit()) {
            state.transferRejected();
            throw new IllegalStateException("Не удалось сохранить операцию на ТСД. Перемещение не отправлено.");
        }
    }

    private void restorePending() {
        String saved = getSharedPreferences("storage_transfer_pending", MODE_PRIVATE).getString(pendingKey(), null);
        if (saved == null) return;
        try {
            JSONObject value = new JSONObject(saved);
            state = StorageBoxTransferState.restorePending(value.getString("source"), value.getString("barcode"),
                value.getString("scan"), value.getString("key"), value.getString("target"), value.optBoolean("autoSource", false));
            sourceBox = new TsdTransferResponse.SourceBox();
            sourceBox.code = state.sourceCode();
            message = "Есть неподтверждённое перемещение. Повторно отсканируйте бокс " + state.pendingTarget() + ". Двойного перемещения не будет.";
        } catch (Exception error) {
            message = "Не удалось восстановить операцию. Обратитесь к администратору перед новым перемещением.";
            busy = true;
        }
    }

    private void clearPending() {
        getSharedPreferences("storage_transfer_pending", MODE_PRIVATE).edit().remove(pendingKey()).commit();
    }

    @Override
    public void onBackPressed() {
        if (busy) return;
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private interface RequestCall<T> { Response<T> execute() throws Exception; }
    private interface Success<T> { void accept(T value); }
    private static final class HttpFailure extends Exception {
        final int code;
        HttpFailure(int code, String message) { super(message); this.code = code; }
    }
}
