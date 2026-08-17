package pro.logoff.wms.tsd.auth;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import pro.logoff.wms.tsd.network.TsdLoginResponse;

public class TsdSessionStore {
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_TOKEN_TYPE = "token_type";
    private static final String KEY_DEVICE_CODE = "device_code";
    private static final String KEY_DEVICE_NAME = "device_name";
    private static final String KEY_USER_ID = "user_id";
    private static final String KEY_USER_NAME = "user_name";
    private static final String KEY_ROLE_CODES = "role_codes";

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

        // Сессии старых версий приложения не содержат роль. Их нельзя считать
        // полноправными: пользователь должен войти ещё раз и получить актуальные права.
        if (
            !prefs.contains(KEY_USER_ID) ||
            !prefs.contains(KEY_USER_NAME) ||
            !prefs.contains(KEY_ROLE_CODES)
        ) {
            return null;
        }

        String userId = prefs.getString(KEY_USER_ID, null);
        String userName = prefs.getString(KEY_USER_NAME, null);
        String serializedRoleCodes = prefs.getString(KEY_ROLE_CODES, null);
        if (
            userId == null || userId.trim().isEmpty() ||
            userName == null || userName.trim().isEmpty() ||
            serializedRoleCodes == null || serializedRoleCodes.trim().isEmpty()
        ) {
            return null;
        }

        List<String> roleCodes = deserializeRoleCodes(serializedRoleCodes);
        if (roleCodes.isEmpty()) {
            return null;
        }

        String deviceName = prefs.getString(KEY_DEVICE_NAME, deviceCode);
        return new TsdSession(token, tokenType, deviceCode, deviceName, userId, userName, roleCodes);
    }

    public void save(TsdLoginResponse response) {
        TsdLoginResponse.User user = response.user;
        String userId = user == null ? null : user.id;
        String userName = user == null ? null : user.name;
        String roleCodes = user == null ? "" : serializeRoleCodes(user.roleCodes);
        prefs.edit()
            .putString(KEY_TOKEN, response.accessToken)
            .putString(KEY_TOKEN_TYPE, response.tokenType)
            .putString(KEY_DEVICE_CODE, response.device.code)
            .putString(KEY_DEVICE_NAME, response.device.name)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_USER_NAME, userName)
            .putString(KEY_ROLE_CODES, roleCodes)
            .apply();
    }

    private static String serializeRoleCodes(List<String> roleCodes) {
        if (roleCodes == null || roleCodes.isEmpty()) {
            return "";
        }
        List<String> normalized = new ArrayList<>();
        for (String roleCode : roleCodes) {
            if (roleCode == null) {
                continue;
            }
            String value = roleCode.trim().toUpperCase(Locale.ROOT);
            if (!value.isEmpty() && !normalized.contains(value)) {
                normalized.add(value);
            }
        }
        return String.join(",", normalized);
    }

    private static List<String> deserializeRoleCodes(String value) {
        List<String> result = new ArrayList<>();
        for (String roleCode : value.split(",")) {
            String normalized = roleCode.trim().toUpperCase(Locale.ROOT);
            if (!normalized.isEmpty() && !result.contains(normalized)) {
                result.add(normalized);
            }
        }
        return result;
    }

    public void clear() {
        prefs.edit().clear().apply();
    }
}
