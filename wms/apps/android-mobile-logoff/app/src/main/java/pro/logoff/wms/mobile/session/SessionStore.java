package pro.logoff.wms.mobile.session;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.util.UUID;

public class SessionStore {
    private static final String ACCESS = "access";
    private static final String REFRESH = "refresh";
    private static final String DEVICE = "device";
    private final SharedPreferences preferences;
    private final String installationId;

    public SessionStore(Context context) {
        try {
            MasterKey key = new MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            preferences = EncryptedSharedPreferences.create(context, "logoff_mobile_session", key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception error) {
            throw new IllegalStateException("Не удалось открыть защищенное хранилище", error);
        }
        String saved = preferences.getString("installation", null);
        installationId = saved == null ? UUID.randomUUID().toString() : saved;
        if (saved == null) preferences.edit().putString("installation", installationId).apply();
    }

    public void save(String accessToken, String refreshToken, String deviceId) {
        preferences.edit().putString(ACCESS, accessToken).putString(REFRESH, refreshToken).putString(DEVICE, deviceId).apply();
    }

    public String accessToken() { return preferences.getString(ACCESS, ""); }
    public String refreshToken() { return preferences.getString(REFRESH, ""); }
    public String deviceId() { return preferences.getString(DEVICE, ""); }
    public String installationId() { return installationId; }
    public boolean isLoggedIn() { return !accessToken().isEmpty() && !refreshToken().isEmpty(); }
    public void clear() { preferences.edit().remove(ACCESS).remove(REFRESH).remove(DEVICE).apply(); }
}
