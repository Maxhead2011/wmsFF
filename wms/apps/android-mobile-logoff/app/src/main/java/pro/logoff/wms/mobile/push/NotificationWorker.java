package pro.logoff.wms.mobile.push;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.List;
import java.util.Map;

import pro.logoff.wms.mobile.LogoffApplication;
import retrofit2.Response;

public class NotificationWorker extends Worker {
    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void enqueueNow(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
                "mobile-notifications-now",
                ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(NotificationWorker.class).build()
        );
    }

    @NonNull @Override public Result doWork() {
        LogoffApplication app = (LogoffApplication) getApplicationContext();
        if (!app.sessions().isLoggedIn()) return Result.success();
        try {
            Response<Map<String, Object>> response = app.repository().api()
                    .notifications(null, true, 100)
                    .execute();
            if (response.code() == 401 || response.code() == 403) return Result.success();
            if (!response.isSuccessful() || response.body() == null) return Result.retry();
            Object raw = response.body().get("data");
            if (!(raw instanceof List<?> rows)) return Result.success();
            int shown = 0;
            for (Object value : rows) {
                if (!(value instanceof Map<?, ?> item)) continue;
                String id = text(item.get("id"));
                String title = text(item.get("title"));
                String body = text(item.get("body"));
                Object request = item.get("request");
                String requestId = item.get("requestId") == null && request instanceof Map<?, ?> map
                        ? text(map.get("id"))
                        : text(item.get("requestId"));
                if (NotificationCenter.show(getApplicationContext(), id, title, body, requestId)) shown++;
                if (shown >= 8) break;
            }
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    private String text(Object value) {
        return value == null || "null".equals(String.valueOf(value)) ? "" : String.valueOf(value);
    }
}
