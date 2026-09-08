package pro.logoff.wms.tsd;
import java.util.LinkedHashMap;
import java.util.Map;

// ADDED: one retained scan awaiting an explicit administrator decision, not an automatic retry.
public final class PalletSortingRestoreConsent {
    private Map<String,Object> scan;
    private String fingerprint, message;
    public boolean offer(String code, String proof, String text, Map<String,Object> body) {
        clear();
        if (!"SORTING_WRITEOFF_CONFIRM_REQUIRED".equals(code) || proof == null || !proof.matches("[a-f0-9]{64}")
                || body == null || !"MOVE".equals(body.get("action")) || !body.containsKey("kiz") || !body.containsKey("barcode")) return false;
        scan=new LinkedHashMap<>(body); fingerprint=proof; message=text; return true;
    }
    public boolean pending() { return scan != null; }
    public String message() { return message; }
    public Map<String,Object> confirm() {
        if (!pending()) return null;
        Map<String,Object> result=new LinkedHashMap<>(scan);
        result.remove("operationId"); result.put("confirmRestore",true); result.put("restoreFingerprint",fingerprint);
        clear(); return result;
    }
    public void clear() { scan=null; fingerprint=null; message=null; }
}
