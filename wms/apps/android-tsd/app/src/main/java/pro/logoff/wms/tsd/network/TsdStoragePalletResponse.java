package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdStoragePalletResponse {
    public String state;
    public String message;
    public boolean duplicate;
    public Pallet pallet;
    public Recovery recovery;

    public static class Pallet {
        public String id;
        public String code;
        public String status;
        public Client client;
        public Zone zone;
        public int boxCount;
        public List<Box> boxes;
    }

    public static class Client {
        public String id;
        public String code;
        public String name;
    }

    public static class Zone {
        public String id;
        public String code;
        public String name;
    }

    public static class Box {
        public String boxCode;
        public boolean existsInWms;
        public String clientName;
        public String scannedAt;
    }

    public static class Recovery {
        public String boxCode;
        public String reason;
        public String reasonLabel;
    }
}
