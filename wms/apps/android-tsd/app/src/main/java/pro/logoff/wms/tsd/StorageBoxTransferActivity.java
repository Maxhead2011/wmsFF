package pro.logoff.wms.tsd;

import android.app.Activity;
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

import java.util.LinkedHashMap;
import java.util.Map;
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        session = new TsdSessionStore(this).load();
        if (session == null || !"logoff".equals(BuildConfig.FLAVOR)) {
            finish();
            return;
        }
        restorePending();
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

        TextView title = text("КОРОБ → БОКС", 26, true);
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
        scanInput.setEnabled(!busy);
        scanInput.setPadding(dp(14), dp(14), dp(14), dp(14));
        root.addView(scanInput, margins(dp(0), dp(12), dp(0), dp(8)));

        Button submit = button(busy ? "ПОДОЖДИТЕ…" : "ПОДТВЕРДИТЬ СКАН", RED);
        submit.setEnabled(!busy);
        submit.setOnClickListener(view -> submitScan());
        root.addView(submit);

        if (!"SOURCE".equals(state.stage())) {
            Button cancelUnit = button("ОТМЕНИТЬ ТЕКУЩУЮ ЕДИНИЦУ", Color.rgb(71, 85, 105));
            cancelUnit.setEnabled(!busy && !state.hasPendingTransfer());
            cancelUnit.setOnClickListener(view -> {
                state.cancelUnit();
                currentItem = null;
                message = "Текущая единица отменена. Сканируйте следующий ШК.";
                success = false;
                render();
            });
            root.addView(cancelUnit, margins(0, dp(8), 0, 0));

            Button anotherSource = button("ДРУГОЙ ИСХОДНЫЙ КОРОБ", Color.rgb(15, 23, 42));
            anotherSource.setEnabled(!busy && !state.hasPendingTransfer());
            anotherSource.setOnClickListener(view -> resetSource());
            root.addView(anotherSource, margins(0, dp(8), 0, 0));
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
                currentItem = null;
                message = "Короб открыт. Сканируйте ШК товара.";
            });
    }

    private void inspectItem(String scanned, boolean isKiz) {
        String authorization = session.authorizationHeader();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("transferMode", "BOX_TO_STORAGE_BOX");
        request.put("fromBoxCode", state.sourceCode());
        request.put("scanCode", scanned);
        if (isKiz) request.put("barcode", state.barcode());
        runRequest(() -> WmsApiFactory.create(BuildConfig.API_BASE_URL)
            .inspectTransferItem(authorization, request).execute(), response -> {
                currentItem = response.item;
                if (isKiz) {
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
        request.put("transferMode", "BOX_TO_STORAGE_BOX");
        request.put("fromBoxCode", state.sourceCode());
        request.put("toBoxCode", targetCode);
        request.put("barcode", state.barcode());
        request.put("scanCode", state.scanCode());
        request.put("idempotencyKey", state.operationKey());
        runRequest(() -> WmsApiFactory.create(BuildConfig.API_BASE_URL)
            .executeTransfer(authorization, request).execute(), response -> {
                message = response.message + (response.sourceBoxArchived
                    ? " Исходный короб пуст и отправлен в архив."
                    : " Можно сканировать следующую единицу из этого же короба.");
                success = true;
                state.completed(response.sourceBoxArchived);
                clearPending();
                currentItem = null;
                if (response.sourceBoxArchived) {
                    sourceBox = null;
                } else if (sourceBox != null) {
                    sourceBox.totalQuantity = response.sourceRemaining;
                }
            });
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
        if (busy || state.hasPendingTransfer()) return;
        state = new StorageBoxTransferState();
        sourceBox = null;
        currentItem = null;
        busy = false;
        success = false;
        message = "Отсканируйте исходный короб";
        render();
    }

    private String prompt() {
        switch (state.stage()) {
            case "BARCODE": return "1. Сканируйте ШК товара";
            case "KIZ": return "2. Сканируйте КИЗ этой единицы";
            case "TARGET": return "3. Сканируйте бокс хранения";
            default: return "Отсканируйте исходный короб";
        }
    }

    private String inputHint() {
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
                value.getString("scan"), value.getString("key"), value.getString("target"));
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
