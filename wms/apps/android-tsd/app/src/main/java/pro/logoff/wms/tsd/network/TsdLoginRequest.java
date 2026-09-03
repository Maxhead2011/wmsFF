package pro.logoff.wms.tsd.network;

public class TsdLoginRequest {
    public String login;
    public String password;
    public String installationCode;

    public TsdLoginRequest() {
    }

    public TsdLoginRequest(String login, String password) {
        this(login, password, null);
    }

    public TsdLoginRequest(String login, String password, String installationCode) {
        this.login = login;
        this.password = password;
        this.installationCode = installationCode;
    }
}
