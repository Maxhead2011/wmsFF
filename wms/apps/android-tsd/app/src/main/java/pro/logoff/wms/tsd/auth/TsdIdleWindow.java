package pro.logoff.wms.tsd.auth;

import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Window;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.util.function.BooleanSupplier;

/** FIX: preserve every native Window callback while observing only real dialog input. */
public final class TsdIdleWindow {
    private TsdIdleWindow() {}
    public static void attach(Window window, BooleanSupplier input) {
        Window.Callback original = window.getCallback();
        if (original == null) return;
        window.setCallback((Window.Callback) Proxy.newProxyInstance(
            Window.Callback.class.getClassLoader(), new Class<?>[]{Window.Callback.class}, (proxy, method, args) -> {
                boolean physical = "dispatchTouchEvent".equals(method.getName())
                    && ((MotionEvent) args[0]).getActionMasked() == MotionEvent.ACTION_DOWN;
                physical |= "dispatchKeyEvent".equals(method.getName())
                    && ((KeyEvent) args[0]).getAction() == KeyEvent.ACTION_DOWN;
                if (physical && !input.getAsBoolean()) return true;
                try { return method.invoke(original, args); }
                catch (InvocationTargetException error) { throw error.getCause(); }
            }));
    }
}
