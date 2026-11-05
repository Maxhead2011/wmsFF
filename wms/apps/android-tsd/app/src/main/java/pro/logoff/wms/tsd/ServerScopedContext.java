package pro.logoff.wms.tsd;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;

/** Legacy main storage stays at its original names; backup storage is independent. */
final class ServerScopedContext extends ContextWrapper {
    private final String suffix;
    private final String profile;

    ServerScopedContext(Context base, String profile) {
        super(base);
        this.profile = profile;
        suffix = ServerSettings.storageSuffix(profile);
    }

    private String scoped(String name) {
        return name.startsWith(File.separator) || suffix.isEmpty() ? name : name + suffix;
    }

    @Override public Context getApplicationContext() {
        // Database/Bluetooth singletons must not retain an Activity's base context.
        Context app = getBaseContext().getApplicationContext();
        return app == getBaseContext() ? this : new ServerScopedContext(app, profile);
    }

    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
        // Selection is installation-wide; tokens, drafts and queues belong to one endpoint.
        return super.getSharedPreferences(ServerSettings.PREFS.equals(name) ? name : scoped(name), mode);
    }

    @Override public File getDatabasePath(String name) { return super.getDatabasePath(scoped(name)); }

    @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode,
            SQLiteDatabase.CursorFactory factory) {
        return super.openOrCreateDatabase(scoped(name), mode, factory);
    }

    @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode,
            SQLiteDatabase.CursorFactory factory, DatabaseErrorHandler handler) {
        return super.openOrCreateDatabase(scoped(name), mode, factory, handler);
    }
}
