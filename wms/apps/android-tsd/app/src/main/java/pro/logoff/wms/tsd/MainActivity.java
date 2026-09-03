package pro.logoff.wms.tsd;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.PackageInstaller;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.graphics.pdf.PdfRenderer;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
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
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
import pro.logoff.wms.tsd.network.TsdFbsRequestsResponse;
import pro.logoff.wms.tsd.network.TsdMovementTask;
import pro.logoff.wms.tsd.network.TsdOperationRequest;
import pro.logoff.wms.tsd.network.TsdRelabelTask;
import pro.logoff.wms.tsd.network.TsdSearchBoxTask;
import pro.logoff.wms.tsd.network.TsdStoragePalletResponse;
import pro.logoff.wms.tsd.network.TsdTransferResponse;
import pro.logoff.wms.tsd.network.TsdLoginRequest;
import pro.logoff.wms.tsd.network.TsdLoginResponse;
import pro.logoff.wms.tsd.network.TsdKizCheckResponse;
import pro.logoff.wms.tsd.network.TsdInventoryBox;
import pro.logoff.wms.tsd.network.TsdInventoryDashboard;
import pro.logoff.wms.tsd.network.TsdInventoryLine;
import pro.logoff.wms.tsd.network.TsdInventorySession;
import pro.logoff.wms.tsd.network.TsdOzonFboOverview;
import pro.logoff.wms.tsd.network.TsdOzonFboPlan;
import pro.logoff.wms.tsd.network.TsdSkuInfo;
import pro.logoff.wms.tsd.network.WmsApi;
import pro.logoff.wms.tsd.network.WmsApiFactory;
import pro.logoff.wms.tsd.printing.NiimbotB1Printer;
import pro.logoff.wms.tsd.sync.TsdSyncRunner;
import pro.logoff.wms.tsd.sync.TsdSyncSummary;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import retrofit2.Response;

public class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 4201;
    private static final int BLUETOOTH_PRINTER_PERMISSION_REQUEST = 4202;
    private static final String UPDATE_INSTALL_ACTION = BuildConfig.APPLICATION_ID + ".UPDATE_INSTALL_STATUS";
    private static final String DEFAULT_BASE_URL = BuildConfig.API_BASE_URL;
    private static final String APK_URL = BuildConfig.APK_URL;
    private static final int RED = Color.rgb(215, 25, 32);
    private static final int BOX_FOUND_GREEN = Color.rgb(187, 247, 208);
    private static final int BOX_DUPLICATE_BLUE = Color.rgb(191, 219, 254);
    private static final int BOX_NOT_NEEDED_RED = Color.rgb(254, 202, 202);
    private static final int BOX_RELABEL_PURPLE = Color.rgb(221, 214, 254);
    private static final int BOX_MOVEMENT_BLUE = Color.rgb(147, 197, 253);
    private static final int BOX_RELABEL_MOVEMENT_CYAN = Color.rgb(165, 243, 252);
    private static final int LIGHT_GRAY = Color.rgb(226, 232, 240);
    private static final int TEXT = Color.rgb(30, 41, 59);
    private static final String RECEIPT_MODE_STANDARD = "STANDARD";
    private static final String RECEIPT_MODE_BOXES = "BOXES";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService monitorExecutor = Executors.newSingleThreadExecutor();
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
    private EditText ozonFboScanInput;
    private EditText storagePalletScanInput;
    private EditText transferScanInput;
    private TsdAssemblyPlan assemblyPlan;
    private TsdBoxlessPackingResponse boxlessPacking;
    private TsdRelabelTask activeRelabelTask;
    private TsdInventorySession activeInventory;
    private TsdInventoryBox activeInventoryBox;
    private TsdInventoryDashboard inventoryDashboard;
    private TsdFbsAssemblyResponse fbsAssembly;
    private TsdFbsRequestsResponse fbsRequests;
    private TsdFbsCargoPackingResponse fbsCargoPacking;
    private TsdOzonFboOverview ozonFboOverview;
    private TsdOzonFboPlan ozonFboPlan;
    private TsdOzonFboPlan.Box ozonFboBox;
    private TsdStoragePalletResponse storagePalletAssembly;
    private final Map<String, StoragePalletRecoveryItem> storagePalletRecoveryItems = new LinkedHashMap<>();
    private String storagePalletRecoveryOperationId = "";
    private String storagePalletRecoveryBoxCode = "";
    private TsdTransferResponse transferWorkflow;
    private String storagePalletClientId = "";
    private String selectedFbsCargoPlanId = "";
    private String selectedFbsRequestId = "";
    private String inventoryType = "";
    private String inventoryClientId = "";
    private String transferredInventoryBoxId = "";
    private boolean inventoryTransferMode;
    private boolean inventoryArchiveMode;
    private boolean inventoryRequestBusy;
    private boolean mandatoryFbsAuditActive;
    private String mandatoryFbsAuditBoxCode = "";
    private String mandatoryFbsAuditClientId = "";
    private String mandatoryFbsAuditSessionId = "";
    private String mandatoryFbsAuditPendingBarcode = "";
    private String mandatoryFbsAuditOwnerKey = "";
    private String confirmedFbsBoxTaskId = "";
    private String confirmedFbsBoxCode = "";
    private String confirmedFbsBoxOwnerKey = "";
    private final Set<String> pendingFbsAuditBoxes = new LinkedHashSet<>();
    private final Set<String> mandatoryFbsAuditKizValues = new LinkedHashSet<>();
    private String uiLanguage = "ru";
    private boolean phoneMode;
    private EditText phoneCameraTarget;
    private Dialog phoneScannerDialog;
    private DecoratedBarcodeView phoneBarcodeView;
    private final List<ReceiptItem> receiptCurrentItems = new ArrayList<>();
    private final Set<String> receiptSessionBoxes = new LinkedHashSet<>();
    private final Set<String> receiptKizValues = new LinkedHashSet<>();
    private final Map<String, String> receiptKizBoxes = new LinkedHashMap<>();
    private String receiptMode = "";
    private String receiptClientId = "";
    private String receiptSourceDocument = "";
    private String receiptBoxCode = "";
    private String pendingReceiptBarcode = "";
    private TsdSkuInfo pendingReceiptSku;
    private boolean pendingReceiptRequiresKiz;
    private boolean receiptCheckingKiz;
    private boolean niimbotPrintBusy;
    private boolean appUpdateBusy;
    private boolean niimbotForceSelection;
    private String pendingNiimbotLabelBase64 = "";
    private String pendingNiimbotLabelContentType = "";
    private String pendingNiimbotOrderId = "";
    private String pendingNiimbotMarketplace = "";
    private String pendingNiimbotRequestNumber = "";
    private String pendingNiimbotWarehouse = "";
    private boolean receiptKizAuditMode;
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
    private Runnable fbsOzonLabelRefreshTask;
    private boolean receiptOpeningBox;
    private boolean receiptClosingBox;
    private boolean fbsBusy;
    private boolean fbsRequestsBusy;
    private boolean fbsRequestsArchiveMode;
    private boolean fbsCargoBusy;
    // ADDED: ручное состояние длинного списка остальных заказов.
    private boolean fbsRemainingOrdersOpen;
    private String fbsRemainingOrdersTaskId = "";
    private boolean ozonFboBusy;
    private boolean transferBusy;
    private boolean transferTargetMode;
    private String transferOperationKey = "";
    private final List<String> transferSelectedScanCodes = new ArrayList<>();
    private final List<TsdTransferResponse.Item> transferSelectedItems = new ArrayList<>();
    // FIX: ШК маркированной единицы храним до сканирования её КИЗ.
    private TsdTransferResponse.Item transferPendingKizItem;
    private int fbsFeedbackColor;
    private int fbsCargoFeedbackColor;
    private int ozonFboFeedbackColor;
    private int transferFeedbackColor;
    private String lastAssemblyTouchKey = "";
    private long lastAssemblyTouchAt = 0L;
    private int boxSearchFeedbackColor = 0;
    private int movementFeedbackColor = 0;
    private int receiptFeedbackColor = 0;
    private Screen screen = Screen.MAIN;
    private AlertDialog activeErrorDialog;
    private AlertDialog fbsGuidedScanDialog;
    private String fbsGuidedScanDialogKey = "";
    private Runnable fbsGuidedAutoSubmitTask;
    private String lastDialogError = "";
    private long lastDialogErrorAt = 0L;
    private final Runnable monitorHeartbeatTask = new Runnable() {
        @Override
        public void run() {
            sendMonitorHeartbeat();
            mainHandler.postDelayed(this, 5_000L);
        }
    };
    private final BroadcastReceiver updateInstallReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirmation;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
                } else {
                    @SuppressWarnings("deprecation")
                    Intent legacyConfirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    confirmation = legacyConfirmation;
                }
                if (confirmation != null) {
                    confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirmation);
                    showUpdateStatus("Android просит подтвердить установку. Нажмите «Обновить» один раз.", false);
                    return;
                }
            }
            appUpdateBusy = false;
            if (status == PackageInstaller.STATUS_SUCCESS) {
                showUpdateStatus("Обновление установлено.", false);
                return;
            }
            String detail = nonEmpty(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE), "неизвестная ошибка установки");
            showUpdateStatus("Не удалось установить обновление: " + detail + ".", true);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        IntentFilter updateFilter = new IntentFilter(UPDATE_INSTALL_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateInstallReceiver, updateFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateInstallReceiver, updateFilter);
        }
        getWindow().setStatusBarColor(RED);
        try {
            outbox = new OperationOutbox(TsdDatabase.get(this).operationDao());
            sessionStore = new TsdSessionStore(this);
            progressStore = getSharedPreferences("tsd_assembly_progress", MODE_PRIVATE);
            uiStore = getSharedPreferences("tsd_ui_preferences", MODE_PRIVATE);
            uiLanguage = uiStore.getString("language", "ru");
            phoneMode = uiStore.getBoolean("phone_mode", false);
            TsdSession startupSession = sessionStore.load();
            if (startupSession != null && nonEmpty(startupSession.deviceCode, "")
                .toUpperCase(Locale.ROOT).startsWith("USER:")) {
                clearMandatoryFbsAuditState();
                sessionStore.clear();
                statusMessage = "Обновите приложение ТСД и войдите заново: старая общая сессия отключена.";
                renderSettingsScreen();
            } else {
                restoreMandatoryFbsAuditState();
            }
            if (startupSession == null) {
                renderSettingsScreen();
            } else if (!nonEmpty(startupSession.deviceCode, "").toUpperCase(Locale.ROOT).startsWith("USER:")
                && (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty())) {
                resumeMandatoryFbsAudit();
            } else if (!nonEmpty(startupSession.deviceCode, "").toUpperCase(Locale.ROOT).startsWith("USER:")) {
                renderMainScreen();
            }
            refreshQueue(null);
            if (sessionStore.load() != null) {
                loadClients(false);
            }
            mainHandler.post(monitorHeartbeatTask);
        } catch (Throwable error) {
            renderFatalScreen(error);
        }
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(monitorHeartbeatTask);
        cancelOzonLabelAutoRefresh();
        try {
            unregisterReceiver(updateInstallReceiver);
        } catch (Throwable ignored) {
        }
        monitorExecutor.shutdownNow();
        executor.shutdownNow();
        if (activeErrorDialog != null) activeErrorDialog.dismiss();
        dismissFbsGuidedScanDialog();
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
            if ((screen == Screen.OZON_FBO_BOXES || screen == Screen.OZON_FBO_ASSEMBLY) && ozonFboScanInput != null) {
                if (screen == Screen.OZON_FBO_BOXES) openOzonFboBoxByCode();
                else submitOzonFboProductScan();
                return true;
            }
            if (screen == Screen.STORAGE_PALLET && storagePalletScanInput != null) {
                submitStoragePalletScan();
                return true;
            }
            if (screen == Screen.STOCK_TRANSFER && transferScanInput != null) {
                submitStockTransferScan();
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
        if (requestCode == BLUETOOTH_PRINTER_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    granted = false;
                    break;
                }
            }
            if (granted) {
                continueQuietNiimbotPrint();
            } else {
                niimbotPrintBusy = false;
                statusMessage = tr(
                    "Доступ к Bluetooth запрещён. Разрешите поиск устройств поблизости в настройках приложения.",
                    "Bluetooth ruxsati berilmadi. Ilova sozlamalarida yaqin qurilmalarni qidirishga ruxsat bering."
                );
                refreshCurrentScreen();
            }
            return;
        }
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

    @Override
    public void onBackPressed() {
        if (mandatoryFbsAuditActive) {
            statusMessage = tr(
                "Обязательную проверку нельзя закрыть. Сначала полностью пропикайте и актуализируйте короб.",
                "Majburiy tekshiruvni yopib bo‘lmaydi. Avval qutini to‘liq skanerlang va yangilang."
            );
            renderInventoryCountScreen();
            return;
        }
        super.onBackPressed();
    }

    private void renderMainScreen() {
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
        screen = Screen.MAIN;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(mainStatusLine());
        if (isWarehouseKeeperOnly(session)) {
            root.addView(primaryMenuButton(tr("Перемещения", "Ko‘chirish"), view -> openStockTransfer()));
            root.addView(primaryMenuButton(
                tr("Сборка паллетов", "Palletlarni yig‘ish"),
                view -> openStoragePalletAssembly()
            ));
            root.addView(primaryMenuButton(
                tr("Инвентаризация", "Inventarizatsiya"),
                view -> renderInventoryMenu()
            ));
        } else {
            root.addView(primaryMenuButton(tr("Приемка товара", "Tovarni qabul qilish"), view -> openReceipt()));
            root.addView(primaryMenuButton(tr("Перемещения", "Ko‘chirish"), view -> openStockTransfer()));
            root.addView(primaryMenuButton(tr("Сборка заявки", "Buyurtmani yig‘ish"), view -> openAssemblyRequests()));
            root.addView(primaryMenuButton(tr("Сборка FBS", "FBS buyurtmasini yig‘ish"), view -> openFbsAssembly()));
            root.addView(primaryMenuButton(tr("Сборка FBO Ozon", "Ozon FBO yig‘ish"), view -> openOzonFboAssembly()));
            root.addView(primaryMenuButton(
                tr("Упаковка FBS", "FBS qadoqlash"),
                view -> openFbsCargoPacking()
            ));
            root.addView(primaryMenuButton(
                tr("Сборка паллетов", "Palletlarni yig‘ish"),
                view -> openStoragePalletAssembly()
            ));
            root.addView(primaryMenuButton(tr("Инвентаризация", "Inventarizatsiya"), view -> renderInventoryMenu()));
            root.addView(primaryMenuButton(
                phoneMode
                    ? tr("Телефон: камера включена", "Telefon: kamera yoqilgan")
                    : tr("Телефон", "Telefon"),
                view -> togglePhoneMode()
            ));
        }
        root.addView(secondaryButton(tr("Синхронизировать очередь", "Navbatni sinxronlash") + " (" + pendingCount + ")", view -> syncPending()));
        if (!isWarehouseKeeperOnly(session)) {
            root.addView(secondaryButton(tr("Обновить клиентов", "Mijozlarni yangilash"), view -> loadClients(true)));
        }
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

    private boolean isWarehouseKeeperOnly(TsdSession session) {
        if (session == null || !session.hasRole("WAREHOUSE_KEEPER")) return false;
        String[] elevatedRoles = {
            "ADMIN", "OWNER", "MANAGER", "OPERATOR", "BRANCH_MANAGER", "SUPER_ADMIN"
        };
        for (String role : elevatedRoles) {
            if (session.hasRole(role)) return false;
        }
        return true;
    }

    private void openStockTransfer() {
        transferWorkflow = null;
        transferOperationKey = "";
        transferSelectedScanCodes.clear();
        transferSelectedItems.clear();
        transferPendingKizItem = null;
        transferTargetMode = false;
        transferBusy = false;
        transferFeedbackColor = 0;
        statusMessage = tr(
            "Отсканируйте короб, из которого берёте товар.",
            "Tovar olinadigan qutini skanerlang."
        );
        renderStockTransferScreen();
    }

    private void renderStockTransferScreen() {
        screen = Screen.STOCK_TRANSFER;
        transferScanInput = null;
        LinearLayout root = baseRoot();
        applyScreenFeedback(root, transferFeedbackColor);
        root.addView(header());
        root.addView(title(tr("Перемещения", "Ko‘chirish")));
        if (!statusMessage.isEmpty()) {
            root.addView(transferFeedbackColor == 0
                ? messageView(statusMessage)
                : feedbackView(statusMessage, transferFeedbackColor));
        }

        TsdTransferResponse.SourceBox source =
            transferWorkflow == null ? null : transferWorkflow.sourceBox;
        if (source == null) {
            root.addView(messageView(tr(
                "Шаг 1 из 3. Отсканируйте исходный короб.",
                "1/3-qadam. Manba qutini skanerlang."
            )));
            transferScanInput = input(tr("Исходный короб", "Manba quti"));
            root.addView(transferScanInput);
            root.addView(primaryMenuButton(
                tr("Открыть короб", "Qutini ochish"),
                view -> submitStockTransferScan()
            ));
        } else {
            String clientName = source.client == null ? "—" : safeText(source.client.name);
            root.addView(feedbackView(
                tr("ИЗ КОРОБА: ", "MANBA QUTI: ") + safeText(source.code) +
                    "\n" + tr("Клиент: ", "Mijoz: ") + clientName +
                    "\n" + tr("Доступно: ", "Mavjud: ") + source.totalQuantity + tr(" ед.", " dona"),
                BOX_MOVEMENT_BLUE
            ));

            if (!transferTargetMode) {
                boolean awaitingKiz = transferPendingKizItem != null;
                root.addView(messageView(awaitingKiz
                    ? tr(
                        "ШК принят: " + safeText(transferPendingKizItem.name) + ". Теперь отсканируйте КИЗ этой единицы.",
                        "SHK qabul qilindi: " + safeText(transferPendingKizItem.name) + ". Endi shu birlikning KIZini skanerlang."
                    )
                    : tr(
                        "Шаг 2 из 3. Сначала сканируйте ШК товара. Для маркированного товара ТСД сразу попросит КИЗ.",
                        "2/3-qadam. Avval tovar SHKini skanerlang. Belgilangan tovar uchun TSD darhol KIZni so‘raydi."
                    )
                ));
                transferScanInput = input(awaitingKiz
                    ? tr("КИЗ товара", "Tovar KIZi")
                    : tr("ШК товара или привязанный КИЗ", "Tovar SHKi yoki biriktirilgan KIZ"));
                root.addView(transferScanInput);
                root.addView(primaryMenuButton(
                    awaitingKiz
                        ? tr("Привязать КИЗ", "KIZni biriktirish")
                        : tr("Добавить товар", "Tovarni qo‘shish"),
                    view -> submitStockTransferScan()
                ));
                if (!transferSelectedItems.isEmpty() && !awaitingKiz) {
                    root.addView(primaryMenuButton(
                        tr("Закончить выбор — ", "Tanlashni tugatish — ") +
                            transferSelectedItems.size() + tr(" ед.", " dona"),
                        view -> {
                            transferTargetMode = true;
                            transferFeedbackColor = 0;
                            statusMessage = tr(
                                "Шаг 3 из 3. Отсканируйте короб назначения для всей выбранной партии.",
                                "3/3-qadam. Belgilangan qutini skanerlang."
                            );
                            renderStockTransferScreen();
                        }
                    ));
                }
                if (awaitingKiz) {
                    root.addView(secondaryButton(
                        tr("Отменить выбор ШК", "SHK tanlovini bekor qilish"),
                        view -> {
                            transferPendingKizItem = null;
                            transferFeedbackColor = 0;
                            statusMessage = tr(
                                "ШК отменён. Сканируйте товар заново.",
                                "SHK bekor qilindi. Tovarni qayta skanerlang."
                            );
                            renderStockTransferScreen();
                        }
                    ));
                }
                addTransferSelectedItems(root);
                addTransferSourceProducts(root, source);
            } else {
                root.addView(messageView(tr(
                    "Шаг 3 из 3. Отсканируйте короб, куда положили все выбранные вещи.",
                    "3/3-qadam. Barcha tanlangan narsalar joylangan qutini skanerlang."
                )));
                root.addView(feedbackView(
                    tr("К ПЕРЕМЕЩЕНИЮ: ", "KO‘CHIRISH UCHUN: ") +
                        transferSelectedItems.size() + tr(" ед.", " dona"),
                    BOX_FOUND_GREEN
                ));
                addTransferSelectedItems(root);
                transferScanInput = input(tr("Короб назначения", "Belgilangan quti"));
                root.addView(transferScanInput);
                root.addView(primaryMenuButton(
                    tr("Переместить всю партию", "Barcha partiyani ko‘chirish"),
                    view -> submitStockTransferScan()
                ));
                root.addView(secondaryButton(
                    tr("Добавить ещё товары", "Yana tovar qo‘shish"),
                    view -> {
                        transferTargetMode = false;
                        transferFeedbackColor = 0;
                        statusMessage = tr(
                            "Продолжайте сканировать товары.",
                            "Tovarlarni skanerlashni davom eting."
                        );
                        renderStockTransferScreen();
                    }
                ));
            }

            if (!transferSelectedItems.isEmpty()) {
                root.addView(secondaryButton(
                    tr("Отменить последний товар", "Oxirgi tovarni bekor qilish"),
                    view -> removeLastTransferItem()
                ));
            }

            root.addView(secondaryButton(
                tr("Сменить исходный короб", "Manba qutini almashtirish"),
                view -> openStockTransfer()
            ));
        }
        if (transferBusy) {
            root.addView(messageView(tr("Проверяю…", "Tekshirilmoqda…")));
        }
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
        if (transferScanInput != null && !transferBusy) {
            transferScanInput.requestFocus();
        }
    }

    private void addTransferSourceProducts(LinearLayout root, TsdTransferResponse.SourceBox source) {
        if (source.products == null || source.products.isEmpty()) {
            return;
        }
        root.addView(label(tr("Содержимое исходного короба", "Manba quti tarkibi")));
        int shown = 0;
        for (TsdTransferResponse.Product product : source.products) {
            if (shown++ >= 12) {
                root.addView(messageView(tr(
                    "Остальные позиции скрыты. Сканирование продолжает работать.",
                    "Qolgan pozitsiyalar yashirilgan. Skanerlash ishlashda davom etadi."
                )));
                break;
            }
            String details =
                tr("Артикул: ", "Artikul: ") + safeText(product.article) +
                (safeText(product.color).equals("—") ? "" :
                    " · " + tr("цвет: ", "rang: ") + safeText(product.color)) +
                (safeText(product.size).equals("—") ? "" :
                    " · " + tr("размер: ", "o‘lcham: ") + safeText(product.size)) +
                "\n" + tr("Доступно: ", "Mavjud: ") + product.quantity +
                (product.requiresKiz ? tr(" · нужен КИЗ", " · KIZ kerak") : "");
            root.addView(taskRow(safeText(product.name), details, Color.WHITE));
        }
    }

    private void addTransferSelectedItems(LinearLayout root) {
        if (transferSelectedItems.isEmpty()) {
            return;
        }
        root.addView(label(
            tr("Выбрано для перемещения", "Ko‘chirish uchun tanlangan") +
                ": " + transferSelectedItems.size()
        ));
        int start = Math.max(0, transferSelectedItems.size() - 12);
        for (int index = transferSelectedItems.size() - 1; index >= start; index--) {
            TsdTransferResponse.Item item = transferSelectedItems.get(index);
            String details =
                tr("Артикул: ", "Artikul: ") + safeText(item.article) +
                (safeText(item.color).equals("—") ? "" :
                    " · " + tr("цвет: ", "rang: ") + safeText(item.color)) +
                (safeText(item.size).equals("—") ? "" :
                    " · " + tr("размер: ", "o‘lcham: ") + safeText(item.size)) +
                "\n" + ("KIZ".equals(item.scanType)
                    ? tr("КИЗ", "KIZ")
                    : tr("ШК", "SHK")) +
                " · " + tr("единица №", "birlik №") + (index + 1);
            root.addView(taskRow(safeText(item.name), details, BOX_FOUND_GREEN));
        }
        if (start > 0) {
            root.addView(messageView(
                tr("Ранее выбрано ещё: ", "Oldin tanlangan yana: ") + start
            ));
        }
    }

    private void removeLastTransferItem() {
        if (transferSelectedItems.isEmpty()) {
            return;
        }
        int last = transferSelectedItems.size() - 1;
        TsdTransferResponse.Item removed = transferSelectedItems.remove(last);
        transferSelectedScanCodes.remove(last);
        transferTargetMode = false;
        transferFeedbackColor = 0;
        statusMessage = tr("Убран последний товар: ", "Oxirgi tovar olib tashlandi: ") +
            safeText(removed.name) + ". " +
            tr("Можно продолжать сканирование.", "Skanerlashni davom ettirishingiz mumkin.");
        renderStockTransferScreen();
    }

    private void submitStockTransferScan() {
        if (transferBusy) {
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        String scanned = textValue(transferScanInput);
        if (scanned.isEmpty()) {
            showStockTransferError(tr("Сначала отсканируйте код.", "Avval kodni skanerlang."));
            return;
        }
        TsdTransferResponse.SourceBox source =
            transferWorkflow == null ? null : transferWorkflow.sourceBox;
        if (source == null) {
            inspectStockTransferSource(scanned);
        } else if (transferTargetMode) {
            executeStockTransferBatch(source.code, scanned);
        } else {
            inspectStockTransferItem(source.code, scanned);
        }
    }

    private void inspectStockTransferSource(String boxCode) {
        TsdSession session = safeSession();
        if (session == null) return;
        transferBusy = true;
        transferFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = tr("Открываю исходный короб…", "Manba quti ochilmoqda…");
        renderStockTransferScreen();
        runBackground(() -> {
            Response<TsdTransferResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .inspectTransferSource(session.authorizationHeader(), boxCode)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(
                    response,
                    tr("Не удалось открыть исходный короб.", "Manba qutini ochib bo‘lmadi.")
                );
                mainHandler.post(() -> showStockTransferError(message));
                return;
            }
            TsdTransferResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                transferBusy = false;
                transferWorkflow = loaded;
                transferFeedbackColor = BOX_FOUND_GREEN;
                statusMessage = nonEmpty(loaded.message, tr("Короб открыт.", "Quti ochildi."));
                playFbsSuccess();
                renderStockTransferScreen();
            });
        });
    }

    private void inspectStockTransferItem(String sourceBoxCode, String scanCode) {
        TsdSession session = safeSession();
        if (session == null) return;
        final TsdTransferResponse.Item pendingKizItem = transferPendingKizItem;
        transferBusy = true;
        transferFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = pendingKizItem == null
            ? tr("Проверяю товар…", "Tovar tekshirilmoqda…")
            : tr("Проверяю и привязываю КИЗ…", "KIZ tekshirilmoqda va biriktirilmoqda…");
        renderStockTransferScreen();
        runBackground(() -> {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("fromBoxCode", sourceBoxCode);
            payload.put("scanCode", scanCode);
            if (pendingKizItem != null) {
                // FIX: Сервер привязывает новый КИЗ именно к SKU ранее отсканированного товара.
                payload.put("skuId", pendingKizItem.skuId);
                payload.put("bindMissingKiz", true);
            }
            Response<TsdTransferResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .inspectTransferItem(session.authorizationHeader(), payload)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(
                    response,
                    tr("Товар не найден в исходном коробе.", "Tovar manba qutida topilmadi.")
                );
                mainHandler.post(() -> showStockTransferError(message));
                return;
            }
            TsdTransferResponse loaded = response.body();
            mainHandler.post(() -> {
                TsdTransferResponse.Item item = loaded.item;
                if (item == null) {
                    showStockTransferError(tr(
                        "Сервер не вернул данные отсканированного товара.",
                        "Server skanerlangan tovar ma’lumotlarini qaytarmadi."
                    ));
                    return;
                }
                if ("SCAN_KIZ".equals(loaded.state)) {
                    online = true;
                    transferBusy = false;
                    transferWorkflow = loaded;
                    transferWorkflow.item = null;
                    transferPendingKizItem = item;
                    transferFeedbackColor = BOX_DUPLICATE_BLUE;
                    statusMessage = nonEmpty(
                        loaded.message,
                        tr(
                            "ШК принят. Теперь отсканируйте КИЗ этой единицы.",
                            "SHK qabul qilindi. Endi shu birlikning KIZini skanerlang."
                        )
                    );
                    playFbsSuccess();
                    renderStockTransferScreen();
                    return;
                }
                if ("KIZ".equals(item.scanType)) {
                    for (String selectedCode : transferSelectedScanCodes) {
                        if (selectedCode.equalsIgnoreCase(scanCode)) {
                            showStockTransferError(tr(
                                "Этот КИЗ уже выбран. Повтор не добавлен.",
                                "Bu KIZ allaqachon tanlangan. Takror qo‘shilmadi."
                            ));
                            return;
                        }
                    }
                }
                int selectedBarcodeQuantity = 0;
                if ("BARCODE".equals(item.scanType)) {
                    for (TsdTransferResponse.Item selected : transferSelectedItems) {
                        if (
                            "BARCODE".equals(selected.scanType) &&
                            safeText(selected.skuId).equals(safeText(item.skuId))
                        ) {
                            selectedBarcodeQuantity += 1;
                        }
                    }
                }
                if ("BARCODE".equals(item.scanType) && selectedBarcodeQuantity >= item.availableQuantity) {
                    showStockTransferError(
                        tr("В исходном коробе больше нет свободных единиц товара «",
                            "Manba qutida boshqa bo‘sh birlik qolmadi: «") +
                            safeText(item.name) + "»."
                    );
                    return;
                }
                online = true;
                transferBusy = false;
                transferWorkflow = loaded;
                transferWorkflow.item = null;
                transferPendingKizItem = null;
                transferSelectedScanCodes.add(scanCode);
                transferSelectedItems.add(item);
                if (transferOperationKey.isEmpty()) {
                    transferOperationKey =
                        "tsd-transfer-batch:" + session.deviceCode + ":" + System.currentTimeMillis();
                }
                transferTargetMode = false;
                transferFeedbackColor = BOX_FOUND_GREEN;
                statusMessage =
                    tr("Товар добавлен. Всего выбрано: ", "Tovar qo‘shildi. Jami tanlandi: ") +
                        transferSelectedItems.size() + tr(" ед.", " dona");
                playFbsSuccess();
                renderStockTransferScreen();
            });
        });
    }

    private void executeStockTransferBatch(String sourceBoxCode, String targetBoxCode) {
        TsdSession session = safeSession();
        if (session == null) return;
        if (transferSelectedScanCodes.isEmpty()) {
            showStockTransferError(tr(
                "Сначала отсканируйте хотя бы один товар.",
                "Avval kamida bitta tovarni skanerlang."
            ));
            return;
        }
        if (transferOperationKey.isEmpty()) {
            transferOperationKey =
                "tsd-transfer-batch:" + session.deviceCode + ":" + System.currentTimeMillis();
        }
        final String operationKey = transferOperationKey;
        final List<String> scanCodes = new ArrayList<>(transferSelectedScanCodes);
        transferBusy = true;
        transferFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage =
            tr("Перемещаю выбранную партию: ", "Tanlangan partiya ko‘chirilmoqda: ") +
                scanCodes.size() + tr(" ед.…", " dona…");
        renderStockTransferScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("fromBoxCode", sourceBoxCode);
            payload.put("toBoxCode", targetBoxCode);
            payload.put("scanCodes", scanCodes);
            payload.put("idempotencyKey", operationKey);
            Response<TsdTransferResponse> response = api
                .executeTransferBatch(session.authorizationHeader(), payload)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(
                    response,
                    tr("Перемещение не выполнено.", "Ko‘chirish bajarilmadi.")
                );
                mainHandler.post(() -> showStockTransferError(message));
                return;
            }
            TsdTransferResponse result = response.body();
            TsdTransferResponse refreshed = null;
            if (!result.sourceBoxArchived) {
                Response<TsdTransferResponse> sourceResponse = api
                    .inspectTransferSource(session.authorizationHeader(), sourceBoxCode)
                    .execute();
                if (sourceResponse.isSuccessful()) {
                    refreshed = sourceResponse.body();
                }
            }
            TsdTransferResponse finalRefreshed = refreshed;
            mainHandler.post(() -> {
                online = true;
                transferBusy = false;
                transferWorkflow = result.sourceBoxArchived ? null : finalRefreshed;
                transferOperationKey = "";
                transferSelectedScanCodes.clear();
                transferSelectedItems.clear();
                transferPendingKizItem = null;
                transferTargetMode = false;
                transferFeedbackColor = BOX_FOUND_GREEN;
                statusMessage = nonEmpty(
                    result.message,
                    tr("Пакетное перемещение выполнено.", "Paketli ko‘chirish bajarildi.")
                ) +
                    (result.sourceBoxArchived
                        ? tr(" Исходный короб опустел и перенесён в архив.", " Manba quti bo‘shadi va arxivga o‘tkazildi.")
                        : "");
                playFbsSuccess();
                renderStockTransferScreen();
            });
        });
    }

    private void showStockTransferError(String message) {
        online = true;
        transferBusy = false;
        transferFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = message;
        playFbsError();
        renderStockTransferScreen();
        showScanningErrorDialog(message);
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
            root.addView(messageView(
                tr("Сейчас работает", "Hozir ishlayapti") + ": " + nonEmpty(session.userName, "-")
                    + "\n" + tr("ТСД", "TSD") + ": " + session.deviceName + " / " + session.deviceCode
            ));
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

    private void openStoragePalletAssembly() {
        storagePalletAssembly = null;
        clearStoragePalletRecovery();
        storagePalletClientId = "";
        statusMessage = tr("Проверяю открытую паллету…", "Ochiq pallet tekshirilmoqda…");
        screen = Screen.STORAGE_PALLET;
        renderStoragePalletAssemblyScreen();
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }
        runBackground(() -> {
            Response<TsdStoragePalletResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .currentStoragePallet(session.authorizationHeader(), session.deviceCode)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdStoragePalletResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                storagePalletAssembly = loaded;
                prepareStoragePalletRecovery(loaded);
                if (loaded.pallet != null && loaded.pallet.client != null) {
                    storagePalletClientId = safeText(loaded.pallet.client.id);
                }
                statusMessage = safeText(loaded.message);
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void renderStoragePalletAssemblyScreen() {
        screen = Screen.STORAGE_PALLET;
        storagePalletScanInput = null;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Сборка паллетов", "Palletlarni yig‘ish")));

        TsdStoragePalletResponse.Pallet pallet =
            storagePalletAssembly == null ? null : storagePalletAssembly.pallet;
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        if (pallet == null) {
            root.addView(messageView(tr(
                "Сначала выберите клиента, затем отсканируйте ШК пустой или уже существующей паллеты.",
                "Avval mijozni tanlang, keyin bo‘sh yoki mavjud pallet shtrix-kodini skanerlang."
            )));
            root.addView(label(tr("Клиент паллет-сорта", "Pallet-sort mijozi")));
            clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
            clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            clientSpinner = new Spinner(this);
            clientSpinner.setAdapter(clientAdapter);
            clientAdapter.add(tr("Выберите клиента", "Mijozni tanlang"));
            int selected = 0;
            for (TsdClientSummary client : clients) {
                clientAdapter.add(client.name + " · " + client.code);
                if (client.id.equals(storagePalletClientId)) {
                    selected = clientAdapter.getCount() - 1;
                }
            }
            clientAdapter.notifyDataSetChanged();
            clientSpinner.setSelection(selected);
            root.addView(clientSpinner);

            storagePalletScanInput = input(tr("Сканируйте ШК паллеты", "Pallet shtrix-kodini skanerlang"));
            storagePalletScanInput.setOnEditorActionListener((view, actionId, event) -> {
                submitStoragePalletScan();
                return true;
            });
            root.addView(storagePalletScanInput);
            root.addView(primaryMenuButton(tr("Открыть паллету", "Palletni ochish"), view -> submitStoragePalletScan()));
            root.addView(secondaryButton(tr("Обновить клиентов", "Mijozlarni yangilash"), view -> loadClients(true)));
        } else {
            String clientName = pallet.client == null ? "-" : safeText(pallet.client.name);
            String zoneName = pallet.zone == null
                ? tr("без зоны", "zonasiz")
                : safeText(pallet.zone.name);
            root.addView(feedbackView(
                pallet.code + "\n" +
                    tr("Клиент", "Mijoz") + ": " + clientName + "\n" +
                    tr("Зона", "Zona") + ": " + zoneName + "\n" +
                    tr("Коробов на паллете", "Palletdagi qutilar") + ": " + pallet.boxCount,
                Color.rgb(220, 252, 231)
            ));
            if (storagePalletAssembly.recovery != null) {
                renderStoragePalletRecovery(root);
            } else {
                storagePalletScanInput = input(tr("Сканируйте номер короба", "Quti raqamini skanerlang"));
                storagePalletScanInput.setOnEditorActionListener((view, actionId, event) -> {
                    submitStoragePalletScan();
                    return true;
                });
                root.addView(storagePalletScanInput);
                root.addView(primaryMenuButton(tr("Добавить короб", "Qutini qo‘shish"), view -> submitStoragePalletScan()));
                root.addView(secondaryButton(
                    tr("Следующая паллета", "Keyingi pallet"),
                    view -> finishStoragePallet()
                ));
                Button deletePalletButton = secondaryButton(
                    tr("Удалить паллет", "Palletni o‘chirish"),
                    view -> confirmDeleteStoragePallet()
                );
                deletePalletButton.setBackgroundColor(BOX_NOT_NEEDED_RED);
                deletePalletButton.setTextColor(TEXT);
                root.addView(deletePalletButton);
                if (pallet.boxes != null && !pallet.boxes.isEmpty()) {
                    root.addView(label(tr("Последние добавленные короба", "Oxirgi qo‘shilgan qutilar")));
                    int limit = Math.min(pallet.boxes.size(), 12);
                    for (int index = 0; index < limit; index += 1) {
                        TsdStoragePalletResponse.Box box = pallet.boxes.get(index);
                        String detail = box.existsInWms
                            ? nonEmpty(box.clientName, clientName)
                            : tr("пока не найден в WMS", "WMSda hozircha topilmadi");
                        root.addView(taskRow(box.boxCode, detail, Color.WHITE));
                    }
                }
            }
        }
        root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderMainScreen()));
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
        if (storagePalletScanInput != null) {
            storagePalletScanInput.requestFocus();
        }
    }

    private void submitStoragePalletScan() {
        if (storagePalletAssembly != null && storagePalletAssembly.recovery != null) {
            scanStoragePalletRecoveryItem();
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        String code = textValue(storagePalletScanInput);
        if (code.isEmpty()) {
            statusMessage = tr("Отсканируйте код.", "Kodni skanerlang.");
            renderStoragePalletAssemblyScreen();
            return;
        }
        TsdStoragePalletResponse.Pallet pallet =
            storagePalletAssembly == null ? null : storagePalletAssembly.pallet;
        if (pallet == null && isLikelyBoxCode(code)) {
            statusMessage = tr(
                "ОТСКАНИРОВАН НОМЕР КОРОБА " + code + ".\nСейчас нужен QR или ШК паллетсорта. Короба сканируются после открытия паллетсорта.",
                "QUTI RAQAMI SKANERLANDI " + code + ".\nHozir pallet-sort QR yoki shtrix-kodi kerak. Qutilar pallet-sort ochilgandan keyin skanerlanadi."
            );
            renderStoragePalletAssemblyScreen();
            return;
        }
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("deviceCode", session.deviceCode);
        if (pallet == null) {
            int selected = clientSpinner == null ? 0 : clientSpinner.getSelectedItemPosition();
            if (selected <= 0 || selected > clients.size()) {
                statusMessage = tr("Выберите клиента паллет-сорта.", "Pallet-sort mijozini tanlang.");
                renderStoragePalletAssemblyScreen();
                return;
            }
            storagePalletClientId = clients.get(selected - 1).id;
            request.put("clientId", storagePalletClientId);
            request.put("palletCode", code);
        } else {
            request.put("boxCode", code);
        }
        statusMessage = tr("Сохраняю…", "Saqlanmoqda…");
        renderStoragePalletAssemblyScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdStoragePalletResponse> response = pallet == null
                ? api.openStoragePallet(session.authorizationHeader(), request).execute()
                : api.scanStoragePalletBox(session.authorizationHeader(), pallet.id, request).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdStoragePalletResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                storagePalletAssembly = loaded;
                prepareStoragePalletRecovery(loaded);
                statusMessage = safeText(loaded.message);
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void renderStoragePalletRecovery(LinearLayout root) {
        TsdStoragePalletResponse.Recovery recovery = storagePalletAssembly.recovery;
        int total = 0;
        for (StoragePalletRecoveryItem item : storagePalletRecoveryItems.values()) {
            total += item.quantity;
        }
        root.addView(feedbackView(
            tr(
                "ТРЕБУЕТСЯ ВОССТАНОВЛЕНИЕ КОРОБА\n",
                "QUTINI TIKLASH KERAK\n"
            ) +
                safeText(recovery.boxCode) + "\n" +
                safeText(recovery.reasonLabel) + "\n" +
                tr(
                    "Пропикайте каждый товар обычным ШК. КИЗ и номера коробов не принимаются.",
                    "Har bir mahsulotni oddiy shtrix-kod bilan skanerlang. KIZ va quti raqamlari qabul qilinmaydi."
                ),
            BOX_NOT_NEEDED_RED
        ));
        root.addView(messageView(
            tr("Отсканировано единиц", "Skanerlangan birliklar") + ": " + total +
                " · " + tr("позиций", "pozitsiyalar") + ": " + storagePalletRecoveryItems.size()
        ));
        for (StoragePalletRecoveryItem item : storagePalletRecoveryItems.values()) {
            root.addView(taskRow(
                item.name,
                tr("ШК", "ShK") + ": " + item.barcode + " · " +
                    tr("Количество", "Miqdor") + ": " + item.quantity,
                Color.WHITE
            ));
        }
        storagePalletScanInput = input(tr("ШК товара", "Tovar shtrix-kodi"));
        storagePalletScanInput.setOnEditorActionListener((view, actionId, event) -> {
            scanStoragePalletRecoveryItem();
            return true;
        });
        root.addView(storagePalletScanInput);
        root.addView(primaryMenuButton(
            tr("Учесть товар", "Tovarni hisobga olish"),
            view -> scanStoragePalletRecoveryItem()
        ));
        root.addView(secondaryButton(
            tr("Завершить и восстановить короб", "Yakunlash va qutini tiklash"),
            view -> completeStoragePalletRecovery()
        ));
        root.addView(secondaryButton(
            tr("Отменить пересчёт", "Qayta sanashni bekor qilish"),
            view -> cancelStoragePalletRecovery()
        ));
    }

    private void scanStoragePalletRecoveryItem() {
        TsdSession session = safeSession();
        if (session == null || storagePalletAssembly == null || storagePalletAssembly.recovery == null) return;
        String barcode = textValue(storagePalletScanInput);
        if (barcode.isEmpty()) {
            statusMessage = tr("Пропикайте ШК товара.", "Tovar shtrix-kodini skanerlang.");
            renderStoragePalletAssemblyScreen();
            return;
        }
        String barcodeError = receiptBarcodeError(barcode);
        if (!barcodeError.isEmpty()) {
            statusMessage = tr(
                "Можно сканировать только ШК товара. " + barcodeError,
                "Faqat tovar shtrix-kodini skanerlash mumkin."
            );
            renderStoragePalletAssemblyScreen();
            return;
        }
        TsdStoragePalletResponse.Pallet pallet = storagePalletAssembly.pallet;
        if (pallet == null || pallet.client == null) return;
        statusMessage = tr("Проверяю товар…", "Tovar tekshirilmoqda…");
        renderStoragePalletAssemblyScreen();
        runBackground(() -> {
            Response<TsdSkuInfo> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .findSkuByBarcode(session.authorizationHeader(), pallet.client.id, barcode)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdSkuInfo sku = response.body();
            mainHandler.post(() -> {
                StoragePalletRecoveryItem current = storagePalletRecoveryItems.get(sku.id);
                if (current == null) {
                    storagePalletRecoveryItems.put(
                        sku.id,
                        new StoragePalletRecoveryItem(
                            sku.id,
                            barcode,
                            sku.displayName(barcode),
                            1
                        )
                    );
                } else {
                    current.quantity += 1;
                }
                online = true;
                statusMessage = tr("Товар учтён.", "Tovar hisobga olindi.");
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void completeStoragePalletRecovery() {
        TsdSession session = safeSession();
        if (
            session == null ||
            storagePalletAssembly == null ||
            storagePalletAssembly.pallet == null ||
            storagePalletAssembly.recovery == null
        ) return;
        if (storagePalletRecoveryItems.isEmpty()) {
            statusMessage = tr(
                "Сначала пропикайте содержимое короба.",
                "Avval quti tarkibini skanerlang."
            );
            renderStoragePalletAssemblyScreen();
            return;
        }
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("boxCode", storagePalletAssembly.recovery.boxCode);
        request.put("idempotencyKey", storagePalletRecoveryOperationId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (StoragePalletRecoveryItem item : storagePalletRecoveryItems.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("skuId", item.skuId);
            row.put("barcode", item.barcode);
            row.put("quantity", item.quantity);
            items.add(row);
        }
        request.put("items", items);
        String palletId = storagePalletAssembly.pallet.id;
        statusMessage = tr("Восстанавливаю короб и остатки…", "Quti va qoldiqlar tiklanmoqda…");
        renderStoragePalletAssemblyScreen();
        runBackground(() -> {
            Response<TsdStoragePalletResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .restoreStoragePalletBox(session.authorizationHeader(), palletId, request)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdStoragePalletResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                clearStoragePalletRecovery();
                storagePalletAssembly = loaded;
                statusMessage = safeText(loaded.message);
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void prepareStoragePalletRecovery(TsdStoragePalletResponse response) {
        if (response == null || response.recovery == null) {
            clearStoragePalletRecovery();
            return;
        }
        String boxCode = safeText(response.recovery.boxCode);
        if (storagePalletRecoveryOperationId.isEmpty()
            || !sameBox(storagePalletRecoveryBoxCode, boxCode)) {
            storagePalletRecoveryItems.clear();
            storagePalletRecoveryOperationId = "tsd-pallet-restore:" + UUID.randomUUID();
            storagePalletRecoveryBoxCode = boxCode;
        }
    }

    private void cancelStoragePalletRecovery() {
        if (storagePalletAssembly != null) {
            storagePalletAssembly.recovery = null;
            storagePalletAssembly.state = "SCAN_BOX";
        }
        clearStoragePalletRecovery();
        statusMessage = tr("Пересчёт отменён. Сканируйте следующий короб.", "Qayta sanash bekor qilindi. Keyingi qutini skanerlang.");
        renderStoragePalletAssemblyScreen();
    }

    private void clearStoragePalletRecovery() {
        storagePalletRecoveryItems.clear();
        storagePalletRecoveryOperationId = "";
        storagePalletRecoveryBoxCode = "";
    }

    private void finishStoragePallet() {
        TsdSession session = safeSession();
        TsdStoragePalletResponse.Pallet pallet =
            storagePalletAssembly == null ? null : storagePalletAssembly.pallet;
        if (session == null || pallet == null) {
            return;
        }
        statusMessage = tr("Завершаю паллету…", "Pallet yakunlanmoqda…");
        renderStoragePalletAssemblyScreen();
        runBackground(() -> {
            Response<TsdStoragePalletResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .closeStoragePallet(session.authorizationHeader(), pallet.id)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdStoragePalletResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                storagePalletAssembly = loaded;
                statusMessage = safeText(loaded.message);
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void confirmDeleteStoragePallet() {
        TsdStoragePalletResponse.Pallet pallet =
            storagePalletAssembly == null ? null : storagePalletAssembly.pallet;
        if (pallet == null) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Удалить паллет?", "Pallet o‘chirilsinmi?"))
            .setMessage(
                tr(
                    "Паллета " + pallet.code + " и её ошибочная привязка коробов будут удалены. После этого паллету можно открыть и пропикать заново.",
                    pallet.code + " pallet va qutilarning noto‘g‘ri bog‘lanishi o‘chiriladi. Keyin palletni qayta ochib skanerlash mumkin."
                )
            )
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(tr("Удалить", "O‘chirish"), (dialog, which) -> deleteStoragePallet())
            .show();
    }

    private void deleteStoragePallet() {
        TsdSession session = safeSession();
        TsdStoragePalletResponse.Pallet pallet =
            storagePalletAssembly == null ? null : storagePalletAssembly.pallet;
        if (session == null || pallet == null) return;
        statusMessage = tr("Удаляю паллету…", "Pallet o‘chirilmoqda…");
        renderStoragePalletAssemblyScreen();
        runBackground(() -> {
            Response<TsdStoragePalletResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .deleteStoragePallet(session.authorizationHeader(), pallet.id)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdStoragePalletResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                storagePalletAssembly = loaded;
                statusMessage = safeText(loaded.message);
                renderStoragePalletAssemblyScreen();
            });
        });
    }

    private void renderInventoryMenu() {
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
        screen = Screen.INVENTORY_MENU;
        activeInventory = null;
        activeInventoryBox = null;
        inventoryDashboard = null;
        inventoryType = "";
        inventoryClientId = "";
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        inventoryArchiveMode = false;
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
        root.addView(secondaryButton(
            tr("Архив проверок коробок", "Qutilar tekshiruvi arxivi"),
            view -> openInventoryBoxCheckArchive()
        ));
        root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderMainScreen()));
        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }
        root.addView(versionView());
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void restoreMandatoryFbsAuditState() {
        if (progressStore == null) return;
        TsdSession session = safeSession();
        String storedOwnerKey = progressStore.getString("mandatory_fbs_audit_owner", "");
        String currentOwnerKey = fbsSessionOwnerKey(session);
        if (session == null || storedOwnerKey.isEmpty() || !storedOwnerKey.equals(currentOwnerKey)) {
            clearMandatoryFbsAuditState();
            return;
        }
        mandatoryFbsAuditOwnerKey = storedOwnerKey;
        pendingFbsAuditBoxes.clear();
        Set<String> saved = progressStore.getStringSet("mandatory_fbs_audit_boxes", null);
        if (saved != null) pendingFbsAuditBoxes.addAll(saved);
        mandatoryFbsAuditBoxCode = progressStore.getString("mandatory_fbs_audit_box", "");
        mandatoryFbsAuditClientId = progressStore.getString("mandatory_fbs_audit_client", "");
        mandatoryFbsAuditSessionId = progressStore.getString("mandatory_fbs_audit_session", "");
        // Mandatory FBS box audits count physical units by the product barcode only.
        // Discard the obsolete KIZ step persisted by versions newer than 0.1.23.
        mandatoryFbsAuditPendingBarcode = "";
        mandatoryFbsAuditKizValues.clear();
        confirmedFbsBoxTaskId = progressStore.getString("confirmed_fbs_box_task", "");
        confirmedFbsBoxCode = progressStore.getString("confirmed_fbs_box_code", "");
        confirmedFbsBoxOwnerKey = progressStore.getString("confirmed_fbs_box_owner", "");
        mandatoryFbsAuditActive = !mandatoryFbsAuditBoxCode.isEmpty();
    }

    private void persistMandatoryFbsAuditState() {
        if (progressStore == null) return;
        progressStore.edit()
            .putStringSet("mandatory_fbs_audit_boxes", new LinkedHashSet<>(pendingFbsAuditBoxes))
            .putString("mandatory_fbs_audit_box", mandatoryFbsAuditBoxCode)
            .putString("mandatory_fbs_audit_client", mandatoryFbsAuditClientId)
            .putString("mandatory_fbs_audit_session", mandatoryFbsAuditSessionId)
            .putString("mandatory_fbs_audit_owner", mandatoryFbsAuditOwnerKey)
            .putString("mandatory_fbs_audit_barcode", mandatoryFbsAuditPendingBarcode)
            .putStringSet("mandatory_fbs_audit_kiz", new LinkedHashSet<>(mandatoryFbsAuditKizValues))
            .putString("confirmed_fbs_box_task", confirmedFbsBoxTaskId)
            .putString("confirmed_fbs_box_code", confirmedFbsBoxCode)
            .putString("confirmed_fbs_box_owner", confirmedFbsBoxOwnerKey)
            .apply();
    }

    private String fbsSessionOwnerKey(TsdSession session) {
        if (session == null) return "";
        return nonEmpty(session.userId, "") + "\u001f" + nonEmpty(session.deviceCode, "");
    }

    private void clearConfirmedFbsBoxScan() {
        confirmedFbsBoxTaskId = "";
        confirmedFbsBoxCode = "";
        confirmedFbsBoxOwnerKey = "";
    }

    private void clearMandatoryFbsAuditState() {
        pendingFbsAuditBoxes.clear();
        inventoryRequestBusy = false;
        mandatoryFbsAuditActive = false;
        mandatoryFbsAuditBoxCode = "";
        mandatoryFbsAuditClientId = "";
        mandatoryFbsAuditSessionId = "";
        mandatoryFbsAuditPendingBarcode = "";
        mandatoryFbsAuditOwnerKey = "";
        mandatoryFbsAuditKizValues.clear();
        clearConfirmedFbsBoxScan();
        if (progressStore != null) {
            progressStore.edit()
                .remove("mandatory_fbs_audit_boxes")
                .remove("mandatory_fbs_audit_box")
                .remove("mandatory_fbs_audit_client")
                .remove("mandatory_fbs_audit_session")
                .remove("mandatory_fbs_audit_owner")
                .remove("mandatory_fbs_audit_barcode")
                .remove("mandatory_fbs_audit_kiz")
                .remove("confirmed_fbs_box_task")
                .remove("confirmed_fbs_box_code")
                .remove("confirmed_fbs_box_owner")
                .apply();
        }
    }

    private String mandatoryFbsAuditKey(String clientId, String boxCode) {
        return nonEmpty(clientId, "").trim() + "\u001f" + nonEmpty(boxCode, "").trim();
    }

    private void removeEquivalentMandatoryFbsAudit(String clientId, String boxCode) {
        String expectedClientId = nonEmpty(clientId, "").trim();
        pendingFbsAuditBoxes.removeIf(entry -> {
            int divider = entry.indexOf('\u001f');
            if (divider <= 0 || divider >= entry.length() - 1) return false;
            String queuedClientId = entry.substring(0, divider).trim();
            String queuedBoxCode = entry.substring(divider + 1).trim();
            return expectedClientId.equals(queuedClientId) && sameBox(queuedBoxCode, boxCode);
        });
    }

    private void queueMandatoryFbsAudit(String clientId, String boxCode) {
        if (nonEmpty(clientId, "").isEmpty() || nonEmpty(boxCode, "").isEmpty()) return;
        TsdSession session = safeSession();
        String ownerKey = fbsSessionOwnerKey(session);
        if (ownerKey.isEmpty()) return;
        if (!mandatoryFbsAuditOwnerKey.isEmpty() && !mandatoryFbsAuditOwnerKey.equals(ownerKey)) {
            clearMandatoryFbsAuditState();
        }
        mandatoryFbsAuditOwnerKey = ownerKey;
        removeEquivalentMandatoryFbsAudit(clientId, boxCode);
        pendingFbsAuditBoxes.add(mandatoryFbsAuditKey(clientId, boxCode));
        persistMandatoryFbsAuditState();
    }

    private void resumeMandatoryFbsAudit() {
        if (!mandatoryFbsAuditActive) {
            if (pendingFbsAuditBoxes.isEmpty()) {
                openFbsAssembly();
                return;
            }
            String next = pendingFbsAuditBoxes.iterator().next();
            int divider = next.indexOf('\u001f');
            if (divider <= 0 || divider >= next.length() - 1) {
                pendingFbsAuditBoxes.remove(next);
                persistMandatoryFbsAuditState();
                resumeMandatoryFbsAudit();
                return;
            }
            mandatoryFbsAuditClientId = next.substring(0, divider);
            mandatoryFbsAuditBoxCode = next.substring(divider + 1);
            mandatoryFbsAuditSessionId = "";
            mandatoryFbsAuditPendingBarcode = "";
            mandatoryFbsAuditKizValues.clear();
            mandatoryFbsAuditActive = true;
            persistMandatoryFbsAuditState();
        }
        inventoryType = "BOX_CHECK";
        inventoryClientId = mandatoryFbsAuditClientId;
        inventoryArchiveMode = false;
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        statusMessage = tr(
            "Обязательная проверка короба " + mandatoryFbsAuditBoxCode + ". Сборка FBS продолжится только после сверки и актуализации.",
            mandatoryFbsAuditBoxCode + " qutisini majburiy tekshirish. FBS faqat tekshiruv va yangilashdan keyin davom etadi."
        );
        if (!mandatoryFbsAuditSessionId.isEmpty()) {
            loadMandatoryFbsAuditSession();
        } else {
            startMandatoryFbsAuditSession();
        }
    }

    private void startMandatoryFbsAuditSession() {
        TsdSession session = safeSession();
        if (session == null) return;
        activeInventory = null;
        activeInventoryBox = null;
        screen = Screen.INVENTORY_COUNT;
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("type", "BOX_CHECK");
            request.put("clientId", mandatoryFbsAuditClientId);
            request.put("title", "Обязательная проверка после сборки FBS · " + mandatoryFbsAuditBoxCode);
            request.put("comment", "[FBS_MANDATORY_BOX_CHECK] Короб выбран в FBS, но нужный товар не был подтверждён.");
            Response<TsdInventoryDashboard> dashboardResponse = api.inventoryDashboard(
                session.authorizationHeader(),
                true
            ).execute();
            Response<TsdInventorySession> createdResponse = api.startInventory(
                session.authorizationHeader(),
                request
            ).execute();
            if (!createdResponse.isSuccessful() || createdResponse.body() == null) {
                throw new IOException(inventoryHttpError(createdResponse));
            }
            TsdInventorySession created = createdResponse.body();
            TsdInventoryBox box = null;
            if (created.boxes != null) {
                for (TsdInventoryBox existingBox : created.boxes) {
                    if (existingBox != null && sameBox(existingBox.boxCode, mandatoryFbsAuditBoxCode)) {
                        box = existingBox;
                        break;
                    }
                }
            }
            if (box == null) {
                Map<String, Object> openRequest = new LinkedHashMap<>();
                openRequest.put("boxCode", mandatoryFbsAuditBoxCode);
                Response<TsdInventoryBox> boxResponse = api.openInventoryBox(
                    session.authorizationHeader(),
                    created.id,
                    openRequest
                ).execute();
                if (!boxResponse.isSuccessful() || boxResponse.body() == null) {
                    throw new IOException(inventoryHttpError(boxResponse));
                }
                box = boxResponse.body();
            }
            TsdInventoryBox openedBox = box;
            TsdInventoryDashboard dashboard = dashboardResponse.isSuccessful()
                ? dashboardResponse.body()
                : null;
            mainHandler.post(() -> {
                online = true;
                inventoryDashboard = dashboard;
                activeInventory = created;
                activeInventoryBox = openedBox;
                mandatoryFbsAuditBoxCode = nonEmpty(openedBox.boxCode, mandatoryFbsAuditBoxCode);
                mandatoryFbsAuditSessionId = created.id;
                persistMandatoryFbsAuditState();
                statusMessage = tr(
                    "Отсканируйте каждую единицу только по ШК товара. КИЗ в этой проверке не требуется.",
                    "Har bir birlikni faqat mahsulot SHKsi bilan skanerlang. Bu tekshiruvda KIZ kerak emas."
                );
                if (continueAfterMandatoryFbsAuditIfReady()) {
                    return;
                }
                renderInventoryCountScreen();
                new AlertDialog.Builder(this)
                    .setTitle(tr("Обязательная проверка короба", "Qutini majburiy tekshirish"))
                    .setMessage(tr(
                        "Сборка FBS приостановлена. Полностью пропикайте короб " + mandatoryFbsAuditBoxCode + " только по ШК товара. После сверки подтвердите актуализацию.",
                        "FBS yig‘ish to‘xtatildi. " + mandatoryFbsAuditBoxCode + " qutisini faqat mahsulot SHKsi bilan to‘liq tekshiring."
                    ))
                    .setPositiveButton(tr("Понятно", "Tushunarli"), null)
                    .show();
            });
        });
    }

    private void loadMandatoryFbsAuditSession() {
        TsdSession session = safeSession();
        if (session == null) return;
        screen = Screen.INVENTORY_COUNT;
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryDashboard> dashboardResponse = api.inventoryDashboard(
                session.authorizationHeader(),
                true
            ).execute();
            Response<TsdInventorySession> response = api.getInventory(
                session.authorizationHeader(),
                mandatoryFbsAuditSessionId,
                false
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                mandatoryFbsAuditSessionId = "";
                persistMandatoryFbsAuditState();
                mainHandler.post(this::startMandatoryFbsAuditSession);
                return;
            }
            TsdInventorySession loaded = response.body();
            TsdInventoryBox target = null;
            if (loaded.boxes != null) {
                for (TsdInventoryBox box : loaded.boxes) {
                    if (box != null && sameBox(box.boxCode, mandatoryFbsAuditBoxCode)) {
                        target = box;
                        break;
                    }
                }
            }
            TsdInventoryBox loadedBox = target;
            TsdInventoryDashboard dashboard = dashboardResponse.isSuccessful()
                ? dashboardResponse.body()
                : null;
            mainHandler.post(() -> {
                online = true;
                inventoryDashboard = dashboard;
                activeInventory = loaded;
                activeInventoryBox = loadedBox;
                if (!continueAfterMandatoryFbsAuditIfReady()) {
                    renderInventoryCountScreen();
                }
            });
        });
    }

    private void openInventoryMode(String type) {
        inventoryType = type;
        inventoryArchiveMode = false;
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
            Response<TsdInventoryDashboard> response = api.inventoryDashboard(session.authorizationHeader(), true).execute();
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

    private void openInventoryBoxCheckArchive() {
        inventoryType = "BOX_CHECK";
        inventoryArchiveMode = true;
        activeInventory = null;
        activeInventoryBox = null;
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        statusMessage = tr("Загружаю архив проверок коробок…", "Qutilar tekshiruvi arxivi yuklanmoqda…");
        screen = Screen.INVENTORY_START;
        renderInventoryStartScreen();
        TsdSession session = safeSession();
        if (session == null) {
            return;
        }
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryDashboard> response = api.inventoryDashboard(session.authorizationHeader(), true).execute();
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
        root.addView(title(inventoryArchiveMode
            ? tr("Архив проверок коробок", "Qutilar tekshiruvi arxivi")
            : inventoryTypeTitle()));

        if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        if (inventoryArchiveMode) {
            List<TsdInventorySession> archive = completedBoxCheckSessions();
            if (archive.isEmpty()) {
                root.addView(feedbackView(
                    tr("Завершённых проверок коробов пока нет.", "Tugallangan quti tekshiruvlari hozircha yo‘q."),
                    LIGHT_GRAY
                ));
            } else {
                root.addView(label(tr("Завершённые проверки", "Tugallangan tekshiruvlar")));
                for (TsdInventorySession item : archive) {
                    String progress = item.progress == null
                        ? ""
                        : "\n" + tr("Проверено коробов", "Tekshirilgan qutilar") + ": " + item.progress.checkedBoxes;
                    String completed = safeText(item.completedAt);
                    if (!completed.isEmpty()) {
                        progress += "\n" + tr("Завершено: ", "Yakunlangan: ") + completed;
                    }
                    if (item.completedByName != null && !item.completedByName.trim().isEmpty()) {
                        progress += "\n" + tr("Сотрудник: ", "Xodim: ") + item.completedByName;
                    }
                    root.addView(taskRow(safeText(item.title), progress, BOX_FOUND_GREEN));
                }
            }
            root.addView(secondaryButton(
                tr("Обновить архив", "Arxivni yangilash"),
                view -> openInventoryBoxCheckArchive()
            ));
            root.addView(secondaryButton(
                tr("К очереди проверки коробок", "Qutilar tekshiruvi navbatiga"),
                view -> openInventoryMode("BOX_CHECK")
            ));
            root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> renderInventoryMenu()));
            root.addView(versionView());
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        List<TsdInventorySession> active = activeInventorySessions();
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
        // Previous/unfinished checks are reference information. Keep the
        // primary action (start a new box check) at the top and render the
        // previous checks below all current-work controls.
        if (!active.isEmpty()) {
            root.addView(label(tr("Предыдущие проверки", "Oldingi tekshiruvlar")));
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

    private List<TsdInventorySession> completedBoxCheckSessions() {
        List<TsdInventorySession> result = new ArrayList<>();
        if (inventoryDashboard == null || inventoryDashboard.historySessions == null) {
            return result;
        }
        for (TsdInventorySession item : inventoryDashboard.historySessions) {
            if (item != null && "BOX_CHECK".equals(item.type) && "COMPLETED".equals(item.status)) {
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
            Response<TsdInventorySession> response = api.getInventory(session.authorizationHeader(), id, true).execute();
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
        if (mandatoryFbsAuditActive) {
            root.addView(feedbackView(
                tr(
                    "FBS ПРИОСТАНОВЛЕН · обязательная проверка " + mandatoryFbsAuditBoxCode,
                    "FBS TO‘XTATILDI · " + mandatoryFbsAuditBoxCode + " majburiy tekshiruv"
                ),
                Color.rgb(254, 215, 170)
            ));
        }
        if (activeInventory == null) {
            root.addView(messageView(tr("Инвентаризация не открыта.", "Inventarizatsiya ochilmagan.")));
            if (!mandatoryFbsAuditActive) {
                root.addView(secondaryButton(tr("Назад", "Orqaga"), view -> openInventoryMode(inventoryType)));
            }
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
        if (inventoryRequestBusy) {
            root.addView(feedbackView(
                tr("Дождитесь ответа WMS. Повторное сканирование временно заблокировано.", "WMS javobini kuting. Takroriy skan vaqtincha bloklangan."),
                LIGHT_GRAY
            ));
            root.addView(versionView());
            setScrollableContent(root);
            refreshHeaderText();
            return;
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
                if (!mandatoryFbsAuditActive) root.addView(inventoryQuantityInput);
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
                addInventoryAdminActions(root, activeInventoryBox);
                addInventoryTransferAction(root, activeInventoryBox);
                if (mandatoryFbsAuditActive) {
                    if ("MATCHED".equals(activeInventoryBox.status) || "RESOLVED".equals(activeInventoryBox.status)) {
                        root.addView(primaryMenuButton(
                            tr("Проверка завершена — продолжить FBS", "Tekshiruv tugadi — FBSni davom ettirish"),
                            view -> finishMandatoryFbsAudit()
                        ));
                    } else {
                        root.addView(feedbackView(
                            tr(
                                "Есть расхождения. Сборка останется заблокированной до актуализации короба администратором.",
                                "Tafovut bor. Administrator qutini yangilamaguncha FBS bloklangan."
                            ),
                            BOX_NOT_NEEDED_RED
                        ));
                        root.addView(secondaryButton(
                            tr("Проверить статус актуализации", "Yangilash holatini tekshirish"),
                            view -> reloadInventorySession(true)
                        ));
                    }
                } else {
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
        }

        if (!mandatoryFbsAuditActive) {
            root.addView(secondaryButton(
                "BOX_CHECK".equals(inventoryType)
                    ? tr("Завершить проверку", "Tekshiruvni yakunlash")
                    : tr("Передать на актуализацию", "Tuzatish uchun yuborish"),
                view -> finishInventorySession()
            ));
            root.addView(secondaryButton(tr("Назад к режимам", "Rejimlarga qaytish"), view -> renderInventoryMenu()));
        }
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

    private void addInventoryAdminActions(LinearLayout root, TsdInventoryBox box) {
        if (inventoryDashboard == null || !inventoryDashboard.canManage) {
            return;
        }
        if ("RESOLVED".equals(box.status)) {
            root.addView(feedbackView(
                tr("Проверка подтверждена администратором.", "Tekshiruv administrator tomonidan tasdiqlandi."),
                BOX_FOUND_GREEN
            ));
            return;
        }
        boolean mismatch = false;
        if (box.lines != null) {
            for (TsdInventoryLine line : box.lines) {
                if (line.countedQuantity != line.expectedQuantity && "PENDING".equals(line.decision)) {
                    mismatch = true;
                    break;
                }
            }
        }
        if (!mismatch) {
            root.addView(primaryMenuButton(
                tr("Подтвердить проверку короба", "Quti tekshiruvini tasdiqlash"),
                view -> confirmResolveInventoryBox("ACCEPT_AS_IS")
            ));
            return;
        }
        root.addView(primaryMenuButton(
            tr("Актуализировать и переместить в другой короб", "Yangilash va boshqa qutiga ko‘chirish"),
            view -> confirmResolveInventoryBox("APPLY_ACTUAL", true)
        ));
        root.addView(secondaryButton(
            tr("Только актуализировать товары по факту", "Faqat tovarlarni amaldagi miqdor bo‘yicha yangilash"),
            view -> confirmResolveInventoryBox("APPLY_ACTUAL", false)
        ));
        root.addView(secondaryButton(
            tr("Подтвердить без изменения WMS", "WMSni o‘zgartirmasdan tasdiqlash"),
            view -> confirmResolveInventoryBox("ACCEPT_AS_IS")
        ));
    }

    private void confirmResolveInventoryBox(String action) {
        confirmResolveInventoryBox(action, false);
    }

    private void confirmResolveInventoryBox(String action, boolean moveAfterResolve) {
        if (activeInventoryBox == null) {
            return;
        }
        boolean applyActual = "APPLY_ACTUAL".equals(action);
        String titleText = applyActual
            ? tr("Актуализировать остатки?", "Qoldiqlarni yangilaysizmi?")
            : tr("Подтвердить без изменений?", "O‘zgarishsiz tasdiqlaysizmi?");
        String messageText = applyActual
            ? tr(
                "Остатки в WMS будут заменены фактически подсчитанными значениями. Действие запишется в журнал.",
                "WMS qoldiqlari amalda sanalgan qiymatlar bilan almashtiriladi. Harakat jurnalga yoziladi."
            )
            : tr(
                "Фактические расхождения останутся, а значения WMS не изменятся. Действие запишется в журнал.",
                "Amaldagi tafovutlar qoladi, WMS qiymatlari o‘zgarmaydi. Harakat jurnalga yoziladi."
            );
        if (moveAfterResolve) {
            messageText += tr(
                " После актуализации здесь же откроется сканирование целевого короба.",
                " Yangilangandan so‘ng shu ekranda maqsad qutini skanerlash ochiladi."
            );
        }
        new AlertDialog.Builder(this)
            .setTitle(titleText)
            .setMessage(messageText)
            .setNegativeButton(tr("Отмена", "Bekor qilish"), null)
            .setPositiveButton(
                tr("Подтвердить", "Tasdiqlash"),
                (dialog, which) -> resolveInventoryBox(action, moveAfterResolve)
            )
            .show();
    }

    private void resolveInventoryBox(String action, boolean moveAfterResolve) {
        TsdSession session = safeSession();
        if (session == null || activeInventoryBox == null) {
            return;
        }
        String boxId = activeInventoryBox.id;
        statusMessage = "APPLY_ACTUAL".equals(action)
            ? tr("Актуализирую остатки…", "Qoldiqlar yangilanmoqda…")
            : tr("Подтверждаю проверку…", "Tekshiruv tasdiqlanmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("action", action);
            request.put("comment", "Решение принято администратором на ТСД");
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryBox> response = api.resolveInventoryBox(
                session.authorizationHeader(),
                boxId,
                request
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventoryBox resolved = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventoryBox = resolved;
                inventoryTransferMode = moveAfterResolve;
                statusMessage = "APPLY_ACTUAL".equals(action)
                    ? moveAfterResolve
                        ? tr(
                            "Остатки актуализированы. Пропикайте короб, куда переместить товар.",
                            "Qoldiqlar yangilandi. Tovar ko‘chiriladigan qutini skanerlang."
                        )
                        : tr("Остатки актуализированы.", "Qoldiqlar yangilandi.")
                    : tr("Проверка подтверждена.", "Tekshiruv tasdiqlandi.");
                reloadInventorySession(true);
            });
        });
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
        if (session == null || activeInventoryBox == null || inventoryRequestBusy) {
            return;
        }
        String scannedValue = textValue(inventoryItemInput);
        if (scannedValue.isEmpty()) {
            statusMessage = tr("Пропикайте штрихкод товара.", "Tovar shtrix-kodini skanerlang.");
            renderInventoryCountScreen();
            return;
        }
        String barcode = scannedValue;
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
        inventoryRequestBusy = true;
        statusMessage = tr("Учитываю товар…", "Tovar hisobga olinmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("barcode", barcode);
            request.put("quantity", mandatoryFbsAuditActive ? 1 : finalQuantity);
            if (mandatoryFbsAuditActive) {
                request.put("requireKiz", false);
            }
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventoryLine> response = api.scanInventoryItem(
                session.authorizationHeader(),
                activeInventoryBox.id,
                request
            ).execute();
            if (!response.isSuccessful()) {
                String message = inventoryHttpError(response);
                throw new IOException(message);
            }
            mainHandler.post(() -> {
                online = true;
                inventoryRequestBusy = false;
                mandatoryFbsAuditPendingBarcode = "";
                persistMandatoryFbsAuditState();
                statusMessage = tr("Товар учтён: ", "Tovar hisobga olindi: ") + barcode;
                reloadInventorySession(true);
            });
        });
    }

    private void finishMandatoryFbsAudit() {
        TsdSession session = safeSession();
        if (session == null || activeInventory == null || activeInventoryBox == null || inventoryRequestBusy) return;
        if (!"MATCHED".equals(activeInventoryBox.status) && !"RESOLVED".equals(activeInventoryBox.status)) {
            statusMessage = tr(
                "Сначала завершите подсчёт и актуализируйте расхождения.",
                "Avval sanashni tugating va tafovutlarni yangilang."
            );
            renderInventoryCountScreen();
            return;
        }
        String completedClientId = mandatoryFbsAuditClientId;
        String completedBoxCode = mandatoryFbsAuditBoxCode;
        inventoryRequestBusy = true;
        statusMessage = tr("Закрываю проверку и возвращаюсь в FBS…", "Tekshiruv yopilmoqda va FBSga qaytilmoqda…");
        renderInventoryCountScreen();
        runBackground(() -> {
            WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
            Response<TsdInventorySession> response = api.finishInventory(
                session.authorizationHeader(),
                activeInventory.id
            ).execute();
            if (!response.isSuccessful()) throw new IOException(inventoryHttpError(response));
            mainHandler.post(() -> completeMandatoryFbsAuditLocally(completedClientId, completedBoxCode));
        });
    }

    private boolean continueAfterMandatoryFbsAuditIfReady() {
        if (!mandatoryFbsAuditActive || activeInventory == null || activeInventoryBox == null) {
            return false;
        }
        int pendingDifferences = 0;
        if (activeInventoryBox.lines != null) {
            for (TsdInventoryLine line : activeInventoryBox.lines) {
                if (
                    line != null &&
                    line.countedQuantity != line.expectedQuantity &&
                    "PENDING".equals(safeText(line.decision))
                ) {
                    pendingDifferences += 1;
                }
            }
        }
        if (!FbsTaskSafety.mandatoryAuditCanResume(
            activeInventory.status,
            activeInventoryBox.status,
            pendingDifferences
        )) {
            return false;
        }
        if (FbsTaskSafety.mandatoryAuditAlreadyCompleted(activeInventory.status)) {
            completeMandatoryFbsAuditLocally(mandatoryFbsAuditClientId, mandatoryFbsAuditBoxCode);
        } else {
            finishMandatoryFbsAudit();
        }
        return true;
    }

    private void completeMandatoryFbsAuditLocally(String completedClientId, String completedBoxCode) {
        inventoryRequestBusy = false;
        removeEquivalentMandatoryFbsAudit(completedClientId, completedBoxCode);
        mandatoryFbsAuditActive = false;
        mandatoryFbsAuditBoxCode = "";
        mandatoryFbsAuditClientId = "";
        mandatoryFbsAuditSessionId = "";
        mandatoryFbsAuditPendingBarcode = "";
        mandatoryFbsAuditKizValues.clear();
        if (pendingFbsAuditBoxes.isEmpty()) {
            mandatoryFbsAuditOwnerKey = "";
        }
        activeInventory = null;
        activeInventoryBox = null;
        persistMandatoryFbsAuditState();
        statusMessage = tr(
            "Короб проверен и актуализирован. Сборка FBS разблокирована.",
            "Quti tekshirildi va yangilandi. FBS blokdan chiqarildi."
        );
        if (!pendingFbsAuditBoxes.isEmpty()) resumeMandatoryFbsAudit();
        else openFbsAssembly();
    }

    private void finishInventoryBox() {
        TsdSession session = safeSession();
        if (session == null || activeInventoryBox == null || inventoryRequestBusy) {
            return;
        }
        String boxId = activeInventoryBox.id;
        inventoryRequestBusy = true;
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
                inventoryRequestBusy = false;
                activeInventoryBox = finished;
                inventoryTransferMode = false;
                statusMessage = "";
                if (!continueAfterMandatoryFbsAuditIfReady()) {
                    renderInventoryCountScreen();
                }
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
                Object autoApprovedValue = result.get("autoApprovedChecks");
                int autoApprovedChecks = autoApprovedValue instanceof Number
                    ? ((Number) autoApprovedValue).intValue()
                    : 0;
                boolean archived = Boolean.TRUE.equals(result.get("sourceArchived"));
                statusMessage = tr(
                    "Перемещено " + quantity + " шт. в короб " + targetBoxCode +
                        (archived ? ". Исходный короб отправлен в архив." : ".") +
                        (autoApprovedChecks > 0
                            ? " Администратором автоматически подтверждено проверок: " + autoApprovedChecks + "."
                            : ""),
                    quantity + " dona " + targetBoxCode + " qutiga ko‘chirildi" +
                        (archived ? ". Manba quti arxivga yuborildi." : ".") +
                        (autoApprovedChecks > 0
                            ? " Administrator avtomatik tasdiqlagan tekshiruvlar: " + autoApprovedChecks + "."
                            : "")
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
            Response<TsdInventorySession> response = api.getInventory(
                session.authorizationHeader(),
                sessionId,
                !keepBox
            ).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdInventorySession loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                activeInventory = loaded;
                activeInventoryBox = boxId.isEmpty() ? null : findInventoryBox(loaded, boxId);
                if (!continueAfterMandatoryFbsAuditIfReady()) {
                    renderInventoryCountScreen();
                }
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

        if (receiptMode.isEmpty()) {
            root.addView(messageView(
                "Выберите способ приемки. В обоих режимах один КИЗ можно принять только один раз."
            ));
            root.addView(primaryMenuButton(
                "Обычная приемка",
                view -> selectReceiptMode(RECEIPT_MODE_STANDARD)
            ));
            root.addView(primaryMenuButton(
                "Приемка по боксам",
                view -> selectReceiptMode(RECEIPT_MODE_BOXES)
            ));
            root.addView(messageView(
                "Приемка по боксам: сканируйте бокс/короб, добавляйте товары, закройте его и переходите к следующему."
            ));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        if (receiptClientId.isEmpty()) {
            root.addView(messageView("Режим: " + receiptModeLabel()));
            root.addView(label("Клиент приемки"));
            clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<String>());
            clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            clientSpinner = new Spinner(this);
            clientSpinner.setAdapter(clientAdapter);
            refreshClientOptions();
            root.addView(clientSpinner);
            root.addView(primaryMenuButton("Выбрать клиента", view -> startReceiptForSelectedClient()));
            root.addView(secondaryButton("Обновить клиентов", view -> loadClients(true)));
            root.addView(secondaryButton("Изменить режим", view -> resetReceiptStateAndRender()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        root.addView(messageView("Клиент: " + receiptClientName()));
        root.addView(messageView(!receiptUsesBoxes()
            ? "Режим: без коробов · принято товаров: " + receiptAcceptedItems
            : "Режим: по боксам · закрыто боксов: " + receiptClosedBoxes + " · товаров: " + receiptAcceptedItems));

        if (receiptKizAuditMode) {
            root.addView(feedbackView(
                "ПРОВЕРКА ПРИНЯТЫХ КИЗ\nСканирование здесь ничего повторно не принимает и не меняет остатки.",
                BOX_DUPLICATE_BLUE
            ));
            scanInput = input("Сканируйте КИЗ для проверки");
            scanInput.setOnEditorActionListener((view, actionId, event) -> {
                handleReceiptKizAuditScan();
                return true;
            });
            root.addView(scanInput);
            root.addView(primaryMenuButton("Проверить КИЗ", view -> handleReceiptKizAuditScan()));
            root.addView(secondaryButton("Вернуться к приемке", view -> stopReceiptKizAudit()));
            root.addView(secondaryButton("Назад", view -> renderMainScreen()));
            setScrollableContent(root);
            scanInput.requestFocus();
            refreshHeaderText();
            return;
        }

        if (!receiptUsesBoxes()) {
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
                root.addView(secondaryButton("Проверить принятые КИЗы", view -> startReceiptKizAudit()));
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
            root.addView(secondaryButton("Проверить принятые КИЗы", view -> startReceiptKizAudit()));
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
            root.addView(secondaryButton("Проверить принятые КИЗы", view -> startReceiptKizAudit()));
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
        root.addView(title(BuildConfig.BRAND_NAME));
        root.addView(messageView("Приложение не смогло открыть локальную базу. Переустановите приложение или очистите данные ТСД."));
        root.addView(messageView(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()));
        root.addView(secondaryButton("Скачать приложение заново", view -> openApkDownload()));
        root.addView(versionView());
        setScrollableContent(root);
    }

    private void openOzonFboAssembly() {
        if (safeSession() == null) {
            statusMessage = tr("Сначала выполните вход в настройках.", "Avval sozlamalarda tizimga kiring.");
            renderSettingsScreen();
            return;
        }
        ozonFboOverview = null;
        ozonFboPlan = null;
        ozonFboBox = null;
        ozonFboBusy = false;
        ozonFboFeedbackColor = 0;
        statusMessage = tr("Выберите клиента FBO Ozon.", "Ozon FBO mijozini tanlang.");
        renderOzonFboClientScreen();
    }

    private void renderOzonFboClientScreen() {
        screen = Screen.OZON_FBO_CLIENT;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Сборка FBO Ozon", "Ozon FBO yig‘ish")));
        if (!statusMessage.isEmpty()) root.addView(messageView(statusMessage));
        if (clients.isEmpty()) {
            root.addView(feedbackView(
                tr("Список клиентов ещё не загружен. Нажмите «Обновить клиентов».", "Mijozlar ro‘yxati yuklanmagan."),
                LIGHT_GRAY
            ));
        } else {
            clientAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, new ArrayList<>());
            clientAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            clientSpinner = new Spinner(this);
            clientSpinner.setAdapter(clientAdapter);
            root.addView(label(tr("Клиент", "Mijoz")));
            root.addView(clientSpinner);
            refreshClientOptions();
            root.addView(primaryMenuButton(
                tr("Показать поставки FBO Ozon", "Ozon FBO yetkazib berishlarini ko‘rsatish"),
                view -> loadOzonFboPlans()
            ));
        }
        root.addView(secondaryButton(tr("Обновить клиентов", "Mijozlarni yangilash"), view -> loadClients(true)));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        refreshHeaderText();
    }

    private String selectedOzonFboClientId() {
        if (clientSpinner == null) return null;
        int index = clientSpinner.getSelectedItemPosition() - 1;
        if (index < 0 || index >= clients.size()) return null;
        return clients.get(index).id;
    }

    private void loadOzonFboPlans() {
        TsdSession session = safeSession();
        String clientId = selectedOzonFboClientId();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        if (clientId == null || clientId.trim().isEmpty()) {
            statusMessage = tr("Выберите клиента.", "Mijozni tanlang.");
            renderOzonFboClientScreen();
            return;
        }
        screen = Screen.OZON_FBO_PLANS;
        ozonFboBusy = true;
        statusMessage = tr("Загружаю поставки FBO Ozon...", "Ozon FBO yetkazib berishlari yuklanmoqda...");
        renderOzonFboPlansScreen();
        runBackground(() -> {
            Response<TsdOzonFboOverview> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .listOzonFboPlans(session.authorizationHeader(), clientId)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr("Не удалось загрузить поставки FBO Ozon.", "Ozon FBO ro‘yxatini yuklab bo‘lmadi."));
                mainHandler.post(() -> showOzonFboError(message));
                return;
            }
            TsdOzonFboOverview loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                ozonFboBusy = false;
                ozonFboFeedbackColor = 0;
                ozonFboOverview = loaded;
                statusMessage = tr("Выберите поставку для сборки.", "Yig‘ish uchun yetkazib berishni tanlang.");
                renderOzonFboPlansScreen();
            });
        });
    }

    private void renderOzonFboPlansScreen() {
        screen = Screen.OZON_FBO_PLANS;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("FBO Ozon — поставки", "Ozon FBO — yetkazib berishlar")));
        if (!statusMessage.isEmpty()) root.addView(feedbackView(
            statusMessage,
            ozonFboFeedbackColor == 0 ? Color.rgb(219, 234, 254) : ozonFboFeedbackColor
        ));
        if (ozonFboBusy) {
            root.addView(messageView(tr("Подождите, идёт загрузка...", "Kutib turing, yuklanmoqda...")));
        }
        int visible = 0;
        if (ozonFboOverview != null && ozonFboOverview.plans != null) {
            for (TsdOzonFboOverview.Plan plan : ozonFboOverview.plans) {
                if (plan == null || plan.boxes <= 0) continue;
                visible += 1;
                int remaining = Math.max(0, plan.totalUnits - plan.assembledUnits);
                root.addView(taskRow(
                    nonEmpty(plan.title, "FBO Ozon"),
                    tr("Товары: ", "Tovarlar: ") + plan.assembledUnits + " / " + plan.totalUnits +
                        "\n" + tr("Короба: ", "Qutilar: ") + plan.closedBoxes + " / " + plan.boxes +
                        " · " + tr("осталось единиц: ", "qoldi: ") + remaining,
                    plan.closedBoxes == plan.boxes ? BOX_FOUND_GREEN : Color.rgb(219, 234, 254)
                ));
                root.addView(multilineSecondaryButton(
                    plan.closedBoxes == plan.boxes
                        ? tr("Посмотреть закрытые короба", "Yopilgan qutilarni ko‘rish")
                        : tr("Открыть сборку", "Yig‘ishni ochish"),
                    view -> loadOzonFboPlan(plan.id)
                ));
            }
        }
        if (!ozonFboBusy && visible == 0) {
            root.addView(feedbackView(
                tr("Поставок с созданными коробами пока нет. Сначала создайте короба на этапе 3 в WMS.", "Yaratilgan qutilari bor yetkazib berishlar yo‘q."),
                LIGHT_GRAY
            ));
        }
        root.addView(secondaryButton(tr("Обновить список", "Ro‘yxatni yangilash"), view -> loadOzonFboPlans()));
        root.addView(secondaryButton(tr("Сменить клиента", "Mijozni almashtirish"), view -> renderOzonFboClientScreen()));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void loadOzonFboPlan(String planId) {
        TsdSession session = safeSession();
        if (session == null || planId == null || planId.trim().isEmpty()) return;
        screen = Screen.OZON_FBO_BOXES;
        ozonFboBusy = true;
        statusMessage = tr("Загружаю короба...", "Qutilar yuklanmoqda...");
        renderOzonFboBoxesScreen();
        runBackground(() -> {
            Response<TsdOzonFboPlan> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .getOzonFboPlan(session.authorizationHeader(), planId)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr("Не удалось загрузить короба FBO Ozon.", "Ozon FBO qutilarini yuklab bo‘lmadi."));
                mainHandler.post(() -> showOzonFboError(message));
                return;
            }
            TsdOzonFboPlan loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                ozonFboBusy = false;
                ozonFboFeedbackColor = 0;
                ozonFboPlan = loaded;
                ozonFboBox = null;
                statusMessage = tr("Отсканируйте номер короба WMS или выберите его из списка.", "WMS quti raqamini skanerlang yoki ro‘yxatdan tanlang.");
                renderOzonFboBoxesScreen();
            });
        });
    }

    private void renderOzonFboBoxesScreen() {
        screen = Screen.OZON_FBO_BOXES;
        ozonFboScanInput = null;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("FBO Ozon — короба WMS", "Ozon FBO — WMS qutilari")));
        if (ozonFboPlan != null) root.addView(messageView(nonEmpty(ozonFboPlan.title, "FBO Ozon")));
        if (!statusMessage.isEmpty()) root.addView(feedbackView(
            statusMessage,
            ozonFboFeedbackColor == 0 ? Color.rgb(219, 234, 254) : ozonFboFeedbackColor
        ));
        if (ozonFboBusy) root.addView(messageView(tr("Подождите...", "Kutib turing...")));
        if (ozonFboPlan != null && ozonFboPlan.boxes != null) {
            ozonFboScanInput = input(tr("Сканируйте короб WMS", "WMS qutini skanerlang"));
            root.addView(ozonFboScanInput);
            root.addView(primaryMenuButton(tr("Открыть короб", "Qutini ochish"), view -> openOzonFboBoxByCode()));
            for (TsdOzonFboPlan.Box box : ozonFboPlan.boxes) {
                if (box == null) continue;
                int planned = box.plannedQuantity();
                int assembled = box.assembledQuantity();
                String city = box.cluster == null
                    ? "—"
                    : nonEmpty(box.cluster.clusterName, nonEmpty(box.cluster.sourceName, "—"));
                root.addView(taskRow(
                    nonEmpty(box.boxCode, "Короб WMS"),
                    city + " · " + assembled + " / " + planned + tr(" шт.", " dona"),
                    box.isClosed() ? BOX_FOUND_GREEN : assembled > 0 ? Color.rgb(254, 240, 138) : LIGHT_GRAY
                ));
                if (!box.isClosed()) {
                    root.addView(multilineSecondaryButton(
                        assembled > 0 ? tr("Продолжить короб", "Qutini davom ettirish") : tr("Начать короб", "Qutini boshlash"),
                        view -> selectOzonFboBox(box)
                    ));
                }
            }
        }
        root.addView(secondaryButton(tr("Обновить короба", "Qutilarni yangilash"), view -> {
            if (ozonFboPlan != null) loadOzonFboPlan(ozonFboPlan.id);
        }));
        root.addView(secondaryButton(tr("К списку поставок", "Yetkazib berishlar ro‘yxatiga"), view -> renderOzonFboPlansScreen()));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        if (ozonFboScanInput != null) ozonFboScanInput.requestFocus();
        refreshHeaderText();
    }

    private void openOzonFboBoxByCode() {
        if (ozonFboPlan == null || ozonFboPlan.boxes == null) return;
        String code = textValue(ozonFboScanInput).toUpperCase(Locale.ROOT);
        if (code.isEmpty()) {
            showOzonFboError(tr("Отсканируйте номер короба WMS.", "WMS quti raqamini skanerlang."));
            return;
        }
        for (TsdOzonFboPlan.Box box : ozonFboPlan.boxes) {
            if (box != null && code.equals(nonEmpty(box.boxCode, "").toUpperCase(Locale.ROOT))) {
                if (box.isClosed()) {
                    showOzonFboError(tr("Этот короб уже закрыт.", "Bu quti allaqachon yopilgan."));
                    return;
                }
                selectOzonFboBox(box);
                return;
            }
        }
        showOzonFboError(tr("Короб не относится к выбранной поставке FBO Ozon.", "Quti tanlangan Ozon FBO yetkazib berishiga tegishli emas."));
    }

    private void selectOzonFboBox(TsdOzonFboPlan.Box box) {
        ozonFboBox = box;
        ozonFboFeedbackColor = 0;
        statusMessage = tr("Сканируйте ШК каждой единицы, которую кладёте в короб.", "Qutiga qo‘yilgan har bir mahsulot SHKini skanerlang.");
        renderOzonFboAssemblyScreen();
    }

    private void renderOzonFboAssemblyScreen() {
        screen = Screen.OZON_FBO_ASSEMBLY;
        ozonFboScanInput = null;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Сборка FBO Ozon", "Ozon FBO yig‘ish")));
        if (ozonFboBox == null) {
            root.addView(feedbackView(tr("Короб не выбран.", "Quti tanlanmagan."), LIGHT_GRAY));
            root.addView(secondaryButton(tr("К коробам", "Qutilarga"), view -> renderOzonFboBoxesScreen()));
            setScrollableContent(root);
            return;
        }
        int planned = ozonFboBox.plannedQuantity();
        int assembled = ozonFboBox.assembledQuantity();
        root.addView(feedbackView(
            nonEmpty(ozonFboBox.boxCode, "Короб WMS") + "\n" +
                tr("Собрано: ", "Yig‘ildi: ") + assembled + " / " + planned,
            assembled == planned ? BOX_FOUND_GREEN : Color.rgb(219, 234, 254)
        ));
        if (!statusMessage.isEmpty()) root.addView(feedbackView(
            statusMessage,
            ozonFboFeedbackColor == 0 ? LIGHT_GRAY : ozonFboFeedbackColor
        ));
        if (ozonFboBox.items != null) {
            for (TsdOzonFboPlan.Item item : ozonFboBox.items) {
                if (item == null) continue;
                TsdOzonFboPlan.PlanItem product = item.planItem;
                String offerId = product == null ? "—" : nonEmpty(product.offerId, nonEmpty(product.ozonSku, "—"));
                String name = product == null ? "—" : nonEmpty(product.productName, offerId);
                root.addView(taskRow(
                    name,
                    tr("Артикул: ", "Artikul: ") + offerId + " · " + item.assembledQuantity + " / " + item.quantity,
                    item.assembledQuantity >= item.quantity ? BOX_FOUND_GREEN : LIGHT_GRAY
                ));
            }
        }
        if (!ozonFboBox.isClosed() && assembled < planned && !"SHORTAGE_PENDING".equals(ozonFboBox.status)) {
            ozonFboScanInput = input(tr("Сканируйте ШК товара", "Mahsulot SHKini skanerlang"));
            root.addView(ozonFboScanInput);
            root.addView(primaryMenuButton(tr("Добавить товар", "Tovar qo‘shish"), view -> submitOzonFboProductScan()));
        } else if ("SHORTAGE_PENDING".equals(ozonFboBox.status)) {
            root.addView(feedbackView(
                tr("По коробу заявлено недовложение. Ожидается решение менеджера в WMS.", "Quti bo‘yicha kamlik bildirildi. Menejer qarori kutilmoqda."),
                Color.rgb(254, 240, 138)
            ));
        }
        if (!ozonFboBox.isClosed() && planned > 0 && assembled == planned) {
            root.addView(primaryMenuButton(tr("Закрыть короб", "Qutini yopish"), view -> closeOzonFboBox()));
        }
        root.addView(secondaryButton(tr("Обновить короб", "Qutini yangilash"), view -> {
            if (ozonFboPlan != null) loadOzonFboPlan(ozonFboPlan.id);
        }));
        root.addView(secondaryButton(tr("К списку коробов", "Qutilar ro‘yxatiga"), view -> renderOzonFboBoxesScreen()));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        if (ozonFboScanInput != null) ozonFboScanInput.requestFocus();
        refreshHeaderText();
    }

    private void submitOzonFboProductScan() {
        TsdSession session = safeSession();
        if (session == null || ozonFboBox == null || ozonFboBusy) return;
        String code = textValue(ozonFboScanInput);
        if (code.isEmpty()) {
            showOzonFboError(tr("Отсканируйте ШК товара.", "Mahsulot SHKini skanerlang."));
            return;
        }
        if (isCurrentOzonFboBoxCode(code)) {
            showOzonFboError(tr("Сейчас нужен ШК товара, а не номер короба WMS.", "Hozir mahsulot SHKi kerak, WMS quti raqami emas."));
            return;
        }
        ozonFboBusy = true;
        Map<String, String> body = new LinkedHashMap<>();
        body.put("code", code);
        runBackground(() -> {
            Response<TsdOzonFboPlan.Box> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .scanOzonFboBox(session.authorizationHeader(), ozonFboBox.id, body)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr("Товар не принят в короб FBO Ozon.", "Tovar Ozon FBO qutisiga qabul qilinmadi."));
                mainHandler.post(() -> showOzonFboError(message));
                return;
            }
            TsdOzonFboPlan.Box updated = response.body();
            mainHandler.post(() -> {
                online = true;
                ozonFboBusy = false;
                ozonFboFeedbackColor = BOX_FOUND_GREEN;
                ozonFboBox = updated;
                replaceOzonFboBox(updated);
                statusMessage = tr("Товар принят. Сканируйте следующую единицу.", "Tovar qabul qilindi. Keyingi birlikni skanerlang.");
                playFbsSuccess();
                renderOzonFboAssemblyScreen();
            });
        });
    }

    private void closeOzonFboBox() {
        TsdSession session = safeSession();
        if (session == null || ozonFboBox == null || ozonFboBusy) return;
        String closedCode = nonEmpty(ozonFboBox.boxCode, "Короб WMS");
        ozonFboBusy = true;
        runBackground(() -> {
            Response<TsdOzonFboPlan> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .closeOzonFboBox(session.authorizationHeader(), ozonFboBox.id)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr("Не удалось закрыть короб.", "Qutini yopib bo‘lmadi."));
                mainHandler.post(() -> showOzonFboError(message));
                return;
            }
            TsdOzonFboPlan updated = response.body();
            mainHandler.post(() -> {
                online = true;
                ozonFboBusy = false;
                ozonFboPlan = updated;
                ozonFboBox = null;
                ozonFboFeedbackColor = BOX_FOUND_GREEN;
                statusMessage = tr("Короб закрыт: ", "Quti yopildi: ") + closedCode;
                playFbsSuccess();
                renderOzonFboBoxesScreen();
            });
        });
    }

    private void replaceOzonFboBox(TsdOzonFboPlan.Box updated) {
        if (updated == null || ozonFboPlan == null || ozonFboPlan.boxes == null) return;
        for (int index = 0; index < ozonFboPlan.boxes.size(); index += 1) {
            TsdOzonFboPlan.Box current = ozonFboPlan.boxes.get(index);
            if (current != null && nonEmpty(current.id, "").equals(nonEmpty(updated.id, ""))) {
                ozonFboPlan.boxes.set(index, updated);
                return;
            }
        }
    }

    private boolean isCurrentOzonFboBoxCode(String value) {
        String normalized = nonEmpty(value, "").trim();
        if (normalized.isEmpty() || ozonFboPlan == null || ozonFboPlan.boxes == null) return false;
        for (TsdOzonFboPlan.Box box : ozonFboPlan.boxes) {
            if (box != null && normalized.equalsIgnoreCase(nonEmpty(box.boxCode, "").trim())) return true;
        }
        return false;
    }

    private void showOzonFboError(String message) {
        ozonFboBusy = false;
        ozonFboFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = nonEmpty(message, tr("Ошибка FBO Ozon.", "Ozon FBO xatosi."));
        playFbsError();
        refreshCurrentScreen();
        showScanningErrorDialog(statusMessage);
    }

    private void openFbsAssembly() {
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
        if (safeSession() == null) {
            statusMessage = tr("Сначала выполните вход в настройках.", "Avval sozlamalarda tizimga kiring.");
            renderSettingsScreen();
            return;
        }
        fbsAssembly = null;
        fbsRequests = null;
        selectedFbsRequestId = "";
        fbsRequestsArchiveMode = false;
        fbsFeedbackColor = 0;
        statusMessage = tr("Загружаю FBS-заявки...", "FBS arizalari yuklanmoqda...");
        loadFbsRequestChoices();
    }

    private void loadFbsRequestChoices() {
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            renderSettingsScreen();
            return;
        }
        screen = Screen.FBS_REQUESTS;
        fbsRequestsBusy = true;
        renderFbsRequestSelectionScreen();
        runBackground(() -> {
            Response<TsdFbsRequestsResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .listFbsAssemblyRequests(
                    session.authorizationHeader(),
                    session.deviceCode,
                    fbsRequestsArchiveMode ? "true" : null
                )
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                String message = responseErrorMessage(response, tr(
                    "Не удалось загрузить FBS-заявки. Повторите через минуту.",
                    "FBS arizalarini yuklab bo‘lmadi. Bir daqiqadan so‘ng takrorlang."
                ));
                mainHandler.post(() -> showFbsRequestsError(message, response.code() < 500));
                return;
            }
            TsdFbsRequestsResponse loaded = response.body();
            mainHandler.post(() -> {
                online = true;
                fbsRequestsBusy = false;
                fbsFeedbackColor = 0;
                fbsRequests = loaded;
                statusMessage = nonEmpty(loaded.message, tr("Выберите FBS-заявку.", "FBS arizasini tanlang."));
                renderFbsRequestSelectionScreen();
            });
        });
    }

    private void renderFbsRequestSelectionScreen() {
        screen = Screen.FBS_REQUESTS;
        LinearLayout root = baseRoot();
        root.addView(header());
        root.addView(title(tr("Сборка FBS — заявки", "FBS yig‘ish — arizalar")));

        if (fbsRequestsArchiveMode) {
            root.addView(feedbackView(
                tr("Архив собранных FBS-заявок", "Yig‘ilgan FBS arizalari arxivi"),
                BOX_FOUND_GREEN
            ));
        }

        if (fbsRequestsBusy) {
            root.addView(feedbackView(
                tr("Подождите, загружаю список заявок...", "Kutib turing, arizalar ro‘yxati yuklanmoqda..."),
                BOX_DUPLICATE_BLUE
            ));
        } else if (!statusMessage.isEmpty()) {
            root.addView(feedbackView(
                statusMessage,
                fbsFeedbackColor == 0 ? Color.rgb(219, 234, 254) : fbsFeedbackColor
            ));
        }

        List<TsdFbsRequestsResponse.Request> requests = fbsRequests == null ? null : fbsRequests.requests;
        if (!fbsRequestsBusy && (requests == null || requests.isEmpty())) {
            root.addView(feedbackView(
                fbsRequestsArchiveMode
                    ? tr("Собранных FBS-заявок пока нет.", "Yig‘ilgan FBS arizalari hozircha yo‘q.")
                    : tr("Открытых FBS-заявок пока нет.", "Hozircha ochiq FBS arizalari yo‘q."),
                LIGHT_GRAY
            ));
        } else if (requests != null) {
            String lockedRequestId = fbsRequests.currentRequestId == null ? "" : fbsRequests.currentRequestId;
            for (TsdFbsRequestsResponse.Request request : requests) {
                boolean isCurrent = !lockedRequestId.isEmpty() && lockedRequestId.equals(request.requestId);
                boolean isLocked = !lockedRequestId.isEmpty() && !isCurrent;
                String requestNumber = request.requestNumber > 0
                    ? String.format(Locale.US, "%06d", request.requestNumber)
                    : "-";
                String clientName = request.client == null
                    ? "-"
                    : nonEmpty(request.client.name, request.client.code);
                String marketplaceName = fbsMarketplaceNames(request.marketplaces);
                root.addView(fbsMarketplaceWarehouseBanner(marketplaceName, request.warehouseNames));
                if (fbsRequestsArchiveMode) {
                    String archiveDetails = tr("Клиент: ", "Mijoz: ") + clientName + "\n" +
                        tr("Собрано заказов: ", "Yig‘ilgan buyurtmalar: ") + request.completedOrders +
                        tr(" из ", " / ") + request.totalOrders;
                    if (request.completedAt != null && !request.completedAt.trim().isEmpty()) {
                        archiveDetails += "\n" + tr("Завершено: ", "Yakunlangan: ") + request.completedAt;
                    }
                    root.addView(taskRow(
                        tr("Заявка №", "Ariza №") + requestNumber + " · " + nonEmpty(request.title, "FBS"),
                        archiveDetails,
                        BOX_FOUND_GREEN
                    ));
                    continue;
                }

                String details = tr("Клиент: ", "Mijoz: ") + clientName + "\n" +
                    tr("Готово к сборке: ", "Yig‘ishga tayyor: ") + request.readyOrders +
                    tr(" из ", " / ") + request.totalOrders + "\n" +
                    tr("Осталось заказов: ", "Qolgan buyurtmalar: ") + request.totalOrders +
                    tr(" · В работе: ", " · Jarayonda: ") + request.inProgressOrders;
                if (request.awaitingWbConfirmation > 0) {
                    details += "\n" + tr("Ждут готовности маркетплейса: ", "Marketplace tayyorligini kutmoqda: ") + request.awaitingWbConfirmation;
                }
                if (request.noAvailableStock > 0) {
                    details += "\n" + tr("Нет доступного остатка: ", "Erkin qoldiq yo‘q: ") + request.noAvailableStock;
                }
                if (isCurrent) {
                    details += "\n" + tr("Открыт незавершённый заказ — продолжите его.", "Tugallanmagan buyurtma ochiq — uni davom ettiring.");
                }
                root.addView(taskRow(
                    tr("Заявка №", "Ariza №") + requestNumber + " · " + nonEmpty(request.title, "FBS"),
                    details,
                    isCurrent ? Color.rgb(254, 240, 138) : request.readyOrders > 0 ? Color.rgb(219, 234, 254) : LIGHT_GRAY
                ));
                if (isLocked) {
                    continue;
                }
                root.addView(multilineSecondaryButton(
                    isCurrent
                        ? tr("Продолжить эту заявку", "Shu arizani davom ettirish")
                        : tr("Выбрать эту заявку", "Shu arizani tanlash"),
                    view -> selectFbsRequest(request)
                ));
            }
        }

        root.addView(secondaryButton(
            fbsRequestsArchiveMode
                ? tr("К рабочим FBS-заявкам", "Faol FBS arizalariga")
                : tr("Архив собранных заявок", "Yig‘ilgan arizalar arxivi"),
            view -> {
                fbsRequestsArchiveMode = !fbsRequestsArchiveMode;
                loadFbsRequestChoices();
            }
        ));
        root.addView(secondaryButton(
            fbsRequestsArchiveMode ? tr("Обновить архив", "Arxivni yangilash") : tr("Обновить список", "Ro‘yxatni yangilash"),
            view -> loadFbsRequestChoices()
        ));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        refreshHeaderText();
    }

    private void selectFbsRequest(TsdFbsRequestsResponse.Request request) {
        if (request == null || request.requestId == null || request.requestId.trim().isEmpty()) {
            return;
        }
        selectedFbsRequestId = request.requestId;
        fbsAssembly = null;
        fbsFeedbackColor = 0;
        statusMessage = tr("Открываю выбранную FBS-заявку...", "Tanlangan FBS arizasi ochilmoqda...");
        loadNextFbsAssembly();
    }

    private void loadNextFbsAssembly() {
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
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
                .nextFbsAssembly(session.authorizationHeader(), session.deviceCode, selectedFbsRequestId)
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

    private void scheduleOzonLabelAutoRefresh(TsdFbsAssemblyResponse.Task task) {
        cancelOzonLabelAutoRefresh();
        if (task == null || task.id == null || task.id.trim().isEmpty()) return;
        String taskId = task.id;
        fbsOzonLabelRefreshTask = () -> {
            fbsOzonLabelRefreshTask = null;
            if (
                screen != Screen.FBS_ASSEMBLY ||
                fbsBusy ||
                fbsAssembly == null ||
                fbsAssembly.task == null ||
                !taskId.equals(fbsAssembly.task.id) ||
                !"WAIT_MARKETPLACE_LABEL".equals(fbsAssembly.state)
            ) {
                return;
            }
            fbsFeedbackColor = BOX_DUPLICATE_BLUE;
            statusMessage = tr(
                "Проверяю готовность этикетки Ozon автоматически...",
                "Ozon stikeri tayyorligini avtomatik tekshiryapman..."
            );
            loadNextFbsAssembly();
        };
        mainHandler.postDelayed(fbsOzonLabelRefreshTask, 5_000L);
    }

    private void cancelOzonLabelAutoRefresh() {
        if (fbsOzonLabelRefreshTask == null) return;
        mainHandler.removeCallbacks(fbsOzonLabelRefreshTask);
        fbsOzonLabelRefreshTask = null;
    }

    private void renderFbsAssemblyScreen() {
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            resumeMandatoryFbsAudit();
            return;
        }
        screen = Screen.FBS_ASSEMBLY;
        if (fbsGuidedScanDialog == null || !fbsGuidedScanDialog.isShowing()) {
            fbsScanInput = null;
        }
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
            dismissFbsGuidedScanDialog();
            // FIX: без активного заказа список всегда начинается свёрнутым.
            fbsRemainingOrdersOpen = false;
            fbsRemainingOrdersTaskId = "";
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
            root.addView(secondaryButton(
                tr("К списку FBS-заявок", "FBS arizalari ro‘yxatiga"),
                view -> loadFbsRequestChoices()
            ));
            root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
            setScrollableContent(root);
            refreshHeaderText();
            return;
        }

        String remainingOrdersTaskId = nonEmpty(task.id, nonEmpty(task.orderId, "-"));
        fbsRemainingOrdersOpen = FbsAssemblyUi.keepRemainingOrdersOpen(
            fbsRemainingOrdersTaskId,
            remainingOrdersTaskId,
            fbsRemainingOrdersOpen
        );
        fbsRemainingOrdersTaskId = remainingOrdersTaskId;

        String clientName = task.client == null ? "-" : nonEmpty(task.client.name, task.client.code);
        String productName = task.product == null ? "-" : nonEmpty(task.product.name, "-");
        String article = task.product == null ? "-" : nonEmpty(task.product.article, "-");
        String color = task.product == null ? "-" : nonEmpty(task.product.color, tr("не указан", "ko‘rsatilmagan"));
        String size = task.product == null ? "-" : nonEmpty(task.product.size, tr("не указан", "ko‘rsatilmagan"));
        String marketplaceName = fbsMarketplaceName(task.marketplace);
        TsdFbsAssemblyResponse.Product sourceProduct =
            task.relabeling == null ? null : task.relabeling.sourceProduct;
        String sourceProductName = sourceProduct == null ? productName : nonEmpty(sourceProduct.name, "-");
        String sourceArticle = sourceProduct == null ? article : nonEmpty(sourceProduct.article, "-");
        String sourceColor = sourceProduct == null ? color : nonEmpty(sourceProduct.color, tr("не указан", "ko‘rsatilmagan"));
        String sourceSize = sourceProduct == null ? size : nonEmpty(sourceProduct.size, tr("не указан", "ko‘rsatilmagan"));
        boolean relabelRequired = task.relabeling != null && task.relabeling.required;
        String state = nonEmpty(fbsAssembly.state, "SCAN_BOX");
        boolean guidedScanDialog = FbsAssemblyUi.shouldUseGuidedScanDialog(state);
        if (!guidedScanDialog) dismissFbsGuidedScanDialog();
        if (!"WAIT_MARKETPLACE_LABEL".equals(state)) {
            cancelOzonLabelAutoRefresh();
        }
        root.addView(feedbackView(
            tr("\u0427\u0422\u041e \u0417\u0410\u0411\u0420\u0410\u0422\u042c", "NIMA OLISH KERAK") + "\n" +
                productName + "\n" +
                tr("\u0410\u0420\u0422\u0418\u041a\u0423\u041b: ", "ARTIKUL: ") + article + "\n" +
                tr("\u0426\u0412\u0415\u0422: ", "RANG: ") + color + "  \u00b7  " +
                tr("\u0420\u0410\u0417\u041c\u0415\u0420: ", "O'LCHAM: ") + size,
            Color.rgb(254, 240, 138)
        ));
        root.addView(taskRow(
            tr("Заказ ", "Buyurtma ") + marketplaceName + " №" + nonEmpty(task.orderId, "-"),
            tr("Клиент: ", "Mijoz: ") + clientName + "\n" +
                productName + " · " + tr("арт. ", "art. ") + article + "\n" +
                tr("Цвет: ", "Rang: ") + color + " · " + tr("РАЗМЕР: ", "O‘LCHAM: ") + size,
            LIGHT_GRAY
        ));
        boolean orderStickerReady = false;
        Button stickerAppliedButton = null;
        if ("READY_TO_COMPLETE".equals(state)) {
            String taskMarketplace = nonEmpty(task.marketplace, "WILDBERRIES");
            boolean localOnlyRecovery = FbsLocalRecoveryPolicy.canCompleteWithoutSticker(
                taskMarketplace,
                task.emergencyAssembly != null,
                task.emergencyAssembly == null || task.emergencyAssembly.wbMutationAllowed
            );
            boolean hasRenderableSticker = task.orderSticker != null
                && !nonEmpty(task.orderSticker.imageBase64, "").isEmpty();
            if (localOnlyRecovery && !hasRenderableSticker) {
                // FIX: a delivery-recovery order is already complete/shipped in WB,
                // so WB legitimately returns an empty sticker list on every refresh.
                root.addView(feedbackView(
                    tr(
                        "ЛОКАЛЬНЫЙ ДОВОЗ\nWB уже принял этот заказ. Повторная наклейка недоступна и не требуется. Проверьте товар и нажмите «ТОВАР ОТОБРАН».",
                        "MAHALLIY YETKAZISH\nWB bu buyurtmani qabul qilgan. Qayta stiker mavjud emas va talab qilinmaydi. Mahsulotni tekshirib, «MAHSULOT OLINDI» tugmasini bosing."
                    ),
                    Color.rgb(254, 240, 138)
                ));
                orderStickerReady = true;
            } else {
                // FIX: ordinary WB/Ozon orders still require a renderable label.
                orderStickerReady = "WILDBERRIES".equalsIgnoreCase(taskMarketplace)
                    ? renderFbsOrderSticker(root, task)
                    : "OZON".equalsIgnoreCase(taskMarketplace)
                        ? renderOzonOrderSticker(root, task)
                        : renderNonWbOrderStickerInstruction(root, task);
            }
            if (orderStickerReady) {
                stickerAppliedButton = primaryMenuButton(
                    localOnlyRecovery && !hasRenderableSticker
                        ? tr("ТОВАР ОТОБРАН", "MAHSULOT OLINDI")
                        : tr("НАКЛЕЙКА НАКЛЕЕНА", "STIKER YOPISHTIRILDI"),
                    view -> completeFbsAssembly()
                );
                root.addView(stickerAppliedButton);
            }
        }
        if (fbsAssembly.progress != null && fbsAssembly.progress.requestTotalItems > 0) {
            String requestNumber = fbsAssembly.progress.requestNumber > 0
                ? String.format(Locale.US, "%06d", fbsAssembly.progress.requestNumber)
                : "-";
            boolean requestCompleted = fbsAssembly.progress.requestRemainingItems == 0;
            root.addView(feedbackView(
                tr("ЗАЯВКА №", "ARIZA №") + requestNumber + "\n" +
                    (requestCompleted
                        ? tr("ОТРАБОТАНА · СОБРАНО: ", "BAJARILDI · YIG‘ILDI: ") +
                            fbsAssembly.progress.requestCompletedItems + " " +
                            tr("из ", "/ ") + fbsAssembly.progress.requestTotalItems
                        : tr("Осталось положить: ", "Joylash qoldi: ") +
                            fbsAssembly.progress.requestRemainingItems + " " +
                            tr("из ", "/ ") + fbsAssembly.progress.requestTotalItems),
                requestCompleted ? BOX_FOUND_GREEN : Color.rgb(219, 234, 254)
            ));
        }
        if (fbsFeedbackColor != 0 && !statusMessage.isEmpty()) {
            root.addView(feedbackView(statusMessage, fbsFeedbackColor));
        } else if (!statusMessage.isEmpty()) {
            root.addView(messageView(statusMessage));
        }

        if ("SCAN_BOX".equals(state) || "PALLET_BOXES".equals(state)) {
            LinearLayout routeDetails = new LinearLayout(this);
            routeDetails.setOrientation(LinearLayout.VERTICAL);
            if ("PALLET_BOXES".equals(state) && fbsAssembly.palletScan != null) {
                TsdFbsAssemblyResponse.PalletScan pallet = fbsAssembly.palletScan;
                String zone = pallet.zone == null
                    ? tr("не назначена", "belgilanmagan")
                    : nonEmpty(pallet.zone.name, pallet.zone.code);
                String neededCodes =
                    pallet.neededBoxCodes == null || pallet.neededBoxCodes.isEmpty()
                        ? tr("нужных коробов нет", "kerakli qutilar yo‘q")
                        : String.join("\n", pallet.neededBoxCodes);
                root.addView(feedbackView(
                    tr("ПАЛЛЕТСОРТ: ", "PALLETSORT: ") + nonEmpty(pallet.code, "-") + "\n" +
                        tr("Зона: ", "Zona: ") + zone + "\n" +
                        tr("Нужно коробов для заявки: ", "Ariza uchun kerakli qutilar: ") +
                        pallet.neededBoxes + tr(" из ", " / ") + pallet.totalBoxes + "\n\n" +
                        neededCodes,
                    pallet.neededBoxes > 0 ? Color.rgb(254, 240, 138) : Color.rgb(254, 226, 226)
                ));
                if (pallet.nearbyPallets != null && !pallet.nearbyPallets.isEmpty()) {
                    StringBuilder nearby = new StringBuilder(tr(
                        "ПОСЛЕ ЭТОГО ПАЛЛЕТСОРТА ОСТАВАЙТЕСЬ В ЭТОЙ ЗОНЕ",
                        "BU PALLETSORTDAN KEYIN SHU ZONADA QOLING"
                    ));
                    nearby.append("\n").append(tr(
                        "Для этой заявки дальше нужны:",
                        "Bu ariza uchun keyin kerak:"
                    ));
                    for (TsdFbsAssemblyResponse.NearbyPallet nextPallet : pallet.nearbyPallets) {
                        nearby.append("\n\n")
                            .append(tr("ПАЛЛЕТСОРТ: ", "PALLETSORT: "))
                            .append(nonEmpty(nextPallet.code, "-"))
                            .append(" · ")
                            .append(nextPallet.neededBoxes)
                            .append(tr(" короб(а/ов)", " quti"));
                        if (nextPallet.neededBoxCodes != null && !nextPallet.neededBoxCodes.isEmpty()) {
                            nearby.append("\n")
                                .append(String.join(", ", nextPallet.neededBoxCodes));
                        }
                    }
                    root.addView(feedbackView(nearby.toString(), Color.rgb(220, 252, 231)));
                }
                if (pallet.neededBoxCodes != null && !pallet.neededBoxCodes.isEmpty()) {
                    // ADDED: create a real web verification task without changing
                    // stock, box placement or the current FBS assembly state.
                    root.addView(dangerSecondaryButton(
                        tr("На паллете отсутствует короб", "Palletda quti yo‘q"),
                        view -> chooseMissingFbsPalletBox(pallet)
                    ));
                }
            }
            String boxCode = nonEmpty(task.recommendedBoxCode, "-");
            String locationHint = "";
            if (task.recommendedLocation != null) {
                String zone = nonEmpty(
                    task.recommendedLocation.zoneName,
                    tr("зона не назначена", "zona belgilanmagan")
                );
                locationHint = "\n" +
                    tr("ЗОНА: ", "ZONA: ") + zone + "\n" +
                    tr("ПАЛЛЕТА: ", "PALLET: ") + nonEmpty(task.recommendedLocation.palletCode, "-");
            }
            root.addView(feedbackView(
                tr("1. НАЙДИТЕ И ОТСКАНИРУЙТЕ КОРОБ\nМожно сначала пикнуть QR паллетсорта.\n",
                    "1. QUTINI TOPING VA SKANERLANG\nAvval palletsort QR kodini skanerlash mumkin.\n") +
                    boxCode + locationHint,
                BOX_MOVEMENT_BLUE
            ));
            if (task.storageBoxes != null && !task.storageBoxes.isEmpty()) {
                StringBuilder options = new StringBuilder(tr(
                    "НЕСКОЛЬКО ВАРИАНТОВ, ГДЕ ВЗЯТЬ ТОВАР",
                    "MAHSULOTNI OLISH UCHUN BIR NECHTA JOY"
                ));
                String previousPallet = null;
                // FIX: Show every available box and pallet-sort returned by WMS.
                for (TsdFbsAssemblyResponse.StorageBox storageBox : task.storageBoxes) {
                    TsdFbsAssemblyResponse.StorageLocation location = storageBox.location;
                    String pallet = location == null
                        ? tr("БЕЗ ПАЛЛЕТСОРТА", "PALLETSORTSIZ")
                        : nonEmpty(location.palletCode, tr("БЕЗ ПАЛЛЕТСОРТА", "PALLETSORTSIZ"));
                    if (!pallet.equals(previousPallet)) {
                        String zone = location == null
                            ? tr("зона не указана", "zona ko‘rsatilmagan")
                            : nonEmpty(location.zoneName, nonEmpty(location.zoneCode, tr("зона не указана", "zona ko‘rsatilmagan")));
                        options.append("\n\n")
                            .append(tr("ПАЛЛЕТСОРТ: ", "PALLETSORT: "))
                            .append(pallet)
                            .append(" · ")
                            .append(tr("ЗОНА: ", "ZONA: "))
                            .append(zone);
                        previousPallet = pallet;
                    }
                    options.append("\n• ")
                        .append(nonEmpty(storageBox.code, "-"))
                        .append(" — ")
                        .append(storageBox.quantity)
                        .append(tr(" шт.", " dona"));
                }
                root.addView(feedbackView(options.toString(), Color.rgb(224, 242, 254)));
            }
            if (task.samePalletRemainingBoxes > 0) {
                String nextBoxes = task.samePalletBoxCodes == null || task.samePalletBoxCodes.isEmpty()
                    ? ""
                    : "\n" + String.join(", ", task.samePalletBoxCodes);
                root.addView(feedbackView(
                    tr("НЕ УХОДИТЕ ОТ ЭТОЙ ПАЛЛЕТЫ\nЗдесь ещё нужных коробов: ",
                        "BU PALLETDAN KETMANG\nBu yerda yana kerakli qutilar: ") +
                        task.samePalletRemainingBoxes + nextBoxes,
                    Color.rgb(254, 240, 138)
                ));
            }
            if (task.nextRequestSources != null && !task.nextRequestSources.isEmpty()) {
                StringBuilder next = new StringBuilder(tr(
                    "ДАЛЬШЕ ПО ЭТОЙ ЗАЯВКЕ",
                    "SHU ARIZA BO‘YICHA KEYINGILAR"
                ));
                // FIX: Show every remaining request route instead of the first eight.
                for (TsdFbsAssemblyResponse.NextRequestSource source : task.nextRequestSources) {
                    String zone = nonEmpty(source.zoneName, nonEmpty(source.zoneCode, "-"));
                    next.append("\n\n")
                        .append(tr("Заказ ", "Buyurtma "))
                        .append(nonEmpty(source.orderId, "-"))
                        .append(" · ")
                        .append(nonEmpty(source.productName, "-"))
                        .append("\n")
                        .append(tr("ПАЛЛЕТ-СОРТ: ", "PALLETSORT: "))
                        .append(nonEmpty(source.palletCode, "-"))
                        .append(" · ")
                        .append(tr("ЗОНА: ", "ZONA: "))
                        .append(zone)
                        .append("\n")
                        .append(tr("КОРОБ: ", "QUTI: "))
                        .append(nonEmpty(source.boxCode, "-"))
                        .append(" · ")
                        .append(source.quantity)
                        .append(tr(" шт.", " dona"));
                }
                routeDetails.addView(feedbackView(next.toString(), Color.rgb(240, 249, 255)));
            }
            if (routeDetails.getChildCount() > 0) {
                // FIX: сворачивается только длинный список остальных заказов;
                // текущие жёлтые, зелёные и синие рабочие блоки остаются видимыми.
                routeDetails.setVisibility(fbsRemainingOrdersOpen ? View.VISIBLE : View.GONE);
                Button routeToggle = secondaryButton(
                    fbsRemainingOrdersOpen
                        ? tr("Свернуть список остальных заказов", "Qolgan buyurtmalarni yig‘ish")
                        : tr("Показать остальные заказы", "Qolgan buyurtmalarni ko‘rsatish"),
                    view -> { }
                );
                routeToggle.setOnClickListener(view -> {
                    // FIX: только эта кнопка может изменить раскрытие списка.
                    fbsRemainingOrdersOpen = !fbsRemainingOrdersOpen;
                    routeDetails.setVisibility(fbsRemainingOrdersOpen ? View.VISIBLE : View.GONE);
                    routeToggle.setText(fbsRemainingOrdersOpen
                        ? tr("Свернуть список остальных заказов", "Qolgan buyurtmalarni yig‘ish")
                        : tr("Показать остальные заказы", "Qolgan buyurtmalarni ko‘rsatish"));
                });
                root.addView(routeToggle);
                root.addView(routeDetails);
            }
            root.addView(messageView(
                tr("В коробе есть нужный товар: ", "Qutida kerakli mahsulot bor: ") +
                    (relabelRequired ? sourceProductName : productName) + "\n" +
                    tr("РАЗМЕР: ", "O‘LCHAM: ") + (relabelRequired ? sourceSize : size)
            ));
            fbsScanInput = input(tr(
                "Номер короба или QR паллетсорта",
                "Quti raqami yoki palletsort QR"
            ));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Проверить скан", "Skanni tekshirish"),
                view -> submitFbsScan()
            ));
        } else if ("SCAN_SOURCE_BARCODE".equals(state)) {
            root.addView(feedbackView(
                tr("Короб подтверждён: ", "Quti tasdiqlandi: ") + nonEmpty(task.scannedBoxCode, "-"),
                BOX_FOUND_GREEN
            ));
            root.addView(feedbackView(
                tr("2. ВОЗЬМИТЕ ИСХОДНЫЙ ТОВАР ДЛЯ ПЕРЕКЛЕЙКИ\n", "2. QAYTA YORLIQLASH UCHUN MANBA MAHSULOTNI OLING\n") +
                    tr("Название: ", "Nomi: ") + sourceProductName + "\n" +
                    tr("Артикул: ", "Artikul: ") + sourceArticle + "\n" +
                    tr("Цвет: ", "Rang: ") + sourceColor + "\n" +
                    tr("РАЗМЕР: ", "O‘LCHAM: ") + sourceSize,
                BOX_MOVEMENT_BLUE
            ));
            fbsScanInput = input(tr("Сканируйте исходный ШК", "Manba SHKni skanerlang"));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Подтвердить исходный товар", "Manba mahsulotni tasdiqlash"),
                view -> submitFbsScan()
            ));
        } else if ("SCAN_RELABEL_BARCODE".equals(state)) {
            root.addView(feedbackView(
                tr("ИСХОДНЫЙ ТОВАР ВЕРНЫЙ", "MANBA MAHSULOT TO‘G‘RI"),
                BOX_FOUND_GREEN
            ));
            root.addView(feedbackView(
                tr("3. ПЕРЕКЛЕЙТЕ ТОВАР И ОТСКАНИРУЙТЕ НОВЫЙ ШК\n", "3. YORLIQNI ALMASHTIRING VA YANGI SHKNI SKANERLANG\n") +
                    sourceArticle + "  →  " + article + "\n" +
                    tr("Должно уехать: ", "Jo‘natilishi kerak: ") + productName + "\n" +
                    tr("Цвет: ", "Rang: ") + color + "\n" +
                    tr("РАЗМЕР: ", "O‘LCHAM: ") + size,
                Color.rgb(254, 240, 138)
            ));
            fbsScanInput = input(tr("Сканируйте новый ШК после переклейки", "Yangi SHKni skanerlang"));
            root.addView(fbsScanInput);
            root.addView(primaryMenuButton(
                tr("Подтвердить переклейку", "Qayta yorliqlashni tasdiqlash"),
                view -> submitFbsScan()
            ));
        } else if ("SCAN_BARCODE".equals(state)) {
            root.addView(feedbackView(
                task.sourceWithoutBox
                    ? tr("ИСТОЧНИК: ХРАНЕНИЕ БЕЗ КОРОБОВ", "MANBA: QUTISIZ SAQLASH")
                    : tr("Короб подтверждён: ", "Quti tasdiqlandi: ") + nonEmpty(task.scannedBoxCode, "-"),
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
            root.addView(primaryMenuButton(
                tr("Открыть окно сканирования ШК", "SHK skanerlash oynasini ochish"),
                view -> showFbsGuidedScanDialog(state, task, productName, article, color, size, marketplaceName)
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
            root.addView(primaryMenuButton(
                tr("Открыть окно сканирования КИЗ", "KIZ skanerlash oynasini ochish"),
                view -> showFbsGuidedScanDialog(state, task, productName, article, color, size, marketplaceName)
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
                    tr("Артикул: ", "Artikul: ") + article + "\n" +
                    tr("Цвет: ", "Rang: ") + color + " · " + tr("РАЗМЕР: ", "O‘LCHAM: ") + size,
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
        } else if ("READY_TO_SUBMIT".equals(state)) {
            root.addView(feedbackView(
                tr("ТОВАР ОТПИКАН\nТеперь WMS передаст состав заказа и КИЗ в Ozon.",
                    "MAHSULOT SKANERLANDI\nEndi WMS buyurtma va KIZni Ozonga yuboradi."),
                BOX_FOUND_GREEN
            ));
            root.addView(primaryMenuButton(
                tr("Передать заказ в Ozon", "Buyurtmani Ozonga yuborish"),
                view -> completeFbsAssembly()
            ));
        } else if ("WAIT_MARKETPLACE_LABEL".equals(state)) {
            root.addView(feedbackView(
                tr("OZON ПРИНЯЛ СБОРКУ\nЭтикетка формируется. WMS проверяет её автоматически каждые 5 секунд — ждать на этом экране можно без нажатий.",
                    "OZON YIG‘IMNI QABUL QILDI\nStiker tayyorlanmoqda. WMS uni har 5 soniyada avtomatik tekshiradi."),
                Color.rgb(254, 240, 138)
            ));
            if (task.marketplaceSubmitError != null && !task.marketplaceSubmitError.trim().isEmpty()) {
                root.addView(messageView(task.marketplaceSubmitError));
            }
            scheduleOzonLabelAutoRefresh(task);
        } else if ("READY_TO_COMPLETE".equals(state)) {
            String readyText = task.requiresKiz
                ? tr("ШК и КИЗ подтверждены для ", "SHK va KIZ tasdiqlandi: ") + marketplaceName + "."
                : tr("Товар подтверждён. КИЗ не требуется.", "Mahsulot tasdiqlandi. KIZ talab qilinmaydi.");
            root.addView(feedbackView(
                tr("ВСЁ ВЕРНО\n", "HAMMASI TO‘G‘RI\n") + readyText,
                BOX_FOUND_GREEN
            ));
            if (task.kizAccepted) {
                root.addView(dangerSecondaryButton(
                    tr("Отменить принятый КИЗ", "Qabul qilingan KIZni bekor qilish"),
                    view -> confirmUndoFbsKiz()
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
        root.addView(secondaryButton(
            tr("К списку FBS-заявок", "FBS arizalari ro‘yxatiga"),
            view -> loadFbsRequestChoices()
        ));
        root.addView(secondaryButton(tr("В главное меню", "Bosh menyuga"), view -> renderMainScreen()));
        setScrollableContent(root);
        if (guidedScanDialog) {
            // FIX: после короба окно ШК открывается сразу и само переключается на КИЗ.
            showFbsGuidedScanDialog(state, task, productName, article, color, size, marketplaceName);
        } else if (stickerAppliedButton != null && orderStickerReady) {
            stickerAppliedButton.setFocusableInTouchMode(true);
            stickerAppliedButton.requestFocus();
        } else if (fbsScanInput != null) {
            fbsScanInput.requestFocus();
        }
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
        root.addView(fbsOrderStickerWarehouseBanner(task));
        ImageView stickerView = fbsOrderStickerView(task.orderSticker.imageBase64);
        if (stickerView != null) root.addView(stickerView);
        if (stickerView != null) addQuietNiimbotPrintActions(root, task);
        root.addView(messageView(
            tr("Наклейка для заказа №", "Buyurtma stikeri №") + nonEmpty(task.orderId, "-") +
                " · " + tr("часть A: ", "A qismi: ") + nonEmpty(task.orderSticker.partA, "-") +
                " · " + tr("часть B: ", "B qismi: ") + largeDigits
        ));
        return stickerView != null;
    }

    private boolean renderNonWbOrderStickerInstruction(
        LinearLayout root,
        TsdFbsAssemblyResponse.Task task
    ) {
        String marketplaceName = fbsMarketplaceName(task.marketplace);
        root.addView(feedbackView(
            tr("ЭТО ЗАКАЗ ", "BU BUYURTMA ") + marketplaceName + "\n" +
                tr("Наклейка WB для него не требуется. Наклейте правильную этикетку ",
                    "WB stikeri talab qilinmaydi. To‘g‘ri stikerini yopishtiring: ") +
                marketplaceName + tr(" для заказа №", " buyurtma №") + nonEmpty(task.orderId, "-"),
            Color.rgb(254, 240, 138)
        ));
        return true;
    }

    private boolean renderOzonOrderSticker(
        LinearLayout root,
        TsdFbsAssemblyResponse.Task task
    ) {
        if (task.orderSticker == null || nonEmpty(task.orderSticker.imageBase64, "").isEmpty()) {
            root.addView(feedbackView(
                tr("Этикетка Ozon ещё не загрузилась. Нажмите «Обновить» и не завершайте заказ без этикетки.",
                    "Ozon stikeri hali yuklanmadi. «Yangilash»ni bosing."),
                Color.rgb(254, 226, 226)
            ));
            return false;
        }
        root.addView(feedbackView(
            tr("НАКЛЕЙТЕ ЭТИКЕТКУ OZON\nЗаказ №", "OZON STIKERINI YOPISHTIRING\nBuyurtma №") +
                nonEmpty(task.orderId, "-"),
            Color.rgb(254, 240, 138)
        ));
        root.addView(fbsOrderStickerWarehouseBanner(task));
        String contentType = nonEmpty(task.orderSticker.contentType, "application/pdf");
        // FIX: never call the native PDF renderer for an Ozon label on ATOL hardware.
        if (!OzonLabelSafety.canRenderOnTsd(contentType)) {
            root.addView(feedbackView(
                tr(
                    "Этикетка Ozon готовится в безопасном формате. Нажмите «Обновить» через несколько секунд.",
                    "Ozon stikeri xavfsiz formatda tayyorlanmoqda. Bir necha soniyadan keyin «Yangilash»ni bosing."
                ),
                BOX_NOT_NEEDED_RED
            ));
            return false;
        }
        ImageView stickerView = fbsOrderStickerView(
            task.orderSticker.imageBase64,
            contentType
        );
        if (stickerView != null) {
            root.addView(stickerView);
            addQuietNiimbotPrintActions(root, task);
        } else {
            root.addView(feedbackView(
                tr(
                    "Этикетка Ozon получена, но ТСД не смог безопасно открыть PDF. Нажмите «Обновить» — приложение больше не закроется.",
                    "Ozon stikeri olindi, ammo TSD PDF faylini xavfsiz ocha olmadi. «Yangilash»ni bosing."
                ),
                BOX_NOT_NEEDED_RED
            ));
        }
        return stickerView != null;
    }

    private void addQuietNiimbotPrintActions(
        LinearLayout root,
        TsdFbsAssemblyResponse.Task task
    ) {
        if (task.orderSticker == null || nonEmpty(task.orderSticker.imageBase64, "").isEmpty()) return;
        String savedPrinter = uiStore == null
            ? ""
            : nonEmpty(uiStore.getString("niimbot_b1_name", ""), "");
        String buttonText = savedPrinter.isEmpty()
            ? tr(
                "Тихая печать 50×30 · подключить NIIMBOT B1",
                "Jim chop etish 50×30 · NIIMBOT B1 ni ulash"
            )
            : tr("Тихая печать 50×30 · ", "Jim chop etish 50×30 · ") + savedPrinter;
        buttonText = savedPrinter.isEmpty()
            ? tr(
                "Печать 2 стикеров 50×30 · подключить NIIMBOT B1",
                "2 ta 50×30 stiker · NIIMBOT B1 ni ulash"
            )
            : tr("Печать 2 стикеров 50×30 · ", "2 ta 50×30 stiker · ") + savedPrinter;
        Button printButton = primaryMenuButton(buttonText, view -> requestQuietNiimbotPrint(task, false));
        printButton.setEnabled(!niimbotPrintBusy);
        root.addView(printButton);
        if (!savedPrinter.isEmpty()) {
            Button changeButton = secondaryButton(
                tr("Сменить принтер NIIMBOT", "NIIMBOT printerni almashtirish"),
                view -> requestQuietNiimbotPrint(task, true)
            );
            changeButton.setEnabled(!niimbotPrintBusy);
            root.addView(changeButton);
        }
    }

    private void requestQuietNiimbotPrint(
        TsdFbsAssemblyResponse.Task task,
        boolean forceSelection
    ) {
        if (niimbotPrintBusy || task == null || task.orderSticker == null) return;
        pendingNiimbotLabelBase64 = nonEmpty(task.orderSticker.imageBase64, "");
        pendingNiimbotLabelContentType = nonEmpty(task.orderSticker.contentType, "image/png");
        pendingNiimbotOrderId = nonEmpty(task.orderId, "-");
        pendingNiimbotMarketplace = fbsMarketplaceName(task.marketplace);
        int requestNumber = fbsAssembly != null && fbsAssembly.progress != null
            ? fbsAssembly.progress.requestNumber
            : 0;
        pendingNiimbotRequestNumber = requestNumber > 0
            ? String.format(Locale.US, "%06d", requestNumber)
            : "-";
        pendingNiimbotWarehouse = nonEmpty(
            task.warehouseName,
            nonEmpty(task.warehouseId, "СКЛАД НЕ УКАЗАН")
        );
        niimbotForceSelection = forceSelection;
        if (!ensureNiimbotPermissions()) return;
        continueQuietNiimbotPrint();
    }

    private boolean ensureNiimbotPermissions() {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        } else if (
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (missing.isEmpty()) return true;
        requestPermissions(
            missing.toArray(new String[0]),
            BLUETOOTH_PRINTER_PERMISSION_REQUEST
        );
        return false;
    }

    private void continueQuietNiimbotPrint() {
        if (pendingNiimbotLabelBase64.isEmpty()) return;
        String address = uiStore == null
            ? ""
            : nonEmpty(uiStore.getString("niimbot_b1_address", ""), "");
        if (niimbotForceSelection || address.isEmpty()) {
            discoverNiimbotPrinter();
        } else {
            startQuietNiimbotPrint(address);
        }
    }

    private void discoverNiimbotPrinter() {
        niimbotPrintBusy = true;
        fbsFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = tr(
            "Ищу NIIMBOT B1 рядом… Не выключайте принтер.",
            "Yaqindagi NIIMBOT B1 qidirilmoqda… Printerni o‘chirmang."
        );
        refreshCurrentScreen();
        NiimbotB1Printer.discover(this, new NiimbotB1Printer.DiscoveryCallback() {
            @Override
            public void onFound(List<NiimbotB1Printer.DeviceInfo> devices) {
                niimbotPrintBusy = false;
                if (devices.size() == 1) {
                    selectNiimbotPrinter(devices.get(0));
                    return;
                }
                String[] labels = new String[devices.size()];
                for (int index = 0; index < devices.size(); index++) {
                    labels[index] = devices.get(index).displayName();
                }
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle(tr("Выберите NIIMBOT B1", "NIIMBOT B1 ni tanlang"))
                    .setItems(labels, (dialog, which) -> selectNiimbotPrinter(devices.get(which)))
                    .setNegativeButton(tr("Отмена", "Bekor qilish"), null)
                    .show();
            }

            @Override
            public void onError(String message) {
                niimbotPrintBusy = false;
                fbsFeedbackColor = BOX_NOT_NEEDED_RED;
                statusMessage = message;
                refreshCurrentScreen();
            }
        });
    }

    private void selectNiimbotPrinter(NiimbotB1Printer.DeviceInfo device) {
        if (uiStore != null) {
            uiStore.edit()
                .putString("niimbot_b1_address", device.address)
                .putString("niimbot_b1_name", device.name)
                .apply();
        }
        niimbotForceSelection = false;
        startQuietNiimbotPrint(device.address);
    }

    private void startQuietNiimbotPrint(String address) {
        Bitmap marketplaceBitmap = fbsOrderStickerBitmap(
            pendingNiimbotLabelBase64,
            pendingNiimbotLabelContentType
        );
        if (marketplaceBitmap == null) {
            niimbotPrintBusy = false;
            fbsFeedbackColor = BOX_NOT_NEEDED_RED;
            statusMessage = tr(
                "Не удалось подготовить изображение этикетки для печати.",
                "Chop etish uchun stiker tasvirini tayyorlab bo‘lmadi."
            );
            refreshCurrentScreen();
            return;
        }
        List<Bitmap> labels = new ArrayList<>();
        labels.add(marketplaceBitmap);
        labels.add(fbsSortingStickerBitmap(
            pendingNiimbotRequestNumber,
            pendingNiimbotOrderId,
            pendingNiimbotWarehouse
        ));
        niimbotPrintBusy = true;
        NiimbotB1Printer.print(this, address, labels, new NiimbotB1Printer.PrintCallback() {
            @Override
            public void onProgress(String message) {
                fbsFeedbackColor = BOX_DUPLICATE_BLUE;
                statusMessage = message;
                refreshCurrentScreen();
            }

            @Override
            public void onSuccess(String printerName) {
                niimbotPrintBusy = false;
                fbsFeedbackColor = BOX_FOUND_GREEN;
                statusMessage = tr("НАПЕЧАТАНО · ", "CHOP ETILDI · ") +
                    pendingNiimbotMarketplace + tr(" · заказ №", " · buyurtma №") +
                    pendingNiimbotOrderId + " · " + printerName + " · 50×30 мм";
                statusMessage = tr(
                    "НАПЕЧАТАНО 2 ЭТИКЕТКИ · ",
                    "2 TA STIKER CHOP ETILDI · "
                ) + pendingNiimbotMarketplace + " · заказ №" + pendingNiimbotOrderId +
                    " · " + printerName + " · 50×30 мм";
                pendingNiimbotLabelBase64 = "";
                pendingNiimbotLabelContentType = "";
                pendingNiimbotOrderId = "";
                pendingNiimbotMarketplace = "";
                pendingNiimbotRequestNumber = "";
                pendingNiimbotWarehouse = "";
                refreshCurrentScreen();
            }

            @Override
            public void onError(String message) {
                niimbotPrintBusy = false;
                fbsFeedbackColor = BOX_NOT_NEEDED_RED;
                statusMessage = message + tr(
                    " Если NIIMBOT открыт на другом телефоне — закройте там приложение и повторите.",
                    " Agar NIIMBOT boshqa telefonda ochiq bo‘lsa, u yerdagi ilovani yoping va takrorlang."
                );
                refreshCurrentScreen();
            }
        });
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
                        tr("Цвет: ", "Rang: ") + nonEmpty(item.color, "—") + " · " +
                        tr("РАЗМЕР: ", "O‘LCHAM: ") + nonEmpty(item.size, "—") + "\n" +
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

    private void showFbsGuidedScanDialog(
        String state,
        TsdFbsAssemblyResponse.Task task,
        String productName,
        String article,
        String color,
        String size,
        String marketplaceName
    ) {
        if (!FbsAssemblyUi.shouldUseGuidedScanDialog(state) || task == null) return;
        String dialogKey = nonEmpty(task.id, "-") + "|" + state;
        if (
            fbsGuidedScanDialog != null &&
            fbsGuidedScanDialog.isShowing() &&
            dialogKey.equals(fbsGuidedScanDialogKey)
        ) {
            return;
        }

        dismissFbsGuidedScanDialog();
        boolean scanKiz = "SCAN_KIZ".equals(state);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(8), dp(18), 0);
        content.addView(feedbackView(
            (scanKiz
                ? tr("ШАГ 2 ИЗ 2 · ОТСКАНИРУЙТЕ КИЗ", "2-QADAM · KIZNI SKANERLANG")
                : tr("ШАГ 1 ИЗ 2 · ОТСКАНИРУЙТЕ ШК", "1-QADAM · SHKNI SKANERLANG")) + "\n\n" +
                productName + "\n" +
                tr("Артикул: ", "Artikul: ") + article + "\n" +
                tr("Цвет: ", "Rang: ") + color + " · " + tr("Размер: ", "O‘lcham: ") + size + "\n" +
                (scanKiz
                    ? tr("После приёма КИЗ откроется наклейка ", "KIZ qabul qilingach stiker ochiladi: ") + marketplaceName
                    : tr("После ШК это окно переключится на КИЗ.", "SHKdan keyin oyna KIZga o‘tadi.")),
            scanKiz ? Color.rgb(254, 240, 138) : BOX_MOVEMENT_BLUE
        ));
        EditText dialogInput = input(scanKiz
            ? tr("Сканируйте КИЗ Data Matrix", "Data Matrix KIZni skanerlang")
            : tr("Сканируйте ШК товара", "Mahsulot SHKini skanerlang"));
        dialogInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence value, int start, int count, int after) { }

            @Override
            public void onTextChanged(CharSequence value, int start, int before, int count) { }

            @Override
            public void afterTextChanged(Editable value) {
                // FIX: аппаратный ТСД отправляет скан автоматически; отдельное
                // подтверждение ШК или КИЗ сотрудником не требуется.
                scheduleFbsGuidedAutoSubmit(dialogInput, value == null ? "" : value.toString());
            }
        });
        content.addView(dialogInput);
        fbsScanInput = dialogInput;

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(scanKiz
                ? tr("КИЗ товара", "Mahsulot KIZi")
                : tr("Товар из короба ", "Qutidagi mahsulot ") + nonEmpty(task.scannedBoxCode, "-"))
            .setView(content)
            .setNegativeButton(tr("Свернуть", "Yig‘ish"), null)
            .create();
        fbsGuidedScanDialog = dialog;
        fbsGuidedScanDialogKey = dialogKey;
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnShowListener(ignored -> {
            dialogInput.requestFocus();
        });
        dialog.setOnDismissListener(ignored -> {
            if (fbsGuidedScanDialog == dialog) {
                fbsGuidedScanDialog = null;
                fbsGuidedScanDialogKey = "";
                if (fbsScanInput == dialogInput) fbsScanInput = null;
            }
        });
        dialog.show();
    }

    private void scheduleFbsGuidedAutoSubmit(EditText input, String value) {
        if (fbsGuidedAutoSubmitTask != null) {
            mainHandler.removeCallbacks(fbsGuidedAutoSubmitTask);
        }
        fbsGuidedAutoSubmitTask = null;
        if (nonEmpty(value, "").isEmpty()) return;
        fbsGuidedAutoSubmitTask = () -> {
            fbsGuidedAutoSubmitTask = null;
            if (fbsScanInput == input && !fbsBusy && !textValue(input).isEmpty()) {
                submitFbsScan();
            }
        };
        mainHandler.postDelayed(fbsGuidedAutoSubmitTask, 350L);
    }

    private void dismissFbsGuidedScanDialog() {
        if (fbsGuidedAutoSubmitTask != null) {
            mainHandler.removeCallbacks(fbsGuidedAutoSubmitTask);
            fbsGuidedAutoSubmitTask = null;
        }
        AlertDialog dialog = fbsGuidedScanDialog;
        fbsGuidedScanDialog = null;
        fbsGuidedScanDialogKey = "";
        fbsScanInput = null;
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
    }

    private void submitFbsScan() {
        if (fbsBusy || fbsAssembly == null || fbsAssembly.task == null) return;
        String value = textValue(fbsScanInput);
        if (value.isEmpty()) {
            showFbsError(tr("Сначала отсканируйте код.", "Avval kodni skanerlang."), true);
            return;
        }
        String state = nonEmpty(fbsAssembly.state, "");
        if ("SCAN_KIZ".equals(state)) {
            String kizError = fbsKizScanError(value);
            if (!kizError.isEmpty()) {
                // FIX: a locally rejected KIZ must not remain in the scanner
                // field and be submitted again by the hardware scanner.
                if (fbsScanInput != null) {
                    fbsScanInput.setText("");
                    fbsScanInput.requestFocus();
                }
                showFbsError(kizError, true);
                return;
            }
        }
        // FIX: the screen already knows whether it expects a box or KIZ. Skip
        // the universal classifier and its duplicate database reads.
        executeFbsAction(
            FbsTaskSafety.scanActionForState(state),
            FbsTaskSafety.scanFieldForState(state),
            value
        );
    }

    private void completeFbsAssembly() {
        executeFbsAction("complete", null, null);
    }

    private void confirmUndoFbsKiz() {
        if (fbsAssembly == null || fbsAssembly.task == null || fbsBusy) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Отменить принятый КИЗ?", "Qabul qilingan KIZ bekor qilinsinmi?"))
            .setMessage(tr(
                "КИЗ будет удалён из заказа Wildberries и освобождён в WMS. После этого отсканируйте правильный КИЗ.",
                "KIZ Wildberries buyurtmasidan o‘chiriladi va WMSda bo‘shatiladi. Keyin to‘g‘ri KIZni skanerlang."
            ))
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(tr("Да, отменить", "Ha, bekor qilish"), (dialog, which) ->
                executeFbsAction("undo-kiz", null, null)
            )
            .show();
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
        return fbsOrderStickerView(encodedImage, "image/png");
    }

    private ImageView fbsOrderStickerView(String encodedImage, String contentType) {
        Bitmap bitmap = fbsOrderStickerBitmap(encodedImage, contentType);
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
    }

    private Bitmap fbsOrderStickerBitmap(String encodedImage, String contentType) {
        try {
            byte[] bytes = Base64.decode(encodedImage, Base64.DEFAULT);
            return contentType.toLowerCase(Locale.ROOT).contains("pdf")
                ? firstPdfPage(bytes)
                : BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException | OutOfMemoryError ignored) {
            return null;
        }
    }

    private Bitmap fbsSortingStickerBitmap(
        String requestNumber,
        String orderId,
        String warehouseName
    ) {
        int width = 768;
        int height = 480;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);

        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setColor(Color.BLACK);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(7f);
        canvas.drawRect(10f, 10f, width - 10f, height - 10f, border);
        border.setStrokeWidth(3f);
        canvas.drawLine(28f, 154f, width - 28f, 154f, border);
        canvas.drawLine(28f, 294f, width - 28f, 294f, border);

        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        text.setColor(Color.BLACK);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        drawFittedSortingLine(
            canvas,
            text,
            "ЗАЯВКА №" + nonEmpty(requestNumber, "-"),
            width / 2f,
            112f,
            width - 64f,
            72f,
            34f
        );
        drawFittedSortingLine(
            canvas,
            text,
            "ЗАКАЗ №" + nonEmpty(orderId, "-"),
            width / 2f,
            252f,
            width - 64f,
            66f,
            30f
        );
        drawFittedSortingLine(
            canvas,
            text,
            "СКЛАД: " + nonEmpty(warehouseName, "НЕ УКАЗАН").toUpperCase(Locale.ROOT),
            width / 2f,
            407f,
            width - 64f,
            76f,
            28f
        );
        return bitmap;
    }

    private void drawFittedSortingLine(
        Canvas canvas,
        Paint paint,
        String value,
        float centerX,
        float baselineY,
        float maxWidth,
        float maxTextSize,
        float minTextSize
    ) {
        float size = maxTextSize;
        paint.setTextSize(size);
        while (size > minTextSize && paint.measureText(value) > maxWidth) {
            size -= 2f;
            paint.setTextSize(size);
        }
        canvas.drawText(value, centerX, baselineY, paint);
    }

    private Bitmap firstPdfPage(byte[] bytes) {
        File file = null;
        try {
            file = File.createTempFile("ozon-label-", ".pdf", getCacheDir());
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            }
            try (
                ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(
                    file,
                    ParcelFileDescriptor.MODE_READ_ONLY
                );
                PdfRenderer renderer = new PdfRenderer(descriptor)
            ) {
                if (renderer.getPageCount() < 1) return null;
                try (PdfRenderer.Page page = renderer.openPage(0)) {
                    int sourceWidth = Math.max(1, page.getWidth());
                    int sourceHeight = Math.max(1, page.getHeight());
                    float scale = Math.min(
                        2f,
                        Math.min(1600f / sourceWidth, 1600f / sourceHeight)
                    );
                    int width = Math.max(1, Math.round(sourceWidth * scale));
                    int height = Math.max(1, Math.round(sourceHeight * scale));
                    long pixels = (long) width * height;
                    if (pixels > 2_000_000L) {
                        float safeScale = (float) Math.sqrt(2_000_000d / pixels);
                        width = Math.max(1, Math.round(width * safeScale));
                        height = Math.max(1, Math.round(height * safeScale));
                    }
                    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    bitmap.eraseColor(Color.WHITE);
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    return bitmap;
                }
            }
        } catch (IOException | RuntimeException | OutOfMemoryError ignored) {
            return null;
        } finally {
            if (file != null) file.delete();
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

    // ADDED: when several boxes are expected on the pallet-sort, the worker
    // names the exact missing physical box before the signal is sent.
    private void chooseMissingFbsPalletBox(TsdFbsAssemblyResponse.PalletScan pallet) {
        if (
            pallet == null ||
            pallet.neededBoxCodes == null ||
            pallet.neededBoxCodes.isEmpty() ||
            fbsBusy
        ) return;
        if (pallet.neededBoxCodes.size() == 1) {
            confirmMissingFbsPalletBox(pallet.neededBoxCodes.get(0), pallet.code);
            return;
        }
        String[] boxCodes = pallet.neededBoxCodes.toArray(new String[0]);
        new AlertDialog.Builder(this)
            .setTitle(tr("Какого короба нет на паллете?", "Palletda qaysi quti yo‘q?"))
            .setItems(boxCodes, (dialog, which) -> {
                if (which >= 0 && which < boxCodes.length) {
                    confirmMissingFbsPalletBox(boxCodes[which], pallet.code);
                }
            })
            .setNegativeButton(tr("Отмена", "Bekor qilish"), null)
            .show();
    }

    private void confirmMissingFbsPalletBox(String boxCode, String palletCode) {
        String normalizedBoxCode = nonEmpty(boxCode, "");
        if (normalizedBoxCode.isEmpty() || fbsBusy) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Сообщить об отсутствующем коробе?", "Yo‘q quti haqida xabar berilsinmi?"))
            .setMessage(
                tr("Короб: ", "Quti: ") + normalizedBoxCode + "\n" +
                    tr("Паллетсорт: ", "Palletsort: ") + nonEmpty(palletCode, "-") + "\n\n" +
                    tr(
                        "Менеджер увидит задачу проверки в вебе. Остатки и заявка автоматически не изменятся.",
                        "Menejer vebda tekshiruv vazifasini ko‘radi. Qoldiq va ariza avtomatik o‘zgarmaydi."
                    )
            )
            .setNegativeButton(tr("Отмена", "Bekor qilish"), null)
            .setPositiveButton(tr("Отправить сигнал", "Xabar yuborish"), (dialog, which) ->
                reportMissingFbsPalletBox(normalizedBoxCode, palletCode)
            )
            .show();
    }

    private void reportMissingFbsPalletBox(String boxCode, String palletCode) {
        TsdSession session = safeSession();
        TsdFbsAssemblyResponse current = fbsAssembly;
        TsdFbsAssemblyResponse.Task task = current == null ? null : current.task;
        String clientId = task == null || task.client == null ? "" : nonEmpty(task.client.id, "");
        if (session == null || task == null || clientId.isEmpty() || fbsBusy) return;

        int requestNumber = current.progress == null ? 0 : current.progress.requestNumber;
        String requestLabel = requestNumber > 0
            ? String.format(Locale.US, "%06d", requestNumber)
            : nonEmpty(task.requestId, "-");
        String normalizedPalletCode = nonEmpty(palletCode, "-");
        String title = "СИГНАЛ ТСД: на паллете нет короба " + boxCode;
        String comment = "[FBS_MISSING_PALLET_BOX] Короб: " + boxCode +
            "; паллетсорт: " + normalizedPalletCode +
            "; заявка: " + requestLabel +
            "; заказ: " + nonEmpty(task.orderId, "-");

        fbsBusy = true;
        fbsFeedbackColor = Color.rgb(254, 240, 138);
        statusMessage = tr("Отправляю сигнал менеджеру…", "Menejerga xabar yuborilmoqda…");
        renderFbsAssemblyScreen();
        runBackground(() -> {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("type", "BOX_CHECK");
            request.put("clientId", clientId);
            request.put("title", title);
            request.put("comment", comment);
            Response<TsdInventorySession> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                .startInventory(session.authorizationHeader(), request)
                .execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException(inventoryHttpError(response));
            }
            mainHandler.post(() -> {
                // FIX: the picker stays on the same FBS pallet and continues work.
                online = true;
                fbsBusy = false;
                fbsFeedbackColor = Color.rgb(254, 240, 138);
                statusMessage = tr(
                    "Сигнал отправлен. Менеджер проверит короб " + boxCode + " в вебе.",
                    "Xabar yuborildi. Menejer " + boxCode + " qutisini vebda tekshiradi."
                );
                playFbsSuccess();
                renderFbsAssemblyScreen();
            });
        });
    }

    private void executeFbsAction(String action, String field, String value) {
        TsdSession session = safeSession();
        TsdFbsAssemblyResponse.Task currentTask = fbsAssembly == null ? null : fbsAssembly.task;
        if (session == null || currentTask == null || fbsBusy) return;
        String submittedState = fbsAssembly == null ? "" : nonEmpty(fbsAssembly.state, "");
        String actionOwnerKey = fbsSessionOwnerKey(session);
        String previousBoxCode = nonEmpty(currentTask.scannedBoxCode, "");
        boolean previousBoxWasNotPicked =
            !previousBoxCode.isEmpty() && nonEmpty(currentTask.scannedBarcode, "").isEmpty();
        boolean previousBoxWasLocallyConfirmed = FbsTaskSafety.matchesConfirmedBox(
            currentTask.id,
            previousBoxCode,
            actionOwnerKey,
            confirmedFbsBoxTaskId,
            confirmedFbsBoxCode,
            confirmedFbsBoxOwnerKey
        );
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
            if ("scan-any".equals(action)) {
                response = api.scanFbsCode(session.authorizationHeader(), taskId, payload).execute();
            } else if ("scan-box".equals(action)) {
                response = api.scanFbsBox(session.authorizationHeader(), taskId, payload).execute();
            } else if ("scan-barcode".equals(action)) {
                response = api.scanFbsBarcode(session.authorizationHeader(), taskId, payload).execute();
            } else if ("scan-kiz".equals(action) || "scan-kiz-move".equals(action)) {
                response = api.scanFbsKiz(session.authorizationHeader(), taskId, payload).execute();
            } else if ("undo-kiz".equals(action)) {
                response = api.undoFbsKiz(session.authorizationHeader(), taskId).execute();
            } else if ("release".equals(action)) {
                response = api.releaseFbsAssembly(session.authorizationHeader(), taskId).execute();
            } else {
                response = api.completeFbsAssembly(session.authorizationHeader(), taskId).execute();
            }
            if (!response.isSuccessful() || response.body() == null) {
                ApiErrorDetails errorDetails = responseErrorDetails(response, tr(
                    "Операция не выполнена. Повторите сканирование.",
                    "Amal bajarilmadi. Qayta skanerlang."
                ));
                if (FbsTaskSafety.isStaleTaskConflict(response.code(), errorDetails.code)) {
                    mainHandler.post(() -> reloadFbsAfterStaleTask(errorDetails.message));
                    return;
                }
                boolean clearRejectedScan = FbsTaskSafety.shouldClearRejectedScan(
                    action,
                    submittedState,
                    response.code()
                );
                mainHandler.post(() -> {
                    if (clearRejectedScan && fbsScanInput != null) {
                        // FIX: a rejected product barcode or KIZ must never remain in the
                        // scanner field and be submitted again by the operator.
                        fbsScanInput.setText("");
                        fbsScanInput.requestFocus();
                    }
                    showFbsError(errorDetails.message, response.code() < 500);
                });
                return;
            }
            TsdFbsAssemblyResponse updated = response.body();
            mainHandler.post(() -> {
                online = true;
                fbsBusy = false;
                fbsAssembly = updated;
                boolean problemWasReportedAfterBoxScan =
                    !previousBoxCode.isEmpty() && "release".equals(action);
                boolean switchedToAnotherTask =
                    updated.task == null || !taskId.equals(nonEmpty(updated.task.id, ""));
                boolean updatedTaskAcceptedBarcode = FbsTaskSafety.taskAcceptedScannedBarcode(
                    action,
                    value,
                    updated
                );
                // FIX: не отправляем сотрудника в обязательную инвентаризацию,
                // если сервер уже принял ШК и переключил заказ на нужный размер.
                if (FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
                    previousBoxWasLocallyConfirmed,
                    previousBoxWasNotPicked,
                    problemWasReportedAfterBoxScan,
                    updatedTaskAcceptedBarcode,
                    taskId,
                    previousBoxCode,
                    updated.task
                )) {
                    queueMandatoryFbsAudit(
                        currentTask.client == null ? "" : currentTask.client.id,
                        previousBoxCode
                    );
                }
                if ("release".equals(action) || switchedToAnotherTask) {
                    clearConfirmedFbsBoxScan();
                }
                if (
                    updated.task != null &&
                    FbsTaskSafety.isConfirmedBoxScan(
                        action,
                        value,
                        updated.task.id,
                        updated.task.scannedBoxCode
                    )
                ) {
                    confirmedFbsBoxTaskId = updated.task.id;
                    confirmedFbsBoxCode = updated.task.scannedBoxCode;
                    confirmedFbsBoxOwnerKey = actionOwnerKey;
                }
                persistMandatoryFbsAuditState();
                statusMessage = nonEmpty(updated.message, tr("Принято.", "Qabul qilindi."));
                boolean needsMoveConfirmation = "CONFIRM_KIZ_MOVE".equals(updated.state);
                boolean kizWasUndone = "undo-kiz".equals(action);
                fbsFeedbackColor = needsMoveConfirmation || kizWasUndone
                    ? Color.rgb(254, 240, 138)
                    : BOX_FOUND_GREEN;
                if (!needsMoveConfirmation) playFbsSuccess();
                if (!pendingFbsAuditBoxes.isEmpty()) {
                    resumeMandatoryFbsAudit();
                    return;
                }
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

    private void reloadFbsAfterStaleTask(String message) {
        online = true;
        fbsBusy = false;
        fbsAssembly = null;
        clearConfirmedFbsBoxScan();
        persistMandatoryFbsAuditState();
        fbsFeedbackColor = Color.rgb(254, 240, 138);
        statusMessage = nonEmpty(
            message,
            tr(
                "Задание уже изменилось. Обновляю очередь…",
                "Vazifa allaqachon o‘zgargan. Navbat yangilanmoqda…"
            )
        );
        renderFbsAssemblyScreen();
        mainHandler.postDelayed(this::loadNextFbsAssembly, 150L);
    }

    private void showFbsError(String message, boolean keepOnline) {
        online = keepOnline;
        fbsBusy = false;
        fbsFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = message;
        playFbsError();
        renderFbsAssemblyScreen();
        showScanningErrorDialog(message);
    }

    private void showFbsRequestsError(String message, boolean keepOnline) {
        online = keepOnline;
        fbsRequestsBusy = false;
        fbsFeedbackColor = BOX_NOT_NEEDED_RED;
        statusMessage = message;
        playFbsError();
        renderFbsRequestSelectionScreen();
        showScanningErrorDialog(message);
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(
                        VibrationEffect.createOneShot(vibrationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                    );
                } else {
                    vibrator.vibrate(vibrationMs);
                }
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
        statusMessage = tr("Загружаю поставки FBS для упаковки...", "FBS qadoqlash yetkazib berishlari yuklanmoqda...");
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
        root.addView(title(tr("Упаковка FBS", "FBS qadoqlash")));
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
            boolean sortingCenterBox = isSortingCenterPacking(current);
            root.addView(fbsWarehouseBanner(current.warehouseName, current.warehouseId));
            root.addView(feedbackView(
                (sortingCenterBox
                    ? tr("ОТКРЫТ КОРОБ\n", "QUTI OCHILDI\n")
                    : tr("ОТКРЫТО ГРУЗОМЕСТО\n", "YUK JOYI OCHILDI\n")) + safeText(current.cargoPlaceId) +
                    "\n" + tr("Заполнено: ", "To‘ldirildi: ") + current.packedItems +
                    tr(" · без ограничения", " · cheklovsiz") +
                    "\n" + tr("Поставка WB: ", "WB yetkazib berish: ") + safeText(current.supplyId) +
                    fbsRequestNumbersLabel(current.requestNumbers),
                BOX_MOVEMENT_BLUE
            ));
            root.addView(primaryMenuButton(
                sortingCenterBox
                    ? tr("Закрыть короб", "Qutini yopish")
                    : tr("Закрыть грузоместо", "Yuk joyini yopish"),
                view -> confirmCloseFbsCargoPacking()
            ));
            root.addView(messageView(sortingCenterBox
                ? tr(
                    "Кладите товар в этот короб и сканируйте ШК каждой положенной единицы. Не собранный товар сначала отпикайте в заявке FBS.",
                    "Tovarni shu qutiga joylang va har bir birlik SHKini skanerlang. Yig‘ilmagan tovarni avval FBS buyurtmasida yig‘ing."
                )
                : tr(
                    "Сканируйте полный ШК с наклейки заказа WB. Один заказ нельзя уложить дважды или в другое грузоместо.",
                    "WB buyurtma stikeridagi to‘liq SHKni skanerlang. Bir buyurtmani ikki marta yoki boshqa joyga qo‘yib bo‘lmaydi."
                )));
            fbsCargoScanInput = input(sortingCenterBox
                ? tr("Сканируйте ШК товара", "Tovar SHKini skanerlang")
                : tr("Сканируйте ШК заказа WB", "WB buyurtma SHK sini skanerlang"));
            root.addView(fbsCargoScanInput);
            root.addView(primaryMenuButton(
                sortingCenterBox
                    ? tr("Положить товар в короб", "Tovarni qutiga joylash")
                    : tr("Добавить заказ в грузоместо", "Buyurtmani yuk joyiga qo‘shish"),
                view -> submitFbsCargoScan()
            ));
            if (current.orders != null && !current.orders.isEmpty()) {
                root.addView(label(sortingCenterBox
                    ? tr("Последние уложенные товары", "Oxirgi joylangan tovarlar")
                    : tr("Последние уложенные заказы", "Oxirgi joylangan buyurtmalar")));
                int shown = 0;
                for (TsdFbsCargoPackingResponse.Order order : current.orders) {
                    if (shown++ >= 8) break;
                    String details = tr("Товар: ", "Mahsulot: ") + safeText(order.productName) +
                        (order.requestNumber > 0
                            ? "\n" + tr("Заявка WMS №", "WMS ariza №") + String.format(Locale.ROOT, "%06d", order.requestNumber)
                            : "") +
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
            Button cancelPackingButton = secondaryButton(
                tr("Отменить упаковку полностью", "Qadoqlashni to‘liq bekor qilish"),
                view -> confirmCancelFbsCargoPacking()
            );
            cancelPackingButton.setBackgroundColor(BOX_NOT_NEEDED_RED);
            cancelPackingButton.setTextColor(TEXT);
            root.addView(cancelPackingButton);
        } else {
            TsdFbsCargoPackingResponse.Supply selected = selectedFbsCargoSupply();
            if (selected != null) {
                boolean sortingCenterBox = isSortingCenterSupply(selected);
                root.addView(fbsWarehouseBanner(selected.warehouseName, selected.warehouseId));
                root.addView(feedbackView(
                    tr("ПОСТАВКА ", "YETKAZIB BERISH ") + safeText(selected.supplyId) +
                        fbsRequestNumbersLabel(selected.requestNumbers) +
                        "\n" + safeText(selected.client == null ? null : selected.client.name) +
                        "\n" + fbsDeliveryDestinationLabel(selected.deliveryDestination) +
                        "\n" + tr("Упаковано: ", "Qadoqlandi: ") + selected.packedItems + " / " + selected.totalPlannedItems +
                        " · " + (sortingCenterBox
                            ? tr("коробов закрыто: ", "yopilgan qutilar: ")
                            : tr("мест закрыто: ", "yopilgan joylar: ")) +
                        selected.closedCargoPlaces + " / " + selected.cargoPlaceCount,
                    BOX_DUPLICATE_BLUE
                ));
                root.addView(messageView(sortingCenterBox
                    ? tr(
                        "Возьмите пустой короб для поставки на СЦ и отсканируйте его номер. Затем кладите товары и сканируйте их ШК.",
                        "Saralash markazi uchun bo‘sh qutini oling va raqamini skanerlang. Keyin tovarlarni joylab, SHKlarini skanerlang."
                    )
                    : tr(
                        "Возьмите пустой физический короб, наклейте на него QR грузоместа WB и отсканируйте этот QR.",
                        "Bo‘sh qutini oling, WB yuk joyi QR stikerini yopishtiring va QRni skanerlang."
                    )));
                fbsCargoScanInput = input(sortingCenterBox
                    ? tr("Сканируйте номер короба FFL", "FFL quti raqamini skanerlang")
                    : tr("Сканируйте QR грузоместа WB", "WB yuk joyi QR kodini skanerlang"));
                root.addView(fbsCargoScanInput);
                root.addView(primaryMenuButton(
                    sortingCenterBox
                        ? tr("Открыть короб", "Qutini ochish")
                        : tr("Открыть грузоместо", "Yuk joyini ochish"),
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
                        "Нет поставок FBS для упаковки. Сначала сформируйте поставку и соберите заказы.",
                        "Qadoqlash uchun FBS yetkazib berishlari yo‘q. Avval yetkazib berishni yarating va buyurtmalarni yig‘ing."
                    )));
                } else {
                    root.addView(label(tr("Выберите поставку", "Yetkazib berishni tanlang")));
                    for (TsdFbsCargoPackingResponse.Supply supply : supplies) {
                        if (supply.readyToDeliver || supply.ignored) continue;
                        String clientName = supply.client == null ? "" : safeText(supply.client.name);
                        String stateText = tr("уложить: ", "joylash: ") + supply.remainingToPack +
                                " · " + tr("ещё собирается: ", "hali yig‘ilmoqda: ") + supply.waitingAssembly;
                        Button supplyButton = multilineSecondaryButton(
                            fbsWarehouseLabel(supply.warehouseName, supply.warehouseId) +
                                "\n" + safeText(supply.supplyId) + fbsRequestNumbersLabel(supply.requestNumbers) +
                                "\n" + clientName + " · " +
                                fbsDeliveryDestinationLabel(supply.deliveryDestination) + "\n" +
                                supply.packedItems + " / " + supply.totalPlannedItems + " · " + stateText,
                            view -> {
                                selectedFbsCargoPlanId = supply.id;
                                fbsCargoFeedbackColor = 0;
                                statusMessage = isSortingCenterSupply(supply)
                                    ? tr("Теперь отсканируйте номер пустого короба FFL.", "Endi bo‘sh FFL quti raqamini skanerlang.")
                                    : tr("Теперь отсканируйте QR грузоместа.", "Endi yuk joyi QR kodini skanerlang.");
                                renderFbsCargoPackingScreen();
                            }
                        );
                        root.addView(supplyButton);
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

    private void confirmCancelFbsCargoPacking() {
        TsdFbsCargoPackingResponse.Packing current =
            fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (current == null || fbsCargoBusy) return;
        new AlertDialog.Builder(this)
            .setTitle(tr("Отменить всю упаковку?", "Butun qadoqlash bekor qilinsinmi?"))
            .setMessage(
                tr(
                    "Все уже добавленные товары будут удалены из этого упаковочного места и вернутся в очередь. Сами заказы и их сборка не отменятся.",
                    "Qo‘shilgan barcha tovarlar bu joydan chiqarilib, navbatga qaytariladi. Buyurtmalar va ularning yig‘ilishi bekor qilinmaydi."
                )
            )
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(
                tr("Сбросить упаковку", "Qadoqlashni tiklash"),
                (dialog, which) -> executeFbsCargoAction("cancel", null)
            )
            .show();
    }

    private void confirmCloseFbsCargoPacking() {
        TsdFbsCargoPackingResponse.Packing current = fbsCargoPacking == null ? null : fbsCargoPacking.packing;
        if (current == null || fbsCargoBusy) return;
        boolean sortingCenterBox = isSortingCenterPacking(current);
        new AlertDialog.Builder(this)
            .setTitle(sortingCenterBox
                ? tr("Закрыть короб?", "Qutini yopasizmi?")
                : tr("Закрыть грузоместо?", "Yuk joyini yopasizmi?"))
            .setMessage(tr("Внутри зафиксировано: ", "Ichida qayd etilgan: ") + current.packedItems +
                tr(" единиц. После закрытия повторное сканирование запрещено.",
                    " dona. Yopilgandan keyin qayta skanerlash taqiqlanadi."))
            .setNegativeButton(tr("Нет", "Yo‘q"), null)
            .setPositiveButton(tr("Закрыть", "Yopish"), (dialog, which) -> executeFbsCargoAction("close", null))
            .show();
    }

    private boolean isSortingCenterSupply(TsdFbsCargoPackingResponse.Supply supply) {
        return supply != null && (
            "SORTING_CENTER_BOX".equals(supply.packingMode) ||
            "VNUKOVO_SORTING_CENTER".equals(supply.deliveryDestination)
        );
    }

    private boolean isSortingCenterPacking(TsdFbsCargoPackingResponse.Packing packing) {
        return packing != null && (
            "SORTING_CENTER_BOX".equals(packing.packingMode) ||
            "VNUKOVO_SORTING_CENTER".equals(packing.deliveryDestination)
        );
    }

    private String fbsDeliveryDestinationLabel(String destination) {
        return "VNUKOVO_SORTING_CENTER".equals(destination)
            ? tr("СЦ Внуково", "Vnukovo saralash markazi")
            : tr("ПВЗ", "PVZ");
    }

    private String fbsRequestNumbersLabel(List<Integer> requestNumbers) {
        if (requestNumbers == null || requestNumbers.isEmpty()) return "";
        StringBuilder result = new StringBuilder("\n");
        result.append(tr("Заявка WMS: ", "WMS ariza: "));
        for (int index = 0; index < requestNumbers.size(); index += 1) {
            Integer number = requestNumbers.get(index);
            if (number == null || number <= 0) continue;
            if (result.charAt(result.length() - 1) != ' ') result.append(", ");
            result.append("№").append(String.format(Locale.ROOT, "%06d", number));
        }
        return result.toString().endsWith(": ") ? "" : result.toString();
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
            } else if ("cancel".equals(action)) {
                response = api.cancelFbsCargoPacking(session.authorizationHeader(), current.id).execute();
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
                boolean closed = "close".equals(action) || "cancel".equals(action);
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
        showScanningErrorDialog(message);
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
        root.addView(messageView("Найдено: " + foundSearchBoxesCount(boxes, found) + " / " + boxes.size()));
        addFeedbackMessage(root, boxSearchFeedbackColor);
        TsdSearchBoxTask nextBox = null;
        for (TsdSearchBoxTask box : boxes) {
            if (!found.contains(normalizeBoxCode(box.boxCode))) {
                nextBox = box;
                break;
            }
        }
        if (nextBox != null) {
            int samePalletRemaining = 0;
            if (nextBox.storageLocation != null) {
                for (TsdSearchBoxTask box : boxes) {
                    if (
                        !found.contains(normalizeBoxCode(box.boxCode)) &&
                        box.storageLocation != null &&
                        safeText(nextBox.storageLocation.palletId).equals(safeText(box.storageLocation.palletId))
                    ) {
                        samePalletRemaining += 1;
                    }
                }
            }
            String samePalletHint = samePalletRemaining > 1
                ? "\nНа этой паллете нужно найти коробов: " + samePalletRemaining
                : "";
            root.addView(feedbackView(
                "СЛЕДУЮЩИЙ КОРОБ: " + nextBox.boxCode + "\n" +
                    boxStorageLocationLabel(nextBox) + samePalletHint,
                BOX_MOVEMENT_BLUE
            ));
        }
        assemblyScanInput = input("Сканируйте короб");
        assemblyScanInput.setOnEditorActionListener((view, actionId, event) -> {
            submitBoxSearchScan();
            return true;
        });
        root.addView(assemblyScanInput);

        for (TsdSearchBoxTask box : boxes) {
            if (!found.contains(normalizeBoxCode(box.boxCode))) {
                root.addView(taskRow(box.boxCode, "Нужно найти · " + boxInstructionLabel(box) + "\n" + boxStorageLocationLabel(box), Color.rgb(241, 245, 249)));
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
        root.addView(messageView(activeRelabelTask == null
            ? "Сканируйте старый ШК товара"
            : "Товар: " + emptyAsDash(activeRelabelTask.name) +
                "\nРазмер: " + emptyAsDash(activeRelabelTask.size) +
                "\nСканируйте новый ШК: " + activeRelabelTask.newBarcode));
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
                root.addView(taskRow(
                    task.oldBarcode + " -> " + task.newBarcode,
                    emptyAsDash(task.name) + " · размер: " + emptyAsDash(task.size) + "\nОсталось: " + remaining,
                    Color.rgb(241, 245, 249)
                ));
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
                String purpose = isShipmentMovementSource(sourceBox) ? "в новый короб поставки" : "остаток на баланс";
                root.addView(taskRow(sourceBox, purpose + " · осталось: " + remainingMovementForSource(sourceBox), Color.rgb(241, 245, 249)));
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
            if (!confirmed) {
                root.addView(taskRow(boxCode, "Нужно отпикать перед упаковкой", BOX_NOT_NEEDED_RED));
            }
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
        if (receiptKizAuditMode) {
            handleReceiptKizAuditScan();
            return;
        }
        if (receiptMode.isEmpty()) {
            statusMessage = "Выберите режим приемки.";
            renderReceiptScreen();
            return;
        }
        if (receiptClientId.isEmpty()) {
            startReceiptForSelectedClient();
            return;
        }
        if (!pendingReceiptBarcode.isEmpty() && pendingReceiptRequiresKiz) {
            handleReceiptKizScan();
            return;
        }
        if (!receiptUsesBoxes()) {
            handleReceiptBarcodeScan();
            return;
        }
        if (receiptBoxCode.isEmpty()) {
            openReceiptBoxFromInput();
            return;
        }
        handleReceiptBarcodeScan();
    }

    private void selectReceiptMode(String mode) {
        receiptMode = RECEIPT_MODE_BOXES.equals(mode) ? RECEIPT_MODE_BOXES : RECEIPT_MODE_STANDARD;
        receiptFeedbackColor = 0;
        statusMessage = RECEIPT_MODE_BOXES.equals(receiptMode)
            ? "Выбрана приемка по боксам. Теперь выберите клиента."
            : "Выбрана обычная приемка. Теперь выберите клиента.";
        renderReceiptScreen();
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
        statusMessage = !receiptUsesBoxes()
            ? "Клиент выбран. Сканируйте ШК товара."
            : "Клиент выбран. Сканируйте новый бокс/короб.";
        renderReceiptScreen();
    }

    private void startReceiptKizAudit() {
        if (!pendingReceiptBarcode.isEmpty()) {
            statusMessage = "Сначала завершите или отмените текущий товар.";
            renderReceiptScreen();
            return;
        }
        receiptKizAuditMode = true;
        receiptFeedbackColor = BOX_DUPLICATE_BLUE;
        statusMessage = "Проверка КИЗ включена. Сканируйте уже уложенные КИЗы — повторного прихода не будет.";
        renderReceiptScreen();
    }

    private void stopReceiptKizAudit() {
        receiptKizAuditMode = false;
        receiptFeedbackColor = 0;
        statusMessage = receiptUsesBoxes() && receiptBoxCode.isEmpty()
            ? "Проверка завершена. Сканируйте следующий бокс/короб."
            : "Проверка завершена. Продолжайте приемку.";
        renderReceiptScreen();
    }

    private void handleReceiptKizAuditScan() {
        if (receiptCheckingKiz) {
            return;
        }
        String kiz = textValue(scanInput);
        if (kiz.isEmpty()) {
            statusMessage = "Сканируйте КИЗ для проверки.";
            renderReceiptScreen();
            return;
        }
        String kizError = receiptKizError(kiz);
        if (!kizError.isEmpty()) {
            statusMessage = kizError;
            receiptFeedbackColor = BOX_NOT_NEEDED_RED;
            scanInput.setText("");
            renderReceiptScreen();
            return;
        }

        String normalizedKiz = kiz.trim().toUpperCase(Locale.ROOT);
        if (receiptKizValues.contains(normalizedKiz)) {
            String duplicateBox = receiptKizBoxes.get(normalizedKiz);
            statusMessage = "КИЗ уже принят в текущей приемке"
                + (duplicateBox == null || duplicateBox.trim().isEmpty() ? "." : " в " + duplicateBox + ".")
                + "\nПовторно ничего не записано.";
            receiptFeedbackColor = BOX_FOUND_GREEN;
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

        receiptCheckingKiz = true;
        scanInput.setEnabled(false);
        executor.execute(() -> {
            try {
                Response<TsdKizCheckResponse> response = WmsApiFactory.create(DEFAULT_BASE_URL)
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
                        statusMessage = "КИЗ уже принят в WMS"
                            + (result.boxCode == null || result.boxCode.trim().isEmpty()
                                ? "."
                                : " в короб " + result.boxCode + ".")
                            + "\nПовторно ничего не записано.";
                        receiptFeedbackColor = BOX_FOUND_GREEN;
                    } else {
                        statusMessage = "Этот КИЗ еще не принят в WMS.\nПроверьте, не пропущен ли товар при приемке.";
                        receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                    }
                    renderReceiptScreen();
                });
            } catch (Throwable error) {
                mainHandler.post(() -> {
                    receiptCheckingKiz = false;
                    online = false;
                    receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                    statusMessage = "Не удалось проверить КИЗ: нет связи с WMS. Данные не изменены.";
                    renderReceiptScreen();
                });
            }
        });
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
                    String failureMessage = inventoryHttpError(response);
                    mainHandler.post(() -> {
                        if (!session.hasSameAccessToken(safeSession())) return;
                        online = false;
                        receiptOpeningBox = false;
                        statusMessage = "Короб не открыт в WMS: " + failureMessage;
                        if (sameBox(receiptBoxCode, boxCode) && receiptCurrentItems.isEmpty()) {
                            receiptBoxCode = "";
                            clearPendingReceiptProductFields();
                        }
                        renderReceiptScreen();
                    });
                    return;
                }
                mainHandler.post(() -> {
                    if (!session.hasSameAccessToken(safeSession())) return;
                    online = true;
                    receiptOpeningBox = false;
                    if (sameBox(receiptBoxCode, boxCode)) {
                        statusMessage = "Короб открыт в WMS. Сканируйте товар.";
                        refreshHeaderText();
                    }
                });
            } catch (Throwable error) {
                mainHandler.post(() -> {
                    if (!session.hasSameAccessToken(safeSession())) return;
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
                    receiptFeedbackColor = BOX_NOT_NEEDED_RED;
                    statusMessage = "КИЗ не принят: не удалось проверить уникальность в WMS.\n"
                        + "Восстановите связь и отсканируйте этот КИЗ еще раз.";
                    renderReceiptScreen();
                });
            }
        });
    }

    private void addReceiptItem(String barcode, String kiz, TsdSkuInfo sku) {
        addReceiptItem(barcode, kiz, sku, null);
    }

    private void addReceiptItem(String barcode, String kiz, TsdSkuInfo sku, String message) {
        if (!receiptUsesBoxes()) {
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
        String clientId = receiptClientId;
        String sourceDocument = receiptSourceDocument;
        statusMessage = message == null
            ? "Сохраняю товар в WMS: " + barcode
            : message + "\nСохраняю товар в WMS.";
        renderReceiptScreen();

        runBackground(() -> {
            outbox.enqueueReceipt(
                clientId,
                barcode,
                kiz,
                null,
                1,
                "AVAILABLE",
                sourceDocument,
                RECEIPT_MODE_STANDARD,
                "Поштучная приемка ТСД без коробов"
            );
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
        if (receiptClosingBox) {
            return;
        }
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
        receiptClosingBox = true;
        statusMessage = "Сохраняю короб " + closedBoxCode + " в WMS. Не нажимайте кнопку повторно.";
        renderReceiptScreen();
        runBackground(() -> {
            try {
                for (ReceiptItem item : itemsToSend) {
                    outbox.enqueueReceipt(
                        receiptClientId,
                        item.barcode,
                        item.kiz,
                        closedBoxCode,
                        1,
                        "AVAILABLE",
                        receiptSourceDocument,
                        RECEIPT_MODE_BOXES,
                        "Приемка ТСД: короб " + closedBoxCode
                    );
                }
                WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
                TsdSyncSummary summary = new TsdSyncRunner(outbox, api, session.deviceCode)
                    .syncPending(session.authorizationHeader());
                mainHandler.post(() -> {
                    receiptClosingBox = false;
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
            } catch (Throwable error) {
                mainHandler.post(() -> receiptClosingBox = false);
                throw error;
            }
        });
    }

    private void finishReceipt() {
        if (!receiptBoxCode.isEmpty() && !receiptCurrentItems.isEmpty()) {
            statusMessage = "Сначала закройте текущий короб.";
            renderReceiptScreen();
            return;
        }
        String summary = !receiptUsesBoxes()
            ? "Приемка закрыта. Товаров: " + receiptAcceptedItems + "."
            : "Приемка по боксам закрыта. Боксов: " + receiptClosedBoxes + ", товаров: " + receiptAcceptedItems + ".";
        resetReceiptState();
        statusMessage = summary;
        renderMainScreen();
    }

    private void resetReceiptSession() {
        resetReceiptState();
        statusMessage = "Выберите режим приемки.";
        renderReceiptScreen();
    }

    private void resetReceiptStateAndRender() {
        resetReceiptState();
        statusMessage = "Выберите режим приемки.";
        renderReceiptScreen();
    }

    private void resetReceiptState() {
        if (receiptBoxAutoOpenTask != null) {
            mainHandler.removeCallbacks(receiptBoxAutoOpenTask);
            receiptBoxAutoOpenTask = null;
        }
        receiptMode = "";
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
        receiptOpeningBox = false;
        receiptClosingBox = false;
        receiptKizAuditMode = false;
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
            Response<TsdLoginResponse> response = api.login(
                new TsdLoginRequest(login, password, physicalInstallationCode())
            ).execute();
            if (!response.isSuccessful()) {
                throw new IOException(inventoryHttpError(response));
            }
            TsdLoginResponse body = response.body();
            if (body == null || body.device == null) {
                throw new IOException("Пустой ответ сервера");
            }
            sessionStore.save(body);
            mainHandler.post(() -> {
                resetReceiptState();
                clients.clear();
                refreshClientOptions();
                restoreMandatoryFbsAuditState();
                online = true;
                statusMessage = "Вошел сотрудник: " + nonEmpty(body.user == null ? null : body.user.name, login)
                    + ". ТСД: " + body.device.name;
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
                throw new IOException(inventoryHttpError(response));
            }
            List<TsdClientSummary> loadedClients = response.body();
            if (loadedClients == null) {
                loadedClients = new ArrayList<>();
            }
            List<TsdClientSummary> finalLoadedClients = loadedClients;
            mainHandler.post(() -> {
                if (!session.hasSameAccessToken(safeSession())) return;
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

    private String physicalInstallationCode() {
        String saved = uiStore == null
            ? ""
            : nonEmpty(uiStore.getString("tsd_installation_code", ""), "");
        if (!saved.isEmpty()) return saved;
        String androidId = Settings.Secure.getString(
            getContentResolver(),
            Settings.Secure.ANDROID_ID
        );
        String stablePart = nonEmpty(androidId, "").replaceAll("[^A-Za-z0-9]", "");
        if (stablePart.isEmpty()) {
            stablePart = UUID.randomUUID().toString().replace("-", "");
        }
        String generated = "TSD-INSTALL-" + stablePart.toUpperCase(Locale.ROOT);
        if (uiStore != null) {
            uiStore.edit().putString("tsd_installation_code", generated).commit();
        }
        return generated;
    }

    private void clearSession() {
        clearMandatoryFbsAuditState();
        sessionStore.clear();
        resetReceiptState();
        clients.clear();
        refreshClientOptions();
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
                    if (screen == Screen.INVENTORY_COUNT) {
                        inventoryRequestBusy = false;
                    }
                    boolean networkFailure = isNetworkFailure(error);
                    String failureMessage = networkFailure
                        ? tr(
                            "Нет связи с WMS. Проверьте интернет и повторите.",
                            "WMS bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring."
                        )
                        : nonEmpty(
                            error.getMessage(),
                            tr("Ошибка приложения.", "Ilova xatosi.")
                        );
                    if (screen == Screen.FBS_ASSEMBLY) {
                        showFbsError(failureMessage, !networkFailure);
                        return;
                    }
                    if (screen == Screen.FBS_REQUESTS) {
                        showFbsRequestsError(failureMessage, !networkFailure);
                        return;
                    }
                    if (screen == Screen.FBS_CARGO) {
                        showFbsCargoError(failureMessage, !networkFailure);
                        return;
                    }
                    online = !networkFailure;
                    statusMessage = failureMessage;
                    refreshCurrentScreen();
                    showScanningErrorDialog(statusMessage);
                });
            }
        });
    }

    private boolean isNetworkFailure(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (
                current instanceof java.net.SocketTimeoutException ||
                current instanceof java.net.ConnectException ||
                current instanceof java.net.UnknownHostException ||
                current instanceof java.net.SocketException ||
                current instanceof javax.net.ssl.SSLException
            ) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private void sendMonitorHeartbeat() {
        TsdSession session = safeSession();
        if (session == null || monitorExecutor.isShutdown()) return;
        Map<String, Object> payload = buildMonitorPayload();
        monitorExecutor.execute(() -> {
            try {
                Response<Map<String, Object>> response = WmsApiFactory.create(DEFAULT_BASE_URL)
                    .sendMonitorHeartbeat(session.authorizationHeader(), payload)
                    .execute();
                Map<String, Object> body = response.body();
                if (response.isSuccessful() && body != null && body.get("command") instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> command = (Map<String, Object>) body.get("command");
                    String action = String.valueOf(command.get("action"));
                    mainHandler.post(() -> handleMonitorCommand(action));
                }
            } catch (Throwable ignored) {
            }
        });
    }

    private void handleMonitorCommand(String actionValue) {
        String action = nonEmpty(actionValue, "").trim().toUpperCase(Locale.ROOT);
        if ("LOGOUT".equals(action)) {
            clearSession();
            return;
        }
        if ("UPDATE_APP".equals(action)) {
            openApkDownload();
            return;
        }
        if ("UNLOCK_INVENTORY".equals(action)) {
            unlockInventoryFromMonitor();
            return;
        }
        if (!"RELOAD_REQUEST".equals(action)) return;
        statusMessage = tr("Диспетчер перезагрузил текущую заявку.", "Dispetcher joriy arizani qayta yukladi.");
        if (screen == Screen.FBS_ASSEMBLY) {
            fbsAssembly = null;
            loadNextFbsAssembly();
        } else if (screen == Screen.FBS_REQUESTS) {
            loadFbsRequestChoices();
        } else if (screen == Screen.FBS_CARGO) {
            loadFbsCargoPacking();
        } else if (screen == Screen.ASSEMBLY_DETAIL && assemblyPlan != null) {
            loadAssemblyPlan(assemblyPlan.id);
        } else {
            refreshCurrentScreen();
        }
    }

    private void unlockInventoryFromMonitor() {
        if (activeErrorDialog != null && activeErrorDialog.isShowing()) {
            activeErrorDialog.dismiss();
        }
        if (mandatoryFbsAuditActive || !pendingFbsAuditBoxes.isEmpty()) {
            clearMandatoryFbsAuditState();
        }
        activeInventory = null;
        activeInventoryBox = null;
        inventoryDashboard = null;
        inventoryType = "";
        inventoryClientId = "";
        transferredInventoryBoxId = "";
        inventoryTransferMode = false;
        inventoryArchiveMode = false;
        inventoryBoxInput = null;
        inventoryItemInput = null;
        inventoryQuantityInput = null;
        inventoryTransferTargetInput = null;
        statusMessage = tr(
            "Администратор разблокировал инвентаризацию. Можно продолжать работу.",
            "Administrator inventarizatsiyani blokdan chiqardi. Ishni davom ettirish mumkin."
        );
        renderMainScreen();
    }

    private void reportMonitorError(String message) {
        TsdSession session = safeSession();
        if (session == null || monitorExecutor.isShutdown()) return;
        Map<String, Object> payload = buildMonitorPayload();
        payload.put("message", nonEmpty(message, "Ошибка сканирования"));
        // FIX: this branch builds the LOGOFF TSD application; capture only its app window,
        // never the Android system UI or content from another application.
        byte[] screenshot = captureAppScreenshot();
        monitorExecutor.execute(() -> {
            try {
                WmsApi api = WmsApiFactory.create(DEFAULT_BASE_URL);
                Response<Map<String, Object>> response = api
                    .sendMonitorError(session.authorizationHeader(), payload)
                    .execute();
                if (screenshot == null || !response.isSuccessful() || response.body() == null) return;
                String operationId = String.valueOf(response.body().get("operationId"));
                if (operationId.isBlank() || "null".equals(operationId)) return;
                RequestBody image = RequestBody.create(MediaType.parse("image/jpeg"), screenshot);
                MultipartBody.Part part = MultipartBody.Part.createFormData(
                    "screenshot",
                    "tsd-error-" + System.currentTimeMillis() + ".jpg",
                    image
                );
                api.uploadMonitorErrorScreenshot(session.authorizationHeader(), operationId, part).execute();
            } catch (Throwable ignored) {
            }
        });
    }

    private byte[] captureAppScreenshot() {
        try {
            View root = getWindow().getDecorView().getRootView();
            int width = root.getWidth();
            int height = root.getHeight();
            if (width <= 0 || height <= 0) return null;
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565);
            root.draw(new Canvas(bitmap));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 58, output);
            bitmap.recycle();
            byte[] bytes = output.toByteArray();
            if (bytes.length <= 700 * 1024) return bytes;
            Bitmap retry = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565);
            root.draw(new Canvas(retry));
            output.reset();
            retry.compress(Bitmap.CompressFormat.JPEG, 34, output);
            retry.recycle();
            return output.size() <= 700 * 1024 ? output.toByteArray() : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private Map<String, Object> buildMonitorPayload() {
        Map<String, Object> payload = new LinkedHashMap<>();
        TsdSession session = safeSession();
        if (session != null) {
            payload.put("deviceCode", session.deviceCode);
            payload.put("workerName", nonEmpty(session.deviceName, session.deviceCode));
        }
        payload.put("screen", screen.name());
        payload.put("screenLabel", monitorScreenLabel(screen));
        payload.put("state", online ? "ONLINE" : "OFFLINE");
        payload.put("stage", monitorScreenLabel(screen));
        payload.put("lastAction", nonEmpty(statusMessage, monitorScreenLabel(screen)));
        payload.put("appVersion", BuildConfig.VERSION_NAME);
        payload.put("reportedAt", System.currentTimeMillis());

        if (activeInventory != null) {
            payload.put("inventorySessionId", activeInventory.id);
            payload.put("inventoryType", nonEmpty(activeInventory.type, inventoryType));
            payload.put("inventoryMandatory", mandatoryFbsAuditActive);
        }
        if (activeInventoryBox != null) {
            payload.put("inventoryBoxId", activeInventoryBox.id);
            payload.put("inventoryBoxCode", activeInventoryBox.boxCode);
        }

        if (fbsAssembly != null) {
            if (fbsAssembly.task != null) {
                TsdFbsAssemblyResponse.Task task = fbsAssembly.task;
                payload.put("requestId", task.requestId);
                payload.put("orderId", task.orderId);
                payload.put("productName", task.product == null ? "" : task.product.name);
                payload.put("clientName", task.client == null ? "" : task.client.name);
                payload.put("boxCode", nonEmpty(task.scannedBoxCode, task.recommendedBoxCode));
                payload.put("warehouseName", nonEmpty(task.warehouseName, ""));
                payload.put("barcode", nonEmpty(task.scannedBarcode, ""));
                if (task.product != null) {
                    payload.put("skuId", nonEmpty(task.product.id, ""));
                    payload.put("article", nonEmpty(task.product.article, ""));
                    payload.put("productSize", nonEmpty(task.product.size, ""));
                    payload.put("productColor", nonEmpty(task.product.color, ""));
                }
                if (task.recommendedLocation != null) {
                    payload.put("palletCode", nonEmpty(task.recommendedLocation.palletCode, ""));
                }
            }
            if (fbsAssembly.progress != null) {
                payload.put("requestNumber", String.valueOf(fbsAssembly.progress.requestNumber));
                payload.put("total", fbsAssembly.progress.requestTotalItems);
                payload.put("completed", fbsAssembly.progress.requestCompletedItems);
                payload.put("remaining", fbsAssembly.progress.requestRemainingItems);
            }
        } else if (assemblyPlan != null) {
            payload.put("requestId", assemblyPlan.id);
            payload.put("requestNumber", nonEmpty(assemblyPlan.title, assemblyPlan.id));
            payload.put("total", assemblyPlan.totalRequested);
            payload.put("completed", assemblyPlan.foundCount);
            payload.put("remaining", assemblyPlan.remainingCount);
        } else if (screen == Screen.RECEIPT) {
            payload.put("accepted", receiptAcceptedItems);
            payload.put("completed", receiptAcceptedItems);
            payload.put("boxCode", receiptBoxCode);
        }
        if (fbsAssembly != null && fbsAssembly.kizMoveProposal != null) {
            payload.put("kiz", nonEmpty(fbsAssembly.kizMoveProposal.kiz, ""));
        }
        return payload;
    }

    private String monitorScreenLabel(Screen value) {
        switch (value) {
            case RECEIPT: return "Приёмка";
            case ASSEMBLY_LIST:
            case ASSEMBLY_DETAIL: return "Сборка заявки";
            case BOX_SEARCH: return "Поиск коробов";
            case RELABEL_LIST:
            case RELABEL_BOX: return "Переклейка";
            case MOVEMENTS: return "Перемещения";
            case OUTGOING_CONTROL: return "Контроль отгрузки";
            case BOXLESS_PACKING: return "Упаковка без коробов";
            case FBS_REQUESTS: return "Список FBS-заявок";
            case FBS_ASSEMBLY: return "Сборка FBS";
            case FBS_CARGO: return "Упаковка FBS";
            case OZON_FBO_CLIENT:
            case OZON_FBO_PLANS:
            case OZON_FBO_BOXES:
            case OZON_FBO_ASSEMBLY: return "FBO Ozon";
            case STORAGE_PALLET: return "Паллетное хранение";
            case STOCK_TRANSFER: return "Перемещение товара";
            case INVENTORY_MENU:
            case INVENTORY_START:
            case INVENTORY_COUNT: return "Инвентаризация";
            case SETTINGS: return "Настройки";
            case INFO: return "Информация";
            case MAIN:
            default: return "Главное меню";
        }
    }

    private void showScanningErrorDialog(String message) {
        String text = nonEmpty(message, "Ошибка сканирования").trim();
        long now = System.currentTimeMillis();
        if (text.equals(lastDialogError) && now - lastDialogErrorAt < 1_500L) return;
        lastDialogError = text;
        lastDialogErrorAt = now;
        reportMonitorError(text);
        if (activeErrorDialog != null && activeErrorDialog.isShowing()) activeErrorDialog.dismiss();
        activeErrorDialog = new AlertDialog.Builder(this)
            .setTitle(tr("Ошибка сканирования", "Skanerlash xatosi"))
            .setMessage(text)
            .setCancelable(false)
            .setPositiveButton(tr("Понятно", "Tushunarli"), (dialog, which) -> dialog.dismiss())
            .create();
        activeErrorDialog.setOnDismissListener(dialog -> activeErrorDialog = null);
        activeErrorDialog.show();
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
        if (screen == Screen.OZON_FBO_BOXES || screen == Screen.OZON_FBO_ASSEMBLY) {
            return ozonFboScanInput;
        }
        if (screen == Screen.STORAGE_PALLET) {
            return storagePalletScanInput;
        }
        if (screen == Screen.STOCK_TRANSFER) {
            return transferScanInput;
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
        } else if (screen == Screen.OZON_FBO_BOXES) {
            openOzonFboBoxByCode();
        } else if (screen == Screen.OZON_FBO_ASSEMBLY) {
            submitOzonFboProductScan();
        } else if (screen == Screen.STORAGE_PALLET) {
            submitStoragePalletScan();
        } else if (screen == Screen.STOCK_TRANSFER) {
            submitStockTransferScan();
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

    private Button dangerSecondaryButton(String text, View.OnClickListener listener) {
        Button button = secondaryButton(text, listener);
        button.setTextColor(Color.rgb(153, 27, 27));
        button.setBackgroundColor(Color.rgb(254, 226, 226));
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
        view.setText("Версия " + installedVersionName());
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

    private String fbsWarehouseLabel(String warehouseName, String warehouseId) {
        String value = warehouseName == null ? "" : warehouseName.trim();
        if (value.isEmpty()) value = warehouseId == null ? "" : warehouseId.trim();
        if (value.isEmpty()) value = tr("НЕ ОПРЕДЕЛЁН", "ANIQLANMAGAN");
        return tr("СКЛАД WB: ", "WB OMBORI: ") + value.toUpperCase(Locale.ROOT);
    }

    private String fbsMarketplaceNames(List<String> marketplaces) {
        if (marketplaces == null || marketplaces.isEmpty()) return "FBS";
        List<String> names = new ArrayList<>();
        for (String marketplace : marketplaces) {
            String name = fbsMarketplaceName(marketplace);
            if (!names.contains(name)) names.add(name);
        }
        return String.join(" / ", names);
    }

    private String fbsMarketplaceName(String marketplace) {
        if ("OZON".equalsIgnoreCase(marketplace)) return "OZON";
        if ("YANDEX_MARKET".equalsIgnoreCase(marketplace)) return "ЯНДЕКС";
        if ("WILDBERRIES".equalsIgnoreCase(marketplace)) return "WB";
        return "FBS";
    }

    private TextView fbsWarehouseBanner(String warehouseName, String warehouseId) {
        TextView view = feedbackView(
            fbsWarehouseLabel(warehouseName, warehouseId),
            Color.rgb(254, 240, 138)
        );
        view.setTextColor(Color.rgb(15, 23, 42));
        view.setTextSize(23f);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(14), dp(16), dp(14), dp(16));
        return view;
    }

    private TextView fbsOrderStickerWarehouseBanner(TsdFbsAssemblyResponse.Task task) {
        String warehouseName = task == null ? "" : nonEmpty(task.warehouseName, task.warehouseId);
        if (warehouseName.isEmpty()) warehouseName = tr("НЕ УКАЗАН", "ANIQLANMAGAN");
        TextView view = feedbackView(
            tr("СКЛАД ЗАКАЗА\n", "BUYURTMA OMBORI\n") + warehouseName.toUpperCase(Locale.ROOT),
            Color.rgb(15, 23, 42)
        );
        view.setTextColor(Color.WHITE);
        view.setTextSize(27f);
        view.setTypeface(null, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setLetterSpacing(0.045f);
        view.setPadding(dp(14), dp(18), dp(14), dp(18));
        return view;
    }

    private TextView fbsMarketplaceWarehouseBanner(String marketplaceName, List<String> warehouseNames) {
        String warehouses = warehouseNames == null || warehouseNames.isEmpty()
            ? tr("НЕ ОПРЕДЕЛЁН", "ANIQLANMAGAN")
            : String.join(" / ", warehouseNames).toUpperCase(Locale.ROOT);
        TextView view = feedbackView(
            tr("СКЛАД ", "OMBOR ") + marketplaceName + ": " + warehouses,
            Color.rgb(254, 240, 138)
        );
        view.setTextColor(Color.rgb(15, 23, 42));
        view.setTextSize(23f);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(14), dp(16), dp(14), dp(16));
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

    private String boxStorageLocationLabel(TsdSearchBoxTask box) {
        if (box == null || box.storageLocation == null) {
            return tr("Место хранения не задано", "Saqlash joyi belgilanmagan");
        }
        return tr("Зона: ", "Zona: ") +
            nonEmpty(box.storageLocation.zoneName, tr("не назначена", "belgilanmagan")) +
            tr(" · Паллета: ", " · Pallet: ") +
            nonEmpty(box.storageLocation.palletCode, "-");
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
                if (
                    box.sourceBox != null &&
                    !box.sourceBox.trim().isEmpty() &&
                    !box.done &&
                    box.remainingQuantity > 0
                ) {
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

    private boolean receiptUsesBoxes() {
        return RECEIPT_MODE_BOXES.equals(receiptMode) || !receiptWithoutBoxes();
    }

    private String receiptModeLabel() {
        return RECEIPT_MODE_BOXES.equals(receiptMode) ? "приемка по боксам" : "обычная приемка";
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
        } else if (screen == Screen.FBS_REQUESTS) {
            renderFbsRequestSelectionScreen();
        } else if (screen == Screen.FBS_ASSEMBLY) {
            renderFbsAssemblyScreen();
        } else if (screen == Screen.FBS_CARGO) {
            renderFbsCargoPackingScreen();
        } else if (screen == Screen.OZON_FBO_CLIENT) {
            renderOzonFboClientScreen();
        } else if (screen == Screen.OZON_FBO_PLANS) {
            renderOzonFboPlansScreen();
        } else if (screen == Screen.OZON_FBO_BOXES) {
            renderOzonFboBoxesScreen();
        } else if (screen == Screen.OZON_FBO_ASSEMBLY) {
            renderOzonFboAssemblyScreen();
        } else if (screen == Screen.STORAGE_PALLET) {
            renderStoragePalletAssemblyScreen();
        } else if (screen == Screen.STOCK_TRANSFER) {
            renderStockTransferScreen();
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
        return responseErrorDetails(response, fallback).message;
    }

    private ApiErrorDetails responseErrorDetails(Response<?> response, String fallback) {
        String code = "";
        String messageText = fallback;
        try {
            if (response.errorBody() == null) return new ApiErrorDetails(code, messageText);
            String body = response.errorBody().string();
            if (body == null || body.trim().isEmpty()) return new ApiErrorDetails(code, messageText);
            JSONObject payload = new JSONObject(body);
            code = nonEmpty(payload.optString("code", ""), "");
            Object message = payload.opt("message");
            if (message != null && !JSONObject.NULL.equals(message)) {
                String text = String.valueOf(message).trim();
                if (!text.isEmpty()) messageText = text;
            }
        } catch (Throwable ignored) {
        }
        return new ApiErrorDetails(code, messageText);
    }

    private static final class ApiErrorDetails {
        final String code;
        final String message;

        ApiErrorDetails(String code, String message) {
            this.code = code == null ? "" : code;
            this.message = message == null ? "" : message;
        }
    }

    private boolean isFflBoxCode(String value) {
        String normalized = normalizeBoxCode(value);
        return normalized.startsWith("FFU") || normalized.startsWith("FFL");
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

    private String fbsKizScanError(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        String compact = trimmed
            .toUpperCase(Locale.ROOT)
            .replaceAll("[^A-ZА-ЯЁ0-9]", "");
        if (compact.startsWith("FFL")) {
            return tr(
                "Отсканирован номер короба. Сейчас нужен КИЗ Data Matrix товара.",
                "Quti raqami skanerlandi. Hozir mahsulotning Data Matrix KIZ kodi kerak."
            );
        }
        if (
            compact.startsWith("PALETSORT") ||
            compact.startsWith("PALLETSORT") ||
            compact.startsWith("ПАЛЛЕТСОРТ")
        ) {
            return tr(
                "Отсканирован код паллетсорта. Сейчас нужен КИЗ Data Matrix товара.",
                "Palletsort kodi skanerlandi. Hozir mahsulotning Data Matrix KIZ kodi kerak."
            );
        }
        if (trimmed.matches("^\\d{8,14}$")) {
            return tr(
                "Отсканирован обычный ШК товара. Сейчас нужен КИЗ Data Matrix.",
                "Oddiy mahsulot SHK skanerlandi. Hozir Data Matrix KIZ kerak."
            );
        }
        if (trimmed.length() < 21 || trimmed.length() > 135) {
            return tr(
                "Отсканирован не КИЗ. Нужен Data Matrix длиной от 21 до 135 символов.",
                "KIZ skanerlanmadi. 21 dan 135 belgigacha Data Matrix kerak."
            );
        }
        boolean hasGs1KizStructure =
            trimmed.matches("(?i)^(?:\\]d2)?01\\d{14}(?:\\x1d)?21[\\s\\S]+$") ||
            trimmed.matches("(?i)^\\(01\\)\\d{14}\\(21\\)[\\s\\S]+$");
        if (!hasGs1KizStructure) {
            return tr(
                "Код неверного типа. КИЗ должен содержать группы 01 (GTIN) и 21 (серийный номер).",
                "Kod turi noto‘g‘ri. KIZ 01 (GTIN) va 21 (seriya raqami) guruhlarini o‘z ichiga olishi kerak."
            );
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

    private boolean isLikelyBoxCode(String value) {
        String normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        return normalized.startsWith("FFL_") || normalized.startsWith("FL_");
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
        if (appUpdateBusy) {
            showUpdateStatus("Обновление уже загружается.", false);
            return;
        }
        TsdSession session = safeSession();
        if (session == null) {
            statusMessage = "Перед обновлением войдите на ТСД и синхронизируйте операции.";
            refreshCurrentScreen();
            return;
        }
        statusMessage = "Проверяю очередь и синхронизирую данные перед обновлением...";
        refreshCurrentScreen();
        runBackground(() -> {
            OperationOutboxCounts beforeSync = outbox.counts();
            if (beforeSync.pending == 0) {
                mainHandler.post(() -> {
                    pendingCount = beforeSync.pending;
                    rejectedCount = beforeSync.rejected;
                    statusMessage = "Очередь синхронизирована. Загружаю обновление...";
                    refreshCurrentScreen();
                    startManagedApkUpdate();
                });
                return;
            }
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
                    : "Все данные синхронизированы. Загружаю обновление...";
                refreshCurrentScreen();
                startManagedApkUpdate();
            });
        });
    }

    private void startManagedApkUpdate() {
        if (appUpdateBusy) return;
        appUpdateBusy = true;
        showUpdateStatus("Скачиваю и проверяю обновление ТСД...", false);
        executor.execute(() -> {
            try {
                File apk = downloadAndVerifyUpdateApk();
                if (apk == null) {
                    appUpdateBusy = false;
                    showUpdateStatus("На ТСД уже установлена актуальная версия.", false);
                    return;
                }
                installUpdateApk(apk);
            } catch (Throwable error) {
                appUpdateBusy = false;
                showUpdateStatus(
                    "Не удалось обновить ТСД: " + nonEmpty(error.getMessage(), "ошибка загрузки") + ".",
                    true
                );
            }
        });
    }

    private File downloadAndVerifyUpdateApk() throws Exception {
        String metadataUrl = APK_URL.endsWith(".apk")
            ? APK_URL.substring(0, APK_URL.length() - 4) + ".json"
            : APK_URL + ".json";
        JSONObject metadata = new JSONObject(new String(downloadBytes(metadataUrl), java.nio.charset.StandardCharsets.UTF_8));
        int remoteVersion = metadata.optInt("versionCode", 0);
        int installedVersion = installedVersionCode();
        if (remoteVersion <= installedVersion) {
            return null;
        }
        byte[] apkBytes = downloadBytes(metadata.optString("apkUrl", APK_URL) + "?v=" + remoteVersion);
        String expectedSha = metadata.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
        String actualSha = sha256(apkBytes);
        if (expectedSha.isEmpty() || !expectedSha.equals(actualSha)) {
            throw new SecurityException("контрольная сумма APK не совпала");
        }
        File apk = new File(getCacheDir(), "logoff-tsd-update-" + remoteVersion + ".apk");
        try (FileOutputStream output = new FileOutputStream(apk, false)) {
            output.write(apkBytes);
            output.flush();
        }
        return apk;
    }

    private byte[] downloadBytes(String urlValue) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlValue).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("сервер обновлений ответил HTTP " + status);
        }
        try (InputStream input = connection.getInputStream(); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private void installUpdateApk(File apk) throws Exception {
        PackageInstaller installer = getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getPackageName());
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session installSession = installer.openSession(sessionId)) {
            try (InputStream input = new FileInputStream(apk);
                 OutputStream output = installSession.openWrite("logoff-tsd.apk", 0, apk.length())) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read > 0) output.write(buffer, 0, read);
                }
                installSession.fsync(output);
            }
            Intent resultIntent = new Intent(UPDATE_INSTALL_ACTION).setPackage(getPackageName());
            PendingIntent callback = PendingIntent.getBroadcast(
                this,
                sessionId,
                resultIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            installSession.commit(callback.getIntentSender());
        }
    }

    @SuppressWarnings("deprecation")
    private int installedVersionCode() throws PackageManager.NameNotFoundException {
        android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            long value = info.getLongVersionCode();
            return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
        }
        return info.versionCode;
    }

    private void showUpdateStatus(String message, boolean error) {
        mainHandler.post(() -> {
            statusMessage = message;
            refreshCurrentScreen();
            if (error) showScanningErrorDialog(message);
        });
    }

    private String installedVersionName() {
        try {
            String versionName = getPackageManager()
                .getPackageInfo(getPackageName(), 0)
                .versionName;
            return versionName == null || versionName.isBlank() ? "—" : versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "—";
        }
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
        FBS_REQUESTS,
        FBS_ASSEMBLY,
        FBS_CARGO,
        OZON_FBO_CLIENT,
        OZON_FBO_PLANS,
        OZON_FBO_BOXES,
        OZON_FBO_ASSEMBLY,
        STORAGE_PALLET,
        STOCK_TRANSFER,
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

    private static class StoragePalletRecoveryItem {
        final String skuId;
        final String barcode;
        final String name;
        int quantity;

        StoragePalletRecoveryItem(String skuId, String barcode, String name, int quantity) {
            this.skuId = skuId;
            this.barcode = barcode;
            this.name = name;
            this.quantity = quantity;
        }
    }
}
