package pro.logoff.wms.tsd;

import android.os.Handler;
import android.os.Looper;
import java.util.WeakHashMap;

/** FIX: bound the installer wait even when Android never delivers a result. */
final class UpdateInstallFeedback {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final WeakHashMap<MainActivity, Runnable> PENDING = new WeakHashMap<>();
    static void arm(MainActivity activity) {
        clear(activity);
        Runnable timeout = () -> {
            PENDING.remove(activity);
            activity.managedUpdateStatus("Android не подтвердил установку за 90 секунд. Повторите проверку обновления через меню. Сохранённые операции не изменены.", true);
        };
        PENDING.put(activity, timeout);
        MAIN.postDelayed(timeout, 90_000L);
    }
    static void clear(MainActivity activity) {
        Runnable timeout = PENDING.remove(activity);
        if (timeout != null) MAIN.removeCallbacks(timeout);
    }
}
