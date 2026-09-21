package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdKizLocationResponse {
    public boolean found;
    public boolean ambiguous;
    public String identity;
    public List<Match> matches;
    public List<Review> reviews;
    public static class Review {
        public String id, kizIdentity, status, decision, resolution, reason, decidedByName;
        public boolean active;
        public Snapshot snapshot;
    }
    public static class Snapshot { public int requestNumber; public String orderId, productName, boxCode, workerName; }
    public static class Match {
        public String id, client, status, boxCode, boxStatus, palletCode, room, warehouse, locationWarning;
        public Product product;
        public Reuse reuse; // FIX: historical use is separate from current AVAILABLE stock.
    }
    public static class Reuse {
        public String decision, message, circulation, checkedAt;
        public List<History> history;
    }
    public static class History {
        public String orderId, at, event, supplyId, worker;
        public Request request;
    }
    public static class Request { public int number; public String status; }
    public static class Product {
        public String id, name, article, size, color;
    }
}
