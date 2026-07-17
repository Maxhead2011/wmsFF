package pro.logoff.wms.mobile.push;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.LinkedHashMap;

import pro.logoff.wms.mobile.BuildConfig;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.MainActivity;
import pro.logoff.wms.mobile.R;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LogoffMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL = "wms_events";

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
        String title = message.getNotification() == null ? message.getData().getOrDefault("title", "LOGOff WMS") : message.getNotification().getTitle();
        String body = message.getNotification() == null ? message.getData().getOrDefault("body", "Есть новое событие") : message.getNotification().getBody();
        show(title == null ? "LOGOff WMS" : title, body == null ? "" : body);
    }

    private void show(String title, String body) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "События WMS", NotificationManager.IMPORTANCE_HIGH));
        PendingIntent intent = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify((int) System.currentTimeMillis(), new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_launcher).setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(intent).build());
    }
}
