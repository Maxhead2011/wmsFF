package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdFbsCargoPackingResponse {
    public String state;
    public String message;
    public List<Supply> supplies;
    public Packing packing;

    public static class Supply {
        public String id;
        public Client client;
        public String connectionId;
        public String supplyId;
        public String deliveryDestination;
        public String packingMode;
        public int itemsPerCargoPlace;
        public int cargoPlaceCount;
        public int totalPlannedItems;
        public int completedItems;
        public int packedItems;
        public int remainingToPack;
        public int waitingAssembly;
        public int closedCargoPlaces;
        public boolean readyToDeliver;
        public List<Packing> cargoPlaces;
    }

    public static class Client {
        public String id;
        public String code;
        public String name;
    }

    public static class Packing {
        public String id;
        public String cargoPlaceId;
        public String cargoPlaceBarcode;
        public String deliveryDestination;
        public String packingMode;
        public int capacityItems;
        public int packedItems;
        public String status;
        public String deviceCode;
        public String openedByName;
        public String openedAt;
        public String closedByName;
        public String closedAt;
        public List<Order> orders;
    }

    public static class Order {
        public String orderId;
        public String requestId;
        public String productName;
        public String article;
        public String color;
        public String size;
        public String productBarcode;
        public String wbStickerPartB;
        public String wbStickerBarcode;
        public String sourceBoxCode;
        public int quantity;
        public String packedByName;
        public String packedAt;
    }
}
