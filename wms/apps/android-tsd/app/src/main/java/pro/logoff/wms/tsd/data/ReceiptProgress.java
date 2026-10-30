package pro.logoff.wms.tsd.data;
import java.util.*;

// FIX: rebuild this receipt from durable acknowledgements; late retries never increment twice.
public final class ReceiptProgress {
    public final Set<String> closed = new LinkedHashSet<>();
    public final Set<String> awaiting = new LinkedHashSet<>();
    public int acceptedItems;
    public static ReceiptProgress from(List<PendingOperation> operations, String clientId, String document) {
        ReceiptProgress result = new ReceiptProgress();
        if (clientId == null || document == null || document.isEmpty()) return result;
        Set<String> keys = new HashSet<>();
        for (PendingOperation op : operations) {
            if (!clientId.equals(op.payload.get("clientId")) || !document.equals(op.payload.get("sourceDocument")) || !keys.add(op.operationKey)) continue;
            String box = op.payload.get("boxCode");
            if ("receipt_close".equals(op.operationType) && box != null && !box.isEmpty()) {
                if (op.status == OperationStatus.SYNCED) result.closed.add(box); else result.awaiting.add(box);
            }
            if ("receipt_scan".equals(op.operationType) && op.status == OperationStatus.SYNCED) {
                try { result.acceptedItems += Math.max(0, Integer.parseInt(op.payload.get("quantity"))); }
                catch (NumberFormatException ignored) { /* Invalid rows must not inflate the counter. */ }
            }
        }
        result.awaiting.removeAll(result.closed);
        return result;
    }
}
