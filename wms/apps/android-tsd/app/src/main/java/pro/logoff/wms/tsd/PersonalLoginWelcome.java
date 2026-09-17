package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

// FIX: an application-local welcome that never changes the session or consumes scanner input.
final class PersonalLoginWelcome {
    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private Runnable tick;

    PersonalLoginWelcome(Activity activity) { this.activity = activity; }

    void show() {
        close();
        if (activity.isFinishing() || activity.isDestroyed()) return;
        AccessibilityManager accessibility = (AccessibilityManager) activity.getSystemService(Context.ACCESSIBILITY_SERVICE);
        boolean reducedMotion = Settings.Global.getFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
            || (accessibility != null && accessibility.isTouchExplorationEnabled());
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCanceledOnTouchOutside(false);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] { Color.rgb(22, 12, 43), Color.rgb(67, 33, 79), Color.rgb(16, 10, 28) });
        content.setBackground(background);
        TextView name = new TextView(activity);
        name.setText("✧ Элькапоне ✧"); name.setTextColor(Color.rgb(221, 180, 226));
        name.setTextSize(16); name.setGravity(Gravity.CENTER); name.setPadding(0, 0, 0, padding);
        content.addView(name, new LinearLayout.LayoutParams(-1, -2));
        TextView phrase = new TextView(activity);
        phrase.setTextSize(32); phrase.setTypeface(Typeface.create("serif", Typeface.NORMAL));
        phrase.setTextColor(Color.rgb(255, 243, 255)); phrase.setGravity(Gravity.CENTER);
        phrase.setMinLines(3); phrase.setShadowLayer(16f, 0f, 0f, Color.rgb(116, 73, 130));
        phrase.setContentDescription(PersonalLoginWelcomeState.TEXT);
        phrase.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_NONE);
        content.addView(phrase, new LinearLayout.LayoutParams(-1, -2));
        Button skip = new Button(activity);
        skip.setText("Продолжить →"); skip.setAllCaps(false); skip.setTextColor(Color.rgb(248, 233, 250));
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.argb(16, 255, 255, 255)); buttonBackground.setCornerRadius(padding);
        buttonBackground.setStroke(1, Color.rgb(147, 109, 156)); skip.setBackground(buttonBackground);
        skip.setPadding(padding, padding / 2, padding, padding / 2);
        LinearLayout.LayoutParams buttonLayout = new LinearLayout.LayoutParams(-2, -2);
        buttonLayout.topMargin = padding; content.addView(skip, buttonLayout);
        skip.setOnClickListener(view -> close());
        dialog.setOnDismissListener(ignored -> cancelTimer());
        dialog.setContentView(content);
        InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(), 0);
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        }
        skip.requestFocus();
        long startedAt = SystemClock.uptimeMillis();
        tick = new Runnable() {
            @Override public void run() {
                if (dialog == null || !dialog.isShowing()) return;
                long elapsed = SystemClock.uptimeMillis() - startedAt;
                phrase.setText(PersonalLoginWelcomeState.textAt(elapsed, reducedMotion).replace("....", "....\n") + (reducedMotion ? "" : "▏"));
                if (elapsed >= PersonalLoginWelcomeState.duration(reducedMotion)) { close(); return; }
                handler.postDelayed(this, 40L);
            }
        };
        handler.post(tick);
    }

    private void cancelTimer() { if (tick != null) handler.removeCallbacks(tick); tick = null; }
    void close() {
        cancelTimer();
        if (dialog != null) { dialog.dismiss(); dialog = null; }
    }
}
