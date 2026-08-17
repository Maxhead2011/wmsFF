package pro.logoff.wms.tsd.printing;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Bluetooth Classic / CPCL printing for DETONGER P2 (203 dpi, 48 mm print width). */
public final class DetongerP2Printer {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final int WIDTH = 384;
    private static final int HEIGHT = 240;

    private DetongerP2Printer() {}

    public static final class DeviceInfo {
        public final String name;
        public final String address;
        DeviceInfo(String name, String address) {
            this.name = name == null || name.trim().isEmpty() ? "DETONGER P2" : name.trim();
            this.address = address;
        }
        public String displayName() { return name + "\n" + address; }
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
        if (adapter == null) { callback.onError("На этом ТСД нет Bluetooth."); return; }
        if (!adapter.isEnabled()) { callback.onError("Включите Bluetooth на ТСД."); return; }
        List<DeviceInfo> devices = new ArrayList<>();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice device : bonded) {
                String name = device.getName();
                String normalized = name == null ? "" : name.toUpperCase();
                if (normalized.contains("DETONGER") || normalized.equals("P2") || normalized.startsWith("P2-")) {
                    devices.add(new DeviceInfo(name, device.getAddress()));
                }
            }
        } catch (SecurityException error) {
            callback.onError("Разрешите приложению подключение к Bluetooth-устройствам."); return;
        }
        devices.sort(Comparator.comparing(item -> item.name.toLowerCase()));
        if (devices.isEmpty()) {
            callback.onError("DETONGER P2 не найден среди сопряжённых устройств. Сначала подключите P2 в настройках Bluetooth ТСД.");
        } else callback.onFound(devices);
    }

    public static void print(Context context, String address, List<Bitmap> labels, PrintCallback callback) {
        if (labels == null || labels.isEmpty()) { callback.onError("Нет этикеток для печати."); return; }
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                progress(callback, "Подключаю DETONGER P2…");
                BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
                if (adapter == null) throw new IllegalStateException("Bluetooth недоступен");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream output = socket.getOutputStream();
                for (Bitmap label : labels) {
                    byte[] command = cpcl(label);
                    output.write(command);
                    output.flush();
                    Thread.sleep(350L);
                }
                String name = device.getName();
                String resultName = name == null || name.trim().isEmpty() ? "DETONGER P2" : name.trim();
                MAIN.post(() -> callback.onSuccess(resultName));
            } catch (Throwable error) {
                String detail = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                MAIN.post(() -> callback.onError("Не удалось напечатать на DETONGER P2: " + detail));
            } finally {
                if (socket != null) try { socket.close(); } catch (Exception ignored) {}
            }
        }, "detonger-p2-print").start();
    }

    private static void progress(PrintCallback callback, String message) {
        MAIN.post(() -> callback.onProgress(message));
    }

    private static byte[] cpcl(Bitmap source) {
        Bitmap canvasBitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(canvasBitmap);
        canvas.drawColor(Color.WHITE);
        float scale = Math.min((float) WIDTH / source.getWidth(), (float) HEIGHT / source.getHeight());
        float x = (WIDTH - source.getWidth() * scale) / 2f;
        float y = (HEIGHT - source.getHeight() * scale) / 2f;
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.save(); canvas.translate(x, y); canvas.scale(scale, scale); canvas.drawBitmap(source, 0, 0, paint); canvas.restore();
        int rowBytes = WIDTH / 8;
        StringBuilder hex = new StringBuilder(rowBytes * HEIGHT * 2);
        for (int yy = 0; yy < HEIGHT; yy++) {
            for (int bx = 0; bx < rowBytes; bx++) {
                int value = 0;
                for (int bit = 0; bit < 8; bit++) {
                    int pixel = canvasBitmap.getPixel(bx * 8 + bit, yy);
                    int gray = (Color.red(pixel) * 30 + Color.green(pixel) * 59 + Color.blue(pixel) * 11) / 100;
                    if (gray < 160) value |= (0x80 >> bit);
                }
                String h = Integer.toHexString(value & 0xff).toUpperCase();
                if (h.length() == 1) hex.append('0');
                hex.append(h);
            }
        }
        String cpcl = "! 0 200 200 " + HEIGHT + " 1\r\n" +
            "PAGE-WIDTH " + WIDTH + "\r\n" +
            "TONE 0\r\nSPEED 3\r\n" +
            "EG " + rowBytes + " " + HEIGHT + " 0 0 " + hex + "\r\n" +
            "FORM\r\nPRINT\r\n";
        return cpcl.getBytes(StandardCharsets.US_ASCII);
    }
}
