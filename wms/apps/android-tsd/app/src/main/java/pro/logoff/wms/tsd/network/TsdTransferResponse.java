package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdTransferResponse {
    public String state;
    public String status;
    public String message;
    // ADDED: older servers default this capability to false.
    public boolean kizRecountEnabled;
    public String snapshot;
    public String reviewId;
    public int quantity;
    public int retiredCount;
    public int registeredCount;
    public boolean adminRelease;
    public boolean adminConfirmationRequired;
    public int previousQuantity;
    public int delta;
    public SourceBox sourceBox;
    public Item item;
    public String sourceBoxCode;
    public String targetBoxCode;
    public boolean sourceBoxArchived;
    public int sourceRemaining;
    public int movedQuantity;
    public List<Item> items;

    public static class SourceBox {
        public String id;
        public String code;
        public Client client;
        public int totalQuantity;
        public List<Product> products;
    }

    public static class Client {
        public String id;
        public String code;
        public String name;
    }

    public static class Product {
        public String skuId;
        public String name;
        public String article;
        public String color;
        public String size;
        public int quantity;
        public boolean requiresKiz;
        public List<String> barcodes;
    }

    public static class Item {
        public String skuId;
        public String name;
        public String article;
        public String color;
        public String size;
        public String scanCode;
        public String scanType;
        public int availableQuantity;
    }
}
