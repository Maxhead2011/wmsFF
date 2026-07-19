package pro.logoff.wms.mobile.push;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.LinkedHashMap;
import java.util.Map;

import pro.logoff.wms.mobile.BuildConfig;
import pro.logoff.wms.mobile.LogoffApplication;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LogoffMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(@NonNull String token) {
        LogoffApplication app = (LogoffApplication) getApplication();
        if (!app.sessions().isLoggedIn()) return;
        Map<String, Object> device = new LinkedHashMap<>();
        device.put("fcmToken", token);
        device.put("appVersion", BuildConfig.VERSION_NAME);
        app.repository().api().registerDevice(device).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {}
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) {}
        });
    }

    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        String title = message.getNotification() == null
                ? message.getData().getOrDefault("title", "LOGOff WMS")
                : message.getNotification().getTitle();
        String body = message.getNotification() == null
                ? message.getData().getOrDefault("body", "Есть новое событие")
                : message.getNotification().getBody();
        String id = message.getData().getOrDefault(
                "notificationId",
                message.getMessageId() == null ? String.valueOf(System.currentTimeMillis()) : message.getMessageId()
        );
        NotificationCenter.show(
                this,
                id,
                title == null ? "LOGOff WMS" : title,
                body == null ? "" : body,
                message.getData().getOrDefault("requestId", "")
        );
    }
}
