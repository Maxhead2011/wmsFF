package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdFbsAssemblyResponse {
    public String state;
    public String message;
    public Task task;
    public Progress progress;
    public KizMoveProposal kizMoveProposal;
    public PalletScan palletScan;

    public static class Task {
        public String id;
        public String marketplace;
        public String orderId;
        public String supplyId;
        public String requestId;
        public String warehouseId;
        public String warehouseName;
        public Client client;
        public Product product;
        public Relabeling relabeling;
        public int itemCount;
        public boolean sourceWithoutBox;
        public boolean requiresKiz;
        public String recommendedBoxCode;
        public StorageLocation recommendedLocation;
        public int samePalletRemainingBoxes;
        public List<String> samePalletBoxCodes;
        public List<StorageBox> storageBoxes;
        public List<NextRequestSource> nextRequestSources;
        public String scannedBoxCode;
        public SourceBoxUsage sourceBoxUsage;
        public String scannedBarcode;
        public boolean kizAccepted;
        public String wbMetaStatus;
        public OrderSticker orderSticker;
        public String marketplaceSubmittedAt;
        public String marketplaceSubmitError;
        public String errorMessage;
        public String status;
    }

    public static class Relabeling {
        public boolean required;
        public Product sourceProduct;
        public String sourceBarcode;
        public String targetBarcode;
        public boolean confirmed;
        public String confirmedAt;
    }

    public static class SourceBoxUsage {
        public String boxCode;
        public int units;
        public int positions;
    }

    public static class OrderSticker {
        public String marketplace;
        public String partA;
        public String partB;
        public String barcode;
        public String contentType;
        public String imageBase64;
    }

    public static class KizMoveProposal {
        public String kiz;
        public String fromBoxCode;
        public String toBoxCode;
        public String productName;
        public String article;
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
        public String color;
        public String size;
        public List<String> barcodes;
    }

    public static class StorageBox {
        public String id;
        public String code;
        public int quantity;
        public StorageLocation location;
    }

    public static class StorageLocation {
        public String palletId;
        public String palletCode;
        public String zoneId;
        public String zoneCode;
        public String zoneName;
        public String source;
    }

    public static class NextRequestSource {
        public String orderId;
        public String productName;
        public String article;
        public int itemCount;
        public String boxCode;
        public int quantity;
        public String palletCode;
        public String zoneCode;
        public String zoneName;
    }

    public static class PalletScan {
        public String id;
        public String code;
        public String status;
        public String source;
        public StorageZone zone;
        public int totalBoxes;
        public int neededBoxes;
        public List<String> neededBoxCodes;
        public List<NearbyPallet> nearbyPallets;
    }

    public static class NearbyPallet {
        public String id;
        public String code;
        public int neededBoxes;
        public List<String> neededBoxCodes;
    }

    public static class StorageZone {
        public String id;
        public String code;
        public String name;
    }

    public static class Progress {
        public int completedToday;
        public int requestNumber;
        public int requestTotalItems;
        public int requestCompletedItems;
        public int requestRemainingItems;
        public List<StickerHistoryItem> recentStickers;
    }

    public static class StickerHistoryItem {
        public String orderId;
        public int requestNumber;
        public String productName;
        public String article;
        public String color;
        public String size;
        public String boxCode;
        public String partA;
        public String partB;
        public String barcode;
        public String completedAt;
    }
}
