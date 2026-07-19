package pro.logoff.wms.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.appcompat.app.AppCompatDelegate;

public final class ThemeStore {
    private static final String PREFS = "logoff_mobile_appearance";
    private static final String DARK = "dark_theme";

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
}
