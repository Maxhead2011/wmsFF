package pro.logoff.wms.tsd.network;

public class TsdLoginRequest {
    public String code;
    public String secret;

    public TsdLoginRequest() {
    }

    public TsdLoginRequest(String code, String secret) {
        this.code = code;
        this.secret = secret;
    }
}
