package pro.logoff.wms.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.Activity;

import androidx.appcompat.app.AppCompatDelegate;

public final class ThemeStore {
    private static final String PREFS = "logoff_mobile_appearance";
    private static final String DARK = "dark_theme";
    private static final String APP_THEME = "app_theme";
    private static final String LEGACY_WEB_THEME = "web_theme";
    public static final String CLASSIC = "classic";
    public static final String SOUL = "soul";
    public static final String SOUL_DARK = "soul-dark";
    public static final String MODERN = "modern";
    public static final String AEROSPACE = "aerospace";
    public static final String OBSIDIAN = "obsidian";
    public static final String POLAR = "polar";
    public static final String FUTURE = "future3100";
    public static final String WING_X = "winx";
    public static final String WING_X_USER_ID = "d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82";

    private static final String[] APP_VALUES = {
            SOUL, SOUL_DARK, MODERN, POLAR, WING_X
    };
    private static final String[] APP_LABELS = {
            "Soul · светлая",
            "Soul · тёмная",
            "Современная",
            "Polar Grid",
            "WingX · Эля"
    };

    private ThemeStore() {}

    public static void applySaved(Context context) {
        AppCompatDelegate.setDefaultNightMode(
                isDarkTheme(appTheme(context)) ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
    }

    public static void applyActivityTheme(Activity activity) {
        String theme = appTheme(activity);
        int style = R.style.Theme_LogoffWms;
        if (MODERN.equals(theme)) style = R.style.Theme_LogoffWms_Modern;
        else if (AEROSPACE.equals(theme)) style = R.style.Theme_LogoffWms_Aerospace;
        else if (OBSIDIAN.equals(theme)) style = R.style.Theme_LogoffWms_Obsidian;
        else if (POLAR.equals(theme)) style = R.style.Theme_LogoffWms_Polar;
        else if (FUTURE.equals(theme)) style = R.style.Theme_LogoffWms_Future;
        else if (WING_X.equals(theme)) style = R.style.Theme_LogoffWms_WingX;
        activity.setTheme(style);
    }

    public static boolean isDark(Context context) {
        return isDarkTheme(appTheme(context));
    }

    public static void setDark(Context context, boolean dark) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        preferences.edit()
                .putBoolean(DARK, dark)
                .putString(APP_THEME, dark ? SOUL_DARK : SOUL)
                .apply();
        AppCompatDelegate.setDefaultNightMode(
                dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
    }

    public static String appTheme(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stored = preferences.getString(APP_THEME, null);
        if (!isAppTheme(stored)) stored = preferences.getString(LEGACY_WEB_THEME, null);
        // The native WMS starts in the same command-style dark visual language as the web WMS.
        // A user can still explicitly switch to any light theme in the application settings.
        if (!isAppTheme(stored)) stored = preferences.getBoolean(DARK, false) ? SOUL_DARK : SOUL;
        return stored;
    }

    public static void setAppTheme(Context context, String theme) {
        if (!isAppTheme(theme)) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(APP_THEME, theme)
                .putBoolean(DARK, isDarkTheme(theme))
                .apply();
        AppCompatDelegate.setDefaultNightMode(
                isDarkTheme(theme) ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
    }

    public static String[] appThemeValues(boolean includeWingX) {
        int size = includeWingX ? APP_VALUES.length : APP_VALUES.length - 1;
        String[] result = new String[size];
        System.arraycopy(APP_VALUES, 0, result, 0, size);
        return result;
    }

    public static String[] appThemeLabels(boolean includeWingX) {
        int size = includeWingX ? APP_LABELS.length : APP_LABELS.length - 1;
        String[] result = new String[size];
        System.arraycopy(APP_LABELS, 0, result, 0, size);
        return result;
    }

    public static String appThemeLabel(String theme) {
        for (int index = 0; index < APP_VALUES.length; index += 1) {
            if (APP_VALUES[index].equals(theme)) return APP_LABELS[index];
        }
        return APP_LABELS[0];
    }

    public static boolean canUseWingX(String userId) {
        return WING_X_USER_ID.equals(userId);
    }

    private static boolean isAppTheme(String value) {
        if (value == null) return false;
        for (String theme : APP_VALUES) if (theme.equals(value)) return true;
        return false;
    }

    private static boolean isDarkTheme(String value) {
        return SOUL_DARK.equals(value) || OBSIDIAN.equals(value) || FUTURE.equals(value) || WING_X.equals(value);
    }
}
