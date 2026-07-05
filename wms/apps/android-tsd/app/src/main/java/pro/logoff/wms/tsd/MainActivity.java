package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
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
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TsdClientSummary> clients = new ArrayList<>();

    private OperationOutbox outbox;
    private TsdSessionStore sessionStore;
    private TextView statusView;
    private TextView sessionView;
    private TextView countsView;
    private TextView rejectedView;
    private TextView operationHintView;
    private EditText scanInput;
    private EditText baseUrlInput;
    private EditText deviceCodeInput;
    private EditText deviceSecretInput;
    private Spinner clientSpinner;
    private ArrayAdapter<String> clientAdapter;
    private EditText boxCodeInput;
    private EditText fromBoxCodeInput;
    private EditText toBoxCodeInput;
    private EditText quantityInput;
    private EditText stockStatusInput;
    private EditText sourceDocumentInput;
    private EditText commentInput;
    private Button receiptModeButton;
    private Button moveModeButton;
    private Button inventoryModeButton;
    private Button loginButton;
    private Button logoutButton;
    private Button refreshClientsButton;
    private Button syncButton;
    private Button retryRejectedButton;
    private TsdOperationMode operationMode = TsdOperationMode.RECEIPT;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        outbox = new OperationOutbox(TsdDatabase.get(this).operationDao());
        sessionStore = new TsdSessionStore(this);

        statusView = new TextView(this);
        statusView.setText("Готово к сканированию");
        statusView.setTextSize(18f);

        sessionView = new TextView(this);
        sessionView.setTextSize(16f);
        countsView = new TextView(this);
        countsView.setTextSize(16f);
        operationHintView = new TextView(this);
        operationHintView.setTextSize(15f);
        rejectedView = new TextView(this);
        rejectedView.setTextSize(14f);

        baseUrlInput = singleLineInput("API URL");
        baseUrlInput.setText("https://wms.logoff.pro/");

        deviceCodeInput = singleLineInput("Код ТСД");
        deviceSecretInput = singleLineInput("Секрет ТСД");
        deviceSecretInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
        clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        clientSpinner = new Spinner(this);
        clientSpinner.setAdapter(clientAdapter);

        boxCodeInput = singleLineInput("Короб");
        fromBoxCodeInput = singleLineInput("Короб-источник");
        toBoxCodeInput = singleLineInput("Короб-приемник");
        quantityInput = singleLineInput("Количество");
        quantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        stockStatusInput = singleLineInput("Статус остатка");
        stockStatusInput.setText("AVAILABLE");
        sourceDocumentInput = singleLineInput("Документ-основание");
        commentInput = singleLineInput("Комментарий");

        scanInput = singleLineInput("Сканируйте штрихкод товара");
        scanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitScan();
            return true;
        });

        receiptModeButton = operationModeButton("Приемка", TsdOperationMode.RECEIPT);
        moveModeButton = operationModeButton("Перемещение", TsdOperationMode.MOVE);
        inventoryModeButton = operationModeButton("Инвентаризация", TsdOperationMode.INVENTORY);

        loginButton = new Button(this);
        loginButton.setText("Войти на ТСД");
        loginButton.setOnClickListener(view -> loginDevice());

        logoutButton = new Button(this);
        logoutButton.setText("Сбросить вход");
        logoutButton.setOnClickListener(view -> clearSession());

        refreshClientsButton = new Button(this);
        refreshClientsButton.setText("Обновить клиентов");
        refreshClientsButton.setOnClickListener(view -> loadClients());

        syncButton = new Button(this);
        syncButton.setText("Синхронизировать");
        syncButton.setOnClickListener(view -> syncPending());

        retryRejectedButton = new Button(this);
        retryRejectedButton.setText("Вернуть отклоненные в очередь");
        retryRejectedButton.setOnClickListener(view -> requeueRejected());

        LinearLayout modeRow = new LinearLayout(this);
        modeRow.setOrientation(LinearLayout.VERTICAL);
        modeRow.addView(receiptModeButton);
        modeRow.addView(moveModeButton);
        modeRow.addView(inventoryModeButton);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 32, 32, 32);
        root.addView(statusView);
        root.addView(sessionView);
        root.addView(countsView);
        root.addView(baseUrlInput);
        root.addView(deviceCodeInput);
        root.addView(deviceSecretInput);
        root.addView(loginButton);
        root.addView(logoutButton);
        root.addView(refreshClientsButton);
        root.addView(label("Операция"));
        root.addView(modeRow);
        root.addView(operationHintView);
        root.addView(label("Клиент"));
        root.addView(clientSpinner);
        root.addView(boxCodeInput);
        root.addView(fromBoxCodeInput);
        root.addView(toBoxCodeInput);
        root.addView(quantityInput);
        root.addView(stockStatusInput);
        root.addView(sourceDocumentInput);
        root.addView(commentInput);
        root.addView(scanInput);
        root.addView(syncButton);
        root.addView(retryRejectedButton);
        root.addView(label("Отклоненные операции"));
        root.addView(rejectedView);

        ScrollView scrollView = new ScrollView(this);
        scrollView.addView(root);
        setContentView(scrollView);

        setOperationMode(TsdOperationMode.RECEIPT);
        refreshClientOptions();
        refreshQueue(null);
        if (sessionStore.load() != null) {
            loadClients();
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
            submitScan();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void submitScan() {
        String barcode = textValue(scanInput);
        if (barcode.isEmpty()) {
            return;
        }

        String clientId = selectedClientId();
        if (clientId == null) {
            return;
        }

        String stockStatus = optionalValue(stockStatusInput);
        TsdOperationMode selectedMode = operationMode;
        String boxCode = textValue(boxCodeInput);
        String fromBoxCode = textValue(fromBoxCodeInput);
        String toBoxCode = textValue(toBoxCodeInput);
        String quantityText = textValue(quantityInput);
        String sourceDocument = optionalValue(sourceDocumentInput);
        String comment = optionalValue(commentInput);

        Integer quantity;
        if (selectedMode == TsdOperationMode.RECEIPT) {
            if (boxCode.isEmpty()) {
                statusView.setText("Укажите короб приемки");
                boxCodeInput.requestFocus();
                return;
            }
            quantity = parseQuantity(quantityText, "Количество должно быть больше 0", false);
        } else if (selectedMode == TsdOperationMode.MOVE) {
            if (fromBoxCode.isEmpty()) {
                statusView.setText("Укажите короб-источник");
                fromBoxCodeInput.requestFocus();
                return;
            }
            if (toBoxCode.isEmpty()) {
                statusView.setText("Укажите короб-приемник");
                toBoxCodeInput.requestFocus();
                return;
            }
            quantity = parseQuantity(quantityText, "Количество должно быть больше 0", false);
        } else {
            if (boxCode.isEmpty()) {
                statusView.setText("Укажите короб инвентаризации");
                boxCodeInput.requestFocus();
                return;
            }
            quantity = parseQuantity(quantityText, "Факт может быть 0 или больше", true);
        }

        if (quantity == null) {
            return;
        }

        executor.execute(() -> {
            PendingOperation operation;
            if (selectedMode == TsdOperationMode.RECEIPT) {
                operation = outbox.enqueueReceipt(
                    clientId,
                    barcode,
                    boxCode,
                    quantity,
                    stockStatus,
                    sourceDocument,
                    comment
                );
            } else if (selectedMode == TsdOperationMode.MOVE) {
                operation = outbox.enqueueMove(
                    clientId,
                    barcode,
                    fromBoxCode,
                    toBoxCode,
                    quantity,
                    stockStatus,
                    comment
                );
            } else {
                operation = outbox.enqueueInventory(clientId, barcode, boxCode, quantity, stockStatus);
            }

            mainHandler.post(() -> scanInput.setText(""));
            refreshQueue(selectedMode.title + ": скан принят в offline-очередь (" + operation.operationType + ")");
        });
    }

    private void loginDevice() {
        String code = textValue(deviceCodeInput);
        String secret = textValue(deviceSecretInput);
        if (code.isEmpty() || secret.isEmpty()) {
            statusView.setText("Укажите код и секрет ТСД");
            return;
        }

        loginButton.setEnabled(false);
        String baseUrl = textValue(baseUrlInput);
        executor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(baseUrl);
                Response<TsdLoginResponse> response = api.login(new TsdLoginRequest(code, secret)).execute();
                if (!response.isSuccessful()) {
                    throw new IOException("HTTP " + response.code());
                }
                TsdLoginResponse body = response.body();
                if (body == null) {
                    throw new IOException("Пустой ответ сервера");
                }
                sessionStore.save(body);
                mainHandler.post(() -> {
                    loginButton.setEnabled(true);
                    deviceSecretInput.setText("");
                    refreshQueue("ТСД вошел: " + body.device.name);
                    loadClients();
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    loginButton.setEnabled(true);
                    refreshQueue(error.getMessage() == null ? "Не удалось войти на ТСД" : error.getMessage());
                });
            }
        });
    }

    private void loadClients() {
        TsdSession session = sessionStore.load();
        if (session == null) {
            statusView.setText("Сначала войдите на ТСД, потом обновите клиентов");
            return;
        }

        refreshClientsButton.setEnabled(false);
        String baseUrl = textValue(baseUrlInput);
        executor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(baseUrl);
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
                    refreshClientsButton.setEnabled(true);
                    clients.clear();
                    clients.addAll(finalLoadedClients);
                    refreshClientOptions();
                    if (finalLoadedClients.isEmpty()) {
                        refreshQueue("Для этого ТСД нет доступных клиентов");
                    } else {
                        refreshQueue("Клиенты загружены: " + finalLoadedClients.size() + ". Выберите клиента для приемки");
                    }
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    refreshClientsButton.setEnabled(true);
                    refreshQueue(error.getMessage() == null ? "Не удалось загрузить клиентов" : error.getMessage());
                });
            }
        });
    }

    private void clearSession() {
        sessionStore.clear();
        clients.clear();
        refreshClientOptions();
        statusView.setText("Вход ТСД сброшен");
        refreshQueue(null);
    }

    private void syncPending() {
        TsdSession session = sessionStore.load();
        if (session == null) {
            statusView.setText("Сначала войдите по коду и секрету ТСД");
            return;
        }

        syncButton.setEnabled(false);
        String baseUrl = textValue(baseUrlInput);
        executor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(baseUrl);
                TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                    .syncPending(session.authorizationHeader());
                mainHandler.post(() -> {
                    syncButton.setEnabled(true);
                    refreshQueue(summary.message + ": отправлено " + summary.sent + ", принято " + summary.applied +
                        ", отклонено " + summary.rejected + ", на повтор " + summary.retried);
                });
            } catch (Exception error) {
                mainHandler.post(() -> {
                    syncButton.setEnabled(true);
                    refreshQueue(error.getMessage() == null ? "Ошибка синхронизации" : error.getMessage());
                });
            }
        });
    }

    private void requeueRejected() {
        executor.execute(() -> {
            int restored = outbox.requeueRejected();
            refreshQueue("Возвращено в очередь: " + restored);
        });
    }

    private void setOperationMode(TsdOperationMode mode) {
        operationMode = mode;
        operationHintView.setText(mode.hint);
        receiptModeButton.setEnabled(mode != TsdOperationMode.RECEIPT);
        moveModeButton.setEnabled(mode != TsdOperationMode.MOVE);
        inventoryModeButton.setEnabled(mode != TsdOperationMode.INVENTORY);

        boolean isMove = mode == TsdOperationMode.MOVE;
        boolean isInventory = mode == TsdOperationMode.INVENTORY;
        boxCodeInput.setVisibility(isMove ? View.GONE : View.VISIBLE);
        fromBoxCodeInput.setVisibility(isMove ? View.VISIBLE : View.GONE);
        toBoxCodeInput.setVisibility(isMove ? View.VISIBLE : View.GONE);
        sourceDocumentInput.setVisibility(mode == TsdOperationMode.RECEIPT ? View.VISIBLE : View.GONE);
        commentInput.setVisibility(isInventory ? View.GONE : View.VISIBLE);
        quantityInput.setHint(isInventory ? "Фактическое количество" : "Количество");
        scanInput.setHint("Сканируйте штрихкод товара");
    }

    private void refreshQueue(String message) {
        executor.execute(() -> {
            OperationOutboxCounts counts = outbox.counts();
            List<PendingOperation> rejected = outbox.rejected();
            mainHandler.post(() -> {
                if (message != null) {
                    statusView.setText(message);
                }
                TsdSession session = sessionStore.load();
                if (session == null) {
                    sessionView.setText("ТСД не авторизован");
                } else {
                    sessionView.setText("ТСД: " + session.deviceName + " (" + session.deviceCode + ")");
                }
                countsView.setText("В очереди: " + counts.pending + "; отклонено: " + counts.rejected);
                rejectedView.setText(rejectedText(rejected));
            });
        });
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(16f);
        return view;
    }

    private EditText singleLineInput(String label) {
        EditText input = new EditText(this);
        input.setHint(label);
        input.setSingleLine(true);
        return input;
    }

    private Button operationModeButton(String label, TsdOperationMode mode) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(view -> setOperationMode(mode));
        return button;
    }

    private void refreshClientOptions() {
        clientAdapter.clear();
        clientAdapter.add("Выберите клиента");
        for (TsdClientSummary client : clients) {
            clientAdapter.add(client.name + " · " + client.code);
        }
        clientAdapter.notifyDataSetChanged();
        clientSpinner.setSelection(0);
    }

    private String selectedClientId() {
        int selectedIndex = clientSpinner.getSelectedItemPosition() - 1;
        if (selectedIndex < 0 || selectedIndex >= clients.size()) {
            statusView.setText(clients.isEmpty()
                ? "Обновите клиентов и выберите клиента приемки"
                : "Выберите клиента приемки");
            clientSpinner.requestFocus();
            return null;
        }
        return clients.get(selectedIndex).id;
    }

    private String textValue(EditText input) {
        return input.getText().toString().trim();
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

        statusView.setText(message);
        quantityInput.requestFocus();
        return null;
    }

    private String rejectedText(List<PendingOperation> rejected) {
        if (rejected.isEmpty()) {
            return "Отклоненных операций нет";
        }

        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < rejected.size(); index++) {
            PendingOperation operation = rejected.get(index);
            if (index > 0) {
                builder.append("\n\n");
            }
            String barcode = operation.payload.get("barcode");
            if (barcode == null) {
                barcode = operation.payload.get("fromBoxCode");
            }
            if (barcode == null) {
                barcode = operation.operationKey;
            }
            builder.append(operation.operationType)
                .append(" / ")
                .append(barcode)
                .append("\n")
                .append(operation.lastMessage == null ? "Причина не указана" : operation.lastMessage);
        }
        return builder.toString();
    }

    private enum TsdOperationMode {
        RECEIPT(
            "Приемка",
            "Приемка добавит товар в указанный короб через receipt_scan."
        ),
        MOVE(
            "Перемещение",
            "Перемещение перенесет количество из короба-источника в короб-приемник."
        ),
        INVENTORY(
            "Инвентаризация",
            "Инвентаризация сверит фактическое количество в коробе с остатком WMS."
        );

        private final String title;
        private final String hint;

        TsdOperationMode(String title, String hint) {
            this.title = title;
            this.hint = hint;
        }
    }
}
