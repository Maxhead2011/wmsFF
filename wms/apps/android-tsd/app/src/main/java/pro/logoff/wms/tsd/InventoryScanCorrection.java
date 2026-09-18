package pro.logoff.wms.tsd;
import java.util.LinkedHashMap;
import java.util.Map;
// FIX: explicit correction is limited to our flavor and elevated roles.
public final class InventoryScanCorrection {
    public static boolean allowed(String flavor, boolean admin, boolean owner, String token) {
        return "logoff".equals(flavor) && (admin || owner) && token != null && !token.isEmpty();
    }
    public static Map<String, Object> confirmed(Map<String, Object> original, String token) {
        if (token == null || token.isEmpty() || !original.containsKey("kiz")) throw new IllegalArgumentException("Missing captured scan");
        Map<String, Object> result = new LinkedHashMap<>(original);
        result.put("allowScanCorrection", true);
        result.put("replaceEvidenceToken", token);
        return result;
    }
}
