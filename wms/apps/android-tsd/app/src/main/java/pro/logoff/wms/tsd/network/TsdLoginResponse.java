package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdLoginResponse {
    public String accessToken;
    public String tokenType;
    public TsdDeviceInfo device;
    public User user;

    public static class User {
        public String id;
        public String email;
        public String name;
        public List<String> roleCodes;
    }
}
