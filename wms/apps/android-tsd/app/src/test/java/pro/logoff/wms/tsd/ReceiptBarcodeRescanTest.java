package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
public class ReceiptBarcodeRescanTest {
    // TEST: short unknown scans never count before a matching second scan.
    @Test public void requiresRepeat() {
        for (String code : new String[]{"18", "7459", "08123282"}) {
            ReceiptBarcodeRescan gate = new ReceiptBarcodeRescan();
            assertFalse(gate.scan("client/box/receipt", code));
            assertTrue(gate.scan("client/box/receipt", code));
            assertEquals(code, gate.evidence());
        }
    }
    @Test public void mismatchRequiresAnotherScan() {
        ReceiptBarcodeRescan gate = new ReceiptBarcodeRescan();
        assertFalse(gate.scan("box", "18")); assertFalse(gate.scan("box", "7459"));
        assertTrue(gate.message().contains("18")); assertTrue(gate.message().contains("7459"));
        assertTrue(gate.scan("box", "7459"));
    }
    @Test public void evidenceCannotCrossBoxesOrCancelledScan() {
        ReceiptBarcodeRescan gate = new ReceiptBarcodeRescan();
        gate.scan("a", "18"); assertFalse(gate.scan("b", "18"));
        gate.clear(); assertFalse(gate.scan("b", "18"));
    }
    // TEST: a failed lookup cannot attach the previous item's evidence to another barcode.
    @Test public void confirmedEvidenceDoesNotLeakToNextBarcode() {
        ReceiptBarcodeRescan gate = new ReceiptBarcodeRescan();
        gate.scan("box", "18"); gate.scan("box", "18");
        assertTrue(gate.scan("box", "4006381333931")); assertEquals("", gate.evidence());
    }
    @Test public void regularEanIsNotInterrupted() { assertTrue(new ReceiptBarcodeRescan().scan("box", "4006381333931")); }
}
