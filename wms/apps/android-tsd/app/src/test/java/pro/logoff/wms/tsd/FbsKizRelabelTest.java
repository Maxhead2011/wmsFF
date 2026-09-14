package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;

public class FbsKizRelabelTest {
    @Test public void auditRelabelNeverRequestsStockPickOrWbAttachment() {
        // TEST: Sonya's already opened audit needs only the mark pair registration, then normal audit validation.
        assertEquals(true, FbsKizRelabelRequest.prepare("old").get("prepareKizRelabelOnly"));
        assertEquals(true, FbsKizRelabelRequest.confirm("new", "proposal", true).get("registerKizRelabelOnly"));
        assertEquals(false, FbsKizRelabelRequest.confirm("new", "proposal", false).get("registerKizRelabelOnly"));
        assertEquals("proposal", FbsKizRelabelRequest.confirm("new", "proposal", true).get("kizRelabelProposalId"));
        assertThrows(IllegalArgumentException.class, () -> FbsKizRelabelRequest.confirm("new", "", true));
    }
    @Test public void newMarkScanUsesKizEndpointAndGuidedScanner() {
        // TEST: explicit relabel scans must not be classified as ordinary barcode scans.
        assertEquals("scan-kiz", FbsTaskSafety.scanActionForState("SCAN_NEW_KIZ"));
        assertEquals("kiz", FbsTaskSafety.scanFieldForState("SCAN_NEW_KIZ"));
        assertTrue(FbsAssemblyUi.shouldUseGuidedScanDialog("SCAN_NEW_KIZ"));
        assertFalse(FbsAssemblyUi.shouldUseGuidedScanDialog("CONFIRM_KIZ_RELABEL"));
        assertTrue(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_NEW_KIZ", 400));
        assertFalse(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_NEW_KIZ", 503));
    }
}
