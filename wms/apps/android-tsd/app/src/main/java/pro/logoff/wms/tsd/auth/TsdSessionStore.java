package pro.logoff.wms.tsd.auth;

import android.content.Context;
import android.content.SharedPreferences;

import pro.logoff.wms.tsd.network.TsdLoginResponse;

public class TsdSessionStore {
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_TOKEN_TYPE = "token_type";
    private static final String KEY_DEVICE_CODE = "device_code";
    private static final String KEY_DEVICE_NAME = "device_name";

    private final SharedPreferences prefs;

    public TsdSessionStore(Context context) {
        prefs = context.getSharedPreferences("logoff_wms_tsd_session", Context.MODE_PRIVATE);
    }

    public TsdSession load() {
        String token = prefs.getString(KEY_TOKEN, null);
        if (token == null) {
            return null;
        }

        String tokenType = prefs.getString(KEY_TOKEN_TYPE, "Bearer");
        String deviceCode = prefs.getString(KEY_DEVICE_CODE, null);
        if (deviceCode == null) {
            return null;
        }

        String deviceName = prefs.getString(KEY_DEVICE_NAME, deviceCode);
        return new TsdSession(token, tokenType, deviceCode, deviceName);
    }

    public void save(TsdLoginResponse response) {
        prefs.edit()
            .putString(KEY_TOKEN, response.accessToken)
            .putString(KEY_TOKEN_TYPE, response.tokenType)
            .putString(KEY_DEVICE_CODE, response.device.code)
            .putString(KEY_DEVICE_NAME, response.device.name)
            .apply();
    }

    public void clear() {
        prefs.edit().clear().apply();
    }
}
