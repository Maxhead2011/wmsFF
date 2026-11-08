package pro.logoff.wms.soswb;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String API = "https://wms.logoff.pro/api/v1";
    private static final int MODE_REQUEST = 0;
    private static final int MODE_ALL = 1;
    private static final int MODE_PRINT = 2;
    private static final int MODE_BOX = 3;

    private final ArrayList<String> requestIds = new ArrayList<>();
    private final ArrayList<Boolean> requestPrintOnly = new ArrayList<>();
    private String lastPostAssembly = "", lastPostBarcode = "", lastPostRequest = "";
    private Button postRepeatButton, refreshRequestsButton;
    private final ArrayList<String> stationIds = new ArrayList<>();
    private String token = "";
    private String activeTaskId = "";
    private String pendingReplaceKiz = "";
    private String selectedSourceBox = "";
    private boolean waitingKiz;
    private boolean activeTaskNeedsRelease;
    private boolean busy;
    private View root;
    private EditText login;
    private EditText password;
    private EditText code;
    private Button loginButton;
    private Button cancelButton;
    private Button replaceButton;
    private View modeButtons;
    private Button modeRequestButton;
    private Button modeAllButton;
    private Button modePrintButton;
    private Button modeBoxButton;
    private Button duplicateKizButton;
    private Spinner mode;
    private Spinner request;
    private Spinner station;
    private TextView modeLabel;
    private TextView requestLabel;
    private TextView stationLabel;
    private TextView prompt;
    private TextView result;
    private TextView requestNumber;
    private TextView orderNumber;
    private android.content.SharedPreferences prefs;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        prefs = getSharedPreferences("sos-wb", MODE_PRIVATE);
        root = findViewById(R.id.root);
        login = findViewById(R.id.login);
        password = findViewById(R.id.password);
        code = findViewById(R.id.code);
        loginButton = findViewById(R.id.loginButton);
        cancelButton = findViewById(R.id.cancelButton);
        replaceButton = findViewById(R.id.replaceButton);
        modeButtons = findViewById(R.id.modeButtons);
        modeRequestButton = findViewById(R.id.modeRequestButton);
        modeAllButton = findViewById(R.id.modeAllButton);
        modePrintButton = findViewById(R.id.modePrintButton);
        modeBoxButton = findViewById(R.id.modeBoxButton);
        duplicateKizButton = findViewById(R.id.duplicateKizButton);
        duplicateKizButton.setOnClickListener(view -> {
            if (!busy && !token.isEmpty()) startActivity(new android.content.Intent(this, DuplicateKizActivity.class)
                .putExtra("token", token).putExtra("login", login.getText().toString().trim()));
        });
        mode = findViewById(R.id.mode);
        request = findViewById(R.id.request);
        postRepeatButton = findViewById(R.id.postRepeatButton);
        refreshRequestsButton = findViewById(R.id.refreshRequestsButton);
        refreshRequestsButton.setOnClickListener(v -> { if (!busy && activeTaskId.isEmpty()) { setBusy(true); loadRequests(); } });
        postRepeatButton.setOnClickListener(v -> {
            if (busy || lastPostAssembly.isEmpty() || !lastPostRequest.equals(selectedRequestId())) return;
            new android.app.AlertDialog.Builder(this).setTitle("Повторная печать")
                .setMessage("Повторить стикер последнего заказа? Отбор и остатки не изменятся.")
                .setPositiveButton("Напечатать повторно", (d, w) -> postPickPrint(lastPostBarcode, lastPostAssembly))
                .setNegativeButton("Отмена", null).show();
        });
        request.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                lastPostAssembly = ""; postRepeatButton.setVisibility(View.GONE);
                if (!busy && activeTaskId.isEmpty()) renderMode();
            }
        });
        station = findViewById(R.id.station);
        modeLabel = findViewById(R.id.modeLabel);
        requestLabel = findViewById(R.id.requestLabel);
        stationLabel = findViewById(R.id.stationLabel);
        prompt = findViewById(R.id.prompt);
        result = findViewById(R.id.result);
        requestNumber = findViewById(R.id.requestNumber);
        orderNumber = findViewById(R.id.orderNumber);
        login.setText(prefs.getString("login", ""));
        loginButton.setOnClickListener(view -> login());
        cancelButton.setOnClickListener(view -> releaseActive());
        replaceButton.setOnClickListener(view -> {
            if (!pendingReplaceKiz.isEmpty()) acceptKiz(pendingReplaceKiz, true);
        });
        modeRequestButton.setOnClickListener(view -> selectMode(MODE_REQUEST));
        modeAllButton.setOnClickListener(view -> selectMode(MODE_ALL));
        modePrintButton.setOnClickListener(view -> selectMode(MODE_PRINT));
        modeBoxButton.setOnClickListener(view -> selectMode(MODE_BOX));
        code.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_DONE || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                scan(); return true;
            }
            return false;
        });
        code.setOnKeyListener((view, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_UP) { scan(); return true; }
            return false;
        });
    }

    private void login() {
        if (busy) return;
        String user = login.getText().toString().trim();
        String pass = password.getText().toString();
        if (user.isEmpty() || pass.isEmpty()) { show("Введите логин и пароль."); return; }
        setBusy(true); show("Подключение к WMS…");
        call("/auth/login", "POST", new JSONObject(map("email", user, "password", pass)).toString(), response -> {
            token = response.optString("accessToken").trim();
            if (token.isEmpty()) throw new IllegalStateException("WMS не вернула токен доступа.");
            prefs.edit().putString("login", user).apply();
            loadRequests();
        });
    }

    private void loadRequests() {
        final String previous = selectedRequestId();
        {
            call("/marketplace-connections/fbs/sos/post-pick/requests", "GET", null, printed -> {
                ArrayList<String> ids = new ArrayList<>(), names = new ArrayList<>();
                ArrayList<Boolean> printOnly = new ArrayList<>();
                for (int group = 0; group < 1; group++) {
                    JSONArray rows = printed.optJSONArray("requests");
                    if (rows == null) continue;
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject row = rows.getJSONObject(i);
                        ids.add(row.getString("requestId")); printOnly.add(group == 0);
                        names.add("№" + String.format("%06d", row.optInt("requestNumber")) + " · " +
                            row.optJSONObject("client").optString("name") + (group == 0
                            ? " · ПЕЧАТЬ: " + row.optInt("printedOrders") + "/" + row.optInt("totalOrders") + " · в очереди " + row.optInt("queuedOrders")
                            : " · ОТБОР: " + row.optInt("availableOrders")));
                    }
                }
                runOnUiThread(() -> {
                    requestIds.clear(); requestIds.addAll(ids); requestPrintOnly.clear(); requestPrintOnly.addAll(printOnly);
                    request.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
                    if (ids.contains(previous)) request.setSelection(ids.indexOf(previous));
                    loadStations();
                });
            });
        }
    }

    private String selectedRequestId() {
        int index = request == null ? -1 : request.getSelectedItemPosition();
        return index >= 0 && index < requestIds.size() ? requestIds.get(index) : "";
    }
    private boolean isPostPickRequest() {
        int index = request.getSelectedItemPosition();
        return mode.getSelectedItemPosition() == MODE_REQUEST && index >= 0 && index < requestPrintOnly.size() && requestPrintOnly.get(index);
    }
    // FIX: scan-to-print never calls SOS claim, KIZ acceptance or warehouse completion.
    private void postPickPrint(String barcode, String repeatAssembly) {
        int index = station.getSelectedItemPosition();
        if (index < 0 || index >= stationIds.size()) { red("Выберите доступный принтер."); return; }
        String stationId = stationIds.get(index), requestId = selectedRequestId();
        JSONObject body;
        String pending = prefs.getString("post-pick-pending", "");
        try {
            if (!pending.isEmpty()) {
                body = new JSONObject(pending);
                if (!body.optString("requestId").equals(requestId) || !body.optString("barcode").equals(barcode) || !body.optString("stationId").equals(stationId)) {
                    red("Результат прошлой печати неизвестен. Выберите прежнюю заявку и принтер, повторите тот же ШК."); return;
                }
            } else {
                body = new JSONObject(map("requestId", requestId, "barcode", barcode, "stationId", stationId,
                    "operationId", java.util.UUID.randomUUID().toString(), "deviceCode", deviceCode()));
                if (!repeatAssembly.isEmpty()) body.put("repeatAssemblyId", repeatAssembly);
                prefs.edit().putString("post-pick-pending", body.toString()).commit();
            }
        } catch (Exception e) { red("Не удалось подготовить печать: " + e.getMessage()); return; }
        setBusy(true); show("Получаю стикер и передаю на принтер…");
        call("/marketplace-connections/fbs/sos/post-pick/print", "POST", body.toString(), response -> runOnUiThread(() -> {
            prefs.edit().remove("post-pick-pending").commit();
            lastPostAssembly = response.optString("assemblyId"); lastPostBarcode = barcode; lastPostRequest = requestId;
            setBusy(false); postRepeatButton.setVisibility(View.VISIBLE);
            green("Заказ №" + response.optString("orderId") + " · " + response.optString("productName") + "\n" +
                ("PRINTED".equals(response.optString("printStatus")) ? "Печать подтверждена агентом." : "Стикер в очереди печати. Проверьте выход этикетки.") + "\nОстатки не изменены."); focus();
        }), failure -> {
            if (failure.status < 500) prefs.edit().remove("post-pick-pending").commit();
            String repeat = failure.field("repeatAssemblyId");
            runOnUiThread(() -> {
                setBusy(false); red(failure.getMessage());
                if (!repeat.isEmpty() && !"null".equals(repeat)) {
                    lastPostAssembly = repeat; lastPostBarcode = barcode; lastPostRequest = requestId;
                    postRepeatButton.setVisibility(View.VISIBLE);
                }
                focus();
            });
            return true;
        });
    }

    private void loadStations() {
        call("/marketplace-connections/fbs/print-stations", "GET", null, response -> {
            JSONArray rows = response.optJSONArray("items");
            if (rows == null) rows = new JSONArray(response.toString());
            stationIds.clear();
            ArrayList<String> names = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                // FIX: an offline station cannot claim the queued print job.
                if (!PrintStationSelection.isSelectable(row.optBoolean("online"))) continue;
                stationIds.add(row.getString("id"));
                names.add("● " + row.optString("name") + " · " + row.optString("printerModel"));
            }
            runOnUiThread(() -> {
                station.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
                openWorkspace();
            });
        });
    }

    private void openWorkspace() {
        setBusy(false);
        duplicateKizButton.setVisibility(View.VISIBLE);
        login.setVisibility(View.GONE); password.setVisibility(View.GONE); loginButton.setVisibility(View.GONE);
        modeLabel.setVisibility(View.VISIBLE); modeButtons.setVisibility(View.VISIBLE); modeBoxButton.setVisibility(View.VISIBLE); prompt.setVisibility(View.VISIBLE); code.setVisibility(View.VISIBLE);
        mode.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{
            "По заявке", "Все заявки", "Печать WB", "Короб + товар"
        }));
        mode.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                if (!activeTaskId.isEmpty()) { show("Сначала завершите выбранный заказ или отмените его."); return; }
                renderMode();
            }
        });
        renderMode();
    }

    private void renderMode() {
        int value = mode.getSelectedItemPosition();
        modeRequestButton.setSelected(value == MODE_REQUEST);
        modeAllButton.setSelected(value == MODE_ALL);
        modePrintButton.setSelected(value == MODE_PRINT);
        modeBoxButton.setSelected(value == MODE_BOX);
        boolean selected = value == MODE_REQUEST;
        boolean printing = value == MODE_PRINT;
        boolean postPicking = isPostPickRequest();
        refreshRequestsButton.setVisibility(selectedModeVisible(value) ? View.VISIBLE : View.GONE);
        postRepeatButton.setVisibility(View.GONE);
        requestLabel.setVisibility(selected ? View.VISIBLE : View.GONE);
        request.setVisibility(selected ? View.VISIBLE : View.GONE);
        stationLabel.setVisibility((printing || postPicking) ? View.VISIBLE : View.GONE);
        station.setVisibility((printing || postPicking) ? View.VISIBLE : View.GONE);
        waitingKiz = false; activeTaskId = ""; activeTaskNeedsRelease = false; pendingReplaceKiz = ""; selectedSourceBox = ""; cancelButton.setVisibility(View.GONE); replaceButton.setVisibility(View.GONE);
        requestNumber.setVisibility(View.GONE); orderNumber.setVisibility(View.GONE);
        neutral();
        prompt.setText(postPicking ? "ОТСКАНИРУЙТЕ ШК ДЛЯ ПЕЧАТИ" : printing ? "ОТСКАНИРУЙТЕ КИЗ ДЛЯ ПЕЧАТИ WB" : "ОТСКАНИРУЙТЕ ШК КОСТЮМА");
        show(postPicking ? "Печать отобранных заказов WB/Ozon. Повторного отбора и списания нет." : printing
            ? "КИЗ будет найден в заказах, WB-этикетка отправится на выбранную станцию."
            : selected ? "Выберите заявку и сканируйте костюмы в любом порядке." : "Поиск идёт сразу по всем незакрытым заявкам.");
        focus();
    }

    private boolean selectedModeVisible(int value) { return value == MODE_REQUEST; }

    private void selectMode(int selectedMode) {
        if (busy) return;
        if (!activeTaskId.isEmpty()) {
            show("Сначала завершите выбранный заказ или отмените его.");
            return;
        }
        mode.setSelection(selectedMode);
        renderMode();
        if (selectedMode == MODE_BOX) {
            prompt.setText("ОТСКАНИРУЙТЕ НОМЕР КОРОБА");
            show("Сначала выберите физический короб, затем сканируйте товары из него.");
        }
    }

    private void scan() {
        if (busy) return;
        String value = code.getText().toString().replace("\r", "").replace("\n", "").trim();
        clearScanField();
        if (value.length() < 5) { show("Код слишком короткий. Повторите сканирование."); focus(); return; }
        if (isPostPickRequest()) { postPickPrint(value, ""); return; }
        if (mode.getSelectedItemPosition() == MODE_PRINT) { printKiz(value); return; }
        if (mode.getSelectedItemPosition() == MODE_BOX && !waitingKiz && selectedSourceBox.isEmpty()) {
            selectedSourceBox = value;
            green("✓ КОРОБ ВЫБРАН: " + selectedSourceBox);
            prompt.setText("ОТСКАНИРУЙТЕ ШК ТОВАРА ИЗ ЭТОГО КОРОБА");
            focus();
            return;
        }
        if (waitingKiz) acceptKiz(value, false); else claimBarcode(value);
    }

    private void claimBarcode(String barcode) {
        String selectedRequest = null;
        if (mode.getSelectedItemPosition() == MODE_REQUEST) {
            int position = request.getSelectedItemPosition();
            if (position < 0 || position >= requestIds.size()) { red("Нет доступной заявки. Обновите список или выберите поиск по всем заявкам."); return; }
            selectedRequest = requestIds.get(position);
        }
        setBusy(true); show("Проверяю потребность и резервирую единицу…");
        Map<String, Object> values = map("barcode", barcode, "deviceCode", deviceCode());
        if (selectedRequest != null) values.put("requestId", selectedRequest);
        if (mode.getSelectedItemPosition() == MODE_BOX && !selectedSourceBox.isEmpty()) values.put("sourceBoxCode", selectedSourceBox);
        call("/marketplace-connections/fbs/sos/claim", "POST", new JSONObject(values).toString(), response -> runOnUiThread(() -> {
            if (!response.optBoolean("matched")) {
                setBusy(false);
                red(response.optString("message", "Товар не нужен. Отсканируйте следующий ШК."));
                return;
            }
            activeTaskId = response.optString("taskId"); activeTaskNeedsRelease = false; waitingKiz = true;
            setBusy(false); cancelButton.setVisibility(View.VISIBLE);
            requestNumber.setText("ЗАЯВКА №" + String.format("%06d", response.optInt("requestNumber")));
            orderNumber.setText("ЗАКАЗ №" + response.optString("orderId"));
            requestNumber.setVisibility(View.VISIBLE); orderNumber.setVisibility(View.VISIBLE);
            green(response.optString("message") + "\n" + response.optString("productName") +
                "\nАрт.: " + response.optString("article") + " · размер " + response.optString("size") +
                "\nВиртуальный резерв: " + response.optString("virtualSourceBox"));
            prompt.setText("ОТСКАНИРУЙТЕ КИЗ"); focus();
        }), failure -> {
            if (failure.status != 409 || !"SOS_WB_ORDER_ACTIVE".equals(failure.field("code"))) return false;
            String taskId = failure.field("taskId");
            if (taskId.isEmpty()) return false;
            String orderId = failure.field("orderId");
            runOnUiThread(() -> {
                activeTaskId = taskId;
                activeTaskNeedsRelease = true;
                waitingKiz = false;
                pendingReplaceKiz = "";
                setBusy(false);
                cancelButton.setVisibility(View.VISIBLE);
                replaceButton.setVisibility(View.GONE);
                requestNumber.setVisibility(View.GONE);
                if (orderId.isEmpty()) {
                    orderNumber.setVisibility(View.GONE);
                } else {
                    orderNumber.setText("ЗАКАЗ №" + orderId);
                    orderNumber.setVisibility(View.VISIBLE);
                }
                red(failure.getMessage() + "\n\nНажмите «ОТМЕНИТЬ ВЫБОР ЗАКАЗА», затем отсканируйте товар заново.");
                prompt.setText("ОТМЕНИТЕ НЕЗАВЕРШЁННЫЙ ЗАКАЗ");
            });
            return true;
        });
    }

    private void acceptKiz(String kiz, boolean confirmReplace) {
        if (activeTaskId.isEmpty()) { waitingKiz = false; neutral(); focus(); return; }
        setBusy(true); show("Передаю КИЗ в Wildberries…");
        call("/marketplace-connections/fbs/sos/tasks/" + activeTaskId + "/kiz", "POST",
            new JSONObject(map("kiz", kiz, "deviceCode", deviceCode(), "confirmReplace", confirmReplace)).toString(), response -> runOnUiThread(() -> {
                setBusy(false);
                if (!response.optBoolean("completed")) {
                    pendingReplaceKiz = kiz;
                    replaceButton.setVisibility(response.optBoolean("canReplace") ? View.VISIBLE : View.GONE);
                    JSONArray oldValues = response.optJSONArray("remoteKiz");
                    String oldKiz = oldValues != null && oldValues.length() > 0 ? oldValues.optString(0) : "не показан";
                    red(response.optString("message") + "\n\nСтарый КИЗ WB:\n" + oldKiz + "\n\nНовый отсканированный КИЗ:\n" + response.optString("scannedKiz"));
                    prompt.setText("ПРОВЕРЬТЕ И ПОДТВЕРДИТЕ ЗАМЕНУ");
                    return;
                }
                green("✓ " + response.optString("message") + "\nЗаявка №" + String.format("%06d", response.optInt("requestNumber")) +
                    " · заказ №" + response.optString("orderId"));
                activeTaskId = ""; activeTaskNeedsRelease = false; pendingReplaceKiz = ""; waitingKiz = false;
                setBusy(false);
                cancelButton.setVisibility(View.GONE); replaceButton.setVisibility(View.GONE); requestNumber.setVisibility(View.GONE); orderNumber.setVisibility(View.GONE);
                prompt.setText(mode.getSelectedItemPosition() == MODE_BOX
                    ? "ОТСКАНИРУЙТЕ СЛЕДУЮЩИЙ ШК ИЗ " + selectedSourceBox
                    : "ОТСКАНИРУЙТЕ СЛЕДУЮЩИЙ ШК КОСТЮМА");
                root.postDelayed(this::neutral, 1300); focus();
            }));
    }

    private void releaseActive() {
        if (activeTaskId.isEmpty() || busy) return;
        String releasing = activeTaskId; setBusy(true);
        call("/marketplace-connections/fbs/sos/tasks/" + releasing + "/release", "POST",
            new JSONObject(map("deviceCode", deviceCode())).toString(), response -> runOnUiThread(() -> {
                activeTaskId = ""; activeTaskNeedsRelease = false; pendingReplaceKiz = ""; waitingKiz = false; setBusy(false);
                cancelButton.setVisibility(View.GONE); replaceButton.setVisibility(View.GONE); requestNumber.setVisibility(View.GONE); orderNumber.setVisibility(View.GONE);
                neutral();
                prompt.setText(mode.getSelectedItemPosition() == MODE_BOX
                    ? "ОТСКАНИРУЙТЕ СЛЕДУЮЩИЙ ШК ИЗ " + selectedSourceBox
                    : "ОТСКАНИРУЙТЕ ШК КОСТЮМА");
                show("Выбор заказа отменён. Виртуальный резерв освобождён."); focus();
            }));
    }

    private void printKiz(String kiz) {
        int position = station.getSelectedItemPosition();
        if (position < 0 || position >= stationIds.size()) { red("Выберите доступную печатную станцию."); return; }
        setBusy(true); show("Ищу заказ и отправляю WB-этикетку на печать…");
        call("/marketplace-connections/fbs/web-order-assembly/scan", "POST",
            new JSONObject(map("code", kiz, "stationId", stationIds.get(position), "deviceCode", deviceCode())).toString(), response -> runOnUiThread(() -> {
                setBusy(false);
                if (response.optString("printJobId").isEmpty()) { red("Заказ найден, но задание печати не создано."); }
                else green("✓ WB-ЭТИКЕТКА ОТПРАВЛЕНА НА ПЕЧАТЬ\nЗаказ №" + response.optString("orderId") +
                    "\nЗаявка №" + String.format("%06d", response.optInt("requestNumber")) + "\nСклад: " + response.optString("warehouseName"));
                focus();
            }));
    }

    private String deviceCode() {
        return "SOS-WB:" + Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
    }

    private void call(String path, String method, String body, Done done) {
        call(path, method, body, done, null);
    }

    private void call(String path, String method, String body, Done done, Failed failed) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = openConnection(API + path);
                connection.setConnectTimeout(10_000); connection.setReadTimeout(45_000); connection.setRequestMethod(method);
                connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) { connection.setDoOutput(true); byte[] bytes = body.getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length); connection.getOutputStream().write(bytes); }
                int status = connection.getResponseCode();
                String text = read(connection, status < 400 ? connection.getInputStream() : connection.getErrorStream());
                if (status >= 400) throw new ApiFailure(status, errorObject(text), error(text, status));
                JSONObject response = text.trim().startsWith("[") ? new JSONObject().put("items", new JSONArray(text)) : new JSONObject(text);
                done.ok(response);
            } catch (Throwable failure) {
                if (failure instanceof ApiFailure && failed != null && failed.handle((ApiFailure) failure)) return;
                String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
                runOnUiThread(() -> { setBusy(false); red(message); focus(); });
            } finally { if (connection != null) connection.disconnect(); }
        }, "sos-wb-request").start();
    }

    protected HttpURLConnection openConnection(String endpoint) throws Exception { return (HttpURLConnection) new URL(endpoint).openConnection(); }

    private static String read(HttpURLConnection ignored, InputStream stream) throws Exception {
        if (stream == null) return "{}";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String error(String text, int status) {
        try { Object value = new JSONObject(text).opt("message"); if (value instanceof JSONArray) return ((JSONArray)value).join("; "); if (value != null) return String.valueOf(value); }
        catch (Exception ignored) {}
        return "WMS вернула HTTP " + status;
    }

    private static JSONObject errorObject(String text) {
        try { return new JSONObject(text); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private void setBusy(boolean value) { busy = value; runOnUiThread(() -> {
        boolean taskActive = !activeTaskId.isEmpty();
        station.setEnabled(!value); refreshRequestsButton.setEnabled(!value && !taskActive); postRepeatButton.setEnabled(!value);
        code.setEnabled(!value && !activeTaskNeedsRelease); loginButton.setEnabled(!value); cancelButton.setEnabled(!value && taskActive);
        mode.setEnabled(!value && !taskActive); request.setEnabled(!value && !taskActive);
        modeRequestButton.setEnabled(!value && !taskActive); modeAllButton.setEnabled(!value && !taskActive); modePrintButton.setEnabled(!value && !taskActive); modeBoxButton.setEnabled(!value && !taskActive);
    }); }
    private void neutral() { runOnUiThread(() -> { root.setBackgroundColor(Color.rgb(244,246,250)); result.setTextColor(Color.rgb(17,24,39)); prompt.setTextColor(Color.rgb(17,24,39)); }); }
    private void green(String message) { runOnUiThread(() -> { root.setBackgroundColor(Color.rgb(18,145,82)); result.setTextColor(Color.WHITE); prompt.setTextColor(Color.WHITE); result.setText(message); }); }
    private void red(String message) { runOnUiThread(() -> { root.setBackgroundColor(Color.rgb(211,30,56)); result.setTextColor(Color.WHITE); prompt.setTextColor(Color.WHITE); result.setText(message); }); }
    private void show(String message) { runOnUiThread(() -> result.setText(message)); }
    private void clearScanField() {
        code.setText("");
        code.getText().clear();
        code.setSelection(0);
    }
    private void focus() { code.postDelayed(() -> { clearScanField(); code.requestFocus(); getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN); }, 80); }
    private Map<String,Object> map(Object... values) { Map<String,Object> out = new HashMap<>(); for (int i=0;i<values.length;i+=2) out.put(String.valueOf(values[i]), values[i+1]); return out; }
    private interface Done { void ok(JSONObject response) throws Exception; }
    private interface Failed { boolean handle(ApiFailure failure); }
    private static final class ApiFailure extends Exception {
        final int status;
        final JSONObject payload;
        ApiFailure(int status, JSONObject payload, String message) { super(message); this.status = status; this.payload = payload; }
        String field(String name) {
            String direct = payload.optString(name).trim();
            if (!direct.isEmpty()) return direct;
            JSONObject nested = payload.optJSONObject("message");
            return nested == null ? "" : nested.optString(name).trim();
        }
    }
}
