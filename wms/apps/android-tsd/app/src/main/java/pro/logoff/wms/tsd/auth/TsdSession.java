package pro.logoff.wms.tsd.auth;

public class TsdSession {
    public final String accessToken;
    public final String tokenType;
    public final String deviceCode;
    public final String deviceName;

    public TsdSession(String accessToken, String tokenType, String deviceCode, String deviceName) {
        this.accessToken = accessToken;
        this.tokenType = tokenType;
        this.deviceCode = deviceCode;
        this.deviceName = deviceName;
    }

    public String authorizationHeader() {
        return tokenType + " " + accessToken;
    }
}
