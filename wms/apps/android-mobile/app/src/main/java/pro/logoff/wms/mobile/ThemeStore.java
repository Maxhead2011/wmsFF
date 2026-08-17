package pro.logoff.wms.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.appcompat.app.AppCompatDelegate;

public final class ThemeStore {
    private static final String PREFS = "logoff_mobile_appearance";
    private static final String DARK = "dark_theme";
    private static final String WEB_THEME = "web_theme";
    public static final String CLASSIC = "classic";
    public static final String MODERN = "modern";
    public static final String AEROSPACE = "aerospace";
    public static final String OBSIDIAN = "obsidian";
    public static final String POLAR = "polar";
    public static final String FUTURE = "future3100";
    public static final String WING_X = "winx";
    public static final String WING_X_USER_ID = "d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82";

    private static final String[] WEB_VALUES = {
            CLASSIC, MODERN, AEROSPACE, OBSIDIAN, POLAR, FUTURE, WING_X
    };
    private static final String[] WEB_LABELS = {
            "Классическая",
            "Современная",
            "Aerospace Light",
            "Obsidian Command",
            "Polar Grid",
            "Future",
            "WingX · Эля"
    };

    private ThemeStore() {}

    public static void applySaved(Context context) {
        AppCompatDelegate.setDefaultNightMode(
                isDark(context) ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
    }

    public static boolean isDark(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DARK, false);
    }

    public static void setDark(Context context, boolean dark) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        preferences.edit().putBoolean(DARK, dark).apply();
        AppCompatDelegate.setDefaultNightMode(
                dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
    }

    public static String webTheme(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(WEB_THEME, CLASSIC);
        return isWebTheme(stored) ? stored : CLASSIC;
    }

    public static void setWebTheme(Context context, String theme) {
        if (!isWebTheme(theme)) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(WEB_THEME, theme)
                .apply();
    }

    public static String[] webThemeValues(boolean includeWingX) {
        int size = includeWingX ? WEB_VALUES.length : WEB_VALUES.length - 1;
        String[] result = new String[size];
        System.arraycopy(WEB_VALUES, 0, result, 0, size);
        return result;
    }

    public static String[] webThemeLabels(boolean includeWingX) {
        int size = includeWingX ? WEB_LABELS.length : WEB_LABELS.length - 1;
        String[] result = new String[size];
        System.arraycopy(WEB_LABELS, 0, result, 0, size);
        return result;
    }

    public static String webThemeLabel(String theme) {
        for (int index = 0; index < WEB_VALUES.length; index += 1) {
            if (WEB_VALUES[index].equals(theme)) return WEB_LABELS[index];
        }
        return WEB_LABELS[0];
    }

    public static boolean canUseWingX(String userId) {
        return WING_X_USER_ID.equals(userId);
    }

    private static boolean isWebTheme(String value) {
        if (value == null) return false;
        for (String theme : WEB_VALUES) if (theme.equals(value)) return true;
        return false;
    }
}
