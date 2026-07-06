package pro.logoff.wms.tsd;

import android.app.Activity;
import android.content.SharedPreferences;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.auth.TsdSessionStore;
import pro.logoff.wms.tsd.data.OperationOutbox;
import pro.logoff.wms.tsd.data.OperationOutboxCounts;
import pro.logoff.wms.tsd.data.PendingOperation;
import pro.logoff.wms.tsd.data.TsdDatabase;
import pro.logoff.wms.tsd.network.TsdClientSummary;
import pro.logoff.wms.tsd.network.TsdAssemblyPlan;
import pro.logoff.wms.tsd.network.TsdAssemblyRequestSummary;
import pro.logoff.wms.tsd.network.TsdMovementTask;
import pro.logoff.wms.tsd.network.TsdRelabelTask;
import pro.logoff.wms.tsd.network.TsdSearchBoxTask;
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
    private static final String APP_VERSION = "0.1.41";
    private static final int RED = Color.rgb(215, 25, 32);
    private static final int LIGHT_GRAY = Color.rgb(226, 232, 240);
    private static final int TEXT = Color.rgb(30, 41, 59);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TsdClientSummary> clients = new ArrayList<>();
    private final List<TsdAssemblyRequestSummary> assemblyRequests = new ArrayList<>();

    private OperationOutbox outbox;
    private TsdSessionStore sessionStore;
    private SharedPreferences progressStore;
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
    private EditText assemblyScanInput;
    private TsdAssemblyPlan assemblyPlan;
    private TsdRelabelTask activeRelabelTask;
    private String selectedRelabelBox = "";
    private String selectedMoveTargetBox = "";
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
            progressStore = getSharedPreferences("tsd_assembly_progress", MODE_PRIVATE);
            if (sessionStore.load() == null) {
                renderSettingsScreen();
            } else {
                renderMainScreen();
            }
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
            if (screen == Screen.BOX_SEARCH && assemblyScanInput != null) {
                submitBoxSearchScan();
                return true;
            }
            if (screen == Screen.RELABEL_BOX && assemblyScanInput != null) {
                submitRelabelScan();
                return true;
            }
            if (screen == Screen.MOVEMENTS && assemblyScanInput != null) {
                submitMovementScan();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void renderMainScreen() {
        if (safeSession() == null) {
            renderSettingsScreen();
            return;
        }
        screen = Screen.MAIN;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(mainStatusLine());
        root.addView(primaryMenuButton("Приемка товара", view -> openReceipt()));
        root.addView(primaryMenuButton("Сборка заявки", view -> openAssemblyRequests()));
        root.addView(primaryMenuButton("Инвентаризация", view -> renderInfoScreen("Инвентаризация", "Модуль инвентаризации будет открыт здесь.")));
        root.addView(secondaryButton("Синхронизировать очередь (" + pendingCount + ")", view -> syncPending()));
        root.addView(secondaryButton("Обновить клиентов", view -> loadClients(true)));
        root.addView(secondaryButton("Настройки / вход", view -> renderSettingsScreen()));
        root.addView(secondaryButton("Проверить обновление", view -> openApkDownload()));
        root.addView(secondaryButton("Сбросить вход", view -> clearSession()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        root.addView(versionView());
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
        if (session != null) {
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        }

        if (session != null) {
            root.addView(messageView("Сейчас: " + session.deviceName + " / " + session.deviceCode));
        }
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        root.addView(versionView());
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
        root.addView(versionView());
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

    private void openAssemblyRequests() {
        if (safeSession() == null) {
            statusMessage = "Сначала выполните вход в настройках.";
            renderSettingsScreen();
            return;
        }
        loadAssemblyRequests();
    }

    private void loadAssemblyRequests() {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            refreshCurrentScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<List<TsdAssemblyRequestSummary>> response = api.listAssemblyRequests(session.authorizationHeader()).execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            List<TsdAssemblyRequestSummary> loaded = response.body();
            if (loaded == null) {
                loaded = new ArrayList<>();
            }
            List<TsdAssemblyRequestSummary> finalLoaded = loaded;
            mainHandler.post(() -> {
                online = true;
                assemblyRequests.clear();
                assemblyRequests.addAll(finalLoaded);
                statusMessage = assemblyRequests.isEmpty() ? "Активных заявок на сборку нет." : "Заявки загружены: " + assemblyRequests.size();
                renderAssemblyListScreen();
            });
        });
    }

    private void renderAssemblyListScreen() {
        screen = Screen.ASSEMBLY_LIST;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Сборка заявки"));

        if (assemblyRequests.isEmpty()) {
            root.addView(messageView("Активных заявок на сборку нет."));
        }
        for (TsdAssemblyRequestSummary request : assemblyRequests) {
            root.addView(requestButton(request));
        }

        root.addView(secondaryButton("Обновить", view -> loadAssemblyRequests()));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        refreshHeaderText();
    }

    private Button requestButton(TsdAssemblyRequestSummary request) {
        String clientName = request.client == null ? "" : request.client.name;
        String city = emptyAsDash(request.city);
        String inWork = request.inWorkBy == null ? "" : "\nУже в работе: " + request.inWorkBy.name;
        String text = request.title + "\nКлиент: " + clientName + "\nГород: " + city + " · Статус: " + request.status + " · строк: " + request.rowsCount + inWork;
        return multilineSecondaryButton(text, view -> loadAssemblyPlan(request.id));
    }

    private void loadAssemblyPlan(String requestId) {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            refreshCurrentScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdAssemblyPlan> response = api.getAssemblyRequest(session.authorizationHeader(), requestId).execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            TsdAssemblyPlan plan = response.body();
            if (plan == null) {
                throw new IOException("Пустая заявка от сервера");
            }
            mainHandler.post(() -> {
                online = true;
                assemblyPlan = plan;
                activeRelabelTask = null;
                selectedRelabelBox = "";
                selectedMoveTargetBox = "";
                statusMessage = "Заявка открыта.";
                renderAssemblyDetailScreen();
            });
        });
    }

    private void renderAssemblyDetailScreen() {
        screen = Screen.ASSEMBLY_DETAIL;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Заявка " + assemblyPlan.title));
        root.addView(messageView("Клиент: " + (assemblyPlan.client == null ? "-" : assemblyPlan.client.name)));
        root.addView(messageView("Город: " + emptyAsDash(assemblyPlan.city)));
        root.addView(messageView("Статус: " + assemblyPlan.status + " · строк: " + assemblyPlan.rowsCount));
        root.addView(messageView("Единиц к отгрузке: " + assemblyPlan.totalRequested + " · коробов найти: " + safeSearchBoxes().size()));

        root.addView(stageButton("1. Поиск коробов", isSearchDone(), view -> renderBoxSearchScreen()));
        root.addView(stageButton("2. Перемаркировка", isRelabelDone(), view -> renderRelabelScreen()));
        root.addView(stageButton("3. Перемещения", isMovementDone(), view -> renderMovementScreen()));
        root.addView(secondaryButton("Обновить заявку", view -> loadAssemblyPlan(assemblyPlan.id)));
        root.addView(secondaryButton("К списку заявок", view -> renderAssemblyListScreen()));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        refreshHeaderText();
    }

    private Button stageButton(String text, boolean done, View.OnClickListener listener) {
        Button button = primaryMenuButton(text, listener);
        button.setBackgroundColor(done ? Color.rgb(22, 163, 74) : RED);
        return button;
    }

    private void renderBoxSearchScreen() {
        screen = Screen.BOX_SEARCH;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Поиск коробов"));
        List<TsdSearchBoxTask> boxes = safeSearchBoxes();
        Set<String> found = foundBoxes();
        root.addView(messageView("Найдено: " + found.size() + " / " + boxes.size()));
        assemblyScanInput = input("Сканируйте короб");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitBoxSearchScan();
            return true;
        });
        root.addView(assemblyScanInput);

        for (TsdSearchBoxTask box : boxes) {
            if (found.contains(normalizeBoxCode(box.boxCode))) {
                root.addView(taskRow(box.boxCode, "Найден", Color.rgb(187, 247, 208)));
            }
        }
        for (TsdSearchBoxTask box : boxes) {
            if (!found.contains(normalizeBoxCode(box.boxCode))) {
                root.addView(taskRow(box.boxCode, "Нужно найти", Color.rgb(241, 245, 249)));
            }
        }

        root.addView(secondaryButton("Обновить", view -> renderBoxSearchScreen()));
        root.addView(secondaryButton("Назад", view -> renderAssemblyDetailScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        assemblyScanInput.requestFocus();
        refreshHeaderText();
    }

    private void submitBoxSearchScan() {
        String scannedCode = textValue(assemblyScanInput);
        String code = normalizeBoxCode(scannedCode);
        if (code.isEmpty() || assemblyPlan == null) {
            return;
        }
        Set<String> required = new LinkedHashSet<>();
        String displayCode = scannedCode;
        for (TsdSearchBoxTask box : safeSearchBoxes()) {
            String normalizedBoxCode = normalizeBoxCode(box.boxCode);
            required.add(normalizedBoxCode);
            if (normalizedBoxCode.equals(code)) {
                displayCode = box.boxCode;
            }
        }
        Set<String> found = foundBoxes();
        if (!required.contains(code)) {
            statusMessage = "Короб не нужен: " + scannedCode;
        } else if (found.contains(code)) {
            statusMessage = "Короб уже найден: " + displayCode;
        } else {
            found.add(code);
            saveStringSet(progressKey("found_boxes"), found);
            statusMessage = "Короб найден: " + displayCode;
        }
        assemblyScanInput.setText("");
        renderBoxSearchScreen();
    }

    private void renderRelabelScreen() {
        screen = Screen.RELABEL_LIST;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Перемаркировка"));
        root.addView(messageView("Заявка: " + assemblyPlan.title));
        root.addView(messageView("Клиент: " + (assemblyPlan.client == null ? "-" : assemblyPlan.client.name)));
        root.addView(messageView("Перемаркировка: " + doneRelabelTotal() + " / " + relabelTotal()));
        root.addView(messageView("Выберите короб для перемаркировки:"));

        Set<String> boxes = new LinkedHashSet<>();
        for (TsdRelabelTask task : safeRelabelTasks()) {
            if (remainingRelabel(task) > 0) {
                boxes.add(task.sourceBox);
            }
        }
        if (boxes.isEmpty()) {
            root.addView(messageView("Перемаркировка завершена или не требуется."));
        }
        for (String box : boxes) {
            int remaining = 0;
            for (TsdRelabelTask task : safeRelabelTasks()) {
                if (box.equals(task.sourceBox)) {
                    remaining += Math.max(0, remainingRelabel(task));
                }
            }
            root.addView(multilineSecondaryButton(box + "\nОсталось: " + remaining, view -> {
                selectedRelabelBox = box;
                activeRelabelTask = null;
                renderRelabelBoxScreen();
            }));
        }

        root.addView(secondaryButton("Обновить", view -> renderRelabelScreen()));
        root.addView(secondaryButton("Назад", view -> renderAssemblyDetailScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void renderRelabelBoxScreen() {
        screen = Screen.RELABEL_BOX;
        if (assemblyPlan == null || selectedRelabelBox.isEmpty()) {
            renderRelabelScreen();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Перемаркировка"));
        root.addView(messageView("Короб: " + selectedRelabelBox));
        root.addView(messageView(activeRelabelTask == null ? "Сканируйте старый ШК товара" : "Сканируйте новый ШК: " + activeRelabelTask.newBarcode));
        assemblyScanInput = input(activeRelabelTask == null ? "Старый ШК" : "Новый ШК");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitRelabelScan();
            return true;
        });
        root.addView(assemblyScanInput);

        for (TsdRelabelTask task : safeRelabelTasks()) {
            if (!selectedRelabelBox.equals(task.sourceBox)) {
                continue;
            }
            int remaining = remainingRelabel(task);
            if (remaining > 0) {
                root.addView(taskRow(task.oldBarcode + " -> " + task.newBarcode, "Осталось: " + remaining, Color.rgb(241, 245, 249)));
            }
        }

        root.addView(secondaryButton("Назад к коробам", view -> renderRelabelScreen()));
        root.addView(secondaryButton("Назад к заявке", view -> renderAssemblyDetailScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        assemblyScanInput.requestFocus();
        refreshHeaderText();
    }

    private void submitRelabelScan() {
        String code = textValue(assemblyScanInput);
        if (code.isEmpty() || assemblyPlan == null) {
            return;
        }
        if (activeRelabelTask == null) {
            for (TsdRelabelTask task : safeRelabelTasks()) {
                if (selectedRelabelBox.equals(task.sourceBox) && remainingRelabel(task) > 0 && code.equals(task.oldBarcode)) {
                    activeRelabelTask = task;
                    statusMessage = "Старый ШК принят. Сканируйте новый ШК.";
                    assemblyScanInput.setText("");
                    renderRelabelBoxScreen();
                    return;
                }
            }
            statusMessage = "Неверный товар для перемаркировки: " + code;
        } else if (code.equals(activeRelabelTask.newBarcode)) {
            int done = doneInt(relabelKey(activeRelabelTask)) + 1;
            saveDoneInt(relabelKey(activeRelabelTask), done);
            statusMessage = "Переклейка подтверждена: " + done + " / " + activeRelabelTask.quantity;
            if (remainingRelabel(activeRelabelTask) <= 0) {
                activeRelabelTask = null;
            }
        } else {
            statusMessage = "Новый ШК неверный. Нужно: " + activeRelabelTask.newBarcode;
        }
        assemblyScanInput.setText("");
        renderRelabelBoxScreen();
    }

    private void renderMovementScreen() {
        screen = Screen.MOVEMENTS;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Перемещения"));
        root.addView(messageView("Перемещения: " + doneMovementTotal() + " / " + movementTotal()));
        root.addView(messageView(selectedMoveTargetBox.isEmpty() ? "Сканируйте новый короб, затем товар" : "Новый короб: " + selectedMoveTargetBox));
        assemblyScanInput = input(selectedMoveTargetBox.isEmpty() ? "Новый короб" : "ШК товара");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitMovementScan();
            return true;
        });
        root.addView(assemblyScanInput);

        for (TsdMovementTask task : safeMovementTasks()) {
            int remaining = remainingMovement(task);
            if (remaining > 0) {
                String label = task.sourceBox + " -> " + task.targetBox + "\n" + task.barcode;
                root.addView(taskRow(label, "Осталось: " + remaining, Color.rgb(241, 245, 249)));
            }
        }

        root.addView(secondaryButton("Сменить новый короб", view -> {
            selectedMoveTargetBox = "";
            renderMovementScreen();
        }));
        root.addView(secondaryButton("Назад", view -> renderAssemblyDetailScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        assemblyScanInput.requestFocus();
        refreshHeaderText();
    }

    private void submitMovementScan() {
        String code = textValue(assemblyScanInput);
        if (code.isEmpty() || assemblyPlan == null) {
            return;
        }

        for (TsdMovementTask task : safeMovementTasks()) {
            if (remainingMovement(task) > 0 && code.equals(task.targetBox)) {
                selectedMoveTargetBox = code;
                statusMessage = "Новый короб выбран: " + code;
                assemblyScanInput.setText("");
                renderMovementScreen();
                return;
            }
        }

        if (selectedMoveTargetBox.isEmpty()) {
            statusMessage = "Сначала отсканируйте новый короб для перемещения.";
            assemblyScanInput.setText("");
            renderMovementScreen();
            return;
        }

        for (TsdMovementTask task : safeMovementTasks()) {
            if (remainingMovement(task) > 0 && selectedMoveTargetBox.equals(task.targetBox) && code.equals(task.barcode)) {
                runBackground(() -> {
                    outbox.enqueueMove(
                        assemblyPlan.client.id,
                        task.barcode,
                        task.sourceBox,
                        task.targetBox,
                        1,
                        "AVAILABLE",
                        "Перемещение по заявке " + assemblyPlan.title
                    );
                    mainHandler.post(() -> {
                        int done = doneInt(movementKey(task)) + 1;
                        saveDoneInt(movementKey(task), done);
                        statusMessage = "Товар перемещен в очередь: " + done + " / " + task.quantity;
                        refreshQueue(null);
                        renderMovementScreen();
                    });
                });
                return;
            }
        }

        statusMessage = "Товар не нужен для текущего нового короба: " + code;
        assemblyScanInput.setText("");
        renderMovementScreen();
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
        renderSettingsScreen();
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
                if (screen == Screen.MAIN && safeSession() != null) {
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

    private Button multilineSecondaryButton(String text, View.OnClickListener listener) {
        Button button = secondaryButton(text, listener);
        button.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        button.setTextSize(15f);
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(10));
        button.setLayoutParams(params);
        button.setMinHeight(dp(86));
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

    private TextView versionView() {
        TextView view = new TextView(this);
        view.setText("Версия " + APP_VERSION);
        view.setTextColor(Color.rgb(100, 116, 139));
        view.setTextSize(13f);
        view.setGravity(Gravity.CENTER);
        view.setPadding(0, dp(10), 0, 0);
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

    private TextView taskRow(String title, String subtitle, int backgroundColor) {
        TextView view = new TextView(this);
        view.setText(title + "\n" + subtitle);
        view.setTextColor(TEXT);
        view.setTextSize(16f);
        view.setBackgroundColor(backgroundColor);
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(10));
        view.setLayoutParams(params);
        return view;
    }

    private List<TsdSearchBoxTask> safeSearchBoxes() {
        return assemblyPlan == null || assemblyPlan.searchBoxes == null ? new ArrayList<>() : assemblyPlan.searchBoxes;
    }

    private List<TsdRelabelTask> safeRelabelTasks() {
        return assemblyPlan == null || assemblyPlan.relabelTasks == null ? new ArrayList<>() : assemblyPlan.relabelTasks;
    }

    private List<TsdMovementTask> safeMovementTasks() {
        return assemblyPlan == null || assemblyPlan.movementTasks == null ? new ArrayList<>() : assemblyPlan.movementTasks;
    }

    private boolean isSearchDone() {
        List<TsdSearchBoxTask> boxes = safeSearchBoxes();
        return foundBoxes().size() >= boxes.size();
    }

    private boolean isRelabelDone() {
        return doneRelabelTotal() >= relabelTotal();
    }

    private boolean isMovementDone() {
        return doneMovementTotal() >= movementTotal();
    }

    private Set<String> foundBoxes() {
        Set<String> normalized = new LinkedHashSet<>();
        for (String value : stringSet(progressKey("found_boxes"))) {
            String code = normalizeBoxCode(value);
            if (!code.isEmpty()) {
                normalized.add(code);
            }
        }
        return normalized;
    }

    private int relabelTotal() {
        int total = 0;
        for (TsdRelabelTask task : safeRelabelTasks()) {
            total += task.quantity;
        }
        return total;
    }

    private int doneRelabelTotal() {
        int total = 0;
        for (TsdRelabelTask task : safeRelabelTasks()) {
            total += Math.min(task.quantity, doneInt(relabelKey(task)));
        }
        return total;
    }

    private int remainingRelabel(TsdRelabelTask task) {
        return Math.max(0, task.quantity - doneInt(relabelKey(task)));
    }

    private String relabelKey(TsdRelabelTask task) {
        return progressKey("relabel:" + task.sourceBox + "|" + task.oldBarcode + "|" + task.newBarcode + "|" + task.size);
    }

    private int movementTotal() {
        int total = 0;
        for (TsdMovementTask task : safeMovementTasks()) {
            total += task.quantity;
        }
        return total;
    }

    private int doneMovementTotal() {
        int total = 0;
        for (TsdMovementTask task : safeMovementTasks()) {
            total += Math.min(task.quantity, doneInt(movementKey(task)));
        }
        return total;
    }

    private int remainingMovement(TsdMovementTask task) {
        return Math.max(0, task.quantity - doneInt(movementKey(task)));
    }

    private String movementKey(TsdMovementTask task) {
        return progressKey("move:" + task.sourceBox + "|" + task.targetBox + "|" + task.barcode + "|" + task.size);
    }

    private String progressKey(String suffix) {
        return assemblyPlan == null ? suffix : assemblyPlan.id + ":" + suffix;
    }

    private Set<String> stringSet(String key) {
        if (progressStore == null) {
            return new LinkedHashSet<>();
        }
        return new LinkedHashSet<>(progressStore.getStringSet(key, new LinkedHashSet<>()));
    }

    private void saveStringSet(String key, Set<String> value) {
        if (progressStore != null) {
            progressStore.edit().putStringSet(key, new LinkedHashSet<>(value)).apply();
        }
    }

    private int doneInt(String key) {
        return progressStore == null ? 0 : progressStore.getInt(key, 0);
    }

    private void saveDoneInt(String key, int value) {
        if (progressStore != null) {
            progressStore.edit().putInt(key, value).apply();
        }
    }

    private String emptyAsDash(String value) {
        return value == null || value.trim().isEmpty() ? "-" : value.trim();
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
        if (safeSession() == null && screen != Screen.SETTINGS) {
            renderSettingsScreen();
            return;
        }
        if (screen == Screen.SETTINGS) {
            renderSettingsScreen();
        } else if (screen == Screen.RECEIPT) {
            renderReceiptScreen();
        } else if (screen == Screen.ASSEMBLY_LIST) {
            renderAssemblyListScreen();
        } else if (screen == Screen.ASSEMBLY_DETAIL) {
            renderAssemblyDetailScreen();
        } else if (screen == Screen.BOX_SEARCH) {
            renderBoxSearchScreen();
        } else if (screen == Screen.RELABEL_LIST) {
            renderRelabelScreen();
        } else if (screen == Screen.RELABEL_BOX) {
            renderRelabelBoxScreen();
        } else if (screen == Screen.MOVEMENTS) {
            renderMovementScreen();
        } else if (screen == Screen.INFO) {
            renderMainScreen();
        } else {
            renderMainScreen();
        }
    }

    private String textValue(EditText input) {
        return input == null ? "" : input.getText().toString().trim();
    }

    private String normalizeBoxCode(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (Character.isLetterOrDigit(current)) {
                builder.append(Character.toString(current).toUpperCase(Locale.ROOT));
            }
        }
        return builder.toString();
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
        ASSEMBLY_LIST,
        ASSEMBLY_DETAIL,
        BOX_SEARCH,
        RELABEL_LIST,
        RELABEL_BOX,
        MOVEMENTS,
        INFO
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
