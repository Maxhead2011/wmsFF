package pro.logoff.wms.tsd;

import java.util.LinkedHashMap;
import java.util.Map;

// ADDED: one pending barcode, scoped to its inventory box; never count barcode and KIZ twice.
public final class InventoryKizScanState {
    private String boxId = "";
    private String pendingBarcode = "";

    public void syncBox(String id) {
        String next = id == null ? "" : id;
        if (!next.equals(boxId)) clear();
        boxId = next;
    }
    public void awaitKiz(String barcode) { pendingBarcode = barcode == null ? "" : barcode; }
    public boolean waitingForKiz() { return !pendingBarcode.isEmpty(); }
    public String barcode() { return pendingBarcode; }
    public void clear() { pendingBarcode = ""; }

    public Map<String, Object> payload(String scan, int quantity, boolean captureKiz) {
        Map<String, Object> result = new LinkedHashMap<>();
        boolean pair = captureKiz && waitingForKiz();
        result.put("barcode", pair ? pendingBarcode : scan);
        result.put("quantity", pair ? 1 : quantity);
        if (captureKiz) result.put("captureKiz", true);
        if (pair) result.put("kiz", scan);
        return result;
    }
}
