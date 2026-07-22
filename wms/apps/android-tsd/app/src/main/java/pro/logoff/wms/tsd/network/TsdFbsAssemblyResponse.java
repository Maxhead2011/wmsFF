package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdFbsAssemblyResponse {
    public String state;
    public String message;
    public Task task;
    public Progress progress;

    public static class Task {
        public String id;
        public String orderId;
        public String supplyId;
        public String requestId;
        public Client client;
        public Product product;
        public int itemCount;
        public boolean requiresKiz;
        public String recommendedBoxCode;
        public List<StorageBox> storageBoxes;
        public String scannedBoxCode;
        public String scannedBarcode;
        public boolean kizAccepted;
        public String wbMetaStatus;
        public String errorMessage;
        public String status;
    }

    public static class Client {
        public String id;
        public String code;
        public String name;
    }

    public static class Product {
        public String id;
        public String name;
        public String article;
        public List<String> barcodes;
    }

    public static class StorageBox {
        public String id;
        public String code;
        public int quantity;
    }

    public static class Progress {
        public int completedToday;
    }
}
