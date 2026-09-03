package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.*;

public class StorageBoxTransferStateTest {
    @Test public void requiresSourceBarcodeKizTargetAndKeepsSourceForNextUnit() {
        // TEST: no extra Finish button, and each unit requires its own destination scan.
        StorageBoxTransferState s = new StorageBoxTransferState();
        assertEquals("SOURCE", s.stage());
        s.sourceAccepted("FFL_SOURCE");
        assertEquals("BARCODE", s.stage());
        s.barcodeAccepted("2040000000001", true);
        assertEquals("KIZ", s.stage());
        s.kizAccepted("KIZ-1");
        assertEquals("TARGET", s.stage());
        String key = s.operationKey();
        assertFalse(key.isEmpty());
        assertEquals(key, s.operationKey()); // network retry retains identity
        s.completed(false);
        assertEquals("BARCODE", s.stage());
        assertEquals("FFL_SOURCE", s.sourceCode());
        assertEquals("", s.barcode());
        s.barcodeAccepted("2040000000001", false);
        assertEquals("TARGET", s.stage());
        assertNotEquals(key, s.operationKey());
        s.completed(true);
        assertEquals("SOURCE", s.stage());
    }

    @Test(expected = IllegalStateException.class) public void cannotSkipBarcode() {
        new StorageBoxTransferState().kizAccepted("KIZ-1");
    }

    @Test public void cancelUnitRetainsSourceAndClearsKiz() {
        StorageBoxTransferState s = new StorageBoxTransferState();
        s.sourceAccepted("BOX-1");
        s.barcodeAccepted("460001", true);
        s.kizAccepted("KIZ-1");
        s.cancelUnit();
        assertEquals("BARCODE", s.stage());
        assertEquals("", s.scanCode());
    }

    @Test public void uncertainTransferCanOnlyBeRetriedToSameTarget() {
        // TEST: an unknown network result must not let the user change destination or unit.
        StorageBoxTransferState s = new StorageBoxTransferState();
        s.sourceAccepted("SOURCE");
        s.barcodeAccepted("460001", false);
        String key = s.operationKey();
        s.beginTransfer("SBOX_1");
        assertTrue(s.hasPendingTransfer());
        s.beginTransfer("SBOX_1");
        assertEquals(key, s.operationKey());
        try { s.beginTransfer("SBOX_2"); fail("must keep target"); } catch (IllegalStateException expected) { }
        try { s.cancelUnit(); fail("must resolve transfer"); } catch (IllegalStateException expected) { }
        s.completed(false);
        assertFalse(s.hasPendingTransfer());
        assertEquals("BARCODE", s.stage());
    }

    @Test public void rejectedTransferAllowsCorrectingTheTarget() {
        // TEST: a definitive validation failure is not an uncertain stock movement.
        StorageBoxTransferState s = new StorageBoxTransferState();
        s.sourceAccepted("SOURCE");
        s.barcodeAccepted("460001", false);
        s.beginTransfer("WRONG");
        s.transferRejected();
        s.beginTransfer("SBOX_1");
        assertEquals("SBOX_1", s.pendingTarget());
    }

    @Test public void restoredPendingTransferRetainsAllIdentifiers() {
        // TEST: after process restart a retry uses exactly the original operation and unit.
        StorageBoxTransferState s = StorageBoxTransferState.restorePending("SOURCE", "BAR", "KIZ", "original-key", "SBOX_1");
        assertEquals("TARGET", s.stage());
        assertEquals("SOURCE", s.sourceCode());
        assertEquals("BAR", s.barcode());
        assertEquals("KIZ", s.scanCode());
        assertEquals("original-key", s.operationKey());
        assertEquals("SBOX_1", s.pendingTarget());
        assertTrue(s.hasPendingTransfer());
    }
}
