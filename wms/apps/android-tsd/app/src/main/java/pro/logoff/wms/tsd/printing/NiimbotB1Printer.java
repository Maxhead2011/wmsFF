package pro.logoff.wms.tsd.printing;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Direct BLE raster printing for NIIMBOT B1/B1 Pro.
 *
 * Protocol framing and B1 job order follow the MIT-licensed, hardware-validated
 * niimbot-web-bluetooth reference implementation:
 * https://github.com/iscarelli/niimbot-web-bluetooth
 */
public final class NiimbotB1Printer {
    private static final UUID SERVICE_UUID = UUID.fromString("e7810a71-73ae-499d-8c15-faa9aef0c3f2");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("bef8d6c9-9c21-4c9e-b632-bd58c1009f9f");
    private static final UUID CLIENT_CONFIG_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final byte[] CONNECT_PACKET = new byte[] {
        0x03, 0x55, 0x55, (byte) 0xc1, 0x01, 0x01, (byte) 0xc1, (byte) 0xaa, (byte) 0xaa
    };
    private static final int B1_MODEL_ID = 0x1000;
    private static final int B1_PRO_MODEL_ID = 0x1001;
    private static final int B1_SE_MODEL_ID = 0x1002;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private NiimbotB1Printer() {}

    public static final class DeviceInfo {
        public final String name;
        public final String address;

        public DeviceInfo(String name, String address) {
            this.name = name == null || name.trim().isEmpty() ? "NIIMBOT B1" : name.trim();
            this.address = address;
        }

        public String displayName() {
            return name + "\n" + address;
        }
    }

    public interface DiscoveryCallback {
        void onFound(List<DeviceInfo> devices);
        void onError(String message);
    }

    public interface PrintCallback {
        void onProgress(String message);
        void onSuccess(String printerName);
        void onError(String message);
    }

    @SuppressLint("MissingPermission")
    public static void discover(Context context, DiscoveryCallback callback) {
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            MAIN.post(() -> callback.onError("На этом ТСД нет Bluetooth."));
            return;
        }
        if (!adapter.isEnabled()) {
            MAIN.post(() -> callback.onError("Включите Bluetooth на ТСД и повторите поиск принтера."));
            return;
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            MAIN.post(() -> callback.onError("Не удалось запустить поиск Bluetooth-принтера."));
            return;
        }

        Map<String, DeviceInfo> found = Collections.synchronizedMap(new LinkedHashMap<>());
        try {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                addIfNiimbot(found, device);
            }
        } catch (SecurityException ignored) {
            // Runtime permission is checked by the activity before discovery.
        }

        ScanCallback scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (result != null) addIfNiimbot(found, result.getDevice());
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                if (results == null) return;
                for (ScanResult result : results) {
                    if (result != null) addIfNiimbot(found, result.getDevice());
                }
            }

            @Override
            public void onScanFailed(int errorCode) {
                try {
                    scanner.stopScan(this);
                } catch (RuntimeException ignored) {}
                MAIN.post(() -> callback.onError("Поиск NIIMBOT B1 завершился ошибкой Bluetooth: " + errorCode + "."));
            }
        };

        try {
            scanner.startScan(scanCallback);
        } catch (SecurityException error) {
            MAIN.post(() -> callback.onError("Разрешите приложению поиск Bluetooth-устройств."));
            return;
        }
        MAIN.postDelayed(() -> {
            try {
                scanner.stopScan(scanCallback);
            } catch (RuntimeException ignored) {}
            List<DeviceInfo> devices;
            synchronized (found) {
                devices = new ArrayList<>(found.values());
            }
            devices.sort(Comparator.comparing(device -> device.name.toLowerCase()));
            if (devices.isEmpty()) {
                callback.onError(
                    "NIIMBOT B1 не найден. Включите принтер, закройте приложение NIIMBOT, " +
                    "поднесите принтер к ТСД и повторите поиск."
                );
            } else {
                callback.onFound(devices);
            }
        }, 6500L);
    }

    @SuppressLint("MissingPermission")
    private static void addIfNiimbot(Map<String, DeviceInfo> found, BluetoothDevice device) {
        if (device == null || device.getAddress() == null) return;
        String name;
        try {
            name = device.getName();
        } catch (SecurityException ignored) {
            return;
        }
        String normalized = name == null ? "" : name.trim().toUpperCase();
        if (
            normalized.startsWith("B1") ||
            normalized.contains("NIIMBOT") ||
            normalized.startsWith("B21")
        ) {
            found.put(device.getAddress(), new DeviceInfo(name, device.getAddress()));
        }
    }

    public static void print(
        Context context,
        String address,
        Bitmap source,
        PrintCallback callback
    ) {
        print(context, address, Collections.singletonList(source), callback);
    }

    public static void print(
        Context context,
        String address,
        List<Bitmap> sources,
        PrintCallback callback
    ) {
        if (sources == null || sources.isEmpty() || sources.contains(null)) {
            MAIN.post(() -> callback.onError("Изображение этикетки не загружено."));
            return;
        }
        new Thread(() -> {
            Session session = null;
            try {
                progress(callback, "Подключаю NIIMBOT B1…");
                session = new Session(context.getApplicationContext(), address);
                PrinterProfile profile;
                try {
                    profile = session.connectAndIdentify();
                } catch (Throwable firstError) {
                    session.close();
                    progress(callback, "Bluetooth-канал занят. Переподключаю NIIMBOT B1…");
                    Thread.sleep(700L);
                    session = new Session(context.getApplicationContext(), address);
                    try {
                        profile = session.connectAndIdentify();
                    } catch (Throwable secondError) {
                        String firstDetail = firstError.getMessage();
                        String secondDetail = secondError.getMessage();
                        throw new IllegalStateException(
                            (secondDetail == null || secondDetail.trim().isEmpty()
                                ? secondError.getClass().getSimpleName()
                                : secondDetail) +
                            (firstDetail == null || firstDetail.trim().isEmpty()
                                ? ""
                                : " Первая попытка: " + firstDetail)
                        );
                    }
                }
                progress(callback, "Готовлю этикетку 50×30 мм…");
                List<PackedBitmap> bitmaps = new ArrayList<>();
                for (Bitmap source : sources) {
                    bitmaps.add(packBitmap(source, profile.width, profile.height, profile.offsetY));
                }
                progress(callback, "Передаю этикетку на принтер…");
                session.print(bitmaps, profile, callback);
                String printerName = session.deviceName();
                MAIN.post(() -> callback.onSuccess(printerName));
            } catch (Throwable error) {
                String detail = error.getMessage();
                if (detail == null || detail.trim().isEmpty()) detail = error.getClass().getSimpleName();
                String message = "Не удалось напечатать на NIIMBOT B1: " + detail;
                MAIN.post(() -> callback.onError(message));
            } finally {
                if (session != null) session.close();
            }
        }, "niimbot-b1-print").start();
    }

    private static void progress(PrintCallback callback, String message) {
        MAIN.post(() -> callback.onProgress(message));
    }

    private static final class PrinterProfile {
        final boolean b1Task;
        final int modelId;
        final int width;
        final int height;
        final int offsetY;
        final int density;

        PrinterProfile(boolean b1Task, int modelId, int width, int height, int offsetY, int density) {
            this.b1Task = b1Task;
            this.modelId = modelId;
            this.width = width;
            this.height = height;
            this.offsetY = offsetY;
            this.density = density;
        }
    }

    private static final class PackedBitmap {
        final byte[] rows;
        final int width;
        final int height;
        final int stride;

        PackedBitmap(byte[] rows, int width, int height, int stride) {
            this.rows = rows;
            this.width = width;
            this.height = height;
            this.stride = stride;
        }
    }

    private static PackedBitmap packBitmap(Bitmap source, int width, int height, int offsetY) {
        Bitmap content = trimWhite(source);
        if (content.getHeight() > content.getWidth() && width > height) {
            Matrix rotation = new Matrix();
            rotation.postRotate(90f);
            content = Bitmap.createBitmap(content, 0, 0, content.getWidth(), content.getHeight(), rotation, true);
        }

        Bitmap page = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(page);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        int margin = 4;
        int availableWidth = Math.max(1, width - margin * 2);
        int availableHeight = Math.max(1, height - margin * 2 - Math.max(0, offsetY));
        float scale = Math.min(
            availableWidth / (float) Math.max(1, content.getWidth()),
            availableHeight / (float) Math.max(1, content.getHeight())
        );
        int drawWidth = Math.max(1, Math.round(content.getWidth() * scale));
        int drawHeight = Math.max(1, Math.round(content.getHeight() * scale));
        float left = (width - drawWidth) / 2f;
        float top = Math.max(0, offsetY) + (availableHeight - drawHeight) / 2f + margin;
        canvas.drawBitmap(
            content,
            null,
            new android.graphics.RectF(left, top, left + drawWidth, top + drawHeight),
            paint
        );

        int stride = (width + 7) / 8;
        byte[] packed = new byte[stride * height];
        int[] pixels = new int[width];
        for (int y = 0; y < height; y++) {
            page.getPixels(pixels, 0, width, 0, y, width, 1);
            for (int x = 0; x < width; x++) {
                int color = pixels[x];
                int alpha = Color.alpha(color);
                int luminance = (
                    299 * Color.red(color) +
                    587 * Color.green(color) +
                    114 * Color.blue(color)
                ) / 1000;
                if (alpha > 32 && luminance < 165) {
                    packed[y * stride + (x >> 3)] |= (byte) (0x80 >> (x & 7));
                }
            }
        }
        return new PackedBitmap(packed, width, height, stride);
    }

    private static Bitmap trimWhite(Bitmap source) {
        int width = source.getWidth();
        int height = source.getHeight();
        if (width < 2 || height < 2) return source;
        int left = width;
        int top = height;
        int right = -1;
        int bottom = -1;
        int[] row = new int[width];
        for (int y = 0; y < height; y++) {
            source.getPixels(row, 0, width, 0, y, width, 1);
            for (int x = 0; x < width; x++) {
                int color = row[x];
                int luminance = (
                    299 * Color.red(color) +
                    587 * Color.green(color) +
                    114 * Color.blue(color)
                ) / 1000;
                if (Color.alpha(color) > 24 && luminance < 248) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        }
        if (right < left || bottom < top) return source;
        int padding = Math.max(2, Math.min(width, height) / 100);
        left = Math.max(0, left - padding);
        top = Math.max(0, top - padding);
        right = Math.min(width - 1, right + padding);
        bottom = Math.min(height - 1, bottom + padding);
        return Bitmap.createBitmap(source, left, top, right - left + 1, bottom - top + 1);
    }

    private static final class Response {
        final int command;
        final byte[] data;

        Response(int command, byte[] data) {
            this.command = command;
            this.data = data;
        }
    }

    private static final class Session {
        private final Context context;
        private final String address;
        private final CountDownLatch ready = new CountDownLatch(1);
        private final BlockingQueue<Response> responses = new LinkedBlockingQueue<>();
        private final Object receiveLock = new Object();
        private final Object serviceDiscoveryLock = new Object();
        private volatile BluetoothGatt gatt;
        private volatile BluetoothGattCharacteristic characteristic;
        private volatile String connectionError;
        private volatile int negotiatedMtu = 23;
        private volatile boolean serviceDiscoveryStarted;
        private volatile CountDownLatch pendingWrite;
        private volatile int pendingWriteStatus = BluetoothGatt.GATT_FAILURE;
        private byte[] receiveBuffer = new byte[0];
        private BluetoothDevice device;

        Session(Context context, String address) {
            this.context = context;
            this.address = address;
        }

        @SuppressLint("MissingPermission")
        PrinterProfile connectAndIdentify() throws Exception {
            BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                throw new IllegalStateException("Bluetooth выключен.");
            }
            try {
                device = adapter.getRemoteDevice(address);
            } catch (IllegalArgumentException error) {
                throw new IllegalStateException("Сохранённый адрес принтера неверен.");
            }
            gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null || !ready.await(16, TimeUnit.SECONDS)) {
                throw new IllegalStateException("принтер не ответил. Включите B1 и закройте приложение NIIMBOT.");
            }
            if (connectionError != null) throw new IllegalStateException(connectionError);
            if (characteristic == null) {
                throw new IllegalStateException("устройство не поддерживает протокол NIIMBOT B1.");
            }
            if (negotiatedMtu < 70) {
                throw new IllegalStateException("Bluetooth-канал принтера слишком узкий. Перезапустите B1 и повторите.");
            }

            writeRaw(CONNECT_PACKET, 30L);
            Thread.sleep(220L);
            Response status = sendWait(0xa5, bytes(0x01), 0xb5, 1200L, false);
            int protocol = 0;
            if (status != null && status.data.length >= 13) {
                int value = unsigned(status.data[11]) * 100 + unsigned(status.data[12]);
                protocol = value >= 302 ? 5 : value >= 300 ? 4 : value >= 204 ? 3 : 0;
            }
            Response model = sendWait(0x40, bytes(0x08), 0x48, 1200L, false);
            int modelId = 0;
            if (model != null && model.data.length >= 1) {
                modelId = model.data.length >= 2
                    ? (unsigned(model.data[0]) << 8) | unsigned(model.data[1])
                    : unsigned(model.data[0]) << 8;
            }

            boolean b1Task = modelId != B1_PRO_MODEL_ID && protocol < 5;
            if (modelId != 0 && modelId != B1_MODEL_ID && modelId != B1_PRO_MODEL_ID && modelId != B1_SE_MODEL_ID) {
                throw new IllegalStateException("подключён не B1/B1 Pro (код модели " + modelId + ").");
            }
            if (b1Task) {
                armB1();
                return new PrinterProfile(true, modelId, 384, 240, 4, 3);
            }
            return new PrinterProfile(false, modelId, 584, 354, 0, 3);
        }

        String deviceName() {
            try {
                String name = device == null ? null : device.getName();
                return name == null || name.trim().isEmpty() ? "NIIMBOT B1" : name.trim();
            } catch (SecurityException ignored) {
                return "NIIMBOT B1";
            }
        }

        private void armB1() throws Exception {
            sendWait(0xa5, bytes(0x01), 0xb5, 1200L, false);
            int[] info = new int[] { 0x08, 0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09 };
            for (int sub : info) {
                sendWait(0x40, bytes(sub), 0x40 + sub, 800L, false);
            }
            sendWait(0xdc, bytes(0x04), 0xd9, 1200L, true);
        }

        void print(List<PackedBitmap> bitmaps, PrinterProfile profile, PrintCallback callback) throws Exception {
            int pageCount = bitmaps.size();
            sendWait(0x21, bytes(profile.density), 0x31, 1200L, true);
            sendWait(0x23, bytes(0x01), 0x33, 1200L, true);
            byte[] start = profile.b1Task
                ? bytes(pageCount >> 8, pageCount, 0, 0, 0, 0, 0)
                : bytes(pageCount >> 8, pageCount, 0, 0, 0, 0, 0, 1, 0);
            sendWait(0x01, start, 0x02, 2000L, true);

            for (int pageIndex = 0; pageIndex < pageCount; pageIndex++) {
                PackedBitmap bitmap = bitmaps.get(pageIndex);
            if (profile.b1Task) {
                sendWait(0x03, bytes(0x01), 0x04, 1200L, true);
                sendWait(
                    0x13,
                    bytes(
                        bitmap.height >> 8, bitmap.height,
                        bitmap.width >> 8, bitmap.width,
                        0, 1
                    ),
                    0x14,
                    2000L,
                    true
                );
            } else {
                send(0xa3, bytes(0x01));
                Thread.sleep(35L);
                sendWait(
                    0x13,
                    bytes(
                        bitmap.height >> 8, bitmap.height,
                        bitmap.width >> 8, bitmap.width,
                        0, 1, 0, 0, 0, 0, 0, 0, 0
                    ),
                    0x14,
                    2000L,
                    true
                );
            }

            sendRows(bitmap, profile.b1Task ? 11L : 4L);
            sendWait(0xe3, bytes(0x01), 0xe4, 4000L, true);
            }
            progress(callback, "NIIMBOT печатает этикетку…");
            waitUntilPrinted(pageCount);
            sendWait(0xf3, bytes(0x01), 0xf4, 3000L, true);
        }

        private void sendRows(PackedBitmap bitmap, long paceMs) throws Exception {
            int row = 0;
            while (row < bitmap.height) {
                int offset = row * bitmap.stride;
                boolean empty = true;
                for (int index = 0; index < bitmap.stride; index++) {
                    if (bitmap.rows[offset + index] != 0) {
                        empty = false;
                        break;
                    }
                }
                int run = 1;
                while (row + run < bitmap.height && run < 200) {
                    int nextOffset = (row + run) * bitmap.stride;
                    boolean same = true;
                    for (int index = 0; index < bitmap.stride; index++) {
                        if (bitmap.rows[offset + index] != bitmap.rows[nextOffset + index]) {
                            same = false;
                            break;
                        }
                    }
                    if (!same) break;
                    run += 1;
                }
                if (empty) {
                    writeFrame(0x84, bytes(row >> 8, row, run), paceMs);
                } else {
                    int black = 0;
                    for (int index = 0; index < bitmap.stride; index++) {
                        black += Integer.bitCount(unsigned(bitmap.rows[offset + index]));
                    }
                    byte[] data = new byte[6 + bitmap.stride];
                    data[0] = (byte) (row >> 8);
                    data[1] = (byte) row;
                    data[2] = 0;
                    data[3] = (byte) black;
                    data[4] = (byte) (black >> 8);
                    data[5] = (byte) run;
                    System.arraycopy(bitmap.rows, offset, data, 6, bitmap.stride);
                    writeFrame(0x85, data, paceMs);
                }
                row += run;
            }
        }

        private void waitUntilPrinted(int pageCount) throws Exception {
            long deadline = System.currentTimeMillis() + 26000L + Math.max(0, pageCount - 1) * 12000L;
            while (System.currentTimeMillis() < deadline) {
                Response status = sendWait(0xa3, bytes(0x01), 0xb3, 1100L, false);
                if (status != null && status.data.length >= 4) {
                    int page = (unsigned(status.data[0]) << 8) | unsigned(status.data[1]);
                    if (page >= pageCount) return;
                }
                Thread.sleep(170L);
            }
            throw new IllegalStateException("принтер не подтвердил завершение печати за 26 секунд.");
        }

        private void send(int command, byte[] data) throws Exception {
            writeFrame(command, data, 12L);
        }

        private Response sendWait(
            int command,
            byte[] data,
            int expectedCommand,
            long timeoutMs,
            boolean required
        ) throws Exception {
            responses.clear();
            writeFrame(command, data, 12L);
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                long remaining = deadline - System.currentTimeMillis();
                Response response = responses.poll(Math.max(1L, remaining), TimeUnit.MILLISECONDS);
                if (response == null) break;
                if (response.command == expectedCommand) return response;
            }
            if (required) {
                throw new IllegalStateException(
                    "принтер не ответил на команду 0x" + Integer.toHexString(command).toUpperCase() + "."
                );
            }
            return null;
        }

        private void writeFrame(int command, byte[] data, long paceMs) throws Exception {
            writeRaw(frame(command, data), paceMs);
        }

        @SuppressLint("MissingPermission")
        private void writeRaw(byte[] bytes, long paceMs) throws Exception {
            BluetoothGatt currentGatt = gatt;
            BluetoothGattCharacteristic currentCharacteristic = characteristic;
            if (currentGatt == null || currentCharacteristic == null) {
                throw new IllegalStateException("соединение с принтером потеряно.");
            }
            int properties = currentCharacteristic.getProperties();
            boolean supportsConfirmedWrite =
                (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
            boolean supportsUnconfirmedWrite =
                (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            if (!supportsConfirmedWrite && !supportsUnconfirmedWrite) {
                throw new IllegalStateException("Bluetooth-канал NIIMBOT не поддерживает запись.");
            }
            int writeType = supportsConfirmedWrite
                ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
            CountDownLatch completed = supportsConfirmedWrite ? new CountDownLatch(1) : null;
            if (completed != null) {
                pendingWriteStatus = BluetoothGatt.GATT_FAILURE;
                pendingWrite = completed;
            }
            boolean accepted = false;
            for (int attempt = 0; attempt < 25 && !accepted; attempt++) {
                if (Build.VERSION.SDK_INT >= 33) {
                    accepted = currentGatt.writeCharacteristic(
                        currentCharacteristic,
                        bytes,
                        writeType
                    ) == 0;
                } else {
                    currentCharacteristic.setWriteType(writeType);
                    currentCharacteristic.setValue(bytes);
                    accepted = currentGatt.writeCharacteristic(currentCharacteristic);
                }
                if (!accepted) Thread.sleep(15L);
            }
            if (!accepted) {
                pendingWrite = null;
                throw new IllegalStateException("Bluetooth-буфер принтера занят.");
            }
            if (completed != null) {
                if (!completed.await(2800L, TimeUnit.MILLISECONDS)) {
                    pendingWrite = null;
                    throw new IllegalStateException("ТСД не получил подтверждение отправки Bluetooth-команды.");
                }
                pendingWrite = null;
                if (pendingWriteStatus != BluetoothGatt.GATT_SUCCESS) {
                    throw new IllegalStateException(
                        "Bluetooth отклонил команду печати (код " + pendingWriteStatus + ")."
                    );
                }
            } else {
                Thread.sleep(Math.max(18L, paceMs));
            }
        }

        @SuppressLint("MissingPermission")
        private void discoverServicesOnce(BluetoothGatt bluetoothGatt) {
            synchronized (serviceDiscoveryLock) {
                if (gatt != bluetoothGatt || serviceDiscoveryStarted) return;
                serviceDiscoveryStarted = true;
            }
            if (!bluetoothGatt.discoverServices()) {
                connectionError = "не удалось запустить поиск служб NIIMBOT.";
                ready.countDown();
            }
        }

        @SuppressLint("MissingPermission")
        void close() {
            BluetoothGatt current = gatt;
            gatt = null;
            characteristic = null;
            if (current == null) return;
            try {
                current.disconnect();
            } catch (RuntimeException ignored) {}
            try {
                current.close();
            } catch (RuntimeException ignored) {}
        }

        private final BluetoothGattCallback callback = new BluetoothGattCallback() {
            @Override
            @SuppressLint("MissingPermission")
            public void onConnectionStateChange(BluetoothGatt bluetoothGatt, int status, int newState) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    connectionError = "ошибка подключения Bluetooth " + status + ".";
                    ready.countDown();
                    return;
                }
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    boolean mtuRequested = bluetoothGatt.requestMtu(247);
                    if (!mtuRequested) discoverServicesOnce(bluetoothGatt);
                    MAIN.postDelayed(() -> discoverServicesOnce(bluetoothGatt), 1400L);
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    connectionError = "принтер отключился во время обмена данными.";
                    CountDownLatch write = pendingWrite;
                    if (write != null) write.countDown();
                    ready.countDown();
                }
            }

            @Override
            @SuppressLint("MissingPermission")
            public void onMtuChanged(BluetoothGatt bluetoothGatt, int mtu, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) negotiatedMtu = mtu;
                discoverServicesOnce(bluetoothGatt);
            }

            @Override
            @SuppressLint("MissingPermission")
            public void onServicesDiscovered(BluetoothGatt bluetoothGatt, int status) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    connectionError = "не удалось прочитать службы NIIMBOT.";
                    ready.countDown();
                    return;
                }
                BluetoothGattService service = bluetoothGatt.getService(SERVICE_UUID);
                characteristic = service == null ? null : service.getCharacteristic(CHARACTERISTIC_UUID);
                if (characteristic == null) {
                    connectionError = "служба NIIMBOT B1 не найдена.";
                    ready.countDown();
                    return;
                }
                if (!bluetoothGatt.setCharacteristicNotification(characteristic, true)) {
                    connectionError = "не удалось включить ответы NIIMBOT на ТСД.";
                    ready.countDown();
                    return;
                }
                BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CLIENT_CONFIG_UUID);
                if (descriptor == null) {
                    connectionError = "NIIMBOT не предоставил канал ответов. Перезапустите принтер.";
                    ready.countDown();
                    return;
                }
                boolean started;
                if (Build.VERSION.SDK_INT >= 33) {
                    started = bluetoothGatt.writeDescriptor(
                        descriptor,
                        BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    ) == 0;
                } else {
                    descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    started = bluetoothGatt.writeDescriptor(descriptor);
                }
                if (!started) {
                    connectionError = "не удалось включить ответы принтера.";
                    ready.countDown();
                }
            }

            @Override
            public void onDescriptorWrite(BluetoothGatt bluetoothGatt, BluetoothGattDescriptor descriptor, int status) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    connectionError = "принтер не разрешил канал уведомлений.";
                }
                ready.countDown();
            }

            @Override
            public void onCharacteristicWrite(
                BluetoothGatt bluetoothGatt,
                BluetoothGattCharacteristic written,
                int status
            ) {
                pendingWriteStatus = status;
                CountDownLatch write = pendingWrite;
                if (write != null) write.countDown();
            }

            @Override
            public void onCharacteristicChanged(
                BluetoothGatt bluetoothGatt,
                BluetoothGattCharacteristic changed,
                byte[] value
            ) {
                accept(value);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onCharacteristicChanged(
                BluetoothGatt bluetoothGatt,
                BluetoothGattCharacteristic changed
            ) {
                accept(changed.getValue());
            }
        };

        private void accept(byte[] value) {
            if (value == null || value.length == 0) return;
            synchronized (receiveLock) {
                byte[] joined = Arrays.copyOf(receiveBuffer, receiveBuffer.length + value.length);
                System.arraycopy(value, 0, joined, receiveBuffer.length, value.length);
                receiveBuffer = joined;
                parseFrames();
            }
        }

        private void parseFrames() {
            int cursor = 0;
            while (receiveBuffer.length - cursor >= 7) {
                while (
                    cursor + 1 < receiveBuffer.length &&
                    (unsigned(receiveBuffer[cursor]) != 0x55 || unsigned(receiveBuffer[cursor + 1]) != 0x55)
                ) {
                    cursor += 1;
                }
                if (receiveBuffer.length - cursor < 7) break;
                int dataLength = unsigned(receiveBuffer[cursor + 3]);
                int frameLength = 7 + dataLength;
                if (receiveBuffer.length - cursor < frameLength) break;
                int endA = unsigned(receiveBuffer[cursor + frameLength - 2]);
                int endB = unsigned(receiveBuffer[cursor + frameLength - 1]);
                if (endA == 0xaa && endB == 0xaa) {
                    int command = unsigned(receiveBuffer[cursor + 2]);
                    byte[] data = Arrays.copyOfRange(
                        receiveBuffer,
                        cursor + 4,
                        cursor + 4 + dataLength
                    );
                    responses.offer(new Response(command, data));
                    cursor += frameLength;
                } else {
                    cursor += 1;
                }
            }
            if (cursor > 0) receiveBuffer = Arrays.copyOfRange(receiveBuffer, cursor, receiveBuffer.length);
        }
    }

    private static byte[] frame(int command, byte[] data) {
        byte[] payload = data == null ? new byte[0] : data;
        byte[] packet = new byte[7 + payload.length];
        packet[0] = 0x55;
        packet[1] = 0x55;
        packet[2] = (byte) command;
        packet[3] = (byte) payload.length;
        int checksum = command ^ payload.length;
        for (int index = 0; index < payload.length; index++) {
            packet[4 + index] = payload[index];
            checksum ^= unsigned(payload[index]);
        }
        packet[4 + payload.length] = (byte) checksum;
        packet[5 + payload.length] = (byte) 0xaa;
        packet[6 + payload.length] = (byte) 0xaa;
        return packet;
    }

    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int index = 0; index < values.length; index++) result[index] = (byte) values[index];
        return result;
    }

    private static int unsigned(byte value) {
        return value & 0xff;
    }
}
