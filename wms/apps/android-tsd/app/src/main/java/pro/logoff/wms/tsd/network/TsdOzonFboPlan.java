package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdOzonFboPlan {
    public String id;
    public String title;
    public String status;
    public String sourceFileName;
    public Client client;
    public List<Box> boxes;

    public static class Client {
        public String id;
        public String code;
        public String name;
    }

    public static class Box {
        public String id;
        public String boxCode;
        public String status;
        public Cluster cluster;
        public List<Item> items;

        public int plannedQuantity() {
            int result = 0;
            if (items != null) {
                for (Item item : items) result += item.quantity;
            }
            return result;
        }

        public int assembledQuantity() {
            int result = 0;
            if (items != null) {
                for (Item item : items) result += item.assembledQuantity;
            }
            return result;
        }

        public boolean isClosed() {
            return "CLOSED".equals(status) || "UPLOADED".equals(status);
        }
    }

    public static class Cluster {
        public String sourceName;
        public String clusterName;
        public String storageWarehouseName;
    }

    public static class Item {
        public String id;
        public int quantity;
        public int assembledQuantity;
        public PlanItem planItem;
    }

    public static class PlanItem {
        public String offerId;
        public String ozonSku;
        public String productName;
    }
}
