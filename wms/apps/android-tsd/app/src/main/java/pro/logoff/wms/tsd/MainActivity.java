package pro.logoff.wms.tsd;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONObject;

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

import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.auth.TsdSessionStore;
import pro.logoff.wms.tsd.data.OperationOutbox;
import pro.logoff.wms.tsd.data.OperationOutboxCounts;
import pro.logoff.wms.tsd.data.PendingOperation;
import pro.logoff.wms.tsd.data.TsdDatabase;
import pro.logoff.wms.tsd.network.TsdClientSummary;
import pro.logoff.wms.tsd.network.TsdAssemblyProcess;
import pro.logoff.wms.tsd.network.TsdAssemblyPlan;
import pro.logoff.wms.tsd.network.TsdAssemblyRequestSummary;
import pro.logoff.wms.tsd.network.TsdBoxlessPackingResponse;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import pro.logoff.wms.tsd.network.TsdFbsCargoPackingResponse;
import pro.logoff.wms.tsd.network.TsdMovementTask;
import pro.logoff.wms.tsd.network.TsdOperationRequest;
import pro.logoff.wms.tsd.network.TsdRelabelTask;
import pro.logoff.wms.tsd.network.TsdSearchBoxTask;
import pro.logoff.wms.tsd.network.TsdLoginRequest;
import pro.logoff.wms.tsd.network.TsdLoginResponse;
import pro.logoff.wms.tsd.network.TsdKizCheckResponse;
import pro.logoff.wms.tsd.network.TsdInventoryBox;
import pro.logoff.wms.tsd.network.TsdInventoryDashboard;
import pro.logoff.wms.tsd.network.TsdInventoryLine;
import pro.logoff.wms.tsd.network.TsdInventorySession;
import pro.logoff.wms.tsd.network.TsdSkuInfo;
import pro.logoff.wms.tsd.network.WmsApi;
import pro.logoff.wms.tsd.network.WmsApiFactory;
import pro.logoff.wms.tsd.sync.TsdSyncRunner;
import pro.logoff.wms.tsd.sync.TsdSyncSummary;
import retrofit2.Response;

public class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 4201;
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";
    private static final String APK_URL = "https://wms.logoff.pro/downloads/logoff-tsd.apk?v=0.1.74";
    private static final String APP_VERSION = "0.1.74";
    private static final int RED = Color.rgb(215, 25, 32);
    private static final int BOX_FOUND_GREEN = Color.rgb(187, 247, 208);
    private static final int BOX_DUPLICATE_BLUE = Color.rgb(191, 219, 254);
    private static final int BOX_NOT_NEEDED_RED = Color.rgb(254, 202, 202);
    private static final int BOX_RELABEL_PURPLE = Color.rgb(221, 214, 254);
    private static final int BOX_MOVEMENT_BLUE = Color.rgb(147, 197, 253);
    private static final int BOX_RELABEL_MOVEMENT_CYAN = Color.rgb(165, 243, 252);
    private static final int LIGHT_GRAY = Color.rgb(226, 232, 240);
    private static final int TEXT = Color.rgb(30, 41, 59);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<TsdClientSummary> clients = new ArrayList<>();
    private final List<TsdAssemblyRequestSummary> assemblyRequests = new ArrayList<>();

    private OperationOutbox outbox;
    private TsdSessionStore sessionStore;
    private SharedPreferences progressStore;
    private SharedPreferences uiStore;
    private TextView statusView;
    private TextView sessionNameView;
    private TextView sessionCodeView;
    private TextView queueView;
    private EditText baseUrlInput;
    private EditText deviceCodeInput;
    private EditText deviceSecretInput;
    private Spinner clientSpinner;
    private Spinner languageSpinner;
    private ArrayAdapter<String> clientAdapter;
    private EditText boxCodeInput;
    private EditText quantityInput;
    private EditText stockStatusInput;
    private EditText sourceDocumentInput;
    private EditText commentInput;
    private EditText scanInput;
    private EditText assemblyScanInput;
    private EditText inventoryBoxInput;
    private EditText inventoryItemInput;
    private EditText inventoryQuantityInput;
    private EditText inventoryTransferTargetInput;
    private EditText fbsScanInput;
    private EditText fbsCargoScanInput;
    private TsdAssemblyPlan assemblyPlan;
    private TsdBoxlessPackingResponse boxlessPacking;
    private TsdRelabelTask activeRelabelTask;
    private TsdInventorySession activeInventory;
    private TsdInventoryBox activeInventoryBox;
    private TsdInventoryDashboard inventoryDashboard;
    private TsdFbsAssemblyResponse fbsAssembly;
    private TsdFbsCargoPackingResponse fbsCargoPacking;
    private String selectedFbsCargoPlanId = "";
    private String inventoryType = "";
    private String inventoryClientId = "";
    private String transferredInventoryBoxId = "";
    private boolean inventoryTransferMode;
    private String uiLanguage = "ru";
    private boolean phoneMode;
    private EditText phoneCameraTarget;
    private Dialog phoneScannerDialog;
    private DecoratedBarcodeView phoneBarcodeView;
    private final List<ReceiptItem> receiptCurrentItems = new ArrayList<>();
    private final Set<String> receiptSessionBoxes = new LinkedHashSet<>();
    private final Set<String> receiptKizValues = new LinkedHashSet<>();
    private final Map<String, String> receiptKizBoxes = new LinkedHashMap<>();
    private String receiptClientId = "";
    private String receiptSourceDocument = "";
    private String receiptBoxCode = "";
    private String pendingReceiptBarcode = "";
    private TsdSkuInfo pendingReceiptSku;
    private boolean pendingReceiptRequiresKiz;
    private boolean receiptCheckingKiz;
    private int receiptClosedBoxes;
    private int receiptAcceptedItems;
    private String selectedRelabelBox = "";
    private String selectedMoveSourceBox = "";
    private String selectedMoveTargetBox = "";
    private int pendingCount;
    private int rejectedCount;
    private boolean online;
    private String statusMessage = "";
    private Runnable receiptBoxAutoOpenTask;
    private boolean receiptOpeningBox;
    private boolean fbsBusy;
    private boolean fbsCargoBusy;
    private int fbsFeedbackColor;
    private int fbsCargoFeedbackColor;
    private String lastAssemblyTouchKey = "";
    private long lastAssemblyTouchAt = 0L;
    private int boxSearchFeedbackColor = 0;
    private int movementFeedbackColor = 0;
    private int receiptFeedbackColor = 0;
    private Screen screen = Screen.MAIN;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(RED);
        try {
            outbox = new OperationOutbox(TsdDatabase.get(this).operationDao());
            sessionStore = new TsdSessionStore(this);
            progressStore = getSharedPreferences("tsd_assembly_progress", MODE_PRIVATE);
            uiStore = getSharedPreferences("tsd_ui_preferences", MODE_PRIVATE);
            uiLanguage = uiStore.getString("language", "ru");
            phoneMode = uiStore.getBoolean("phone_mode", false);
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
            if (screen == Screen.OUTGOING_CONTROL && assemblyScanInput != null) {
                submitOutgoingBoxScan();
                return true;
            }
            if (screen == Screen.FBS_ASSEMBLY && fbsScanInput != null) {
                submitFbsScan();
                return true;
            }
            if (screen == Screen.FBS_CARGO && fbsCargoScanInput != null) {
                submitFbsCargoScan();
                return true;
            }
            if (screen == Screen.INVENTORY_COUNT) {
                if (activeInventoryBox == null && inventoryBoxInput != null) {
                    openInventoryBox();
                } else if (inventoryItemInput != null) {
                    scanInventoryItem();
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            openPhoneCameraDialog();
            return;
        }
        statusMessage = tr(
            "Доступ к камере запрещён. Разрешите камеру в настройках приложения.",
            "Kameraga kirish taqiqlangan. Ilova sozlamalarida kameraga ruxsat bering."
        );
        refreshCurrentScreen();
    }

    @Override
    protected void onPause() {
        if (phoneBarcodeView != null) {
            phoneBarcodeView.pause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (
            phoneBarcodeView != null &&
            phoneScannerDialog != null &&
            phoneScannerDialog.isShowing() &&
            checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) {
            phoneBarcodeView.resume();
        }
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
        root.addView(primaryMenuButton(tr("Приемка товара", "Tovarni qabul qilish"), view -> openReceipt()));
        root.addView(primaryMenuButton(tr("Сборка заявки", "Buyurtmani yig‘ish"), view -> openAssemblyRequests()));
        root.addView(primaryMenuButton(tr("Сборка FBS", "FBS buyurtmasini yig‘ish"), view -> openFbsAssembly()));
        root.addView(primaryMenuButton(
            tr("Упаковка грузомест FBS", "FBS yuk joylarini qadoqlash"),
            view -> openFbsCargoPacking()
        ));
        root.addView(primaryMenuButton(tr("Инвентаризация", "Inventarizatsiya"), view -> renderInventoryMenu()));
        root.addView(primaryMenuButton(
            phoneMode
                ? tr("Телефон: камера включена", "Telefon: kamera yoqilgan")
                : tr("Телефон", "Telefon"),
            view -> togglePhoneMode()
        ));
        root.addView(secondaryButton(tr("Синхронизировать очередь", "Navbatni sinxronlash") + " (" + pendingCount + ")", view -> syncPending()));
        root.addView(secondaryButton(tr("Обновить клиентов", "Mijozlarni yangilash"), view -> loadClients(true)));
        root.addView(secondaryButton(tr("Настройки / вход", "Sozlamalar / kirish"), view -> renderSettingsScreen()));
        root.addView(secondaryButton(tr("Проверить обновление", "Yangilanishni tekshirish"), view -> openApkDownload()));
        root.addView(secondaryButton(tr("Сбросить вход", "Kirishni bekor qilish"), view -> clearSession()));
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
        root.addView(title(tr("Настройки / вход", "Sozlamalar / kirish")));

        root.addView(label(tr("Язык интерфейса", "Interfeys tili")));
        languageSpinner = new Spinner(this);
        ArrayAdapter<String> languageAdapter = new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_item,
            new String[]{"Русский", "O‘zbekcha"}
        );
        languageAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        languageSpinner.setAdapter(languageAdapter);
        languageSpinner.setSelection("uz".equals(uiLanguage) ? 1 : 0);
        root.addView(languageSpinner);
        root.addView(secondaryButton(tr("Сохранить язык", "Tilni saqlash"), view -> saveLanguage()));

        baseUrlInput = input(tr("Адрес WMS", "WMS manzili"));
        baseUrlInput.setText(DEFAULT_BASE_URL);
        deviceCodeInput = input(tr("Логин сотрудника", "Xodim logini"));
        deviceSecretInput = input(tr("Пароль", "Parol"));
        deviceSecretInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        root.addView(baseUrlInput);
        root.addView(deviceCodeInput);
        root.addView(deviceSecretInput);
        root.addView(primaryMenuButton(tr("Войти на ТСД", "TSD tizimiga kirish"), view -> loginDevice()));
        root.addView(secondaryButton(tr("Скачать приложение ТСД", "TSD ilovasini yuklab olish"), view -> openApkDownload()));
        if (session != null) {
            root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderMainScreen()));
        }

        if (session != null) {
            root.addView(messageView(tr("Сейчас", "Hozir") + ": " + session.deviceName + " / " + session.deviceCode));
        }
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void saveLanguage() {
        uiLanguage = languageSpinner != null && languageSpinner.getSelectedItemPosition() == 1 ? "uz" : "ru";
        uiStore.edit().putString("language", uiLanguage).apply();
        statusMessage = tr("Язык сохранён.", "Til saqlandi.");
        renderSettingsScreen();
    }

    private String tr(String russian, String uzbek) {
        return "uz".equals(uiLanguage) ? uzbek : russian;
    }

    private void renderInventoryMenu() {
        screen = Screen.INVENTORY_MENU;
        activeInventory = null;
        activeInventoryBox = null;
        inventoryDashboard = null;
        inventoryType = "";
        inventoryClientId = "";
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Инвентаризация", "Inventarizatsiya")));
        root.addView(messageView(tr(
            "Выберите режим. Актуализация расхождений выполняется менеджером в веб-версии WMS.",
            "Rejimni tanlang. Tafovutlarni tuzatish menejer tomonidan WMS veb-versiyasida bajariladi."
        )));
        root.addView(primaryMenuButton(
            tr("1. Полная инвентаризация", "1. To‘liq inventarizatsiya"),
            view -> openInventoryMode("FULL")
        ));
        root.addView(primaryMenuButton(
            tr("2. Частичная инвентаризация", "2. Qisman inventarizatsiya"),
            view -> openInventoryMode("PARTIAL")
        ));
        root.addView(primaryMenuButton(
            tr("3. Проверка содержимого короба", "3. Quti tarkibini tekshirish"),
            view -> openInventoryMode("BOX_CHECK")
        ));
        root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void openInventoryMode(String type) {
        inventoryType = type;
        activeInventory = null;
        activeInventoryBox = null;
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        statusMessage = tr("Загружаю активные инвентаризации…", "Faol inventarizatsiyalar yuklanmoqda…");
        screen = Screen.INVENTORY_START;
        renderInventoryStartScreen();
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryDashboard> response = api.inventoryDashboard(session.authorizationHeader()).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("HTTP " + response.code());
            }
            TsdInventoryDashboard loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                inventoryDashboard = loaded;
                statusMessage = "";
                renderInventoryStartScreen();
            });
        });
    }

    private void renderInventoryStartScreen() {
        screen = Screen.INVENTORY_START;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(inventoryTypeTitle()));

        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        List<TsdInventorySession> active = activeInventorySessions();
        if (!active.isEmpty()) {
            root.addView(label(tr("Продолжить активную проверку", "Faol tekshiruvni davom ettirish")));
            for (TsdInventorySession item : active) {
                String progress = item.progress == null
                    ? ""
                    : "\n" + tr("Проверено коробов", "Tekshirilgan qutilar") + ": " + item.progress.checkedBoxes;
                root.addView(multilineSecondaryButton(
                    safeText(item.title) + progress,
                    view -> loadInventorySession(item.id)
                ));
            }
        }

        if ("FULL".equals(inventoryType)) {
            if (active.isEmpty()) {
                root.addView(messageView(tr(
                    "После запуска все движения товара будут заблокированы до завершения инвентаризации в вебе.",
                    "Ishga tushirilgandan so‘ng vebda inventarizatsiya yakunlangunga qadar barcha tovar harakatlari bloklanadi."
                )));
                root.addView(primaryMenuButton(
                    tr("Начать полную инвентаризацию", "To‘liq inventarizatsiyani boshlash"),
                    view -> startInventory()
                ));
            }
        } else {
            root.addView(label(tr("Клиент", "Mijoz")));
            clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
            clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            clientSpinner = new Spinner(this);
            clientSpinner.setAdapter(clientAdapter);
            root.addView(clientSpinner);
            refreshInventoryClientOptions();
            root.addView(primaryMenuButton(
                "PARTIAL".equals(inventoryType)
                    ? tr("Начать частичную инвентаризацию", "Qisman inventarizatsiyani boshlash")
                    : tr("Начать проверку коробов", "Qutilarni tekshirishni boshlash"),
                view -> startInventory()
            ));
        }
        root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderInventoryMenu()));
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void refreshInventoryClientOptions() {
        if (clientAdapter == null || clientSpinner == null) {
            return;
        }
        clientAdapter.clear();
        clientAdapter.add(tr("Выберите клиента", "Mijozni tanlang"));
        for (TsdClientSummary client : clients) {
            clientAdapter.add(client.name + " · " + client.code);
        }
        clientAdapter.notifyDataSetChanged();
    }

    private List<TsdInventorySession> activeInventorySessions() {
        List<TsdInventorySession> result = new ArrayList<>();
        if (inventoryDashboard == null || inventoryDashboard.activeSessions == null) {
            return result;
        }
        Set<String> ids = new LinkedHashSet<>();
        for (TsdInventorySession item : inventoryDashboard.activeSessions) {
            if (item != null && inventoryType.equals(item.type) && ids.add(item.id)) {
                result.add(item);
            }
        }
        return result;
    }

    private void startInventory() {
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = tr("Сначала войдите на ТСД.", "Avval TSD tizimiga kiring.");
            renderSettingsScreen();
            return;
        }
        if (!"FULL".equals(inventoryType)) {
            int selected = clientSpinner == null ? 0 : clientSpinner.getSelectedItemPosition();
            if (selected <= 0 || selected > clients.size()) {
                statusMessage = tr("Выберите клиента.", "Mijozni tanlang.");
                renderInventoryStartScreen();
                return;
            }
            inventoryClientId = clients.get(selected - 1).id;
        }
        statusMessage = tr("Запускаю инвентаризацию…", "Inventarizatsiya boshlanmoqda…");
        renderInventoryStartScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("type", inventoryType);
            if (!"FULL".equals(inventoryType)) {
                request.put("clientId", inventoryClientId);
            }
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventorySession> response = api.startInventory(session.authorizationHeader(), request).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventorySession created = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventory = created;
                activeInventoryBox = null;
                statusMessage = "";
                renderInventoryCountScreen();
            });
        });
    }

    private void loadInventorySession(String id) {
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }
        statusMessage = tr("Открываю инвентаризацию…", "Inventarizatsiya ochilmoqda…");
        renderInventoryStartScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventorySession> response = api.getInventory(session.authorizationHeader(), id).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventorySession loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventory = loaded;
                activeInventoryBox = null;
                statusMessage = "";
                renderInventoryCountScreen();
            });
        });
    }

    private void renderInventoryCountScreen() {
        screen = Screen.INVENTORY_COUNT;
        inventoryBoxInput = null;
        inventoryItemInput = null;
        inventoryTransferTargetInput = null;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(inventoryTypeTitle()));
        if (activeInventory == null) {
            root.addView(messageView(tr("Инвентаризация не открыта.", "Inventarizatsiya ochilmagan.")));
            root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> openInventoryMode(inventoryType)));
            setScrollableContent(root);
            return;
        }

        root.addView(messageView(safeText(activeInventory.title)));
        if (activeInventory.progress != null) {
            String total = activeInventory.progress.totalBoxes == null ? "" : " / " + activeInventory.progress.totalBoxes;
            root.addView(messageView(
                tr("Проверено коробов", "Tekshirilgan qutilar") + ": " +
                    activeInventory.progress.checkedBoxes + total + " · " +
                    tr("Расхождений", "Tafovutlar") + ": " + activeInventory.progress.mismatchBoxes
            ));
        }
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        if (activeInventoryBox == null) {
            inventoryBoxInput = input(tr("Номер короба", "Quti raqami"));
            root.addView(inventoryBoxInput);
            root.addView(primaryMenuButton(
                tr("Открыть короб", "Qutini ochish"),
                view -> openInventoryBox()
            ));
            inventoryBoxInput.requestFocus();
        } else {
            root.addView(label(
                tr("Короб", "Quti") + " " + safeText(activeInventoryBox.boxCode) +
                    " · " + safeText(activeInventoryBox.clientName)
            ));
            addInventoryLines(root, activeInventoryBox);
            if ("COUNTING".equals(activeInventoryBox.status)) {
                inventoryItemInput = input(tr("Штрихкод товара", "Tovar shtrix-kodi"));
                inventoryQuantityInput = input(tr("Количество (по умолчанию 1)", "Miqdor (odatda 1)"));
                inventoryQuantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
                inventoryQuantityInput.setText("1");
                root.addView(inventoryItemInput);
                root.addView(inventoryQuantityInput);
                root.addView(primaryMenuButton(
                    tr("Учесть товар", "Tovarni hisobga olish"),
                    view -> scanInventoryItem()
                ));
                root.addView(secondaryButton(
                    tr("Завершить подсчёт короба", "Quti sanog‘ini yakunlash"),
                    view -> finishInventoryBox()
                ));
                inventoryItemInput.requestFocus();
            } else {
                addInventoryResult(root, activeInventoryBox);
                addInventoryTransferAction(root, activeInventoryBox);
                root.addView(primaryMenuButton(
                    tr("Проверить следующий короб", "Keyingi qutini tekshirish"),
                    view -> {
                        activeInventoryBox = null;
                        transferredInventoryBoxId = "";
                        inventoryTransferMode = false;
                        statusMessage = "";
                        reloadInventorySession(false);
                    }
                ));
            }
        }

        root.addView(secondaryButton(
            "BOX_CHECK".equals(inventoryType)
                ? tr("Завершить проверку", "Tekshiruvni yakunlash")
                : tr("Передать на актуализацию", "Tuzatish uchun yuborish"),
            view -> finishInventorySession()
        ));
        root.addView(secondaryButton(tr("Назад к режимам", "Rejimlarga qaytish"), view -> renderInventoryMenu()));
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void addInventoryLines(LinearLayout root, TsdInventoryBox box) {
        root.addView(label(tr("Содержимое короба", "Quti tarkibi")));
        if (box.lines == null || box.lines.isEmpty()) {
            root.addView(messageView(tr(
                "По данным WMS короб пуст. Отсканированный товар будет показан как излишек.",
                "WMS bo‘yicha quti bo‘sh. Skanerlangan tovar ortiqcha sifatida ko‘rsatiladi."
            )));
            return;
        }
        for (TsdInventoryLine line : box.lines) {
            int difference = line.countedQuantity - line.expectedQuantity;
            String subtitle =
                tr("Артикул", "Artikul") + ": " + safeText(line.internalSku) + "\n" +
                tr("ШК", "ShK") + ": " + safeText(line.barcode) + "\n" +
                "WMS: " + line.expectedQuantity + " · " +
                tr("Факт", "Amalda") + ": " + line.countedQuantity + " · " +
                tr("Разница", "Farq") + ": " + (difference > 0 ? "+" : "") + difference;
            int color = difference == 0 ? Color.rgb(240, 253, 244) : Color.rgb(255, 237, 213);
            root.addView(taskRow(safeText(line.skuName), subtitle, color));
        }
    }

    private void addInventoryResult(LinearLayout root, TsdInventoryBox box) {
        int mismatches = 0;
        if (box.lines != null) {
            for (TsdInventoryLine line : box.lines) {
                if (line.countedQuantity != line.expectedQuantity) {
                    mismatches++;
                }
            }
        }
        if (mismatches == 0) {
            root.addView(feedbackView(
                tr("Всё в порядке. Содержимое полностью совпадает с WMS.", "Hammasi to‘g‘ri. Tarkib WMS bilan to‘liq mos."),
                BOX_FOUND_GREEN
            ));
        } else {
            root.addView(feedbackView(
                tr("Содержимое отличается. Расхождений", "Tarkib farq qiladi. Tafovutlar") + ": " + mismatches +
                    ". " + tr("Точные значения показаны выше.", "Aniq qiymatlar yuqorida ko‘rsatilgan."),
                Color.rgb(254, 215, 170)
            ));
        }
    }

    private void openInventoryBox() {
        TsdSession session = safeSession();
        if (session == null || activeInventory == null) {
            return;
        }
        String boxCode = textValue(inventoryBoxInput);
        if (boxCode.isEmpty()) {
            statusMessage = tr("Пропикайте номер короба.", "Quti raqamini skanerlang.");
            renderInventoryCountScreen();
            return;
        }
        statusMessage = tr("Открываю короб…", "Quti ochilmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("boxCode", boxCode);
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryBox> response = api.openInventoryBox(
                session.authorizationHeader(),
                activeInventory.id,
                request
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                if (response.code() == 404) {
                    throw new IOException(tr(
                        "Короб " + boxCode + " в системе не найден.",
                        boxCode + " qutisi tizimda topilmadi."
                    ));
                }
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventoryBox loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventoryBox = loaded;
                transferredInventoryBoxId = "";
                inventoryTransferMode = false;
                statusMessage = "";
                renderInventoryCountScreen();
            });
        });
    }

    private void scanInventoryItem() {
        TsdSession session = safeSession();
        if (session == null || activeInventoryBox == null) {
            return;
        }
        String barcode = textValue(inventoryItemInput);
        if (barcode.isEmpty()) {
            statusMessage = tr("Пропикайте штрихкод товара.", "Tovar shtrix-kodini skanerlang.");
            renderInventoryCountScreen();
            return;
        }
        String barcodeError = receiptBarcodeError(barcode);
        if (!barcodeError.isEmpty()) {
            statusMessage = tr(
                "При инвентаризации можно сканировать только ШК товара. " + barcodeError,
                "Inventarizatsiyada faqat tovar shtrix-kodini skanerlash mumkin."
            );
            inventoryItemInput.setText("");
            renderInventoryCountScreen();
            return;
        }
        int quantity = 1;
        try {
            quantity = Math.max(1, Integer.parseInt(textValue(inventoryQuantityInput)));
        } catch (NumberFormatException ignored) {
        }
        int finalQuantity = quantity;
        statusMessage = tr("Учитываю товар…", "Tovar hisobga olinmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("barcode", barcode);
            request.put("quantity", finalQuantity);
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryLine> response = api.scanInventoryItem(
                session.authorizationHeader(),
                activeInventoryBox.id,
                request
            ).execute();
            if (!response.isSuccessful()) {
                throw new IOException(inventoryHttpError(response));
            }
            mainHandler.post(() -> {
                online = true;
                statusMessage = tr("Товар учтён: ", "Tovar hisobga olindi: ") + barcode;
                reloadInventorySession(true);
            });
        });
    }

    private void finishInventoryBox() {
        TsdSession session = safeSession();
        if (session == null || activeInventoryBox == null) {
            return;
        }
        String boxId = activeInventoryBox.id;
        statusMessage = tr("Сверяю короб…", "Quti solishtirilmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryBox> response = api.finishInventoryBox(
                session.authorizationHeader(),
                boxId
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventoryBox finished = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventoryBox = finished;
                inventoryTransferMode = false;
                statusMessage = "";
                renderInventoryCountScreen();
            });
        });
    }

    private void addInventoryTransferAction(LinearLayout root, TsdInventoryBox box) {
        if ("FULL".equals(inventoryType)) {
            return;
        }
        if (!"MATCHED".equals(box.status) && !"RESOLVED".equals(box.status)) {
            root.addView(messageView(tr(
                "Перемещение доступно после устранения расхождений.",
                "Ko‘chirish tafovutlar bartaraf etilgandan keyin mavjud."
            )));
            return;
        }
        if (safeText(box.id).equals(transferredInventoryBoxId)) {
            root.addView(feedbackView(
                tr("Остаток перемещён. Исходный короб отправлен в архив.", "Qoldiq ko‘chirildi. Manba quti arxivga yuborildi."),
                BOX_FOUND_GREEN
            ));
            return;
        }
        if (!inventoryTransferMode) {
            root.addView(primaryMenuButton(
                tr("Переместить эти товары в другой короб", "Bu tovarlarni boshqa qutiga ko‘chirish"),
                view -> {
                    inventoryTransferMode = true;
                    statusMessage = "";
                    renderInventoryCountScreen();
                }
            ));
            return;
        }

        inventoryTransferTargetInput = input(tr(
            "Пропикайте целевой короб (новый или существующий)",
            "Maqsad qutini skanerlang (yangi yoki mavjud)"
        ));
        inventoryTransferTargetInput.setOnEditorActionListener((view, actionId, event) -> {
            transferInventoryBox();
            return true;
        });
        root.addView(inventoryTransferTargetInput);
        root.addView(primaryMenuButton(
            tr("Переместить весь остаток", "Barcha qoldiqni ko‘chirish"),
            view -> transferInventoryBox()
        ));
        root.addView(secondaryButton(
            tr("Отмена", "Bekor qilish"),
            view -> {
                inventoryTransferMode = false;
                statusMessage = "";
                renderInventoryCountScreen();
            }
        ));
        inventoryTransferTargetInput.requestFocus();
    }

    private void transferInventoryBox() {
        TsdSession session = safeSession();
        if (session == null || activeInventoryBox == null || inventoryTransferTargetInput == null) {
            return;
        }
        String targetBoxCode = textValue(inventoryTransferTargetInput);
        if (!isFflBoxCode(targetBoxCode)) {
            statusMessage = tr(
                "Ошибка: номер целевого короба должен начинаться с FFL.",
                "Xato: maqsad quti raqami FFL bilan boshlanishi kerak."
            );
            renderInventoryCountScreen();
            return;
        }
        if (sameBox(activeInventoryBox.boxCode, targetBoxCode)) {
            statusMessage = tr("Исходный и целевой короба совпадают.", "Manba va maqsad qutilar bir xil.");
            renderInventoryCountScreen();
            return;
        }

        String auditBoxId = activeInventoryBox.id;
        String sourceBoxCode = activeInventoryBox.boxCode;
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("clientId", activeInventoryBox.clientId);
        request.put("fromBoxCode", sourceBoxCode);
        request.put("toBoxCode", targetBoxCode);
        request.put("idempotencyKey", "tsd-inventory-consolidation:" + auditBoxId + ":" + normalizeBoxCode(targetBoxCode));
        request.put("comment", "Объединение остатков после проверки короба " + sourceBoxCode);

        statusMessage = tr("Перемещаю остаток…", "Qoldiq ko‘chirilmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<Map<String, Object>> response = api.transferWholeBox(
                session.authorizationHeader(),
                request
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            Map<String, Object> result = response.body();
            mainHandler.post(() -> {
                online = true;
                inventoryTransferMode = false;
                transferredInventoryBoxId = auditBoxId;
                Object quantityValue = result.get("quantity");
                int quantity = quantityValue instanceof Number ? ((Number) quantityValue).intValue() : 0;
                boolean archived = Boolean.TRUE.equals(result.get("sourceArchived"));
                statusMessage = tr(
                    "Перемещено " + quantity + " шт. в короб " + targetBoxCode +
                        (archived ? ". Исходный короб отправлен в архив." : "."),
                    quantity + " dona " + targetBoxCode + " qutiga ko‘chirildi" +
                        (archived ? ". Manba quti arxivga yuborildi." : ".")
                );
                renderInventoryCountScreen();
            });
        });
    }

    private void reloadInventorySession(boolean keepBox) {
        TsdSession session = safeSession();
        if (session == null || activeInventory == null) {
            return;
        }
        String sessionId = activeInventory.id;
        String boxId = keepBox && activeInventoryBox != null ? activeInventoryBox.id : "";
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventorySession> response = api.getInventory(session.authorizationHeader(), sessionId).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventorySession loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventory = loaded;
                activeInventoryBox = boxId.isEmpty() ? null : findInventoryBox(loaded, boxId);
                renderInventoryCountScreen();
            });
        });
    }

    private TsdInventoryBox findInventoryBox(TsdInventorySession session, String id) {
        if (session.boxes != null) {
            for (TsdInventoryBox box : session.boxes) {
                if (box != null && id.equals(box.id)) {
                    return box;
                }
            }
        }
        return null;
    }

    private void finishInventorySession() {
        TsdSession session = safeSession();
        if (session == null || activeInventory == null) {
            return;
        }
        if (activeInventoryBox != null && "COUNTING".equals(activeInventoryBox.status)) {
            statusMessage = tr("Сначала завершите подсчёт открытого короба.", "Avval ochiq quti sanog‘ini yakunlang.");
            renderInventoryCountScreen();
            return;
        }
        statusMessage = tr("Завершаю инвентаризацию…", "Inventarizatsiya yakunlanmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventorySession> response = api.finishInventory(
                session.authorizationHeader(),
                activeInventory.id
            ).execute();
            if (!response.isSuccessful()) {
                throw new IOException(inventoryHttpError(response));
            }
            mainHandler.post(() -> {
                online = true;
                statusMessage = "BOX_CHECK".equals(inventoryType)
                    ? tr("Проверка завершена.", "Tekshiruv yakunlandi.")
                    : tr("Инвентаризация передана менеджеру на актуализацию.", "Inventarizatsiya tuzatish uchun menejerga yuborildi.");
                renderInventoryMenu();
            });
        });
    }

    private String inventoryTypeTitle() {
        if ("FULL".equals(inventoryType)) {
            return tr("Полная инвентаризация", "To‘liq inventarizatsiya");
        }
        if ("PARTIAL".equals(inventoryType)) {
            return tr("Частичная инвентаризация", "Qisman inventarizatsiya");
        }
        return tr("Проверка содержимого короба", "Quti tarkibini tekshirish");
    }

    private String inventoryHttpError(Response<?> response) {
        try {
            if (response.errorBody() != null) {
                String body = response.errorBody().string();
                if (!body.trim().isEmpty()) {
                    JSONObject payload = new JSONObject(body);
                    Object message = payload.opt("message");
                    if (message instanceof String && !((String) message).trim().isEmpty()) {
                        return ((String) message).trim();
                    }
                    if (message != null) {
                        String normalized = String.valueOf(message)
                            .replace("[\"", "")
                            .replace("\"]", "")
                            .replace("\",\"", ". ")
                            .trim();
                        if (!normalized.isEmpty()) {
                            return normalized;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return tr(
            "Не удалось выполнить операцию в WMS. Повторите попытку.",
            "WMS amalini bajarib bo‘lmadi. Qayta urinib ko‘ring."
        );
    }

    private String safeText(String value) {
        return value == null || value.trim().isEmpty() ? "—" : value.trim();
    }

    private void renderReceiptScreen() {
        screen = Screen.RECEIPT;
        scanInput = null;
        LinearLayout root = baseRoot();
        applyScreenFeedback(root, receiptFeedbackColor);
        root.addView(header());
        root.addView(title("Приемка товара"));
        if (!statusMessage.isEmpty()) {
            root.addView(receiptFeedbackColor == 0 ? messageView(statusMessage) : feedbackView(statusMessage, receiptFeedbackColor));
        }

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
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        root.addView(messageView("Клиент: " + receiptClientName()));
        root.addView(messageView(receiptWithoutBoxes()
            ? "Режим: без коробов · принято товаров: " + receiptAcceptedItems
            : "Принято коробов: " + receiptClosedBoxes + " · товаров: " + receiptAcceptedItems));

        if (receiptWithoutBoxes()) {
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
            if (receiptAcceptedItems > 0 || pendingCount > 0) {
                root.addView(primaryMenuButton("Закрыть приемку", view -> finishReceipt()));
            }
            root.addView(secondaryButton("Синхронизировать очередь (" + pendingCount + ")", view -> syncPending()));
            root.addView(secondaryButton("Сменить клиента", view -> resetReceiptSession()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            setScrollableContent(root);
            if (scanInput != null) {
                scanInput.requestFocus();
            }
            refreshHeaderText();
            return;
        }

        if (receiptBoxCode.isEmpty()) {
            boxCodeInput = input("Сканируйте ШК нового короба");
            boxCodeInput.setOnEditorActionListener((view, actionId, event) -> {
                openReceiptBoxFromInput();
                return true;
            });
            boxCodeInput.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence text, int start, int count, int after) {
                }

                @Override
                public void onTextChanged(CharSequence text, int start, int before, int count) {
                }

                @Override
                public void afterTextChanged(Editable editable) {
                    if (receiptBoxAutoOpenTask != null) {
                        mainHandler.removeCallbacks(receiptBoxAutoOpenTask);
                    }
                    String value = editable.toString().trim();
                    if (!isFflBoxCode(value) || normalizeBoxCode(value).length() < 6) {
                        return;
                    }
                    receiptBoxAutoOpenTask = () -> {
                        if (screen == Screen.RECEIPT
                            && receiptBoxCode.isEmpty()
                            && boxCodeInput != null
                            && !receiptOpeningBox
                            && !textValue(boxCodeInput).isEmpty()) {
                            openReceiptBoxFromInput();
                        }
                    };
                    mainHandler.postDelayed(receiptBoxAutoOpenTask, 350);
                }
            });
            scanInput = boxCodeInput;
            root.addView(boxCodeInput);
            root.addView(primaryMenuButton("Открыть короб", view -> openReceiptBoxFromInput()));
            if (receiptClosedBoxes > 0) {
                root.addView(primaryMenuButton("Закрыть приемку", view -> finishReceipt()));
            }
            root.addView(secondaryButton("Сменить клиента", view -> resetReceiptSession()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
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

    private void openFbsAssembly() {
        if (safeSession() == null) {
            statusMessage = tr("Сначала выполните вход в настройках.", "Avval sozlamalarda tizimga kiring.");
            renderSettingsScreen();
            return;
        }
        fbsAssembly = null;
        fbsFeedbackColor = 0;
        statusMessage = tr("Получаю следующий заказ...", "Keyingi buyurtma olinmoqda...");
        loadNextFbsAssembly();
    }

    private void loadNextFbsAssembly() {
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        screen = Screen.FBS_ASSEMBLY;
        fbsBusy = true;
        renderFbsAssemblyScreen();
        runBackground(() -> {
            Response<TsdFbsAssemblyResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .nextFbsAssembly(session.authorizationHeader(), session.deviceCode)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr(
                    "Не удалось получить очередь FBS. Повторите через минуту.",
                    "FBS navbatini olib bo‘lmadi. Bir daqiqadan so‘ng takrorlang."
                ));
                mainHandler.post(() -> showFbsError(message, response.code() < 500));
                return;
            }
            TsdFbsAssemblyResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                fbsBusy = false;
                fbsFeedbackColor = 0;
                fbsAssembly = loaded;
                statusMessage = nonEmpty(loaded.message, tr("Следуйте подсказке.", "Ko‘rsatmaga amal qiling."));
                renderFbsAssemblyScreen();
            });
        });
    }

    private void renderFbsAssemblyScreen() {
        screen = Screen.FBS_ASSEMBLY;
        fbsScanInput = null;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Сборка FBS", "FBS buyurtmasini yig‘ish")));
        int completedToday = fbsAssembly != null && fbsAssembly.progress != null
            ? fbsAssembly.progress.completedToday
            : 0;
        root.addView(messageView(tr("Собрано сегодня: ", "Bugun yig‘ildi: ") + completedToday));
        int stickerHistoryCount = fbsAssembly != null && fbsAssembly.progress != null &&
            fbsAssembly.progress.recentStickers != null
            ? fbsAssembly.progress.recentStickers.size()
            : 0;
        root.addView(secondaryButton(
            tr("История наклеек", "Stikerlar tarixi") + " (" + stickerHistoryCount + ")",
            view -> showFbsStickerHistory()
        ));

        if (fbsBusy) {
            root.addView(feedbackView(
                tr("Подождите, загружаю заказ...", "Kutib turing, buyurtma yuklanmoqda..."),
                BOX_DUPLICATE_BLUE
            ));
        }

        TsdFbsAssemblyResponse.Task task = fbsAssembly == null ? null : fbsAssembly.task;
        if (task == null) {
            if (!fbsBusy) {
                root.addView(feedbackView(
                    nonEmpty(statusMessage, tr("Готовых заказов пока нет.", "Hozircha tayyor buyurtmalar yo‘q.")),
                    fbsFeedbackColor == 0 ? LIGHT_GRAY : fbsFeedbackColor
                ));
                root.addView(primaryMenuButton(
                    tr("Проверить ещё раз", "Yana tekshirish"),
                    view -> loadNextFbsAssembly()
                ));
            }
            root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderMainScreen()));
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        String clientName = task.client == null ? "-" : nonEmpty(task.client.name, task.client.code);
        String productName = task.product == null ? "-" : nonEmpty(task.product.name, "-");
        String article = task.product == null ? "-" : nonEmpty(task.product.article, "-");
        String color = task.product == null ? "-" : nonEmpty(task.product.color, tr("не указан", "ko‘rsatilmagan"));
        String size = task.product == null ? "-" : nonEmpty(task.product.size, tr("не указан", "ko‘rsatilmagan"));
        String state = nonEmpty(fbsAssembly.state, "SCAN_BOX");
        root.addView(taskRow(
            tr("Заказ WB №", "WB buyurtmasi №") + nonEmpty(task.orderId, "-"),
            tr("Клиент: ", "Mijoz: ") + clientName + "\n" +
                productName + " · " + tr("арт. ", "art. ") + article,
            LIGHT_GRAY
        ));
        boolean orderStickerReady = false;
        if ("READY_TO_COMPLETE".equals(state)) {
            orderStickerReady = renderFbsOrderSticker(root, task);
        }
        if (fbsAssembly.progress != null && fbsAssembly.progress.requestTotalItems > 0) {
            String requestNumber = fbsAssembly.progress.requestNumber > 0
                ? String.format(Locale.US, "%06d", fbsAssembly.progress.requestNumber)
                : "-";
            root.addView(feedbackView(
                tr("ЗАЯВКА №", "ARIZA №") + requestNumber + "\n" +
                    tr("Осталось положить: ", "Joylash qoldi: ") +
                    fbsAssembly.progress.requestRemainingItems + " " +
                    tr("из ", "/ ") + fbsAssembly.progress.requestTotalItems,
                Color.rgb(219, 234, 254)
            ));
        }
        if (fbsFeedbackColor != 0 && !statusMessage.isEmpty()) {
            root.addView(feedbackView(statusMessage, fbsFeedbackColor));
        } else if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        if ("SCAN_BOX".equals(state)) {
            String boxCode = nonEmpty(task.recommendedBoxCode, "-");
            root.addView(feedbackView(
                tr("1. НАЙДИТЕ И ОТСКАНИРУЙТЕ КОРОБ\n", "1. QUTINI TOPING VA SKANERLANG\n") + boxCode,
                BOX_MOVEMENT_BLUE
            ));
            root.addView(messageView(
                tr("В коробе есть нужный товар: ", "Qutida kerakli mahsulot bor: ") + productName
            ));
            fbsScanInput = input(tr("Сканируйте номер короба", "Quti raqamini skanerlang"));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Подтвердить короб", "Qutini tasdiqlash"),
                view -> submitFbsScan()
            ));
        } else if ("SCAN_BARCODE".equals(state)) {
            root.addView(feedbackView(
                tr("Короб подтверждён: ", "Quti tasdiqlandi: ") + nonEmpty(task.scannedBoxCode, "-"),
                BOX_FOUND_GREEN
            ));
            if (task.sourceBoxUsage != null) {
                root.addView(feedbackView(
                    tr("ИЗ ЭТОГО КОРОБА БУДЕТ ВЗЯТО\n", "BU QUTIDAN OLINADI\n") +
                        task.sourceBoxUsage.units + tr(" ЕДИНИЦ ТОВАРА · ", " DONA · ") +
                        task.sourceBoxUsage.positions + tr(" ПОЗИЦИЙ", " TA POZITSIYA"),
                    Color.rgb(219, 234, 254)
                ));
            }
            root.addView(feedbackView(
                tr("2. ВОЗЬМИТЕ ТОВАР И ОТСКАНИРУЙТЕ ЕГО ШК\n", "2. MAHSULOTNI OLING VA SHKNI SKANERLANG\n") +
                    tr("Название: ", "Nomi: ") + productName + "\n" +
                    tr("Артикул: ", "Artikul: ") + article + "\n" +
                    tr("Цвет: ", "Rang: ") + color + "\n" +
                    tr("РАЗМЕР: ", "O‘LCHAM: ") + size,
                BOX_MOVEMENT_BLUE
            ));
            fbsScanInput = input(tr("Сканируйте ШК товара", "Mahsulot SHK sini skanerlang"));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Подтвердить товар", "Mahsulotni tasdiqlash"),
                view -> submitFbsScan()
            ));
        } else if ("SCAN_KIZ".equals(state)) {
            root.addView(feedbackView(
                tr("Товар подтверждён", "Mahsulot tasdiqlandi"),
                BOX_FOUND_GREEN
            ));
            root.addView(feedbackView(
                tr("3. ТЕПЕРЬ ОТСКАНИРУЙТЕ КИЗ DATA MATRIX\nНе сканируйте обычный ШК повторно.",
                    "3. ENDI DATA MATRIX KIZNI SKANERLANG\nOddiy SHKni qayta skanerlamang."),
                Color.rgb(254, 240, 138)
            ));
            fbsScanInput = input(tr("Сканируйте КИЗ", "KIZni skanerlang"));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Передать КИЗ в WB", "KIZni WBga yuborish"),
                view -> submitFbsScan()
            ));
        } else if ("CONFIRM_KIZ_MOVE".equals(state)) {
            TsdFbsAssemblyResponse.KizMoveProposal proposal = fbsAssembly.kizMoveProposal;
            String fromBox = proposal == null ? "-" : nonEmpty(proposal.fromBoxCode, "-");
            String toBox = proposal == null ? nonEmpty(task.scannedBoxCode, "-") : nonEmpty(proposal.toBoxCode, "-");
            root.addView(feedbackView(
                tr("КИЗ НАЙДЕН В ДРУГОМ КОРОБЕ", "KIZ BOSHQA QUTIDA TOPILDI"),
                Color.rgb(254, 240, 138)
            ));
            root.addView(feedbackView(
                tr("Сейчас числится: ", "Hozirgi quti: ") + fromBox + "\n" +
                    tr("Переместить в открытый короб: ", "Ochiq qutiga ko‘chirish: ") + toBox + "\n" +
                    tr("Товар: ", "Mahsulot: ") + productName + "\n" +
                    tr("Артикул: ", "Artikul: ") + article,
                BOX_MOVEMENT_BLUE
            ));
            root.addView(primaryMenuButton(
                tr("ПЕРЕМЕСТИТЬ И ПРИНЯТЬ КИЗ", "KO‘CHIRISH VA KIZNI QABUL QILISH"),
                view -> confirmFbsKizMove()
            ));
            root.addView(secondaryButton(
                tr("Нет — отсканировать другой КИЗ", "Yo‘q — boshqa KIZni skanerlash"),
                view -> cancelFbsKizMove()
            ));
        } else if ("READY_TO_COMPLETE".equals(state)) {
            String readyText = task.requiresKiz
                ? tr("ШК и КИЗ подтверждены Wildberries.", "SHK va KIZ Wildberries tomonidan tasdiqlandi.")
                : tr("Товар подтверждён. КИЗ не требуется.", "Mahsulot tasdiqlandi. KIZ talab qilinmaydi.");
            root.addView(feedbackView(
                tr("ВСЁ ВЕРНО\n", "HAMMASI TO‘G‘RI\n") + readyText,
                BOX_FOUND_GREEN
            ));
            if (orderStickerReady) {
                root.addView(primaryMenuButton(
                    tr("Готово — наклейка нанесена", "Tayyor — stiker yopishtirildi"),
                    view -> completeFbsAssembly()
                ));
            }
        } else if ("COMPLETED".equals(state)) {
            root.addView(feedbackView(
                tr("ГОТОВО\nЗаказ собран и записан в заявку.", "TAYYOR\nBuyurtma yig‘ildi va arizaga yozildi."),
                BOX_FOUND_GREEN
            ));
            root.addView(primaryMenuButton(
                tr("Следующий заказ", "Keyingi buyurtma"),
                view -> loadNextFbsAssembly()
            ));
        }

        if (!"COMPLETED".equals(state) && !task.kizAccepted) {
            root.addView(secondaryButton(
                tr("Проблема с товаром — отложить", "Mahsulotda muammo — keyinga qoldirish"),
                view -> confirmReleaseFbsAssembly()
            ));
        }
        root.addView(secondaryButton(tr("Обновить", "Yangilash"), view -> loadNextFbsAssembly()));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        if (fbsScanInput != null) fbsScanInput.requestFocus();
        refreshHeaderText();
    }

    private boolean renderFbsOrderSticker(LinearLayout root, TsdFbsAssemblyResponse.Task task) {
        if (task.orderSticker == null || nonEmpty(task.orderSticker.imageBase64, "").isEmpty()) {
            root.addView(feedbackView(
                tr("Наклейка WB временно не загрузилась. Нажмите «Обновить» и не завершайте заказ без правильной наклейки.",
                    "WB stikeri vaqtincha yuklanmadi. «Yangilash»ni bosing va to‘g‘ri stikersiz buyurtmani yakunlamang."),
                Color.rgb(254, 226, 226)
            ));
            return false;
        }
        String largeDigits = nonEmpty(task.orderSticker.partB, "—");
        root.addView(feedbackView(
            tr("НАКЛЕЙТЕ ШК ЗАКАЗА WB\nИЩИТЕ НАКЛЕЙКУ С КРУПНЫМИ ЦИФРАМИ: ",
                "WB BUYURTMA SHK STIKERINI YOPISHTIRING\nKATTA RAQAMLI STIKERNI TOPING: ") + largeDigits,
            Color.rgb(254, 240, 138)
        ));
        ImageView stickerView = fbsOrderStickerView(task.orderSticker.imageBase64);
        if (stickerView != null) root.addView(stickerView);
        root.addView(messageView(
            tr("Наклейка для заказа №", "Buyurtma stikeri №") + nonEmpty(task.orderId, "-") +
                " · " + tr("часть A: ", "A qismi: ") + nonEmpty(task.orderSticker.partA, "-") +
                " · " + tr("часть B: ", "B qismi: ") + largeDigits
        ));
        return stickerView != null;
    }

    private void showFbsStickerHistory() {
        List<TsdFbsAssemblyResponse.StickerHistoryItem> history =
            fbsAssembly != null && fbsAssembly.progress != null
                ? fbsAssembly.progress.recentStickers
                : null;
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(8), dp(8), dp(8), dp(8));
        if (history == null || history.isEmpty()) {
            content.addView(messageView(tr(
                "Наклеенных ШК пока нет.",
                "Hozircha yopishtirilgan SHK yo‘q."
            )));
        } else {
            for (TsdFbsAssemblyResponse.StickerHistoryItem item : history) {
                String requestNumber = item.requestNumber > 0
                    ? String.format(Locale.US, "%06d", item.requestNumber)
                    : "-";
                String largeDigits = nonEmpty(item.partB, "—");
                content.addView(taskRow(
                    tr("КРУПНЫЕ ЦИФРЫ: ", "KATTA RAQAMLAR: ") + largeDigits,
                    tr("Заказ WB №", "WB buyurtmasi №") + nonEmpty(item.orderId, "-") +
                        " · " + tr("заявка №", "ariza №") + requestNumber + "\n" +
                        nonEmpty(item.productName, "-") + " · " + tr("арт. ", "art. ") + nonEmpty(item.article, "-") + "\n" +
                        tr("Короб: ", "Quti: ") + nonEmpty(item.boxCode, "-") + "\n" +
                        tr("ШК наклейки: ", "Stiker SHK: ") + nonEmpty(item.barcode, "-"),
                    BOX_FOUND_GREEN
                ));
            }
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        new AlertDialog.Builder(this)
            .setTitle(tr("История наклеек FBS", "FBS stikerlar tarixi"))
            .setView(scroll)
            .setPositiveButton(tr("Закрыть", "Yopish"), null)
            .show();
    }

    private void submitFbsScan() {
        if (fbsBusy || fbsAssembly == null || fbsAssembly.task == null) return;
        String value = textValue(fbsScanInput);
        if (value.isEmpty()) {
            showFbsError(tr("Сначала отсканируйте код.", "Avval kodni skanerlang."), true);
            return;
        }
        String state = nonEmpty(fbsAssembly.state, "");
        if ("SCAN_BOX".equals(state)) {
            executeFbsAction("scan-box", "boxCode", value);
        } else if ("SCAN_BARCODE".equals(state)) {
            executeFbsAction("scan-barcode", "barcode", value);
        } else if ("SCAN_KIZ".equals(state)) {
            executeFbsAction("scan-kiz", "kiz", value);
        }
    }

    private void completeFbsAssembly() {
        executeFbsAction("complete", null, null);
    }

    private void confirmFbsKizMove() {
        if (fbsAssembly == null || fbsAssembly.kizMoveProposal == null || fbsBusy) return;
        executeFbsAction("scan-kiz-move", "kiz", fbsAssembly.kizMoveProposal.kiz);
    }

    private void cancelFbsKizMove() {
        if (fbsAssembly == null || fbsBusy) return;
        fbsAssembly.state = "SCAN_KIZ";
        fbsAssembly.kizMoveProposal = null;
        fbsFeedbackColor = 0;
        statusMessage = tr("Отсканируйте другой КИЗ.", "Boshqa KIZni skanerlang.");
        renderFbsAssemblyScreen();
    }

    private ImageView fbsOrderStickerView(String encodedImage) {
        try {
            byte[] bytes = Base64.decode(encodedImage, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) return null;
            ImageView image = new ImageView(this);
            image.setImageBitmap(bitmap);
            image.setAdjustViewBounds(true);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setBackgroundColor(Color.WHITE);
            image.setPadding(dp(12), dp(12), dp(12), dp(12));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            params.setMargins(dp(16), dp(6), dp(16), dp(10));
            image.setLayoutParams(params);
            return image;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private void confirmReleaseFbsAssembly() {
        if (fbsAssembly == null || fbsAssembly.task == null || fbsBusy) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Отложить заказ?", "Buyurtmani keyinga qoldirasizmi?"))
            .setMessage(tr(
                "Заказ вернётся в очередь. Используйте это только если товар или короб найти невозможно.",
                "Buyurtma navbatga qaytadi. Faqat mahsulot yoki qutini topib bo‘lmasa foydalaning."
            ))
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(tr("Отложить", "Keyinga qoldirish"), (dialog, which) ->
                executeFbsAction("release", null, null)
            )
            .show();
    }

    private void executeFbsAction(String action, String field, String value) {
        TsdSession session = safeSession();
        TsdFbsAssemblyResponse.Task currentTask = fbsAssembly == null ? null : fbsAssembly.task;
        if (session == null || currentTask == null || fbsBusy) return;
        fbsBusy = true;
        fbsFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = tr("Проверяю...", "Tekshirilmoqda...");
        renderFbsAssemblyScreen();
        String taskId = currentTask.id;
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, Object> payload = new LinkedHashMap<>();
            if (field != null) payload.put(field, value);
            if ("scan-kiz-move".equals(action)) payload.put("confirmBoxMove", true);
            Response<TsdFbsAssemblyResponse> response;
            if ("scan-box".equals(action)) {
                response = api.scanFbsBox(session.authorizationHeader(), taskId, payload).execute();
            } else if ("scan-barcode".equals(action)) {
                response = api.scanFbsBarcode(session.authorizationHeader(), taskId, payload).execute();
            } else if ("scan-kiz".equals(action) || "scan-kiz-move".equals(action)) {
                response = api.scanFbsKiz(session.authorizationHeader(), taskId, payload).execute();
            } else if ("release".equals(action)) {
                response = api.releaseFbsAssembly(session.authorizationHeader(), taskId).execute();
            } else {
                response = api.completeFbsAssembly(session.authorizationHeader(), taskId).execute();
            }
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr(
                    "Операция не выполнена. Повторите сканирование.",
                    "Amal bajarilmadi. Qayta skanerlang."
                ));
                mainHandler.post(() -> showFbsError(message, response.code() < 500));
                return;
            }
            TsdFbsAssemblyResponse updated = response.body();
            mainHandler.post(() -> {
                online = true;
                fbsBusy = false;
                fbsAssembly = updated;
                statusMessage = nonEmpty(updated.message, tr("Принято.", "Qabul qilindi."));
                boolean needsMoveConfirmation = "CONFIRM_KIZ_MOVE".equals(updated.state);
                fbsFeedbackColor = needsMoveConfirmation ? Color.rgb(254, 240, 138) : BOX_FOUND_GREEN;
                if (!needsMoveConfirmation) playFbsSuccess();
                renderFbsAssemblyScreen();
                if ("COMPLETED".equals(updated.state)) {
                    String completedTaskId = taskId;
                    mainHandler.postDelayed(() -> {
                        if (
                            screen == Screen.FBS_ASSEMBLY &&
                            fbsAssembly != null &&
                            fbsAssembly.task != null &&
                            completedTaskId.equals(fbsAssembly.task.id) &&
                            "COMPLETED".equals(fbsAssembly.state)
                        ) {
                            loadNextFbsAssembly();
                        }
                    }, 1200L);
                } else if ("release".equals(action)) {
                    loadNextFbsAssembly();
                }
            });
        });
    }

    private void showFbsError(String message, boolean keepOnline) {
        online = keepOnline;
        fbsBusy = false;
        fbsFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = message;
        playFbsError();
        renderFbsAssemblyScreen();
    }

    private void playFbsSuccess() {
        playFbsTone(ToneGenerator.TONE_PROP_ACK, 120, 45);
    }

    private void playFbsError() {
        playFbsTone(ToneGenerator.TONE_PROP_NACK, 260, 180);
    }

    private void playFbsTone(int tone, int durationMs, long vibrationMs) {
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);
            generator.startTone(tone, durationMs);
            mainHandler.postDelayed(generator::release, durationMs + 100L);
        } catch (Throwable ignored) {
        }
        try {
            Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                vibrator.vibrate(VibrationEffect.createOneShot(vibrationMs, VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (Throwable ignored) {
        }
    }

    private void openFbsCargoPacking() {
        if (safeSession() == null) {
            statusMessage = tr("Сначала выполните вход в настройках.", "Avval sozlamalarda tizimga kiring.");
            renderSettingsScreen();
            return;
        }
        fbsCargoPacking = null;
        selectedFbsCargoPlanId = "";
        fbsCargoFeedbackColor = 0;
        statusMessage = tr("Загружаю поставки для ПВЗ...", "PVZ uchun yetkazib berishlar yuklanmoqda...");
        loadFbsCargoPacking();
    }

    private void loadFbsCargoPacking() {
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        screen = Screen.FBS_CARGO;
        fbsCargoBusy = true;
        renderFbsCargoPackingScreen();
        runBackground(() -> {
            Response<TsdFbsCargoPackingResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .getFbsCargoPacking(session.authorizationHeader(), session.deviceCode)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr(
                    "Не удалось загрузить грузоместа FBS.",
                    "FBS yuk joylarini yuklab bo‘lmadi."
                ));
                mainHandler.post(() -> showFbsCargoError(message, response.code() < 500));
                return;
            }
            TsdFbsCargoPackingResponse loaded = response.body();
            mainHandler.post(() -> applyFbsCargoResponse(loaded, false));
        });
    }

    private void renderFbsCargoPackingScreen() {
        screen = Screen.FBS_CARGO;
        fbsCargoScanInput = null;
        LinearLayout root = baseRoot();
        applyScreenFeedback(root, fbsCargoFeedbackColor);
        root.addView(header());
        root.addView(title(tr("Упаковка грузомест FBS", "FBS yuk joylarini qadoqlash")));
        if (!statusMessage.isEmpty()) {
            root.addView(fbsCargoFeedbackColor == 0
                ? messageView(statusMessage)
                : feedbackView(statusMessage, fbsCargoFeedbackColor));
        }
        if (fbsCargoBusy && fbsCargoPacking == null) {
            root.addView(messageView(tr("Загрузка...", "Yuklanmoqda...")));
            root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        TsdFbsCargoPackingResponse.Packing current = fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (current != null) {
            root.addView(feedbackView(
                tr("ОТКРЫТО ГРУЗОМЕСТО\n", "YUK JOYI OCHILDI\n") + safeText(current.cargoPlaceId) +
                    "\n" + tr("Заполнено: ", "To‘ldirildi: ") + current.packedItems + " / " + current.capacityItems,
                BOX_MOVEMENT_BLUE
            ));
            root.addView(messageView(tr(
                "Сканируйте полный ШК с наклейки заказа WB. Один заказ нельзя уложить дважды или в другое грузоместо.",
                "WB buyurtma stikeridagi to‘liq SHKni skanerlang. Bir buyurtmani ikki marta yoki boshqa joyga qo‘yib bo‘lmaydi."
            )));
            fbsCargoScanInput = input(tr("Сканируйте ШК заказа WB", "WB buyurtma SHK sini skanerlang"));
            root.addView(fbsCargoScanInput);
            root.addView(primaryMenuButton(
                tr("Добавить заказ в грузоместо", "Buyurtmani yuk joyiga qo‘shish"),
                view -> submitFbsCargoScan()
            ));
            if (current.orders != null && !current.orders.isEmpty()) {
                root.addView(label(tr("Последние уложенные заказы", "Oxirgi joylangan buyurtmalar")));
                int shown = 0;
                for (TsdFbsCargoPackingResponse.Order order : current.orders) {
                    if (shown++ >= 8) break;
                    String details = tr("Товар: ", "Mahsulot: ") + safeText(order.productName) +
                        "\n" + tr("Артикул: ", "Artikul: ") + safeText(order.article) +
                        (safeText(order.color).equals("—") ? "" : " · " + tr("цвет: ", "rang: ") + safeText(order.color)) +
                        (safeText(order.size).equals("—") ? "" : " · " + tr("размер: ", "o‘lcham: ") + safeText(order.size)) +
                        "\n" + tr("Большие цифры WB: ", "WB katta raqamlari: ") + safeText(order.wbStickerPartB);
                    root.addView(taskRow(tr("Заказ №", "Buyurtma №") + safeText(order.orderId), details, BOX_FOUND_GREEN));
                }
                root.addView(secondaryButton(
                    tr("Отменить последнее сканирование", "Oxirgi skanerlashni bekor qilish"),
                    view -> undoLastFbsCargoOrder()
                ));
            }
            root.addView(primaryMenuButton(
                tr("Закрыть грузоместо", "Yuk joyini yopish"),
                view -> confirmCloseFbsCargoPacking()
            ));
        } else {
            TsdFbsCargoPackingResponse.Supply selected = selectedFbsCargoSupply();
            if (selected != null) {
                root.addView(feedbackView(
                    tr("ПОСТАВКА ", "YETKAZIB BERISH ") + safeText(selected.supplyId) +
                        "\n" + safeText(selected.client == null ? null : selected.client.name) +
                        "\n" + tr("Упаковано: ", "Qadoqlandi: ") + selected.packedItems + " / " + selected.totalPlannedItems +
                        " · " + tr("мест закрыто: ", "yopilgan joylar: ") + selected.closedCargoPlaces + " / " + selected.cargoPlaceCount,
                    BOX_DUPLICATE_BLUE
                ));
                root.addView(messageView(tr(
                    "Возьмите пустой физический короб, наклейте на него QR грузоместа WB и отсканируйте этот QR.",
                    "Bo‘sh qutini oling, WB yuk joyi QR stikerini yopishtiring va QRni skanerlang."
                )));
                fbsCargoScanInput = input(tr("Сканируйте QR грузоместа WB", "WB yuk joyi QR kodini skanerlang"));
                root.addView(fbsCargoScanInput);
                root.addView(primaryMenuButton(
                    tr("Открыть грузоместо", "Yuk joyini ochish"),
                    view -> submitFbsCargoScan()
                ));
                root.addView(secondaryButton(
                    tr("Выбрать другую поставку", "Boshqa yetkazib berishni tanlash"),
                    view -> {
                        selectedFbsCargoPlanId = "";
                        fbsCargoFeedbackColor = 0;
                        statusMessage = tr("Выберите поставку.", "Yetkazib berishni tanlang.");
                        renderFbsCargoPackingScreen();
                    }
                ));
            } else {
                List<TsdFbsCargoPackingResponse.Supply> supplies = fbsCargoPacking == null
                    ? null
                    : fbsCargoPacking.supplies;
                if (supplies == null || supplies.isEmpty()) {
                    root.addView(messageView(tr(
                        "Нет поставок в ПВЗ для упаковки. Сначала соберите заказы FBS.",
                        "Qadoqlash uchun PVZ yetkazib berishlari yo‘q. Avval FBS buyurtmalarini yig‘ing."
                    )));
                } else {
                    root.addView(label(tr("Выберите поставку", "Yetkazib berishni tanlang")));
                    for (TsdFbsCargoPackingResponse.Supply supply : supplies) {
                        String clientName = supply.client == null ? "" : safeText(supply.client.name);
                        String stateText = supply.readyToDeliver
                            ? tr("ГОТОВА К ПЕРЕДАЧЕ", "TOPSHIRISHGA TAYYOR")
                            : tr("уложить: ", "joylash: ") + supply.remainingToPack +
                                " · " + tr("ещё собирается: ", "hali yig‘ilmoqda: ") + supply.waitingAssembly;
                        root.addView(multilineSecondaryButton(
                            safeText(supply.supplyId) + "\n" + clientName + "\n" +
                                supply.packedItems + " / " + supply.totalPlannedItems + " · " + stateText,
                            view -> {
                                if (supply.readyToDeliver) {
                                    statusMessage = tr("Эта поставка уже полностью упакована.", "Bu yetkazib berish to‘liq qadoqlangan.");
                                    fbsCargoFeedbackColor = BOX_FOUND_GREEN;
                                    renderFbsCargoPackingScreen();
                                    return;
                                }
                                selectedFbsCargoPlanId = supply.id;
                                fbsCargoFeedbackColor = 0;
                                statusMessage = tr("Теперь отсканируйте QR грузоместа.", "Endi yuk joyi QR kodini skanerlang.");
                                renderFbsCargoPackingScreen();
                            }
                        ));
                    }
                }
            }
        }
        root.addView(secondaryButton(tr("Обновить", "Yangilash"), view -> loadFbsCargoPacking()));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        root.addView(versionView());
        setScrollableContent(root);
        if (fbsCargoScanInput != null) fbsCargoScanInput.requestFocus();
        refreshHeaderText();
    }

    private TsdFbsCargoPackingResponse.Supply selectedFbsCargoSupply() {
        if (selectedFbsCargoPlanId.isEmpty() || fbsCargoPacking == null || fbsCargoPacking.supplies == null) return null;
        for (TsdFbsCargoPackingResponse.Supply supply : fbsCargoPacking.supplies) {
            if (selectedFbsCargoPlanId.equals(supply.id)) return supply;
        }
        selectedFbsCargoPlanId = "";
        return null;
    }

    private void submitFbsCargoScan() {
        if (fbsCargoBusy) return;
        String value = textValue(fbsCargoScanInput);
        if (value.isEmpty()) {
            showFbsCargoError(tr("Сначала отсканируйте код.", "Avval kodni skanerlang."), true);
            return;
        }
        TsdFbsCargoPackingResponse.Packing current = fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (current == null) {
            if (selectedFbsCargoPlanId.isEmpty()) {
                showFbsCargoError(tr("Сначала выберите поставку.", "Avval yetkazib berishni tanlang."), true);
                return;
            }
            executeFbsCargoAction("open", value);
        } else {
            executeFbsCargoAction("scan", value);
        }
    }

    private void undoLastFbsCargoOrder() {
        executeFbsCargoAction("undo", null);
    }

    private void confirmCloseFbsCargoPacking() {
        TsdFbsCargoPackingResponse.Packing current = fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (current == null || fbsCargoBusy) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Закрыть грузоместо?", "Yuk joyini yopasizmi?"))
            .setMessage(tr("Внутри зафиксировано: ", "Ichida qayd etilgan: ") + current.packedItems +
                " / " + current.capacityItems + tr(" единиц. После закрытия повторное сканирование запрещено.",
                    " dona. Yopilgandan keyin qayta skanerlash taqiqlanadi."))
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(tr("Закрыть", "Yopish"), (dialog, which) -> executeFbsCargoAction("close", null))
            .show();
    }

    private void executeFbsCargoAction(String action, String value) {
        TsdSession session = safeSession();
        if (session == null || fbsCargoBusy) return;
        TsdFbsCargoPackingResponse.Packing current = fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (!"open".equals(action) && current == null) return;
        fbsCargoBusy = true;
        fbsCargoFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = tr("Проверяю...", "Tekshirilmoqda...");
        renderFbsCargoPackingScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdFbsCargoPackingResponse> response;
            if ("open".equals(action)) {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("planId", selectedFbsCargoPlanId);
                payload.put("cargoCode", value);
                payload.put("deviceCode", session.deviceCode);
                response = api.openFbsCargoPacking(session.authorizationHeader(), payload).execute();
            } else if ("scan".equals(action)) {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("orderCode", value);
                response = api.scanFbsCargoOrder(session.authorizationHeader(), current.id, payload).execute();
            } else if ("undo".equals(action)) {
                response = api.undoLastFbsCargoOrder(session.authorizationHeader(), current.id).execute();
            } else {
                response = api.closeFbsCargoPacking(session.authorizationHeader(), current.id).execute();
            }
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr(
                    "Операция не выполнена. Повторите сканирование.",
                    "Amal bajarilmadi. Qayta skanerlang."
                ));
                mainHandler.post(() -> showFbsCargoError(message, response.code() < 500));
                return;
            }
            TsdFbsCargoPackingResponse updated = response.body();
            mainHandler.post(() -> {
                boolean closed = "close".equals(action);
                if (closed) selectedFbsCargoPlanId = "";
                applyFbsCargoResponse(updated, true);
            });
        });
    }

    private void applyFbsCargoResponse(TsdFbsCargoPackingResponse response, boolean success) {
        online = true;
        fbsCargoBusy = false;
        fbsCargoPacking = response;
        statusMessage = nonEmpty(response.message, tr("Готово.", "Tayyor."));
        fbsCargoFeedbackColor = success ? BOX_FOUND_GREEN : 0;
        if (success) playFbsSuccess();
        renderFbsCargoPackingScreen();
    }

    private void showFbsCargoError(String message, boolean keepOnline) {
        online = keepOnline;
        fbsCargoBusy = false;
        fbsCargoFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = message;
        playFbsError();
        renderFbsCargoPackingScreen();
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
        String process = activeProcessesText(request.activeTsdProcesses, request.activeTsdProcess);
        String text = request.title + "\nКлиент: " + clientName + "\nГород: " + city + " · Статус: " + request.status + " · строк: " + request.rowsCount + inWork + process;
        Button button = multilineSecondaryButton(text, view -> loadAssemblyPlan(request.id));
        if ((request.activeTsdProcesses != null && !request.activeTsdProcesses.isEmpty()) || request.activeTsdProcess != null) {
            button.setBackgroundColor(Color.rgb(219, 234, 254));
        } else if ("IN_WORK".equals(request.status)) {
            button.setBackgroundColor(Color.rgb(224, 242, 254));
        }
        return button;
    }

    private void loadBoxlessPacking() {
        TsdSession session = safeSession();
        if (session == null || assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdBoxlessPackingResponse> response = api
                .getBoxlessPacking(session.authorizationHeader(), assemblyPlan.id)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("HTTP " + response.code());
            }
            TsdBoxlessPackingResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                boxlessPacking = loaded;
                renderBoxlessPackingScreen();
            });
        });
    }

    private void renderBoxlessPackingScreen() {
        screen = Screen.BOXLESS_PACKING;
        scanInput = null;
        if (assemblyPlan == null || boxlessPacking == null || boxlessPacking.packingProgress == null) {
            loadAssemblyPlan(assemblyPlan == null ? "" : assemblyPlan.id);
            return;
        }
        TsdBoxlessPackingResponse.PackingProgress progress = boxlessPacking.packingProgress;
        TsdBoxlessPackingResponse.PackingBox currentBox = currentBoxlessPackingBox(progress);
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Сборка по коробам"));
        root.addView(messageView("Заявка: " + assemblyPlan.title));
        root.addView(messageView("Упаковано: " + progress.packedQuantity + " из " + progress.totalQuantity + " · осталось: " + progress.remainingQuantity));

        if (!statusMessage.isEmpty()) {
            root.addView(receiptFeedbackColor == 0 ? messageView(statusMessage) : feedbackView(statusMessage, receiptFeedbackColor));
        }

        if (currentBox == null) {
            scanInput = input("Сканируйте ШК нового короба");
            scanInput.setOnEditorActionListener((view, actionId, event) -> {
                sendBoxlessPackingAction("open-box", textValue(scanInput), null);
                return true;
            });
            root.addView(scanInput);
            root.addView(primaryMenuButton("Открыть короб", view -> sendBoxlessPackingAction("open-box", textValue(scanInput), null)));
        } else {
            root.addView(messageView("Открыт короб: " + currentBox.boxCode + " · товаров: " + currentBox.quantity));
            scanInput = input("Сканируйте ШК товара");
            scanInput.setOnEditorActionListener((view, actionId, event) -> {
                sendBoxlessPackingAction("scan-item", textValue(scanInput), currentBox.boxCode);
                return true;
            });
            root.addView(scanInput);
            root.addView(primaryMenuButton("Добавить товар", view -> sendBoxlessPackingAction("scan-item", textValue(scanInput), currentBox.boxCode)));
            root.addView(secondaryButton("Закрыть короб", view -> sendBoxlessPackingAction("close-box", currentBox.boxCode, currentBox.boxCode)));
        }

        root.addView(label("Короба"));
        if (progress.boxes != null) {
            for (TsdBoxlessPackingResponse.PackingBox box : progress.boxes) {
                root.addView(taskRow(box.boxCode, (box.closed ? "Закрыт" : "Открыт") + " · " + box.quantity + " шт · " + emptyAsDash(box.deviceCode), box.closed ? BOX_FOUND_GREEN : LIGHT_GRAY));
            }
        }
        root.addView(label("Осталось упаковать"));
        if (progress.rows != null) {
            for (TsdBoxlessPackingResponse.PackingRow row : progress.rows) {
                if (row.remainingQuantity > 0) {
                    root.addView(taskRow(emptyAsDash(row.barcode), row.name + " · осталось " + row.remainingQuantity, LIGHT_GRAY));
                }
            }
        }
        if (progress.remainingQuantity == 0 && progress.openBoxes == 0 && progress.closedBoxes > 0) {
            root.addView(primaryMenuButton("Завершить упаковку", view -> sendBoxlessPackingAction("finish", "", null)));
        }
        root.addView(secondaryButton("Обновить", view -> loadBoxlessPacking()));
        root.addView(secondaryButton("Назад к заявке", view -> renderAssemblyDetailScreen()));
        setScrollableContent(root);
        if (scanInput != null) scanInput.requestFocus();
        refreshHeaderText();
    }

    private TsdBoxlessPackingResponse.PackingBox currentBoxlessPackingBox(TsdBoxlessPackingResponse.PackingProgress progress) {
        TsdSession session = safeSession();
        if (progress.boxes == null || session == null) return null;
        for (TsdBoxlessPackingResponse.PackingBox box : progress.boxes) {
            if (!box.closed && session.deviceCode.equals(box.deviceCode)) return box;
        }
        return null;
    }

    private void sendBoxlessPackingAction(String action, String code, String boxCode) {
        TsdSession session = safeSession();
        if (session == null || assemblyPlan == null) return;
        String scanned = code == null ? "" : code.trim();
        if ("open-box".equals(action) && !isFflBoxCode(scanned)) {
            receiptFeedbackColor = BOX_NOT_NEEDED_RED;
            statusMessage = "Номер короба должен начинаться с FFL.";
            renderBoxlessPackingScreen();
            return;
        }
        if ("scan-item".equals(action)) {
            String error = receiptBarcodeError(scanned);
            if (!error.isEmpty()) {
                receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                statusMessage = error;
                renderBoxlessPackingScreen();
                return;
            }
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("deviceCode", session.deviceCode);
        payload.put("operationKey", "boxless-" + assemblyPlan.id + "-" + action + "-" + System.currentTimeMillis());
        if (boxCode != null && !boxCode.trim().isEmpty()) payload.put("boxCode", boxCode.trim());
        if ("open-box".equals(action)) payload.put("boxCode", scanned);
        if ("scan-item".equals(action)) payload.put("barcode", scanned);

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdBoxlessPackingResponse> response;
            if ("open-box".equals(action)) {
                response = api.openBoxlessPackingBox(session.authorizationHeader(), assemblyPlan.id, payload).execute();
            } else if ("scan-item".equals(action)) {
                response = api.scanBoxlessPackingItem(session.authorizationHeader(), assemblyPlan.id, payload).execute();
            } else if ("close-box".equals(action)) {
                response = api.closeBoxlessPackingBox(session.authorizationHeader(), assemblyPlan.id, payload).execute();
            } else {
                response = api.finishBoxlessPacking(session.authorizationHeader(), assemblyPlan.id, payload).execute();
            }
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("HTTP " + response.code());
            }
            TsdBoxlessPackingResponse updated = response.body();
            mainHandler.post(() -> {
                online = true;
                receiptFeedbackColor = 0;
                statusMessage = "finish".equals(action) ? "Заявка упакована." : "Операция принята.";
                if ("finish".equals(action)) {
                    loadAssemblyPlan(assemblyPlan.id);
                } else {
                    boxlessPacking = updated;
                    renderBoxlessPackingScreen();
                }
            });
        });
    }

    private String activeProcessLine(TsdAssemblyProcess process) {
        if (process == null) {
            return "";
        }
        String worker = process.workerName == null || process.workerName.trim().isEmpty() ? "" : process.workerName.trim();
        String device = process.deviceCode == null || process.deviceCode.trim().isEmpty() ? "" : process.deviceCode.trim();
        String who = worker.isEmpty() ? device : worker + (device.isEmpty() ? "" : " / " + device);
        String progress = process.progressText == null || process.progressText.trim().isEmpty() ? process.stageLabel : process.progressText;
        if (process.totalBoxCount > 0) {
            progress = "найдено коробов: " + process.foundCount + " из " + process.totalBoxCount;
        } else if (process.foundCount > 0) {
            progress = "найдено коробов: " + process.foundCount;
        }
        return "\nВ работе на ТСД: " + (who.isEmpty() ? "-" : who) + "\nЭтап: " + emptyAsDash(process.stageLabel) + " · " + emptyAsDash(progress);
    }

    private String activeProcessesText(List<TsdAssemblyProcess> processes, TsdAssemblyProcess fallback) {
        List<TsdAssemblyProcess> visible = processes == null ? new ArrayList<>() : processes;
        if (visible.isEmpty() && fallback != null) {
            visible = new ArrayList<>();
            visible.add(fallback);
        }
        if (visible.isEmpty()) {
            return "";
        }
        StringBuilder result = new StringBuilder("\nСейчас работают: ");
        int limit = Math.min(visible.size(), 4);
        for (int index = 0; index < limit; index++) {
            TsdAssemblyProcess process = visible.get(index);
            if (index > 0) result.append("; ");
            String worker = process.workerName == null || process.workerName.trim().isEmpty() ? process.deviceCode : process.workerName.trim();
            result.append(worker).append(" — ").append(emptyAsDash(process.stageLabel));
        }
        if (visible.size() > limit) result.append("; еще ").append(visible.size() - limit);
        return result.toString();
    }

    private void touchAssemblyStage(String stage) {
        if (assemblyPlan == null) {
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }

        long now = System.currentTimeMillis();
        String touchKey = assemblyPlan.id + ":" + stage;
        if (touchKey.equals(lastAssemblyTouchKey) && now - lastAssemblyTouchAt < 15000L) {
            return;
        }
        lastAssemblyTouchKey = touchKey;
        lastAssemblyTouchAt = now;

        String requestId = assemblyPlan.id;
        String requestTitle = assemblyPlan.title;
        runSilentBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, String> payload = new LinkedHashMap<>();
            payload.put("requestId", requestId);
            payload.put("stage", stage);
            payload.put("stageLabel", assemblyStageLabel(stage));
            payload.put("requestTitle", requestTitle == null ? "" : requestTitle);
            payload.put("deviceCode", session.deviceCode);
            payload.put("workerName", session.deviceName);
            TsdOperationRequest operation = new TsdOperationRequest(
                session.deviceCode,
                "assembly-stage:" + requestId + ":" + session.deviceCode + ":" + stage + ":" + System.currentTimeMillis(),
                "assembly_stage",
                payload
            );
            api.sendOperation(session.authorizationHeader(), operation).execute();
        });
    }

    private void enqueueAssemblyProgress(Map<String, String> values) {
        if (assemblyPlan == null) return;
        TsdSession session = safeSession();
        if (session == null) return;
        String requestId = assemblyPlan.id;
        Map<String, String> payload = new LinkedHashMap<>(values);
        payload.put("requestId", requestId);
        payload.put("deviceCode", session.deviceCode);
        payload.put("workerName", session.deviceName);

        runBackground(() -> {
            outbox.enqueueAssemblyStage(payload);
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending(session.authorizationHeader());
            Response<TsdAssemblyPlan> response = api.getAssemblyRequest(session.authorizationHeader(), requestId).execute();
            TsdAssemblyPlan freshPlan = response.isSuccessful() ? response.body() : null;
            mainHandler.post(() -> {
                online = summary.retried == 0;
                if (freshPlan != null) assemblyPlan = freshPlan;
                if (summary.rejected > 0) {
                    statusMessage = "Операция уже выполнена другим сборщиком или отклонена WMS. Обновите заявку.";
                    movementFeedbackColor = BOX_NOT_NEEDED_RED;
                }
                refreshQueue(null);
                refreshCurrentScreen();
            });
        });
    }

    private void sendBoxSearchScan(String boxCode) {
        if (assemblyPlan == null) {
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }

        String requestId = assemblyPlan.id;
        runSilentBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, String> payload = new LinkedHashMap<>();
            payload.put("boxCode", boxCode);
            payload.put("deviceCode", session.deviceCode);
            Response<Map<String, Object>> scanResponse = api.scanAssemblyBox(session.authorizationHeader(), requestId, payload).execute();
            if (!scanResponse.isSuccessful()) {
                online = false;
                return;
            }
            Response<TsdAssemblyPlan> planResponse = api.getAssemblyRequest(session.authorizationHeader(), requestId).execute();
            if (!planResponse.isSuccessful() || planResponse.body() == null) {
                return;
            }
            TsdAssemblyPlan freshPlan = planResponse.body();
            mainHandler.post(() -> {
                assemblyPlan = freshPlan;
                online = true;
                if (screen == Screen.BOX_SEARCH) {
                    renderBoxSearchScreen();
                } else {
                    refreshHeaderText();
                }
            });
        });
    }

    private String assemblyStageLabel(String stage) {
        if ("box-search".equals(stage)) {
            return "поиск коробов";
        }
        if ("relabel".equals(stage)) {
            return "перемаркировка";
        }
        if ("moves".equals(stage)) {
            return "перемещения";
        }
        if ("outgoing-control".equals(stage)) {
            return "контроль отгрузки";
        }
        if ("boxless-packing".equals(stage)) {
            return "сборка по коробам";
        }
        return "открыта заявка";
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
                selectedMoveSourceBox = "";
                selectedMoveTargetBox = "";
                statusMessage = "Заявка открыта.";
                renderAssemblyDetailScreen();
                touchAssemblyStage("open");
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
        List<TsdSearchBoxTask> searchBoxes = safeSearchBoxes();
        int foundSearchBoxes = foundSearchBoxesCount(searchBoxes, foundBoxes());
        syncFoundBoxesToServer(searchBoxes, foundBoxes());
        root.addView(messageView("Единиц к отгрузке: " + assemblyPlan.totalRequested + " · коробов найти: " + searchBoxes.size()));
        root.addView(messageView("Поиск коробов: найдено " + foundSearchBoxes + " из " + searchBoxes.size()));
        String activeWorkers = activeProcessesText(assemblyPlan.activeTsdProcesses, assemblyPlan.activeTsdProcess).trim();
        if (!activeWorkers.isEmpty()) {
            root.addView(messageView(activeWorkers));
        }

        if (assemblyPlan.storesWithoutBoxes) {
            root.addView(stageButton("1. Сборка по коробам", false, view -> loadBoxlessPacking()));
            root.addView(secondaryButton("Обновить заявку", view -> loadAssemblyPlan(assemblyPlan.id)));
            root.addView(secondaryButton("К списку заявок", view -> renderAssemblyListScreen()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            if (!statusMessage.isEmpty()) {
                root.addView(messageView(statusMessage));
            }
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        root.addView(stageButton("1. Поиск коробов (" + foundSearchBoxes + "/" + searchBoxes.size() + ")", isSearchDone(), view -> renderBoxSearchScreen()));
        root.addView(stageButton("2. Перемаркировка", isRelabelDone(), view -> renderRelabelScreen()));
        root.addView(stageButton("3. Перемещения", isMovementDone(), view -> renderMovementScreen()));
        if (areAssemblyStepsDone()) {
            root.addView(stageButton("4. Контроль отгрузки (" + confirmedOutgoingBoxesCount() + "/" + outgoingBoxCodes().size() + ")", areOutgoingBoxesConfirmed(), view -> renderOutgoingControlScreen()));
        }
        if (areAssemblyStepsDone() && areOutgoingBoxesConfirmed()) {
            root.addView(primaryMenuButton("Заявка упакована", view -> completeAssemblyIfReady()));
        }
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
        assemblyScanInput = null;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }
        touchAssemblyStage("box-search");

        LinearLayout root = baseRoot();
        applyScreenFeedback(root, boxSearchFeedbackColor);
        root.addView(header());
        root.addView(title("Поиск коробов"));
        List<TsdSearchBoxTask> boxes = safeSearchBoxes();
        Set<String> found = foundBoxes();
        syncFoundBoxesToServer(boxes, found);
        String lastFoundBox = lastFoundBoxCode();
        root.addView(messageView("Найдено: " + foundSearchBoxesCount(boxes, found) + " / " + boxes.size()));
        addFeedbackMessage(root, boxSearchFeedbackColor);
        assemblyScanInput = input("Сканируйте короб");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitBoxSearchScan();
            return true;
        });
        root.addView(assemblyScanInput);

        if (!lastFoundBox.isEmpty() && found.contains(lastFoundBox)) {
            for (TsdSearchBoxTask box : boxes) {
                if (lastFoundBox.equals(normalizeBoxCode(box.boxCode))) {
                    root.addView(taskRow(box.boxCode, "Найден · " + boxInstructionLabel(box), BOX_FOUND_GREEN));
                    break;
                }
            }
        }
        for (TsdSearchBoxTask box : boxes) {
            String normalizedBox = normalizeBoxCode(box.boxCode);
            if (found.contains(normalizedBox) && !normalizedBox.equals(lastFoundBox)) {
                root.addView(taskRow(box.boxCode, "Найден · " + boxInstructionLabel(box), BOX_FOUND_GREEN));
            }
        }
        for (TsdSearchBoxTask box : boxes) {
            if (!found.contains(normalizeBoxCode(box.boxCode))) {
                root.addView(taskRow(box.boxCode, "Нужно найти · " + boxInstructionLabel(box), Color.rgb(241, 245, 249)));
            }
        }

        root.addView(secondaryButton("Обновить", view -> renderBoxSearchScreen()));
        root.addView(secondaryButton("Назад", view -> renderAssemblyDetailScreen()));
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
        if (!isFflBoxCode(scannedCode)) {
            statusMessage = "Ошибка: номер короба должен начинаться с FFL.";
            boxSearchFeedbackColor = BOX_NOT_NEEDED_RED;
            assemblyScanInput.setText("");
            renderBoxSearchScreen();
            return;
        }
        Set<String> required = new LinkedHashSet<>();
        String displayCode = scannedCode;
        TsdSearchBoxTask matchedTask = null;
        for (TsdSearchBoxTask box : safeSearchBoxes()) {
            String normalizedBoxCode = normalizeBoxCode(box.boxCode);
            required.add(normalizedBoxCode);
            if (normalizedBoxCode.equals(code)) {
                displayCode = box.boxCode;
                matchedTask = box;
            }
        }
        Set<String> found = foundBoxes();
        if (!required.contains(code)) {
            statusMessage = "Короб не нужен: " + scannedCode;
            boxSearchFeedbackColor = BOX_NOT_NEEDED_RED;
        } else if (found.contains(code)) {
            statusMessage = "Повторный скан отклонен. Короб уже был пропикан: " + displayCode;
            saveLastFoundBoxCode(code);
            boxSearchFeedbackColor = BOX_DUPLICATE_BLUE;
        } else {
            found.add(code);
            Set<String> localFound = localFoundBoxes();
            localFound.add(code);
            saveStringSet(progressKey("found_boxes"), localFound);
            saveLastFoundBoxCode(code);
            statusMessage = boxInstructionLabel(matchedTask) + "\nКороб найден: " + displayCode;
            boxSearchFeedbackColor = boxInstructionColor(matchedTask);
            sendBoxSearchScan(displayCode);
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
        touchAssemblyStage("relabel");

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
        assemblyScanInput = null;
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
        String barcodeError = receiptBarcodeError(code);
        if (!barcodeError.isEmpty()) {
            statusMessage = barcodeError;
            assemblyScanInput.setText("");
            renderRelabelBoxScreen();
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
            TsdRelabelTask completedTask = activeRelabelTask;
            int done = Math.max(completedTask.doneQuantity, doneInt(relabelKey(completedTask))) + 1;
            saveDoneInt(relabelKey(completedTask), done);
            Map<String, String> progress = new LinkedHashMap<>();
            progress.put("stage", "relabel");
            progress.put("action", "relabel-complete");
            progress.put("sourceBox", completedTask.sourceBox);
            progress.put("oldBarcode", completedTask.oldBarcode);
            progress.put("newBarcode", completedTask.newBarcode);
            progress.put("size", completedTask.size == null ? "" : completedTask.size);
            enqueueAssemblyProgress(progress);
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
        assemblyScanInput = null;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }
        touchAssemblyStage("moves");

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Перемещения"));
        root.addView(messageView("Перемещения: " + doneMovementTotal() + " / " + movementTotal()));
        addFeedbackMessage(root, movementFeedbackColor);

        if (isMovementDone()) {
            renderOutgoingControlScreen();
            return;
        }

        String instruction;
        String inputHint;
        if (selectedMoveSourceBox.isEmpty()) {
            instruction = selectedMoveTargetBox.isEmpty()
                ? "Сканируйте короб, из которого нужно переместить товар."
                : "Новый короб открыт: " + selectedMoveTargetBox + ". Сканируйте следующий исходный короб.";
            inputHint = "Исходный короб";
        } else if (selectedMoveTargetBox.isEmpty()) {
            instruction = isShipmentMovementSource(selectedMoveSourceBox)
                ? "Исходный короб: " + selectedMoveSourceBox + ". Сканируйте новый короб поставки, он должен начинаться с FFL."
                : "Исходный короб: " + selectedMoveSourceBox + ". Сканируйте новый короб баланса, он должен начинаться с FFL.";
            inputHint = "Новый короб FFL";
        } else {
            instruction = "Исходный короб: " + selectedMoveSourceBox + " · новый короб: " + selectedMoveTargetBox + ". Сканируйте товар.";
            inputHint = "ШК товара";
        }
        root.addView(messageView(instruction));

        assemblyScanInput = input(inputHint);
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitMovementScan();
            return true;
        });
        root.addView(assemblyScanInput);

        if (selectedMoveSourceBox.isEmpty()) {
            root.addView(messageView("Короба, из которых нужно переместить товар:"));
            for (String sourceBox : movementSourceBoxes()) {
                boolean done = isMovementSourceDone(sourceBox);
                String purpose = isShipmentMovementSource(sourceBox) ? "в новый короб поставки" : "остаток на баланс";
                root.addView(taskRow(sourceBox, done ? "Обработан" : purpose + " · осталось: " + remainingMovementForSource(sourceBox), done ? BOX_FOUND_GREEN : Color.rgb(241, 245, 249)));
            }
        } else {
            root.addView(messageView("Что нужно переложить из этого короба:"));
            for (TsdMovementTask task : safeMovementTasks()) {
                if (!sameBox(task.sourceBox, selectedMoveSourceBox)) {
                    continue;
                }
                int remaining = remainingMovement(task);
                if (remaining > 0) {
                    String label = task.barcode + "\n" + emptyAsDash(task.name) + " · " + emptyAsDash(task.size);
                    String purpose = isShipmentMovementTask(task) ? "в новый короб поставки" : "на баланс";
                    root.addView(taskRow(label, purpose + " · осталось: " + remaining, Color.rgb(241, 245, 249)));
                }
            }
        }

        if (!selectedMoveSourceBox.isEmpty() && !selectedMoveTargetBox.isEmpty()) {
            root.addView(secondaryButton("Продолжить заполнять короб", view -> {
                selectedMoveSourceBox = "";
                movementFeedbackColor = 0;
                statusMessage = "Сканируйте следующий исходный короб для нового короба " + selectedMoveTargetBox + ".";
                renderMovementScreen();
            }));
        }
        if (!selectedMoveSourceBox.isEmpty()) {
            root.addView(secondaryButton("Выбрать другой исходный короб", view -> {
                selectedMoveSourceBox = "";
                movementFeedbackColor = 0;
                renderMovementScreen();
            }));
        }
        if (!selectedMoveTargetBox.isEmpty()) {
            root.addView(secondaryButton("Сменить новый короб", view -> {
                selectedMoveTargetBox = "";
                movementFeedbackColor = 0;
                renderMovementScreen();
            }));
        }
        root.addView(secondaryButton("Сбросить выбор", view -> {
            selectedMoveSourceBox = "";
            selectedMoveTargetBox = "";
            movementFeedbackColor = 0;
            renderMovementScreen();
        }));
        root.addView(secondaryButton("Назад", view -> renderAssemblyDetailScreen()));
        setScrollableContent(root);
        assemblyScanInput.requestFocus();
        refreshHeaderText();
    }

    private void renderOutgoingControlScreen() {
        screen = Screen.OUTGOING_CONTROL;
        assemblyScanInput = null;
        if (assemblyPlan == null) {
            renderAssemblyListScreen();
            return;
        }
        touchAssemblyStage("outgoing-control");

        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title("Контроль отгрузки"));
        addFeedbackMessage(root, movementFeedbackColor);

        if (!areAssemblyStepsDone()) {
            root.addView(messageView("Контроль отгрузки откроется после поиска коробов, перемаркировки и перемещений."));
            root.addView(secondaryButton("Назад к заявке", view -> renderAssemblyDetailScreen()));
            if (!statusMessage.isEmpty()) {
                root.addView(messageView(statusMessage));
            }
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        List<String> outgoingBoxes = outgoingBoxCodes();
        Set<String> confirmedBoxes = confirmedOutgoingBoxes();
        int confirmedCount = confirmedOutgoingBoxesCount();
        root.addView(messageView("Отпикайте все короба, которые уезжают в поставку."));
        root.addView(messageView("Короба к отгрузке: " + outgoingBoxes.size() + " · подтверждено: " + confirmedCount + " · паллет примерно: " + ((outgoingBoxes.size() + 15) / 16) + " · единиц: " + assemblyPlan.totalRequested));

        assemblyScanInput = input("Сканируйте короб к отгрузке");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitOutgoingBoxScan();
            return true;
        });
        root.addView(assemblyScanInput);

        List<String> displayBoxes = new ArrayList<>(outgoingBoxes);
        displayBoxes.sort((left, right) -> {
            boolean leftConfirmed = confirmedBoxes.contains(normalizeBoxCode(left));
            boolean rightConfirmed = confirmedBoxes.contains(normalizeBoxCode(right));
            if (leftConfirmed != rightConfirmed) {
                return leftConfirmed ? -1 : 1;
            }
            return left.compareToIgnoreCase(right);
        });

        for (String boxCode : displayBoxes) {
            boolean confirmed = confirmedBoxes.contains(normalizeBoxCode(boxCode));
            root.addView(taskRow(boxCode, confirmed ? "Подтвержден, уезжает" : "Нужно отпикать перед упаковкой", confirmed ? BOX_FOUND_GREEN : BOX_NOT_NEEDED_RED));
        }
        if (areOutgoingBoxesConfirmed()) {
            root.addView(primaryMenuButton("Заявка упакована", view -> completeAssemblyIfReady()));
        }
        root.addView(secondaryButton("Назад к заявке", view -> renderAssemblyDetailScreen()));
        setScrollableContent(root);
        if (assemblyScanInput != null) {
            assemblyScanInput.requestFocus();
        }
        refreshHeaderText();
    }

    private void submitMovementScan() {
        if (isMovementDone()) {
            renderOutgoingControlScreen();
            return;
        }

        String code = textValue(assemblyScanInput);
        if (code.isEmpty() || assemblyPlan == null) {
            return;
        }

        if (selectedMoveSourceBox.isEmpty()) {
            String sourceBox = displayMovementSourceBox(code);
            if (sourceBox.isEmpty()) {
                statusMessage = "Этот короб не участвует в перемещении: " + code;
                movementFeedbackColor = BOX_NOT_NEEDED_RED;
                assemblyScanInput.setText("");
                renderMovementScreen();
                return;
            }
            if (isMovementSourceDone(sourceBox)) {
                statusMessage = "Этот короб уже обработан: " + sourceBox;
                movementFeedbackColor = BOX_DUPLICATE_BLUE;
                assemblyScanInput.setText("");
                renderMovementScreen();
                return;
            }
            selectedMoveSourceBox = sourceBox;
            movementFeedbackColor = 0;
            statusMessage = isShipmentMovementSource(sourceBox)
                ? "Исходный короб выбран: " + sourceBox + ". Сканируйте новый короб поставки."
                : "Исходный короб выбран: " + sourceBox + ". Сканируйте новый короб баланса.";
            assemblyScanInput.setText("");
            renderMovementScreen();
            return;
        }

        if (selectedMoveTargetBox.isEmpty()) {
            if (!isFflBoxCode(code)) {
                statusMessage = "Ошибка: номер нового короба должен начинаться с FFL.";
                movementFeedbackColor = BOX_NOT_NEEDED_RED;
                assemblyScanInput.setText("");
                renderMovementScreen();
                return;
            }
            selectedMoveTargetBox = code;
            if (isShipmentMovementSource(selectedMoveSourceBox)) {
                rememberOutgoingShipmentBox(code);
            } else {
                rememberMovementTargetBox(code);
            }
            movementFeedbackColor = 0;
            statusMessage = "Новый короб выбран: " + code + ". Сканируйте товар из " + selectedMoveSourceBox + ".";
            assemblyScanInput.setText("");
            renderMovementScreen();
            return;
        }

        String barcodeError = receiptBarcodeError(code);
        if (!barcodeError.isEmpty()) {
            statusMessage = barcodeError;
            movementFeedbackColor = BOX_NOT_NEEDED_RED;
            assemblyScanInput.setText("");
            renderMovementScreen();
            return;
        }

        for (TsdMovementTask task : safeMovementTasks()) {
            if (sameBox(task.sourceBox, selectedMoveSourceBox) && remainingMovement(task) > 0 && code.equals(task.barcode)) {
                String sourceBox = selectedMoveSourceBox;
                String targetBox = selectedMoveTargetBox;
                TsdSession session = safeSession();
                runBackground(() -> {
                    outbox.enqueueMove(
                        assemblyPlan.client.id,
                        assemblyPlan.id,
                        task.barcode,
                        sourceBox,
                        targetBox,
                        1,
                        "AVAILABLE",
                        "Перемещение по заявке " + assemblyPlan.title
                    );
                    TsdSyncSummary summary = null;
                    if (session != null) {
                        WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
                        summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                            .syncPending(session.authorizationHeader());
                    }
                    TsdSyncSummary finalSummary = summary;
                    TsdAssemblyPlan freshPlan = null;
                    if (session != null && summary != null && summary.retried == 0) {
                        Response<TsdAssemblyPlan> planResponse = WmsApiFactory.create(DEFAULT_BASE_URL)
                            .getAssemblyRequest(session.authorizationHeader(), assemblyPlan.id)
                            .execute();
                        if (planResponse.isSuccessful()) freshPlan = planResponse.body();
                    }
                    TsdAssemblyPlan finalFreshPlan = freshPlan;
                    mainHandler.post(() -> {
                        if (finalFreshPlan != null) assemblyPlan = finalFreshPlan;
                        boolean rejected = finalSummary != null && finalSummary.rejected > 0;
                        int done = doneInt(movementKey(task));
                        if (!rejected) {
                            done += 1;
                            saveDoneInt(movementKey(task), done);
                        }
                        movementFeedbackColor = 0;
                        online = finalSummary == null || finalSummary.retried == 0;
                        statusMessage = finalSummary == null || finalSummary.rejected > 0 || finalSummary.retried > 0
                            ? "Товар перемещен локально: " + done + " / " + task.quantity + ". Проверьте очередь: отправлено " +
                                (finalSummary == null ? 0 : finalSummary.sent) + ", принято " +
                                (finalSummary == null ? 0 : finalSummary.applied) + ", отклонено " +
                                (finalSummary == null ? 0 : finalSummary.rejected) + ", на повтор " +
                                (finalSummary == null ? 0 : finalSummary.retried) + "."
                            : "Товар перемещен и записан в WMS: " + done + " / " + task.quantity;
                        if (isMovementSourceDone(sourceBox)) {
                            statusMessage = "Исходный короб обработан: " + sourceBox + ". Можно продолжить заполнять новый короб или выбрать другой.";
                        }
                        refreshQueue(null);
                        renderMovementScreen();
                    });
                });
                return;
            }
        }

        statusMessage = "Этот товар не нужен из короба " + selectedMoveSourceBox + ": " + code;
        movementFeedbackColor = BOX_NOT_NEEDED_RED;
        assemblyScanInput.setText("");
        renderMovementScreen();
    }

    private void submitOutgoingBoxScan() {
        String code = textValue(assemblyScanInput);
        if (code.isEmpty() || assemblyPlan == null) {
            return;
        }

        String normalizedCode = normalizeBoxCode(code);
        if (!isFflBoxCode(code)) {
            statusMessage = "Ошибка: номер короба к отгрузке должен начинаться с FFL.";
            movementFeedbackColor = BOX_NOT_NEEDED_RED;
            assemblyScanInput.setText("");
            renderOutgoingControlScreen();
            return;
        }

        String matchedBox = "";
        for (String boxCode : outgoingBoxCodes()) {
            if (sameBox(boxCode, code)) {
                matchedBox = boxCode;
                break;
            }
        }

        if (matchedBox.isEmpty()) {
            statusMessage = "Этот короб не входит в отгрузку: " + code;
            movementFeedbackColor = BOX_NOT_NEEDED_RED;
            assemblyScanInput.setText("");
            renderOutgoingControlScreen();
            return;
        }

        Set<String> confirmed = stringSet(progressKey("outgoing_confirmed_boxes"));
        if (confirmed.contains(normalizedCode)) {
            statusMessage = "Короб уже подтвержден к отгрузке: " + matchedBox;
            movementFeedbackColor = BOX_DUPLICATE_BLUE;
            assemblyScanInput.setText("");
            renderOutgoingControlScreen();
            return;
        }

        confirmed.add(normalizedCode);
        saveStringSet(progressKey("outgoing_confirmed_boxes"), confirmed);
        Map<String, String> progress = new LinkedHashMap<>();
        progress.put("stage", "outgoing-control");
        progress.put("action", "outgoing-confirm");
        progress.put("boxCode", matchedBox);
        enqueueAssemblyProgress(progress);
        movementFeedbackColor = BOX_FOUND_GREEN;
        statusMessage = "Короб к отгрузке подтвержден: " + matchedBox;
        assemblyScanInput.setText("");
        renderOutgoingControlScreen();
    }

    private void completeAssemblyIfReady() {
        if (assemblyPlan == null || isAssemblyPackedOnServer() || !areAssemblyStepsDone()) {
            return;
        }
        if (!areOutgoingBoxesConfirmed()) {
            statusMessage = "Сначала отпикайте все короба, которые уезжают в поставку.";
            renderOutgoingControlScreen();
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
        int boxes = outgoingBoxCodes().size();
        int pallets = boxes <= 0 ? 0 : (boxes + 15) / 16;
        int packedUnits = Math.max(0, assemblyPlan.totalRequested);
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
            payload.put("pallets", pallets);
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
        receiptKizBoxes.clear();
        receiptFeedbackColor = 0;
        statusMessage = receiptWithoutBoxes()
            ? "Клиент выбран. Сканируйте ШК товара."
            : "Клиент выбран. Сканируйте новый короб.";
        renderReceiptScreen();
    }

    private void openReceiptBoxFromInput() {
        if (receiptBoxAutoOpenTask != null) {
            mainHandler.removeCallbacks(receiptBoxAutoOpenTask);
            receiptBoxAutoOpenTask = null;
        }
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
        if (!isFflBoxCode(boxCode)) {
            statusMessage = "Ошибка: номер короба должен начинаться с FFL.";
            boxCodeInput.setText("");
            renderReceiptScreen();
            return;
        }
        if (receiptSessionBoxes.contains(normalizedBox)) {
            statusMessage = "Этот короб уже использовался в текущей приемке.";
            renderReceiptScreen();
            return;
        }
        if (receiptOpeningBox) {
            return;
        }

        receiptOpeningBox = true;
        receiptBoxCode = boxCode;
        receiptCurrentItems.clear();
        clearPendingReceiptProductFields();
        receiptFeedbackColor = 0;
        statusMessage = "Короб открыт. Сканируйте товар.";
        renderReceiptScreen();

        executor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("clientId", receiptClientId);
                payload.put("boxCode", boxCode);
                payload.put("sourceDocument", receiptSourceDocument);
                Response<Map<String, Object>> response = api.openReceiptBox(session.authorizationHeader(), payload).execute();
                if (!response.isSuccessful()) {
                    mainHandler.post(() -> {
                        online = false;
                        receiptOpeningBox = false;
                        statusMessage = "Короб не открыт в WMS: HTTP " + response.code();
                        if (sameBox(receiptBoxCode, boxCode) && receiptCurrentItems.isEmpty()) {
                            receiptBoxCode = "";
                            clearPendingReceiptProductFields();
                        }
                        renderReceiptScreen();
                    });
                    return;
                }
                mainHandler.post(() -> {
                    online = true;
                    receiptOpeningBox = false;
                    if (sameBox(receiptBoxCode, boxCode)) {
                        statusMessage = "Короб открыт в WMS. Сканируйте товар.";
                        refreshHeaderText();
                    }
                });
            } catch (Throwable error) {
                mainHandler.post(() -> {
                    online = false;
                    receiptOpeningBox = false;
                    statusMessage = error.getMessage() == null ? "Короб не открыт в WMS." : error.getMessage();
                    if (sameBox(receiptBoxCode, boxCode) && receiptCurrentItems.isEmpty()) {
                        receiptBoxCode = "";
                        clearPendingReceiptProductFields();
                    }
                    renderReceiptScreen();
                });
            }
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
        String barcodeError = receiptBarcodeError(barcode);
        if (!barcodeError.isEmpty()) {
            statusMessage = barcodeError;
            scanInput.setText("");
            renderReceiptScreen();
            return;
        }
        receiptFeedbackColor = 0;

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
                    addReceiptItem(barcode, null, null, "Товар не найден. Создается черновик без обязательного КИЗ.");
                });
                return;
            }
            throw new IOException("Не удалось проверить товар: HTTP " + response.code());
        });
    }

    private void handleReceiptKizScan() {
        if (receiptCheckingKiz) {
            return;
        }
        String kiz = textValue(scanInput);
        if (kiz.isEmpty()) {
            statusMessage = "Сканируйте КИЗ.";
            renderReceiptScreen();
            return;
        }
        String kizError = receiptKizError(kiz);
        if (!kizError.isEmpty()) {
            statusMessage = kizError;
            scanInput.setText("");
            renderReceiptScreen();
            return;
        }
        String normalizedKiz = kiz.trim().toUpperCase(Locale.ROOT);
        if (receiptKizValues.contains(normalizedKiz)) {
            String duplicateBox = receiptKizBoxes.get(normalizedKiz);
            statusMessage = duplicateKizMessage(kiz, duplicateBox, true);
            receiptFeedbackColor = BOX_NOT_NEEDED_RED;
            scanInput.setText("");
            renderReceiptScreen();
            return;
        }

        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Сначала войдите на ТСД.";
            renderSettingsScreen();
            return;
        }

        String barcode = pendingReceiptBarcode;
        TsdSkuInfo sku = pendingReceiptSku;
        receiptCheckingKiz = true;
        if (scanInput != null) {
            scanInput.setEnabled(false);
        }
        executor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
                Response<TsdKizCheckResponse> response = api
                    .checkReceiptKiz(session.authorizationHeader(), receiptClientId, kiz)
                    .execute();
                if (!response.isSuccessful() || response.body() == null) {
                    throw new IOException("HTTP " + response.code());
                }
                TsdKizCheckResponse result = response.body();
                mainHandler.post(() -> {
                    receiptCheckingKiz = false;
                    online = true;
                    if (result.duplicate) {
                        statusMessage = result.message == null || result.message.trim().isEmpty()
                            ? duplicateKizMessage(kiz, result.boxCode, false)
                            : result.message + "\nКИЗ: " + kiz;
                        receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                        renderReceiptScreen();
                        return;
                    }
                    addReceiptItem(barcode, kiz, sku);
                });
            } catch (Throwable error) {
                mainHandler.post(() -> {
                    receiptCheckingKiz = false;
                    online = false;
                    addReceiptItem(
                        barcode,
                        kiz,
                        sku,
                        "Товар принят офлайн. КИЗ будет повторно проверен при синхронизации с WMS."
                    );
                });
            }
        });
    }

    private void addReceiptItem(String barcode, String kiz, TsdSkuInfo sku) {
        addReceiptItem(barcode, kiz, sku, null);
    }

    private void addReceiptItem(String barcode, String kiz, TsdSkuInfo sku, String message) {
        if (receiptWithoutBoxes()) {
            enqueueUnboxedReceiptItem(barcode, kiz, sku, message);
            return;
        }
        receiptCurrentItems.add(new ReceiptItem(barcode, kiz, sku == null ? null : sku.name));
        if (kiz != null && !kiz.trim().isEmpty()) {
            String normalizedKiz = kiz.trim().toUpperCase(Locale.ROOT);
            receiptKizValues.add(normalizedKiz);
            receiptKizBoxes.put(normalizedKiz, receiptBoxCode);
        }
        clearPendingReceiptProductFields();
        receiptFeedbackColor = 0;
        statusMessage = message == null
            ? "Товар добавлен в короб: " + barcode + ". В коробе: " + receiptCurrentItems.size()
            : message;
        renderReceiptScreen();
    }

    private void enqueueUnboxedReceiptItem(String barcode, String kiz, TsdSkuInfo sku, String message) {
        TsdSession session = safeSession();
        if (outbox == null || session == null) {
            statusMessage = "Локальная очередь приемки недоступна.";
            renderReceiptScreen();
            return;
        }
        if (kiz != null && !kiz.trim().isEmpty()) {
            String normalizedKiz = kiz.trim().toUpperCase(Locale.ROOT);
            receiptKizValues.add(normalizedKiz);
            receiptKizBoxes.put(normalizedKiz, "Без короба");
        }
        clearPendingReceiptProductFields();
        outbox.enqueueReceipt(
            receiptClientId,
            barcode,
            kiz,
            null,
            1,
            "AVAILABLE",
            receiptSourceDocument,
            "Поштучная приемка ТСД без коробов"
        );
        statusMessage = message == null ? "Товар добавлен: " + barcode : message;
        renderReceiptScreen();

        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending(session.authorizationHeader());
            mainHandler.post(() -> {
                online = summary.retried == 0;
                if (summary.rejected > 0) {
                    receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                    statusMessage = "ОШИБКА ПРИЕМКИ\n" + summary.message;
                } else {
                    receiptAcceptedItems += 1;
                    receiptFeedbackColor = 0;
                    statusMessage = summary.retried > 0
                        ? "Товар сохранен в очереди и будет передан в WMS после восстановления связи."
                        : "Товар принят в WMS: " + barcode;
                }
                renderReceiptScreen();
                refreshQueue(null);
            });
        });
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
        receiptCheckingKiz = false;
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
                receiptClosedBoxes += summary.rejected == 0 ? 1 : 0;
                receiptAcceptedItems += summary.applied;
                receiptSessionBoxes.add(normalizeBoxCode(closedBoxCode));
                receiptBoxCode = "";
                receiptCurrentItems.clear();
                clearPendingReceiptProductFields();
                receiptFeedbackColor = summary.rejected > 0 ? BOX_NOT_NEEDED_RED : 0;
                if (summary.rejected > 0) {
                    statusMessage = "ДУБЛЬ КИЗ / ОШИБКА ПРИЕМКИ\n" + summary.message + "\nКороб: " + closedBoxCode;
                } else if (summary.retried > 0) {
                    statusMessage = "Короб сохранен в очереди: " + closedBoxCode + ". КИЗ будут проверены при синхронизации.";
                } else {
                    statusMessage = "Короб закрыт и записан в WMS: " + closedBoxCode;
                }
                renderReceiptScreen();
                refreshQueue(null);
            });
        });
    }

    private void finishReceipt() {
        if (!receiptBoxCode.isEmpty() && !receiptCurrentItems.isEmpty()) {
            statusMessage = "Сначала закройте текущий короб.";
            renderReceiptScreen();
            return;
        }
        String summary = receiptWithoutBoxes()
            ? "Приемка закрыта. Товаров: " + receiptAcceptedItems + "."
            : "Приемка закрыта. Коробов: " + receiptClosedBoxes + ", товаров: " + receiptAcceptedItems + ".";
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
        receiptKizBoxes.clear();
        receiptCheckingKiz = false;
        receiptFeedbackColor = 0;
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
                    if (screen == Screen.FBS_ASSEMBLY) {
                        showFbsError(
                            tr(
                                "Нет связи с WMS. Проверьте интернет и повторите.",
                                "WMS bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring."
                            ),
                            false
                        );
                        return;
                    }
                    if (screen == Screen.FBS_CARGO) {
                        showFbsCargoError(
                            tr(
                                "Нет связи с WMS. Проверьте интернет и повторите.",
                                "WMS bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring."
                            ),
                            false
                        );
                        return;
                    }
                    online = false;
                    statusMessage = error.getMessage() == null ? "Ошибка приложения" : error.getMessage();
                    refreshCurrentScreen();
                });
            }
        });
    }

    private void runSilentBackground(ThrowingRunnable task) {
        executor.execute(() -> {
            try {
                task.run();
            } catch (Throwable ignored) {
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
        phoneCameraTarget = activePhoneCameraTarget();
        if (phoneMode && phoneCameraTarget != null) {
            root.addView(primaryMenuButton(
                tr("Сканировать камерой телефона", "Telefon kamerasi bilan skanerlash"),
                view -> startPhoneCameraScan()
            ));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        scroll.addView(root);
        setContentView(scroll);
    }

    private void togglePhoneMode() {
        phoneMode = !phoneMode;
        uiStore.edit().putBoolean("phone_mode", phoneMode).apply();
        statusMessage = phoneMode
            ? tr(
                "Режим телефона включён. На рабочих экранах используйте кнопку сканирования камерой.",
                "Telefon rejimi yoqildi. Ish ekranlarida kamera orqali skanerlash tugmasidan foydalaning."
            )
            : tr("Режим аппаратного ТСД включён.", "Apparat TSD rejimi yoqildi.");
        renderMainScreen();
    }

    private EditText activePhoneCameraTarget() {
        if (screen == Screen.RECEIPT || screen == Screen.BOXLESS_PACKING) {
            return scanInput;
        }
        if (screen == Screen.FBS_ASSEMBLY) {
            return fbsScanInput;
        }
        if (screen == Screen.FBS_CARGO) {
            return fbsCargoScanInput;
        }
        if (
            screen == Screen.BOX_SEARCH ||
            screen == Screen.RELABEL_BOX ||
            screen == Screen.MOVEMENTS ||
            screen == Screen.OUTGOING_CONTROL
        ) {
            return assemblyScanInput;
        }
        if (screen == Screen.INVENTORY_COUNT) {
            if (inventoryTransferMode && inventoryTransferTargetInput != null) {
                return inventoryTransferTargetInput;
            }
            return activeInventoryBox == null ? inventoryBoxInput : inventoryItemInput;
        }
        return null;
    }

    private void startPhoneCameraScan() {
        if (phoneCameraTarget == null) {
            statusMessage = tr("На этом экране нет активного поля сканирования.", "Bu ekranda faol skanerlash maydoni yo‘q.");
            refreshCurrentScreen();
            return;
        }
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            statusMessage = tr("На устройстве не найдена камера.", "Qurilmada kamera topilmadi.");
            refreshCurrentScreen();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            return;
        }
        openPhoneCameraDialog();
    }

    private void openPhoneCameraDialog() {
        if (phoneScannerDialog != null && phoneScannerDialog.isShowing()) {
            return;
        }
        try {
            Dialog dialog = new Dialog(this);
            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(dp(12), dp(12), dp(12), dp(12));
            content.setBackgroundColor(Color.BLACK);

            DecoratedBarcodeView barcodeView = new DecoratedBarcodeView(this);
            barcodeView.setStatusText(tr(
                "Наведите камеру на штрихкод или КИЗ",
                "Kamerani shtrix-kod yoki KIZga qarating"
            ));
            content.addView(
                barcodeView,
                new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            );

            Button closeButton = secondaryButton(tr("Закрыть камеру", "Kamerani yopish"), view -> dialog.dismiss());
            content.addView(closeButton);
            dialog.setContentView(content);
            dialog.setCancelable(true);
            dialog.setOnDismissListener(ignored -> {
                barcodeView.pause();
                phoneBarcodeView = null;
                phoneScannerDialog = null;
            });

            phoneScannerDialog = dialog;
            phoneBarcodeView = barcodeView;
            barcodeView.decodeSingle(new BarcodeCallback() {
                @Override
                public void barcodeResult(BarcodeResult result) {
                    String scanned = result == null ? null : result.getText();
                    if (scanned == null || scanned.trim().isEmpty()) {
                        return;
                    }
                    EditText target = phoneCameraTarget;
                    dialog.dismiss();
                    if (target == null) {
                        return;
                    }
                    target.setText(scanned);
                    target.setSelection(target.length());
                    submitPhoneCameraScan();
                }

                @Override
                public void possibleResultPoints(List<com.google.zxing.ResultPoint> resultPoints) {
                    // Preview hints are intentionally ignored.
                }
            });
            dialog.show();
            Window window = dialog.getWindow();
            if (window != null) {
                window.setLayout(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT);
            }
            barcodeView.resume();
        } catch (Throwable error) {
            if (phoneScannerDialog != null) {
                phoneScannerDialog.dismiss();
            }
            phoneBarcodeView = null;
            phoneScannerDialog = null;
            statusMessage = tr(
                "Камера временно недоступна. Закройте другие приложения с камерой и повторите.",
                "Kamera vaqtincha ishlamayapti. Kameradan foydalanayotgan boshqa ilovalarni yoping va qayta urinib ko‘ring."
            );
            refreshCurrentScreen();
        }
    }

    private void submitPhoneCameraScan() {
        if (screen == Screen.RECEIPT) {
            submitReceiptInput();
        } else if (screen == Screen.BOX_SEARCH) {
            submitBoxSearchScan();
        } else if (screen == Screen.RELABEL_BOX) {
            submitRelabelScan();
        } else if (screen == Screen.MOVEMENTS) {
            submitMovementScan();
        } else if (screen == Screen.OUTGOING_CONTROL) {
            submitOutgoingBoxScan();
        } else if (screen == Screen.BOXLESS_PACKING && boxlessPacking != null && boxlessPacking.packingProgress != null) {
            TsdBoxlessPackingResponse.PackingBox currentBox = currentBoxlessPackingBox(boxlessPacking.packingProgress);
            if (currentBox == null) {
                sendBoxlessPackingAction("open-box", textValue(scanInput), null);
            } else {
                sendBoxlessPackingAction("scan-item", textValue(scanInput), currentBox.boxCode);
            }
        } else if (screen == Screen.FBS_ASSEMBLY) {
            submitFbsScan();
        } else if (screen == Screen.FBS_CARGO) {
            submitFbsCargoScan();
        } else if (screen == Screen.INVENTORY_COUNT) {
            if (inventoryTransferMode) {
                transferInventoryBox();
            } else if (activeInventoryBox == null) {
                openInventoryBox();
            } else {
                scanInventoryItem();
            }
        }
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

    private void addFeedbackMessage(LinearLayout root, int backgroundColor) {
        if (!statusMessage.isEmpty()) {
            root.addView(feedbackView(statusMessage, backgroundColor));
        }
    }

    private TextView feedbackView(String text, int backgroundColor) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(TEXT);
        view.setTextSize(16f);
        view.setTypeface(null, 1);
        view.setBackgroundColor(backgroundColor == 0 ? Color.rgb(241, 245, 249) : backgroundColor);
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(10));
        view.setLayoutParams(params);
        return view;
    }

    private void applyScreenFeedback(LinearLayout root, int backgroundColor) {
        if (backgroundColor != 0) {
            root.setBackgroundColor(backgroundColor);
        }
    }

    private String boxInstructionLabel(TsdSearchBoxTask box) {
        if (box != null && box.instructionLabel != null && !box.instructionLabel.trim().isEmpty()) {
            return box.instructionLabel.trim().toUpperCase(Locale.ROOT);
        }
        boolean relabel = boxRequiresRelabel(box);
        boolean movement = boxRequiresMovement(box);
        if (relabel && movement) {
            return "МАРК+ПЕРЕМЕЩЕНИЕ";
        }
        if (relabel) {
            return "ПЕРЕМАРКИРОВКА";
        }
        if (movement) {
            return "ПЕРЕМЕЩЕНИЕ";
        }
        return "ЦЕЛИКОМ";
    }

    private int boxInstructionColor(TsdSearchBoxTask box) {
        boolean relabel = boxRequiresRelabel(box);
        boolean movement = boxRequiresMovement(box);
        if (relabel && movement) {
            return BOX_RELABEL_MOVEMENT_CYAN;
        }
        if (relabel) {
            return BOX_RELABEL_PURPLE;
        }
        if (movement) {
            return BOX_MOVEMENT_BLUE;
        }
        return BOX_FOUND_GREEN;
    }

    private boolean boxRequiresRelabel(TsdSearchBoxTask box) {
        if (box == null) {
            return false;
        }
        if (box.requiresRelabel || "RELABEL".equals(box.instructionType) || "RELABEL_MOVEMENT".equals(box.instructionType)) {
            return true;
        }
        for (TsdRelabelTask task : safeRelabelTasks()) {
            if (sameBox(task.sourceBox, box.boxCode)) {
                return true;
            }
        }
        return false;
    }

    private boolean boxRequiresMovement(TsdSearchBoxTask box) {
        if (box == null) {
            return false;
        }
        if (box.requiresMovement || "MOVEMENT".equals(box.instructionType) || "RELABEL_MOVEMENT".equals(box.instructionType)) {
            return true;
        }
        for (TsdMovementTask task : safeMovementTasks()) {
            if (sameBox(task.sourceBox, box.boxCode)) {
                return true;
            }
        }
        if (assemblyPlan != null && assemblyPlan.movementProgress != null && assemblyPlan.movementProgress.rows != null) {
            for (TsdAssemblyPlan.TsdMovementProgressRow row : assemblyPlan.movementProgress.rows) {
                if (sameBox(row.sourceBox, box.boxCode)) {
                    return true;
                }
            }
        }
        return false;
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

    private Set<String> movementSourceBoxes() {
        Set<String> boxes = new LinkedHashSet<>();
        if (assemblyPlan != null && assemblyPlan.movementProgress != null && assemblyPlan.movementProgress.sourceBoxes != null) {
            for (TsdAssemblyPlan.TsdMovementSourceBox box : assemblyPlan.movementProgress.sourceBoxes) {
                if (box.sourceBox != null && !box.sourceBox.trim().isEmpty()) {
                    boxes.add(box.sourceBox);
                }
            }
        }
        for (TsdMovementTask task : safeMovementTasks()) {
            if (task.sourceBox != null && !task.sourceBox.trim().isEmpty()) {
                boxes.add(task.sourceBox);
            }
        }
        return boxes;
    }

    private String displayMovementSourceBox(String scannedBox) {
        String normalized = normalizeBoxCode(scannedBox);
        if (normalized.isEmpty()) {
            return "";
        }
        for (String sourceBox : movementSourceBoxes()) {
            if (normalizeBoxCode(sourceBox).equals(normalized)) {
                return sourceBox;
            }
        }
        return "";
    }

    private boolean sameBox(String left, String right) {
        String normalizedLeft = normalizeBoxCode(left);
        String normalizedRight = normalizeBoxCode(right);
        return !normalizedLeft.isEmpty() && normalizedLeft.equals(normalizedRight);
    }

    private int remainingMovementForSource(String sourceBox) {
        int remaining = 0;
        for (TsdMovementTask task : safeMovementTasks()) {
            if (sameBox(task.sourceBox, sourceBox)) {
                remaining += Math.max(0, remainingMovement(task));
            }
        }
        TsdAssemblyPlan.TsdMovementSourceBox server = serverMovementSource(sourceBox);
        if (server != null) {
            int serverRemaining = Math.max(0, server.remainingQuantity);
            return remaining <= 0 ? serverRemaining : Math.min(remaining, serverRemaining);
        }
        return remaining;
    }

    private boolean isMovementSourceDone(String sourceBox) {
        TsdAssemblyPlan.TsdMovementSourceBox server = serverMovementSource(sourceBox);
        if (server != null && server.done) {
            return true;
        }
        return remainingMovementForSource(sourceBox) <= 0;
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
        for (TsdSearchBoxTask box : safeSearchBoxes()) {
            if (box.found || box.isFound) {
                String code = normalizeBoxCode(box.boxCode);
                if (!code.isEmpty()) {
                    normalized.add(code);
                }
            }
        }
        if (assemblyPlan != null && assemblyPlan.foundBoxCodes != null) {
            for (String value : assemblyPlan.foundBoxCodes) {
                String code = normalizeBoxCode(value);
                if (!code.isEmpty()) {
                    normalized.add(code);
                }
            }
        }
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

    private void syncFoundBoxesToServer(List<TsdSearchBoxTask> boxes, Set<String> found) {
        if (boxes.isEmpty() || found.isEmpty()) {
            return;
        }
        Set<String> localFound = localFoundBoxes();
        if (localFound.isEmpty()) {
            return;
        }
        Set<String> synced = stringSet(progressKey("found_boxes_synced"));
        boolean changed = false;
        for (TsdSearchBoxTask box : boxes) {
            String normalizedBoxCode = normalizeBoxCode(box.boxCode);
            if (found.contains(normalizedBoxCode) && localFound.contains(normalizedBoxCode) && !synced.contains(normalizedBoxCode)) {
                synced.add(normalizedBoxCode);
                changed = true;
                sendBoxSearchScan(box.boxCode);
            }
        }
        if (changed) {
            saveStringSet(progressKey("found_boxes_synced"), synced);
        }
    }

    private Set<String> localFoundBoxes() {
        Set<String> normalized = new LinkedHashSet<>();
        for (String value : stringSet(progressKey("found_boxes"))) {
            String code = normalizeBoxCode(value);
            if (!code.isEmpty()) {
                normalized.add(code);
            }
        }
        return normalized;
    }

    private String lastFoundBoxCode() {
        if (progressStore == null) {
            return "";
        }
        return normalizeBoxCode(progressStore.getString(progressKey("last_found_box"), ""));
    }

    private void saveLastFoundBoxCode(String boxCode) {
        if (progressStore != null) {
            progressStore.edit().putString(progressKey("last_found_box"), normalizeBoxCode(boxCode)).apply();
        }
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

    private boolean isShipmentMovementTask(TsdMovementTask task) {
        String purpose = task.purpose == null ? "" : task.purpose.trim().toUpperCase(Locale.ROOT);
        String targetRole = task.targetRole == null ? "" : task.targetRole.trim().toUpperCase(Locale.ROOT);
        if ("SHIPMENT".equals(purpose) || "SHIPMENT".equals(targetRole)) {
            return true;
        }
        String note = task.note == null ? "" : task.note.toLowerCase(Locale.ROOT);
        return note.contains("постав");
    }

    private boolean isShipmentMovementSource(String sourceBox) {
        for (TsdMovementTask task : safeMovementTasks()) {
            if (sameBox(task.sourceBox, sourceBox) && remainingMovement(task) > 0 && isShipmentMovementTask(task)) {
                return true;
            }
        }
        return false;
    }

    private void rememberOutgoingShipmentBox(String boxCode) {
        String targetBox = boxCode == null ? "" : boxCode.trim();
        if (normalizeBoxCode(targetBox).isEmpty()) {
            return;
        }
        Set<String> targets = stringSet(progressKey("outgoing_movement_boxes"));
        targets.add(targetBox);
        saveStringSet(progressKey("outgoing_movement_boxes"), targets);
    }

    private List<String> outgoingBoxCodes() {
        Map<String, String> boxes = new LinkedHashMap<>();
        addOutgoingBoxes(boxes, assemblyPlan == null ? null : assemblyPlan.shipmentBoxes);
        addOutgoingBoxes(boxes, assemblyPlan == null ? null : assemblyPlan.outgoingBoxes);
        addOutgoingBoxStrings(boxes, assemblyPlan == null ? null : assemblyPlan.shipmentBoxCodes);
        addOutgoingBoxStrings(boxes, assemblyPlan == null ? null : assemblyPlan.outgoingBoxCodes);
        addOutgoingBoxStrings(boxes, stringSet(progressKey("outgoing_movement_boxes")));

        if (boxes.isEmpty()) {
            for (TsdSearchBoxTask box : safeSearchBoxes()) {
                addOutgoingBox(boxes, box.boxCode);
            }
        }

        return new ArrayList<>(boxes.values());
    }

    private void addOutgoingBoxes(Map<String, String> boxes, List<TsdSearchBoxTask> values) {
        if (values == null) {
            return;
        }
        for (TsdSearchBoxTask box : values) {
            addOutgoingBox(boxes, box.boxCode);
        }
    }

    private void addOutgoingBoxStrings(Map<String, String> boxes, Iterable<String> values) {
        if (values == null) {
            return;
        }
        for (String boxCode : values) {
            addOutgoingBox(boxes, boxCode);
        }
    }

    private void addOutgoingBox(Map<String, String> boxes, String boxCode) {
        String normalized = normalizeBoxCode(boxCode);
        if (!normalized.isEmpty() && !boxes.containsKey(normalized)) {
            boxes.put(normalized, boxCode == null ? normalized : boxCode.trim());
        }
    }

    private Set<String> confirmedOutgoingBoxes() {
        Set<String> result = new LinkedHashSet<>();
        if (assemblyPlan != null && assemblyPlan.confirmedOutgoingBoxCodes != null) {
            for (String value : assemblyPlan.confirmedOutgoingBoxCodes) {
                String normalized = normalizeBoxCode(value);
                if (!normalized.isEmpty()) result.add(normalized);
            }
        }
        for (String value : stringSet(progressKey("outgoing_confirmed_boxes"))) {
            String normalized = normalizeBoxCode(value);
            if (!normalized.isEmpty()) {
                result.add(normalized);
            }
        }
        return result;
    }

    private int confirmedOutgoingBoxesCount() {
        Set<String> confirmed = confirmedOutgoingBoxes();
        int count = 0;
        for (String boxCode : outgoingBoxCodes()) {
            if (confirmed.contains(normalizeBoxCode(boxCode))) {
                count += 1;
            }
        }
        return count;
    }

    private boolean areOutgoingBoxesConfirmed() {
        List<String> boxes = outgoingBoxCodes();
        return confirmedOutgoingBoxesCount() >= boxes.size();
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
            total += Math.min(task.quantity, Math.max(task.doneQuantity, doneInt(relabelKey(task))));
        }
        return total;
    }

    private int remainingRelabel(TsdRelabelTask task) {
        return Math.max(0, task.quantity - Math.max(task.doneQuantity, doneInt(relabelKey(task))));
    }

    private String relabelKey(TsdRelabelTask task) {
        return progressKey("relabel:" + task.sourceBox + "|" + task.oldBarcode + "|" + task.newBarcode + "|" + task.size);
    }

    private int movementTotal() {
        if (assemblyPlan != null && assemblyPlan.movementProgress != null && assemblyPlan.movementProgress.totalRequired > 0) {
            return assemblyPlan.movementProgress.totalRequired;
        }
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
        return Math.max(total, serverMovedTotal());
    }

    private int remainingMovement(TsdMovementTask task) {
        int done = Math.max(doneInt(movementKey(task)), serverMovedForTask(task));
        return Math.max(0, task.quantity - done);
    }

    private int serverMovedTotal() {
        return assemblyPlan == null || assemblyPlan.movementProgress == null ? 0 : Math.max(0, assemblyPlan.movementProgress.totalMoved);
    }

    private int serverMovedForTask(TsdMovementTask task) {
        if (assemblyPlan == null || assemblyPlan.movementProgress == null || assemblyPlan.movementProgress.rows == null) {
            return 0;
        }
        int moved = 0;
        for (TsdAssemblyPlan.TsdMovementProgressRow row : assemblyPlan.movementProgress.rows) {
            if (matchesMovementRow(task, row)) {
                moved = Math.max(moved, row.movedQuantity);
            }
        }
        return moved;
    }

    private boolean matchesMovementRow(TsdMovementTask task, TsdAssemblyPlan.TsdMovementProgressRow row) {
        if (!sameBox(task.sourceBox, row.sourceBox)) {
            return false;
        }
        if (!sameNullableText(task.barcode, row.barcode) || !sameNullableText(task.size, row.size)) {
            return false;
        }
        String taskTarget = normalizeBoxCode(task.targetBox);
        String rowTarget = normalizeBoxCode(row.targetBox);
        if (!taskTarget.isEmpty()) {
            return taskTarget.equals(rowTarget);
        }
        return sameNullableText(task.purpose, row.purpose) && sameNullableText(task.targetRole, row.targetRole);
    }

    private TsdAssemblyPlan.TsdMovementSourceBox serverMovementSource(String sourceBox) {
        if (assemblyPlan == null || assemblyPlan.movementProgress == null || assemblyPlan.movementProgress.sourceBoxes == null) {
            return null;
        }
        for (TsdAssemblyPlan.TsdMovementSourceBox box : assemblyPlan.movementProgress.sourceBoxes) {
            if (sameBox(box.sourceBox, sourceBox)) {
                return box;
            }
        }
        return null;
    }

    private boolean sameNullableText(String left, String right) {
        String normalizedLeft = left == null ? "" : left.trim().toLowerCase(Locale.ROOT);
        String normalizedRight = right == null ? "" : right.trim().toLowerCase(Locale.ROOT);
        return normalizedLeft.equals(normalizedRight);
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

    private boolean receiptWithoutBoxes() {
        for (TsdClientSummary client : clients) {
            if (client.id != null && client.id.equals(receiptClientId)) {
                return client.storesWithoutBoxes;
            }
        }
        return false;
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
        } else if (screen == Screen.OUTGOING_CONTROL) {
            renderOutgoingControlScreen();
        } else if (screen == Screen.BOXLESS_PACKING) {
            renderBoxlessPackingScreen();
        } else if (screen == Screen.FBS_ASSEMBLY) {
            renderFbsAssemblyScreen();
        } else if (screen == Screen.FBS_CARGO) {
            renderFbsCargoPackingScreen();
        } else if (screen == Screen.INVENTORY_MENU) {
            renderInventoryMenu();
        } else if (screen == Screen.INVENTORY_START) {
            renderInventoryStartScreen();
        } else if (screen == Screen.INVENTORY_COUNT) {
            renderInventoryCountScreen();
        } else if (screen == Screen.INFO) {
            renderMainScreen();
        } else {
            renderMainScreen();
        }
    }

    private String textValue(EditText input) {
        return input == null ? "" : input.getText().toString().trim();
    }

    private String nonEmpty(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private String responseErrorMessage(Response<?> response, String fallback) {
        try {
            if (response.errorBody() == null) return fallback;
            String body = response.errorBody().string();
            if (body == null || body.trim().isEmpty()) return fallback;
            JSONObject payload = new JSONObject(body);
            Object message = payload.opt("message");
            if (message != null && !JSONObject.NULL.equals(message)) {
                String text = String.valueOf(message).trim();
                if (!text.isEmpty()) return text;
            }
        } catch (Throwable ignored) {
        }
        return fallback;
    }

    private boolean isFflBoxCode(String value) {
        return normalizeBoxCode(value).startsWith("FFL");
    }

    private String receiptBarcodeError(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        if (isFflBoxCode(trimmed)) {
            return "Ошибка: в поле ШК товара отсканирован номер короба.";
        }
        if (trimmed.length() > 13) {
            return "Ошибка: ШК товара не должен быть длиннее 13 символов. Возможно, отсканирован КИЗ.";
        }
        return "";
    }

    private String receiptKizError(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        if (isFflBoxCode(trimmed)) {
            return "Ошибка: в поле КИЗ отсканирован номер короба.";
        }
        if (trimmed.length() <= 20) {
            return "Ошибка: КИЗ должен быть длиннее 20 символов. Возможно, отсканирован ШК товара.";
        }
        return "";
    }

    private String duplicateKizMessage(String kiz, String boxCode, boolean currentReceipt) {
        String location;
        if (boxCode != null && !boxCode.trim().isEmpty()) {
            location = "Короб с дублем: " + boxCode.trim() + ".";
        } else if (currentReceipt) {
            location = "Дубль найден в текущей приемке.";
        } else {
            location = "Дубль уже есть в WMS.";
        }
        return "ДУБЛЬ КИЗ\n" + location + "\nКИЗ: " + kiz;
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
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Перед обновлением войдите на ТСД и синхронизируйте операции.";
            refreshCurrentScreen();
            return;
        }
        OperationOutboxCounts beforeSync = outbox.counts();
        if (beforeSync.pending == 0) {
            statusMessage = "Очередь синхронизирована. Открываю обновление " + APP_VERSION + ".";
            refreshCurrentScreen();
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL)));
            return;
        }
        statusMessage = "Проверяю очередь и синхронизирую данные перед обновлением...";
        refreshCurrentScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending(session.authorizationHeader());
            OperationOutboxCounts counts = outbox.counts();
            mainHandler.post(() -> {
                pendingCount = counts.pending;
                rejectedCount = counts.rejected;
                if (counts.pending > 0 || summary.retried > 0) {
                    statusMessage = "Обновление остановлено: не отправлено операций — " + counts.pending + ". Проверьте интернет и повторите синхронизацию.";
                    refreshCurrentScreen();
                    return;
                }
                statusMessage = counts.rejected > 0
                    ? "Очередь отправлена. Отклоненные операции сохранены на ТСД и в разборе WMS."
                    : "Все данные синхронизированы. Открываю обновление.";
                refreshCurrentScreen();
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL)));
            });
        });
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
        OUTGOING_CONTROL,
        BOXLESS_PACKING,
        FBS_ASSEMBLY,
        FBS_CARGO,
        INVENTORY_MENU,
        INVENTORY_START,
        INVENTORY_COUNT,
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
