package pro.logoff.wms.mobile.push;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import java.util.Collections;
import java.util.LinkedHashSet;

import pro.logoff.wms.mobile.MainActivity;
import pro.logoff.wms.mobile.R;

public final class NotificationCenter {
    public static final String CHANNEL_EVENTS = "wms_events";
    public static final String EXTRA_SECTION = "openSection";
    public static final String EXTRA_NOTIFICATION_ID = "notificationId";
    public static final String EXTRA_REQUEST_ID = "requestId";
    private static final String PREFS = "logoff_mobile_notifications";
    private static final String SHOWN = "shown_ids";
    private static final int MAX_REMEMBERED = 250;

    private NotificationCenter() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel events = new NotificationChannel(
                CHANNEL_EVENTS,
                "События WMS",
                NotificationManager.IMPORTANCE_HIGH
        );
        events.setDescription("Заявки, счета, приемка и важные складские события");
        events.enableVibration(true);
        context.getSystemService(NotificationManager.class).createNotificationChannel(events);
    }

    public static boolean show(Context context, String id, String title, String body, String requestId) {
        if (id == null || id.isBlank() || wasShown(context, id)) return false;
        if (Build.VERSION.SDK_INT >= 33
                && ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return false;

        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_SECTION, requestId == null || requestId.isBlank() ? "notifications" : "requests")
                .putExtra(EXTRA_NOTIFICATION_ID, id)
                .putExtra(EXTRA_REQUEST_ID, requestId == null ? "" : requestId);
        PendingIntent pending = PendingIntent.getActivity(
                context,
                id.hashCode(),
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_EVENTS)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(context.getColor(R.color.logoff_red))
                .setContentTitle(title == null || title.isBlank() ? "LOGOff WMS" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setAutoCancel(true)
                .setContentIntent(pending);
        context.getSystemService(NotificationManager.class).notify(id.hashCode(), notification.build());
        remember(context, id);
        return true;
    }

    public static void remember(Context context, String id) {
        if (id == null || id.isBlank()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        LinkedHashSet<String> ids = new LinkedHashSet<>(
                prefs.getStringSet(SHOWN, Collections.emptySet())
        );
        ids.remove(id);
        ids.add(id);
        while (ids.size() > MAX_REMEMBERED) ids.remove(ids.iterator().next());
        prefs.edit().putStringSet(SHOWN, ids).apply();
    }

    private static boolean wasShown(Context context, String id) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getStringSet(SHOWN, Collections.emptySet())
                .contains(id);
    }
}
