package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

public class FbsRelabelPrintUiTest {
    @Test
    public void printButtonAppearsOnlyAfterFbsSourceScanOnOurTerminal() {
        // TEST: the FBS picking screen, unlike the separate relabel menu, previously had no print action.
        TsdFbsAssemblyResponse.Task task = new TsdFbsAssemblyResponse.Task();
        task.relabeling = new TsdFbsAssemblyResponse.Relabeling();
        task.relabeling.required = true;
        task.relabeling.sourceBarcode = "old";
        task.product = new TsdFbsAssemblyResponse.Product();
        task.product.barcodes = Arrays.asList("", "new");
        assertEquals("new", FbsRelabelPrintUi.targetBarcode(task));
        assertTrue(FbsRelabelPrintUi.showPrintButton("logoff", "SCAN_RELABEL_BARCODE", task));
        assertFalse(FbsRelabelPrintUi.showPrintButton("logoff", "SCAN_SOURCE_BARCODE", task));
        assertFalse(FbsRelabelPrintUi.showPrintButton("ff", "SCAN_RELABEL_BARCODE", task));
        task.relabeling.sourceBarcode = null;
        assertFalse(FbsRelabelPrintUi.showPrintButton("logoff", "SCAN_RELABEL_BARCODE", task));
    }
}
