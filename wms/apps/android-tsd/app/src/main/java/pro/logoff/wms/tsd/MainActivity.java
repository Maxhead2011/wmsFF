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
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
import pro.logoff.wms.tsd.network.TsdSkuInfo;
import pro.logoff.wms.tsd.network.WmsApi;
import pro.logoff.wms.tsd.network.WmsApiFactory;
import pro.logoff.wms.tsd.sync.TsdSyncRunner;
import pro.logoff.wms.tsd.sync.TsdSyncSummary;
import retrofit2.Response;

public class MainActivity extends Activity {
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";
    private static final String APK_URL = "https://wms.logoff.pro/downloads/logoff-tsd.apk";
    private static final String APP_VERSION = "0.1.45";
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
    private final List<ReceiptItem> receiptCurrentItems = new ArrayList<>();
    private final Set<String> receiptSessionBoxes = new LinkedHashSet<>();
    private final Set<String> receiptKizValues = new LinkedHashSet<>();
    private String receiptClientId = "";
    private String receiptSourceDocument = "";
    private String receiptBoxCode = "";
    private String pendingReceiptBarcode = "";
    private TsdSkuInfo pendingReceiptSku;
    private boolean pendingReceiptRequiresKiz;
    private int receiptClosedBoxes;
    private int receiptAcceptedItems;
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
                submitReceiptInput();
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

        if (receiptClientId.isEmpty()) {
            root.addView(label("Клиент приемки"));
            clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
            clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            clientSpinner = new Spinner(this);
            clientSpinner.setAdapter(clientAdapter);
            refreshClientOptions();
            root.addView(clientSpinner);
            root.addView(primaryMenuButton("Выбрать клиента", view -> startReceiptForSelectedClient()));
            root.addView(secondaryButton("Обновить клиентов", view -> loadClients(true)));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            if (!statusMessage.isEmpty()) {
                root.addView(messageView(statusMessage));
            }
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        root.addView(messageView("Клиент: " + receiptClientName()));
        root.addView(messageView("Принято коробов: " + receiptClosedBoxes + " · товаров: " + receiptAcceptedItems));

        if (receiptBoxCode.isEmpty()) {
            boxCodeInput = input("Сканируйте ШК нового короба");
            boxCodeInput.setOnEditorActionListener((view, actionId, event) -> {
                openReceiptBoxFromInput();
                return true;
            });
            scanInput = boxCodeInput;
            root.addView(boxCodeInput);
            root.addView(primaryMenuButton("Открыть короб", view -> openReceiptBoxFromInput()));
            if (receiptClosedBoxes > 0) {
                root.addView(primaryMenuButton("Закрыть приемку", view -> finishReceipt()));
            }
            root.addView(secondaryButton("Сменить клиента", view -> resetReceiptSession()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            if (!statusMessage.isEmpty()) {
                root.addView(messageView(statusMessage));
            }
            setScrollableContent(root);
            boxCodeInput.requestFocus();
            refreshHeaderText();
            return;
        }

        root.addView(messageView("Открыт короб: " + receiptBoxCode + " · в коробе: " + receiptCurrentItems.size()));

        if (!pendingReceiptBarcode.isEmpty() && pendingReceiptRequiresKiz) {
            root.addView(messageView("Товар: " + receiptSkuDisplay(pendingReceiptSku, pendingReceiptBarcode)));
            scanInput = input("Сканируйте КИЗ");
            scanInput.setOnEditorActionListener((view, actionId, event) -> {
                handleReceiptKizScan();
                return true;
            });
            root.addView(scanInput);
            root.addView(primaryMenuButton("Принять КИЗ", view -> handleReceiptKizScan()));
            root.addView(secondaryButton("Отменить этот товар", view -> clearPendingReceiptProduct()));
        } else {
            scanInput = input("Сканируйте ШК товара");
            scanInput.setOnEditorActionListener((view, actionId, event) -> {
                handleReceiptBarcodeScan();
                return true;
            });
            root.addView(scanInput);
            root.addView(primaryMenuButton("Принять товар", view -> handleReceiptBarcodeScan()));
        }

        root.addView(secondaryButton("Закрыть короб", view -> closeReceiptBox()));
        root.addView(secondaryButton("Синхронизировать очередь (" + pendingCount + ")", view -> syncPending()));
        root.addView(secondaryButton("Назад", view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        setScrollableContent(root);
        if (scanInput != null) {
            scanInput.requestFocus();
        }
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
        if (isAssemblyPackedOnServer()) {
            renderAssemblyPackedDetailScreen();
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

    private void renderAssemblyPackedDetailScreen() {
        screen = Screen.ASSEMBLY_DETAIL;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("\u0417\u0430\u044f\u0432\u043a\u0430 " + assemblyPlan.title));
        root.addView(messageView("\u041a\u043b\u0438\u0435\u043d\u0442: " + (assemblyPlan.client == null ? "-" : assemblyPlan.client.name)));
        root.addView(messageView("\u0413\u043e\u0440\u043e\u0434: " + emptyAsDash(assemblyPlan.city)));
        root.addView(messageView("\u0421\u0442\u0430\u0442\u0443\u0441: " + assemblyPlan.status));
        root.addView(messageView("\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0430 \u0438 \u0436\u0434\u0435\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u043e\u043c."));
        root.addView(secondaryButton("\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443", view -> loadAssemblyPlan(assemblyPlan.id)));
        root.addView(secondaryButton("\u041a \u0441\u043f\u0438\u0441\u043a\u0443 \u0437\u0430\u044f\u0432\u043e\u043a", view -> renderAssemblyListScreen()));
        root.addView(secondaryButton("\u041d\u0430\u0437\u0430\u0434", view -> renderMainScreen()));
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
        if (areAssemblyStepsDone()) {
            completeAssemblyIfReady();
            return;
        }

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Поиск коробов"));
        List<TsdSearchBoxTask> boxes = safeSearchBoxes();
        Set<String> found = foundBoxes();
        root.addView(messageView("Найдено: " + foundSearchBoxesCount(boxes, found) + " / " + boxes.size()));
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
        if (areAssemblyStepsDone()) {
            completeAssemblyIfReady();
        } else {
            renderBoxSearchScreen();
        }
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
        if (areAssemblyStepsDone()) {
            completeAssemblyIfReady();
        } else {
            renderRelabelBoxScreen();
        }
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
        if (handleFlexibleMovementScan(code)) {
            return;
        }

        for (TsdMovementTask task : safeMovementTasks()) {
            if (remainingMovement(task) > 0 && code.equals(task.targetBox)) {
                selectedMoveTargetBox = code;
                rememberMovementTargetBox(code);
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

    private boolean handleFlexibleMovementScan(String code) {
        if (selectedMoveTargetBox.isEmpty()) {
            selectedMoveTargetBox = code;
            rememberMovementTargetBox(code);
            statusMessage = "\u041d\u043e\u0432\u044b\u0439 \u043a\u043e\u0440\u043e\u0431 \u0432\u044b\u0431\u0440\u0430\u043d: " + code;
            assemblyScanInput.setText("");
            renderMovementScreen();
            return true;
        }

        for (TsdMovementTask task : safeMovementTasks()) {
            if (remainingMovement(task) > 0 && code.equals(task.barcode)) {
                String targetBox = selectedMoveTargetBox;
                runBackground(() -> {
                    outbox.enqueueMove(
                        assemblyPlan.client.id,
                        task.barcode,
                        task.sourceBox,
                        targetBox,
                        1,
                        "AVAILABLE",
                        "\u041f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u043f\u043e \u0437\u0430\u044f\u0432\u043a\u0435 " + assemblyPlan.title
                    );
                    mainHandler.post(() -> {
                        int done = doneInt(movementKey(task)) + 1;
                        saveDoneInt(movementKey(task), done);
                        statusMessage = "\u0422\u043e\u0432\u0430\u0440 \u043f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c: " + done + " / " + task.quantity;
                        refreshQueue(null);
                        if (areAssemblyStepsDone()) {
                            completeAssemblyIfReady();
                        } else {
                            renderMovementScreen();
                        }
                    });
                });
                return true;
            }
        }

        statusMessage = "\u0422\u043e\u0432\u0430\u0440 \u043d\u0435 \u043d\u0443\u0436\u0435\u043d \u0434\u043b\u044f \u043f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u044f: " + code;
        assemblyScanInput.setText("");
        renderMovementScreen();
        return true;
    }

    private void completeAssemblyIfReady() {
        if (assemblyPlan == null || isAssemblyPackedOnServer() || !areAssemblyStepsDone()) {
            return;
        }

        String packedKey = progressKey("assembly_packed");
        if (doneInt(packedKey) > 0) {
            statusMessage = "\u0417\u0430\u044f\u0432\u043a\u0430 \u0443\u0436\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u0432 WMS \u043a\u0430\u043a \u0441\u043e\u0431\u0440\u0430\u043d\u043d\u0430\u044f.";
            renderAssemblyDetailScreen();
            return;
        }

        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u043d\u0430 \u0422\u0421\u0414.";
            renderSettingsScreen();
            return;
        }

        String requestId = assemblyPlan.id;
        int boxes = Math.max(1, safeSearchBoxes().size());
        int packedUnits = Math.max(1, assemblyPlan.totalRequested);
        statusMessage = "\u0412\u0441\u0435 \u044d\u0442\u0430\u043f\u044b \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u044b. \u0424\u0438\u043a\u0441\u0438\u0440\u0443\u044e \u0441\u0431\u043e\u0440\u043a\u0443 \u0432 WMS...";
        renderAssemblyDetailScreen();

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            OperationOutboxCounts counts = outbox.counts();
            if (counts.pending > 0) {
                TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                    .syncPending(session.authorizationHeader());
                if (summary.rejected > 0 || summary.retried > 0) {
                    throw new IOException("\u041d\u0435 \u0432\u0441\u0435 \u0434\u0432\u0438\u0436\u0435\u043d\u0438\u044f \u0422\u0421\u0414 \u043f\u0440\u0438\u043d\u044f\u0442\u044b WMS. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435.");
                }
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("requestId", requestId);
            payload.put("idempotencyKey", "tsd-pack:" + requestId);
            payload.put("comment", "\u0421\u0431\u043e\u0440\u043a\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430 \u043d\u0430 \u0422\u0421\u0414.");
            payload.put("boxes", boxes);
            payload.put("pallets", 0);
            payload.put("packedUnits", packedUnits);

            Response<Map<String, Object>> response = api
                .packageClientRequest(session.authorizationHeader(), payload)
                .execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }

            mainHandler.post(() -> {
                saveDoneInt(packedKey, 1);
                statusMessage = "\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0430 \u0438 \u043f\u0435\u0440\u0435\u0434\u0430\u043d\u0430 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0443 \u043d\u0430 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443.";
                refreshQueue(null);
                loadAssemblyPlan(requestId);
            });
        });
    }

    private void submitReceiptInput() {
        if (receiptClientId.isEmpty()) {
            startReceiptForSelectedClient();
            return;
        }
        if (receiptBoxCode.isEmpty()) {
            openReceiptBoxFromInput();
            return;
        }
        if (!pendingReceiptBarcode.isEmpty() && pendingReceiptRequiresKiz) {
            handleReceiptKizScan();
            return;
        }
        handleReceiptBarcodeScan();
    }

    private void startReceiptForSelectedClient() {
        String clientId = selectedClientId();
        if (clientId == null) {
            return;
        }
        receiptClientId = clientId;
        receiptSourceDocument = newReceiptSourceDocument();
        receiptClosedBoxes = 0;
        receiptAcceptedItems = 0;
        receiptSessionBoxes.clear();
        receiptKizValues.clear();
        statusMessage = "Клиент выбран. Сканируйте новый короб.";
        renderReceiptScreen();
    }

    private void openReceiptBoxFromInput() {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            renderSettingsScreen();
            return;
        }
        if (receiptClientId.isEmpty()) {
            statusMessage = "Выберите клиента приемки.";
            renderReceiptScreen();
            return;
        }

        String boxCode = textValue(boxCodeInput);
        if (boxCode.isEmpty()) {
            statusMessage = "Сканируйте ШК нового короба.";
            renderReceiptScreen();
            return;
        }

        String normalizedBox = normalizeBoxCode(boxCode);
        if (receiptSessionBoxes.contains(normalizedBox)) {
            statusMessage = "Этот короб уже использовался в текущей приемке.";
            renderReceiptScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("clientId", receiptClientId);
            payload.put("boxCode", boxCode);
            Response<Map<String, Object>> response = api.openReceiptBox(session.authorizationHeader(), payload).execute();
            if (!response.isSuccessful()) {
                throw new IOException("Короб не открыт: HTTP " + response.code());
            }
            mainHandler.post(() -> {
                online = true;
                receiptBoxCode = boxCode;
                receiptCurrentItems.clear();
                clearPendingReceiptProductFields();
                statusMessage = "Короб открыт. Сканируйте товар.";
                renderReceiptScreen();
            });
        });
    }

    private void handleReceiptBarcodeScan() {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            renderSettingsScreen();
            return;
        }
        String barcode = textValue(scanInput);
        if (barcode.isEmpty()) {
            statusMessage = "Сканируйте ШК товара.";
            renderReceiptScreen();
            return;
        }

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdSkuInfo> response = api.findSkuByBarcode(session.authorizationHeader(), receiptClientId, barcode).execute();
            if (response.isSuccessful() && response.body() != null) {
                TsdSkuInfo sku = response.body();
                mainHandler.post(() -> {
                    online = true;
                    if (sku.needsChestnyZnak && !sku.isUnmarked) {
                        pendingReceiptBarcode = barcode;
                        pendingReceiptSku = sku;
                        pendingReceiptRequiresKiz = true;
                        statusMessage = "Нужен КИЗ. Сканируйте КИЗ товара.";
                        renderReceiptScreen();
                    } else {
                        addReceiptItem(barcode, null, sku);
                    }
                });
                return;
            }
            if (response.code() == 404) {
                mainHandler.post(() -> {
                    online = true;
                    pendingReceiptBarcode = barcode;
                    pendingReceiptSku = null;
                    pendingReceiptRequiresKiz = true;
                    statusMessage = "Товар не найден. Будет создан черновик, сканируйте КИЗ.";
                    renderReceiptScreen();
                });
                return;
            }
            throw new IOException("Не удалось проверить товар: HTTP " + response.code());
        });
    }

    private void handleReceiptKizScan() {
        String kiz = textValue(scanInput);
        if (kiz.isEmpty()) {
            statusMessage = "Сканируйте КИЗ.";
            renderReceiptScreen();
            return;
        }
        String normalizedKiz = kiz.trim().toUpperCase(Locale.ROOT);
        if (receiptKizValues.contains(normalizedKiz)) {
            statusMessage = "Этот КИЗ уже есть в текущей приемке.";
            renderReceiptScreen();
            return;
        }
        addReceiptItem(pendingReceiptBarcode, kiz, pendingReceiptSku);
    }

    private void addReceiptItem(String barcode, String kiz, TsdSkuInfo sku) {
        receiptCurrentItems.add(new ReceiptItem(barcode, kiz, sku == null ? null : sku.name));
        if (kiz != null && !kiz.trim().isEmpty()) {
            receiptKizValues.add(kiz.trim().toUpperCase(Locale.ROOT));
        }
        clearPendingReceiptProductFields();
        statusMessage = "Товар добавлен в короб: " + barcode + ". В коробе: " + receiptCurrentItems.size();
        renderReceiptScreen();
    }

    private void clearPendingReceiptProduct() {
        clearPendingReceiptProductFields();
        statusMessage = "Скан товара отменен.";
        renderReceiptScreen();
    }

    private void clearPendingReceiptProductFields() {
        pendingReceiptBarcode = "";
        pendingReceiptSku = null;
        pendingReceiptRequiresKiz = false;
    }

    private void closeReceiptBox() {
        if (outbox == null) {
            statusMessage = "Локальная очередь недоступна.";
            refreshCurrentScreen();
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            renderSettingsScreen();
            return;
        }
        if (receiptBoxCode.isEmpty()) {
            statusMessage = "Сначала откройте короб.";
            renderReceiptScreen();
            return;
        }
        if (!pendingReceiptBarcode.isEmpty()) {
            statusMessage = "Сначала завершите скан товара и КИЗ или отмените этот товар.";
            renderReceiptScreen();
            return;
        }
        if (receiptCurrentItems.isEmpty()) {
            statusMessage = "В коробе нет товара. Сканируйте товар или смените короб.";
            renderReceiptScreen();
            return;
        }

        String closedBoxCode = receiptBoxCode;
        List<ReceiptItem> itemsToSend = new ArrayList<>(receiptCurrentItems);
        runBackground(() -> {
            for (ReceiptItem item : itemsToSend) {
                outbox.enqueueReceipt(
                    receiptClientId,
                    item.barcode,
                    item.kiz,
                    closedBoxCode,
                    1,
                    "AVAILABLE",
                    receiptSourceDocument,
                    "Приемка ТСД: короб " + closedBoxCode
                );
            }
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending(session.authorizationHeader());
            mainHandler.post(() -> {
                online = summary.retried == 0;
                receiptClosedBoxes += 1;
                receiptAcceptedItems += itemsToSend.size();
                receiptSessionBoxes.add(normalizeBoxCode(closedBoxCode));
                receiptBoxCode = "";
                receiptCurrentItems.clear();
                clearPendingReceiptProductFields();
                statusMessage = summary.rejected == 0 && summary.retried == 0
                    ? "Короб закрыт и записан в WMS: " + closedBoxCode
                    : "Короб закрыт, но часть сканов осталась в очереди. Синхронизируйте очередь.";
                refreshQueue(statusMessage);
            });
        });
    }

    private void finishReceipt() {
        if (!receiptBoxCode.isEmpty() && !receiptCurrentItems.isEmpty()) {
            statusMessage = "Сначала закройте текущий короб.";
            renderReceiptScreen();
            return;
        }
        String summary = "Приемка закрыта. Коробов: " + receiptClosedBoxes + ", товаров: " + receiptAcceptedItems + ".";
        resetReceiptState();
        statusMessage = summary;
        renderMainScreen();
    }

    private void resetReceiptSession() {
        resetReceiptState();
        statusMessage = "Выберите клиента приемки.";
        renderReceiptScreen();
    }

    private void resetReceiptState() {
        receiptClientId = "";
        receiptSourceDocument = "";
        receiptBoxCode = "";
        receiptClosedBoxes = 0;
        receiptAcceptedItems = 0;
        receiptCurrentItems.clear();
        receiptSessionBoxes.clear();
        receiptKizValues.clear();
        clearPendingReceiptProductFields();
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
                if (summary.rejected == 0 && summary.retried == 0 && areAssemblyStepsDone()) {
                    completeAssemblyIfReady();
                }
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
        int selectedIndex = 0;
        for (TsdClientSummary client : clients) {
            clientAdapter.add(client.name + " · " + client.code);
            if (!receiptClientId.isEmpty() && receiptClientId.equals(client.id)) {
                selectedIndex = clientAdapter.getCount() - 1;
            }
        }
        clientAdapter.notifyDataSetChanged();
        clientSpinner.setSelection(selectedIndex);
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
        List<TsdSearchBoxTask> boxes = assemblyPlan == null || assemblyPlan.searchBoxes == null ? new ArrayList<>() : assemblyPlan.searchBoxes;
        Set<String> movementTargets = movementTargetBoxes();
        if (boxes.isEmpty() || movementTargets.isEmpty()) {
            return boxes;
        }

        List<TsdSearchBoxTask> filtered = new ArrayList<>();
        for (TsdSearchBoxTask box : boxes) {
            if (!movementTargets.contains(normalizeBoxCode(box.boxCode))) {
                filtered.add(box);
            }
        }
        return filtered;
    }

    private List<TsdRelabelTask> safeRelabelTasks() {
        return assemblyPlan == null || assemblyPlan.relabelTasks == null ? new ArrayList<>() : assemblyPlan.relabelTasks;
    }

    private List<TsdMovementTask> safeMovementTasks() {
        return assemblyPlan == null || assemblyPlan.movementTasks == null ? new ArrayList<>() : assemblyPlan.movementTasks;
    }

    private boolean isSearchDone() {
        List<TsdSearchBoxTask> boxes = safeSearchBoxes();
        return foundSearchBoxesCount(boxes, foundBoxes()) >= boxes.size();
    }

    private boolean isRelabelDone() {
        return doneRelabelTotal() >= relabelTotal();
    }

    private boolean isMovementDone() {
        return doneMovementTotal() >= movementTotal();
    }

    private boolean isAssemblyPackedOnServer() {
        return assemblyPlan != null && ("PACKED".equals(assemblyPlan.status) || "DONE".equals(assemblyPlan.status));
    }

    private boolean areAssemblyStepsDone() {
        return assemblyPlan != null && isSearchDone() && isRelabelDone() && isMovementDone();
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

    private int foundSearchBoxesCount(List<TsdSearchBoxTask> boxes, Set<String> found) {
        int total = 0;
        for (TsdSearchBoxTask box : boxes) {
            if (found.contains(normalizeBoxCode(box.boxCode))) {
                total += 1;
            }
        }
        return total;
    }

    private Set<String> movementTargetBoxes() {
        Set<String> targets = new LinkedHashSet<>();
        for (TsdMovementTask task : safeMovementTasks()) {
            String targetBox = normalizeBoxCode(task.targetBox);
            if (!targetBox.isEmpty()) {
                targets.add(targetBox);
            }
        }
        for (String value : stringSet(progressKey("movement_target_boxes"))) {
            String targetBox = normalizeBoxCode(value);
            if (!targetBox.isEmpty()) {
                targets.add(targetBox);
            }
        }
        return targets;
    }

    private void rememberMovementTargetBox(String boxCode) {
        String targetBox = normalizeBoxCode(boxCode);
        if (targetBox.isEmpty()) {
            return;
        }
        Set<String> targets = stringSet(progressKey("movement_target_boxes"));
        targets.add(targetBox);
        saveStringSet(progressKey("movement_target_boxes"), targets);
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

    private String receiptClientName() {
        for (TsdClientSummary client : clients) {
            if (client.id.equals(receiptClientId)) {
                return client.name;
            }
        }
        return receiptClientId.isEmpty() ? "-" : receiptClientId;
    }

    private String receiptSkuDisplay(TsdSkuInfo sku, String barcode) {
        if (sku == null) {
            return "Новый товар без карточки\nШК " + barcode;
        }
        return sku.displayName(barcode);
    }

    private String newReceiptSourceDocument() {
        String device = safeSession() == null ? "TSD" : safeSession().deviceCode.replaceAll("[^A-Za-z0-9_-]", "_");
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
        return "TSD-RECEIPT-" + stamp + "-" + device;
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

    private static class ReceiptItem {
        final String barcode;
        final String kiz;
        final String name;

        ReceiptItem(String barcode, String kiz, String name) {
            this.barcode = barcode;
            this.kiz = kiz;
            this.name = name;
        }
    }
}
