package pro.logoff.wms.tsd.network;
import java.util.List;

public class TsdFboPlan {
    public boolean relabelRequired;
    public List<RelabelUnit> relabelUnits;
    public static class RelabelUnit {
        public String id,skuId,sourceBarcode,kiz,pickedByUserId,printId,printStatus;
        public RelabelLabel label;
    }
    public static class RelabelLabel { public String barcode,name,size,article; }
    public String marketplace;
    public List<Direction> directions;
    // FIX: retain the server's per-destination quotas and physical packing counts.
    public static class Direction { public String name; public int needed, packed; public List<DirectionItem> items; }
    public static class DirectionItem { public String skuId, barcode; public int quantity, packed; }
    // FIX: absent capability keeps older servers and sold clients on the existing workflow.
    public boolean packingByProductSupported;
    public boolean reopenPackingBoxSupported;
    public boolean packingUndoSupported;
    // FIX: physical source box is optional only when the server advertises loose storage.
    public boolean unboxedPickingSupported;
    public List<PackingSuggestion> packingSuggestions;
    public static class PackingSuggestion { public String skuId, barcode, direction, targetBoxCode; }
    public boolean parallelPackingSupported;
    public boolean localRouteEnabled;
    // FIX: absence keeps old servers and sold applications on the original scanner flow.
    public boolean alternativePickingSupported;
    public String requestId, title, phase;
    public int needed, picked, packed, looseRemaining, shortage;
    // FIX: accepted stock may be reserved while its storage location is still pending.
    public int pendingPlacementQuantity;
    public boolean compositionChanged, manualPackingEnabled, reusablePackingEnabled;
    public boolean fastAcknowledgementSupported;
    public boolean compactPackingSupported;
    public List<Line> lines;
    public List<Route> route;
    public List<Box> boxes;
    public List<String> wholeBoxes;
    public static class Line {
        public String id, skuId, barcode, name, article, size, productDisplayText;
        // FIX: loose picking uses the same client presentation as tasks in a box route.
        public String displayLabel() {
            if(productDisplayText!=null&&!productDisplayText.trim().isEmpty())return productDisplayText;
            StringBuilder label=new StringBuilder();
            for(String value:new String[]{name,article,size,barcode})if(value!=null&&!value.trim().isEmpty()){
                if(label.length()>0)label.append(" · ");label.append(value);
            }
            return label.length()>0?label.toString():"Товар";
        }
        public List<String> barcodes;
        public boolean requiresKiz;
        public int needed, picked, packed, remaining;
    }
    public static class Route {
        public String boxCode, pallet, zone;
        public boolean wholeBox, recount;
        public int wholeBoxQuantity, remainderQuantity;
        public List<Task> tasks;
    }
    public static class Task {
        public String skuId, barcode, name, productDisplayText;
        public int quantity; public boolean requiresKiz;
        public String displayLabel(String fallback) { return productDisplayText == null ? fallback : productDisplayText; }
    }
    public static class Box { public String code, direction; public boolean wholeBox, closed, confirmed; public int quantity; }
}
