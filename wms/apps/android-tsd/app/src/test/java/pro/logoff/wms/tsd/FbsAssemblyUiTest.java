package pro.logoff.wms.tsd;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FbsAssemblyUiTest {
    @Test
    public void guidesBarcodeAndKizButReturnsToStickerScreen() {
        // TEST: рабочее окно ведёт сотрудника ровно через ШК и КИЗ.
        assertTrue(FbsAssemblyUi.shouldUseGuidedScanDialog("SCAN_BARCODE"));
        assertTrue(FbsAssemblyUi.shouldUseGuidedScanDialog("SCAN_KIZ"));
        assertFalse(FbsAssemblyUi.shouldUseGuidedScanDialog("READY_TO_COMPLETE"));
    }
}
