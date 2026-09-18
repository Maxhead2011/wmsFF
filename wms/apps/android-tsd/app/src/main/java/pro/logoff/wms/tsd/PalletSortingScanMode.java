package pro.logoff.wms.tsd;
import java.util.Map;
import java.util.LinkedHashMap;

// FIX: server state, not the last local selection, controls resumed sessions.
public final class PalletSortingScanMode {
    public static final String BARCODE_ONLY = "BARCODE_ONLY";
    public static final String BARCODE_KIZ = "BARCODE_KIZ";
    public static boolean barcodeOnly(Map<String, Object> state) {
        return state != null && BARCODE_ONLY.equals(state.get("scanMode"));
    }
    public static Map<String, Object> barcodeMove(String barcode, String source) {
        if (source == null || source.trim().isEmpty()) throw new IllegalArgumentException("Сначала отсканируйте исходный короб.");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("barcode", barcode); body.put("sourceBoxCode", source.trim());
        return body; // one scan; no quantity or artificial KIZ
    }
}
