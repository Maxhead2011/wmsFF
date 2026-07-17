package pro.logoff.wms.mobile.files;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.ResponseBody;
import pro.logoff.wms.mobile.BuildConfig;

public final class DocumentSaver {
    public interface Callback { void saved(Uri uri); void failed(String message); }
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private DocumentSaver() {}

    public static void save(Context context, String fileName, ResponseBody body, Callback callback) {
        IO.execute(() -> {
            try { callback.saved(write(context, safe(fileName), body.bytes())); }
            catch (Exception error) { callback.failed(error.getMessage() == null ? "Не удалось сохранить файл" : error.getMessage()); }
        });
    }

    private static Uri write(Context context, String name, byte[] bytes) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.MIME_TYPE, "application/pdf"); values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/LOGOff WMS");
            Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values); if (uri == null) throw new IOException("Хранилище недоступно");
            try (OutputStream output = context.getContentResolver().openOutputStream(uri)) { if (output == null) throw new IOException("Файл не открыт"); output.write(bytes); }
            return uri;
        }
        File directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS); if (directory == null) throw new IOException("Хранилище недоступно"); if (!directory.exists() && !directory.mkdirs()) throw new IOException("Папка не создана");
        File file = new File(directory, name); try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
        return FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".files", file);
    }

    private static String safe(String value) { return value.replaceAll("[\\\\/:*?\"<>|]", "_"); }
}
