package pro.logoff.wms.tsd;

import android.content.Context;

/** Explicit endpoints: switching never silently replays work against a different WMS. */
final class ServerSettings {
    static final String PREFS = "tsd_server_choice";
    static final String MAIN = "main";
    static final String BACKUP = "backup";
    static final String MAIN_URL = "https://wms.logoff.pro/";
    static final String BACKUP_URL = "https://77.37.144.211/";
    static final String[] NAMES = {"Основной · wms.logoff.pro", "Резервный · 77.37.144.211"};

    private ServerSettings() {}

    static String selected(Context context) {
        String fallback = defaultProfile(context.getPackageName());
        String value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("selected", fallback);
        return MAIN.equals(value) || BACKUP.equals(value) ? value : fallback;
    }

    static void select(Context context, String profile) {
        if (!MAIN.equals(profile) && !BACKUP.equals(profile)) {
            throw new IllegalArgumentException("Неизвестный сервер WMS");
        }
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("selected", profile).commit()) {
            throw new IllegalStateException("Не удалось сохранить выбранный сервер");
        }
    }

    static String baseUrl(String profile) { return BACKUP.equals(profile) ? BACKUP_URL : MAIN_URL; }
    static String defaultProfile(String packageId) { return packageId.endsWith(".servers") ? BACKUP : MAIN; }
    static String apkPath(String packageId) {
        return packageId.endsWith(".servers") ? "downloads/logoff-tsd-server-choice.apk" : "downloads/logoff-tsd.apk";
    }
    static String name(String profile) { return BACKUP.equals(profile) ? "Резервный сервер" : "Основной сервер"; }
    static String storageSuffix(String profile) { return BACKUP.equals(profile) ? "_server_backup_77_37_144_211" : ""; }
}
