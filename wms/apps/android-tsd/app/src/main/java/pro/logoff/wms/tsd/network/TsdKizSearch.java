package pro.logoff.wms.tsd.network;
import java.util.List;
// FIX: search progress is separate from assembly quantities and stock balances.
public final class TsdKizSearch {
    public String id, title, status;
    public int number, found, total;
    public List<Item> items;
    public static final class Item {
        public String itemId, boxCode, pallet, kiz, name, barcode, order, firstWorker;
        public boolean found;
    }
    public static final class ScanResult {
        public String result, message, itemId;
        public int found, total;
    }
}
