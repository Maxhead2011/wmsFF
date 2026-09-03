package pro.logoff.wms.tsd.auth;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TsdSession {
    public final String accessToken;
    public final String tokenType;
    public final String deviceCode;
    public final String deviceName;
    public final String userId;
    public final String userName;
    public final List<String> roleCodes;

    public TsdSession(
        String accessToken,
        String tokenType,
        String deviceCode,
        String deviceName,
        String userId,
        String userName,
        List<String> roleCodes
    ) {
        this.accessToken = accessToken;
        this.tokenType = tokenType;
        this.deviceCode = deviceCode;
        this.deviceName = deviceName;
        this.userId = userId;
        this.userName = userName;
        this.roleCodes = roleCodes == null
            ? Collections.emptyList()
            : Collections.unmodifiableList(new ArrayList<>(roleCodes));
    }

    public String authorizationHeader() {
        return tokenType + " " + accessToken;
    }

    public boolean hasSameAccessToken(TsdSession other) {
        return other != null && accessToken != null && accessToken.equals(other.accessToken);
    }

    public boolean hasRole(String roleCode) {
        if (roleCode == null) {
            return false;
        }
        for (String assignedRole : roleCodes) {
            if (roleCode.equalsIgnoreCase(assignedRole)) {
                return true;
            }
        }
        return false;
    }
}
