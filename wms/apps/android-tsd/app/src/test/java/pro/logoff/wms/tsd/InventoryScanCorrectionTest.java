package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;
public class InventoryScanCorrectionTest {
    @Test public void rolesAndFlavorGateConfirmation() {
        // TEST: ordinary counters and sold flavors must not receive the override button.
        assertTrue(InventoryScanCorrection.allowed("logoff", false, true, "token"));
        assertTrue(InventoryScanCorrection.allowed("logoff", true, false, "token"));
        assertFalse(InventoryScanCorrection.allowed("logoff", false, false, "token"));
        assertFalse(InventoryScanCorrection.allowed("sold", true, true, "token"));
        assertFalse(InventoryScanCorrection.allowed("logoff", true, true, null));
    }
    @Test public void retriesPreserveOriginalPairAndTokenWithoutMutatingScan() {
        // TEST: confirming or retrying cannot substitute a newly typed barcode/KIZ.
        Map<String,Object> scan = new LinkedHashMap<>(); scan.put("barcode", "123"); scan.put("kiz", "01test\u001d92crypto"); scan.put("quantity",1);
        Map<String,Object> result = InventoryScanCorrection.confirmed(scan,"token");
        assertEquals(scan.get("kiz"),result.get("kiz")); assertEquals("123",result.get("barcode"));
        assertEquals("token",result.get("replaceEvidenceToken")); assertFalse(scan.containsKey("replaceEvidenceToken"));
        assertEquals(result,InventoryScanCorrection.confirmed(scan,"token"));
    }
}
