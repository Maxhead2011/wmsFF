package pro.logoff.wms.tsd.network;
import java.util.List;

public class TsdFboPlan {
    public String requestId, title, phase;
    public int needed, picked, packed, looseRemaining, shortage;
    public boolean compositionChanged;
    public boolean fastAcknowledgementSupported;
    public List<Line> lines;
    public List<Route> route;
    public List<Box> boxes;
    public List<String> wholeBoxes;
    public static class Line {
        public String id, skuId, barcode, name, article, size;
        public boolean requiresKiz;
        public int needed, picked, packed, remaining;
    }
    public static class Route {
        public String boxCode, pallet, zone;
        public boolean wholeBox, recount;
        public int wholeBoxQuantity, remainderQuantity;
        public List<Task> tasks;
    }
    public static class Task { public String skuId, barcode, name; public int quantity; public boolean requiresKiz; }
    public static class Box { public String code; public boolean wholeBox, closed, confirmed; public int quantity; }
}
