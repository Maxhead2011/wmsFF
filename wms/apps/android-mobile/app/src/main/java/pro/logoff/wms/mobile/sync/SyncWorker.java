package pro.logoff.wms.mobile.sync;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.IOException;

import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.data.PendingAction;

public class SyncWorker extends Worker {
    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        LogoffApplication app = (LogoffApplication) getApplicationContext();
        if (!app.sessions().isLoggedIn()) return Result.success();
        // Safe queued actions are deliberately limited to notification acknowledgements in the first release.
        for (PendingAction action : app.database().cacheDao().pending()) {
            if (!"READ_NOTIFICATION".equals(action.method)) continue;
            try {
                retrofit2.Response<java.util.Map<String, Object>> response = app.repository().api().markNotificationRead(action.path).execute();
                if (response.isSuccessful()) app.database().cacheDao().remove(action); else app.database().cacheDao().failed(action.id);
            } catch (IOException error) { return Result.retry(); }
        }
        return Result.success();
    }
}
