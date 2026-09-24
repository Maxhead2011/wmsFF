package pro.logoff.wms.tsd;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class RelabelPrintGate {
    private RelabelPrintGate() {}

    // FIX: a newly applied barcode may be confirmed only after the agent acknowledges both labels.
    static boolean canVerify(String printStatus) {
        return "PRINTED".equals(printStatus);
    }

    // FIX: retries after a terminal restart reuse the same print job for this one item.
    static String printId(String requestId, String box, String oldBarcode, String newBarcode,
                          String size, int completedQuantity, String workerId) {
        String key = "tsd-relabel-v1\u001f" + requestId + "\u001f" + box + "\u001f" + oldBarcode +
            "\u001f" + newBarcode + "\u001f" + size + "\u001f" + completedQuantity + "\u001f" + workerId;
        return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString();
    }
}
