package pro.logoff.wms.tsd;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.auth.TsdSessionStore;
import pro.logoff.wms.tsd.data.OperationOutbox;
import pro.logoff.wms.tsd.data.OperationOutboxCounts;
import pro.logoff.wms.tsd.data.PendingOperation;
import pro.logoff.wms.tsd.data.TsdDatabase;
import pro.logoff.wms.tsd.network.TsdClientSummary;
import pro.logoff.wms.tsd.network.TsdLoginRequest;
import pro.logoff.wms.tsd.network.TsdLoginResponse;
import pro.logoff.wms.tsd.network.WmsApi;
import pro.logoff.wms.tsd.network.WmsApiFactory;
import pro.logoff.wms.tsd.sync.TsdSyncRunner;
import pro.logoff.wms.tsd.sync.TsdSyncSummary;
import retrofit2.Response;

public class MainActivity extends Activity {
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";
    private static final String APK_URL = "https://wms.logoff.pro/downloads/logoff-tsd.apk";
    private static final int RED = Color.rgb(215, 25, 32);
    private static final int LIGHT_GRAY = Color.rgb(226, 232, 240);
    private static final int TEXT = Color.rgb(30, 41, 59);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TsdClientSummary> clients = new ArrayList<>();

    private OperationOutbox outbox;
    private TsdSessionStore sessionStore;
    private TextView statusView;
    private TextView sessionNameView;
    private TextView sessionCodeView;
    private TextView queueView;
    private EditText baseUrlInput;
    private EditText deviceCodeInput;
    private EditText deviceSecretInput;
    private Spinner clientSpinner;
    private ArrayAdapter<String> clientAdapter;
    private EditText boxCodeInput;
    private EditText quantityInput;
    private EditText stockStatusInput;
    private EditText sourceDocumentInput;
    private EditText commentInput;
    private EditText scanInput;
    private int pendingCount;
    private int rejectedCount;
    private boolean online;
    private String statusMessage = "";
    private Screen screen = Screen.MAIN;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(RED);
        try {
            outbox = new OperationOutbox(TsdDatabase.get(this).operationDao());
            sessionStore = new TsdSessionStore(this);
            renderMainScreen();
            refreshQueue(null);
            if (sessionStore.load() != null) {
                loadClients(false);
            }
        } catch (Throwable error) {
            renderFatalScreen(error);
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_ENTER) {
            if (screen == Screen.RECEIPT && scanInput != null) {
                submitReceiptScan();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void renderMainScreen() {
        screen = Screen.MAIN;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(mainStatusLine());
        root.addView(primaryMenuButton("Приемка товара", view -> openReceipt()));
        root.addView(primaryMenuButton("Сборка заявки", view -> renderInfoScreen("Сборка заявки", "Список активных заявок будет открыт здесь.")));
        root.addView(primaryMenuButton("Инвентаризация", view -> renderInfoScreen("Инвентаризация", "Модуль инвентаризации будет открыт здесь.")));
        root.addView(secondaryButton("Синхронизировать очередь (" + pendingCount + ")", view -> syncPending()));
        root.addView(secondaryButton("Обновить клиентов", view -> loadClients(true)));
        root.addView(secondaryButton("Настройки / вход", view -> renderSettingsScreen()));
        root.addView(secondaryButton("Проверить обновление", view -> openApkDownload()));
        root.addView(secondaryButton("Сбросить вход", view -> clearSession()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void renderSettingsScreen() {
        screen = Screen.SETTINGS;
        TsdSession session = safeSession();
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Настройки / вход"));

        baseUrlInput = input("Адрес WMS");
        baseUrlInput.setText(DEFAULT_BASE_URL);
        deviceCodeInput = input("Логин сотрудника");
        deviceSecretInput = input("Пароль");
        deviceSecretInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        root.addView(baseUrlInput);
        root.addView(deviceCodeInput);
        root.addView(deviceSecretInput);
        root.addView(primaryMenuButton("Войти на ТСД", view -> loginDevice()));
        root.addView(secondaryButton("Скачать приложение ТСД", view -> openApkDownload()));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));

        if (session != null) {
            root.addView(messageView("Сейчас: " + session.deviceName + " / " + session.deviceCode));
        }
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void renderReceiptScreen() {
        screen = Screen.RECEIPT;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Приемка товара"));
        root.addView(label("Клиент"));

        clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        clientSpinner = new Spinner(this);
        clientSpinner.setAdapter(clientAdapter);
        refreshClientOptions();
        root.addView(clientSpinner);
        root.addView(secondaryButton("Обновить клиентов", view -> loadClients(true)));

        boxCodeInput = input("Короб");
        quantityInput = input("Количество");
        quantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        quantityInput.setText("1");
        stockStatusInput = input("Статус остатка");
        stockStatusInput.setText("AVAILABLE");
        sourceDocumentInput = input("Документ-основание");
        commentInput = input("Комментарий");
        scanInput = input("Сканируйте штрихкод товара");
        scanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitReceiptScan();
            return true;
        });

        root.addView(boxCodeInput);
        root.addView(quantityInput);
        root.addView(stockStatusInput);
        root.addView(sourceDocumentInput);
        root.addView(commentInput);
        root.addView(scanInput);
        root.addView(primaryMenuButton("Сохранить скан", view -> submitReceiptScan()));
        root.addView(secondaryButton("Синхронизировать очередь (" + pendingCount + ")", view -> syncPending()));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        scanInput.requestFocus();
        refreshHeaderText();
    }

    private void renderInfoScreen(String title, String text) {
        screen = Screen.INFO;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(title));
        root.addView(messageView(text));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void renderFatalScreen(Throwable error) {
        LinearLayout root = baseRoot();
        root.addView(title("LOGOff ТСД"));
        root.addView(messageView("Приложение не смогло открыть локальную базу. Переустановите приложение или очистите данные ТСД."));
        root.addView(messageView(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
        root.addView(secondaryButton("Скачать приложение заново", view -> openApkDownload()));
        setScrollableContent(root);
    }

    private void openReceipt() {
        if (safeSession() == null) {
            statusMessage = "Сначала выполните вход в настройках.";
            renderSettingsScreen();
            return;
        }
        if (clients.isEmpty()) {
            loadClients(true);
        }
        renderReceiptScreen();
    }

    private void submitReceiptScan() {
        if (outbox == null) {
            statusMessage = "Локальная очередь недоступна.";
            refreshCurrentScreen();
            return;
        }

        String clientId = selectedClientId();
        if (clientId == null) {
            return;
        }

        String barcode = textValue(scanInput);
        String boxCode = textValue(boxCodeInput);
        String quantityText = textValue(quantityInput);
        if (barcode.isEmpty()) {
            statusMessage = "Сканируйте штрихкод товара.";
            refreshCurrentScreen();
            return;
        }
        if (boxCode.isEmpty()) {
            statusMessage = "Укажите короб приемки.";
            boxCodeInput.requestFocus();
            refreshCurrentScreen();
            return;
        }

        Integer quantity = parseQuantity(quantityText, "Количество должно быть больше 0", false);
        if (quantity == null) {
            return;
        }

        String status = optionalValue(stockStatusInput);
        String sourceDocument = optionalValue(sourceDocumentInput);
        String comment = optionalValue(commentInput);
        runBackground(() -> {
            PendingOperation operation = outbox.enqueueReceipt(
                clientId,
                barcode,
                boxCode,
                quantity,
                status,
                sourceDocument,
                comment
            );
            mainHandler.post(() -> {
                scanInput.setText("");
                statusMessage = "Приемка: скан принят в очередь (" + operation.operationType + ")";
                refreshQueue(statusMessage);
            });
        });
    }

    private void loginDevice() {
        String login = textValue(deviceCodeInput);
        String password = textValue(deviceSecretInput);
        if (login.isEmpty() || password.isEmpty()) {
            statusMessage = "Укажите логин и пароль сотрудника.";
            refreshCurrentScreen();
            return;
        }

        String baseUrl = textValue(baseUrlInput);
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(baseUrl);
            Response<TsdLoginResponse> response = api.login(new TsdLoginRequest(login, password)).execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            TsdLoginResponse body = response.body();
            if (body == null || body.device == null) {
                throw new IOException("Пустой ответ сервера");
            }
            sessionStore.save(body);
            mainHandler.post(() -> {
                online = true;
                statusMessage = "ТСД вошел: " + body.device.name;
                loadClients(false);
                renderMainScreen();
            });
        });
    }

    private void loadClients(boolean showResult) {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            refreshCurrentScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<List<TsdClientSummary>> response = api.listClients(session.authorizationHeader()).execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            List<TsdClientSummary> loadedClients = response.body();
            if (loadedClients == null) {
                loadedClients = new ArrayList<>();
            }
            List<TsdClientSummary> finalLoadedClients = loadedClients;
            mainHandler.post(() -> {
                online = true;
                clients.clear();
                clients.addAll(finalLoadedClients);
                refreshClientOptions();
                if (showResult) {
                    statusMessage = clients.isEmpty()
                        ? "Для этого ТСД нет доступных клиентов."
                        : "Клиенты загружены: " + clients.size();
                    refreshCurrentScreen();
                }
            });
        });
    }

    private void syncPending() {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            refreshCurrentScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending(session.authorizationHeader());
            mainHandler.post(() -> {
                online = true;
                statusMessage = summary.message + ": отправлено " + summary.sent + ", принято " + summary.applied +
                    ", отклонено " + summary.rejected + ", на повтор " + summary.retried;
                refreshQueue(statusMessage);
            });
        });
    }

    private void clearSession() {
        sessionStore.clear();
        clients.clear();
        online = false;
        statusMessage = "Вход ТСД сброшен.";
        renderMainScreen();
        refreshQueue(statusMessage);
    }

    private void refreshQueue(String message) {
        runBackground(() -> {
            OperationOutboxCounts counts = outbox.counts();
            mainHandler.post(() -> {
                pendingCount = counts.pending;
                rejectedCount = counts.rejected;
                if (message != null) {
                    statusMessage = message;
                }
                refreshHeaderText();
                if (screen == Screen.MAIN) {
                    renderMainScreen();
                }
            });
        });
    }

    private void runBackground(ThrowingRunnable task) {
        executor.execute(() -> {
            try {
                task.run();
            } catch (Throwable error) {
                mainHandler.post(() -> {
                    online = false;
                    statusMessage = error.getMessage() == null ? "Ошибка приложения" : error.getMessage();
                    refreshCurrentScreen();
                });
            }
        });
    }

    private LinearLayout header() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(0, 0, 0, dp(18));

        TextView logo = new TextView(this);
        logo.setText("ТСД");
        logo.setGravity(Gravity.CENTER);
        logo.setTextColor(Color.WHITE);
        logo.setTextSize(18f);
        logo.setTypeface(null, 1);
        logo.setBackgroundColor(RED);
        header.addView(logo, new LinearLayout.LayoutParams(dp(64), dp(50)));

        LinearLayout names = new LinearLayout(this);
        names.setOrientation(LinearLayout.VERTICAL);
        names.setPadding(dp(14), 0, 0, 0);
        sessionNameView = new TextView(this);
        sessionNameView.setTextColor(TEXT);
        sessionNameView.setTextSize(16f);
        sessionCodeView = new TextView(this);
        sessionCodeView.setTextColor(TEXT);
        sessionCodeView.setTextSize(16f);
        names.addView(sessionNameView);
        names.addView(sessionCodeView);
        header.addView(names);
        return header;
    }

    private TextView mainStatusLine() {
        queueView = new TextView(this);
        queueView.setTextColor(TEXT);
        queueView.setTextSize(17f);
        queueView.setPadding(0, 0, 0, dp(16));
        refreshHeaderText();
        return queueView;
    }

    private void refreshHeaderText() {
        TsdSession session = safeSession();
        if (sessionNameView != null) {
            sessionNameView.setText(session == null ? "Вход сотрудника" : session.deviceName);
        }
        if (sessionCodeView != null) {
            sessionCodeView.setText(session == null ? "не выполнен" : session.deviceCode);
        }
        if (queueView != null) {
            queueView.setText((online ? "Онлайн" : "Офлайн") + " · очередь: " + pendingCount);
        }
    }

    private LinearLayout baseRoot() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(18));
        root.setBackgroundColor(Color.rgb(248, 250, 252));
        return root;
    }

    private void setScrollableContent(LinearLayout root) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        scroll.addView(root);
        setContentView(scroll);
    }

    private Button primaryMenuButton(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(20f);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setBackgroundColor(RED);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(86)
        );
        params.setMargins(0, 0, 0, dp(16));
        button.setLayoutParams(params);
        return button;
    }

    private Button secondaryButton(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(16f);
        button.setTextColor(TEXT);
        button.setAllCaps(false);
        button.setBackgroundColor(LIGHT_GRAY);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        params.setMargins(0, 0, 0, dp(10));
        button.setLayoutParams(params);
        return button;
    }

    private TextView title(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(TEXT);
        view.setTextSize(22f);
        view.setTypeface(null, 1);
        view.setPadding(0, 0, 0, dp(12));
        return view;
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(TEXT);
        view.setTextSize(14f);
        view.setTypeface(null, 1);
        view.setPadding(0, dp(8), 0, dp(4));
        return view;
    }

    private TextView messageView(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(TEXT);
        view.setTextSize(15f);
        view.setPadding(0, dp(8), 0, dp(8));
        return view;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setTextSize(16f);
        input.setPadding(dp(10), 0, dp(10), 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(52)
        );
        params.setMargins(0, 0, 0, dp(10));
        input.setLayoutParams(params);
        return input;
    }

    private void refreshClientOptions() {
        if (clientAdapter == null || clientSpinner == null) {
            return;
        }
        clientAdapter.clear();
        clientAdapter.add("Выберите клиента");
        for (TsdClientSummary client : clients) {
            clientAdapter.add(client.name + " · " + client.code);
        }
        clientAdapter.notifyDataSetChanged();
        clientSpinner.setSelection(0);
    }

    private String selectedClientId() {
        if (clientSpinner == null) {
            statusMessage = "Откройте приемку заново.";
            refreshCurrentScreen();
            return null;
        }
        int selectedIndex = clientSpinner.getSelectedItemPosition() - 1;
        if (selectedIndex < 0 || selectedIndex >= clients.size()) {
            statusMessage = clients.isEmpty()
                ? "Обновите клиентов и выберите клиента приемки."
                : "Выберите клиента приемки.";
            clientSpinner.requestFocus();
            refreshCurrentScreen();
            return null;
        }
        return clients.get(selectedIndex).id;
    }

    private TsdSession safeSession() {
        return sessionStore == null ? null : sessionStore.load();
    }

    private void refreshCurrentScreen() {
        if (screen == Screen.SETTINGS) {
            renderSettingsScreen();
        } else if (screen == Screen.RECEIPT) {
            renderReceiptScreen();
        } else if (screen == Screen.INFO) {
            renderMainScreen();
        } else {
            renderMainScreen();
        }
    }

    private String textValue(EditText input) {
        return input == null ? "" : input.getText().toString().trim();
    }

    private String optionalValue(EditText input) {
        String value = textValue(input);
        return value.isEmpty() ? null : value;
    }

    private Integer parseQuantity(String quantityText, String message, boolean allowZero) {
        try {
            int value = Integer.parseInt(quantityText);
            boolean valid = allowZero ? value >= 0 : value > 0;
            if (valid) {
                return value;
            }
        } catch (NumberFormatException ignored) {
        }
        statusMessage = message;
        quantityInput.requestFocus();
        refreshCurrentScreen();
        return null;
    }

    private void openApkDownload() {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL)));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private enum Screen {
        MAIN,
        SETTINGS,
        RECEIPT,
        INFO
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
