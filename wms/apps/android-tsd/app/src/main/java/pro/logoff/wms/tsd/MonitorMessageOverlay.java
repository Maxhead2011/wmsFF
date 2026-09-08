package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.Application;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Map;
import java.util.function.Supplier;
import pro.logoff.wms.tsd.auth.TsdSession;

// ADDED: application-local full-screen dialog, not a system overlay permission.
// Keeps the underlying Activity and its scan fields intact, including transfer screens.
final class MonitorMessageOverlay implements Application.ActivityLifecycleCallbacks {
    interface Acknowledger { void acknowledge(String id, TsdSession session, java.util.function.Consumer<Boolean> done); }
    private final Application application;
    private final Supplier<TsdSession> sessions;
    private final Acknowledger acknowledger;
    private final MonitorMessageState state = new MonitorMessageState();
    private Activity foreground;
    private Dialog dialog;
    private TsdSession recipient;
    private String id = "", text = "", sender = "";
    private boolean busy;

    MonitorMessageOverlay(Activity owner, Supplier<TsdSession> sessions, Acknowledger acknowledger) {
        this.application = owner.getApplication();
        this.sessions = sessions;
        this.acknowledger = acknowledger;
        application.registerActivityLifecycleCallbacks(this);
    }

    void offer(Map<String, Object> message, TsdSession session) {
        sessionChanged();
        if (!session.hasSameAccessToken(sessions.get())) return;
        Object messageId = message.get("id"), messageText = message.get("text");
        if (!(messageId instanceof String) || !(messageText instanceof String) || !session.userId.equals(message.get("recipientUserId"))) return;
        if (!state.offer(session.accessToken, (String) messageId)) return;
        recipient = session; id = (String) messageId; text = (String) messageText;
        sender = String.valueOf(message.get("senderName"));
        show();
    }

    void sessionChanged() {
        if (recipient != null && !recipient.hasSameAccessToken(sessions.get())) {
            dismiss(); state.reset(); recipient = null; id = ""; busy = false;
        }
    }

    private void show() {
        sessionChanged();
        if (foreground == null || foreground.isFinishing() || foreground.isDestroyed() || id.isEmpty() || dialog != null) return;
        Activity activity = foreground;
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);
        dialog.setCanceledOnTouchOutside(false);
        // FIX: scanner Enter/Tab/Back cannot acknowledge or modify the underlying task.
        dialog.setOnKeyListener((d, key, event) -> true);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * activity.getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad); root.setBackgroundColor(Color.WHITE);
        TextView title = new TextView(activity);
        title.setText("СООБЩЕНИЕ ИЗ ВМС\n" + sender); title.setTextSize(22); title.setTextColor(Color.rgb(160, 20, 30));
        root.addView(title);
        ScrollView scroll = new ScrollView(activity);
        TextView content = new TextView(activity); content.setText(text); content.setTextSize(28); content.setTextColor(Color.BLACK);
        content.setPadding(0, pad, 0, pad); scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        TextView status = new TextView(activity); status.setTextSize(18); root.addView(status);
        Button ok = new Button(activity); ok.setText("ОК — прочитано"); ok.setTextSize(24);
        ok.setEnabled(!busy); ok.setFocusable(false); root.addView(ok, new LinearLayout.LayoutParams(-1, -2));
        ok.setOnClickListener(v -> {
            sessionChanged();
            if (recipient == null || !state.beginAck()) return;
            busy = true; ok.setEnabled(false); status.setText("Подтверждаю прочтение…");
            String acknowledgingId = id;
            TsdSession acknowledgingSession = recipient;
            acknowledger.acknowledge(acknowledgingId, acknowledgingSession, success -> {
                sessionChanged();
                if (recipient == null || !recipient.hasSameAccessToken(acknowledgingSession) || !id.equals(acknowledgingId)) return;
                busy = false;
                if (success) {
                    state.ackSucceeded(); id = ""; dismiss();
                } else {
                    state.ackFailed();
                    // Rebuild if the foreground activity changed while HTTP was in flight.
                    dismiss(); show();
                    if (dialog != null) {
                        TextView warning = dialog.getWindow().getDecorView().findViewWithTag("message-status");
                        if (warning != null) warning.setText("Нет подтверждения от ВМС. Проверьте связь и нажмите ОК ещё раз.");
                    }
                }
            });
        });
        status.setTag("message-status");
        dialog.setContentView(root); dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private void dismiss() { if (dialog != null) { dialog.dismiss(); dialog = null; } }
    void close() { dismiss(); application.unregisterActivityLifecycleCallbacks(this); foreground = null; }
    @Override public void onActivityResumed(Activity activity) { foreground = activity; show(); }
    @Override public void onActivityPaused(Activity activity) { if (foreground == activity) { dismiss(); foreground = null; } }
    @Override public void onActivityDestroyed(Activity activity) { if (foreground == activity) { dismiss(); foreground = null; } }
    @Override public void onActivityCreated(Activity activity, Bundle state) {}
    @Override public void onActivityStarted(Activity activity) {}
    @Override public void onActivityStopped(Activity activity) {}
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
}
