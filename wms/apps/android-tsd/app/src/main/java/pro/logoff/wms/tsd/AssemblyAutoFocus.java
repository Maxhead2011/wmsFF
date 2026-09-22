package pro.logoff.wms.tsd;

import android.view.View;
import java.util.function.BooleanSupplier;

// FIX: scanner Enter can move focus after rendering; restore it after that event, without stealing dialog focus.
final class AssemblyAutoFocus {
    static void request(View target) { request(target, () -> true); }
    static void request(View target, BooleanSupplier current) {
        if (!"logoff".equals(BuildConfig.FLAVOR) || target == null) return;
        Runnable focus = () -> {
            if (current.getAsBoolean() && target.isAttachedToWindow() && target.hasWindowFocus()
                    && target.isShown() && target.isEnabled() && target.isFocusable()) target.requestFocus();
        };
        target.post(focus);
        target.postDelayed(focus, 80);
    }
}
