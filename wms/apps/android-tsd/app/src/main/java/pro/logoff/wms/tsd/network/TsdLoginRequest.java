package pro.logoff.wms.tsd.network;

public class TsdLoginRequest {
    public String login;
    public String password;

    public TsdLoginRequest() {
    }

    public TsdLoginRequest(String login, String password) {
        this.login = login;
        this.password = password;
    }
}
