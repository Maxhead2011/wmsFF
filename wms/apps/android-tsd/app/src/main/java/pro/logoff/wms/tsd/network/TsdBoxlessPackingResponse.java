package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdBoxlessPackingResponse {
    public String status;
    public String message;
    public boolean accepted;
    public PackingProgress packingProgress;

    public static class PackingProgress {
        public int packedQuantity;
        public int totalQuantity;
        public int remainingQuantity;
        public int closedBoxes;
        public int openBoxes;
        public List<PackingBox> boxes;
        public List<PackingRow> rows;
    }

    public static class PackingBox {
        public String boxCode;
        public boolean closed;
        public String deviceCode;
        public int quantity;
        public List<PackingItem> items;
    }

    public static class PackingItem {
        public String requestItemId;
        public String barcode;
        public String name;
        public int quantity;
    }

    public static class PackingRow {
        public String requestItemId;
        public String barcode;
        public String name;
        public int requiredQuantity;
        public int packedQuantity;
        public int remainingQuantity;
    }
}
