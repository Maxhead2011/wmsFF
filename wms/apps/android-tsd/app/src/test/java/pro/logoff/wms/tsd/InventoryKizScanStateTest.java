package pro.logoff.wms.tsd;

import static org.junit.Assert.*;
import java.util.Map;
import org.junit.Test;

public class InventoryKizScanStateTest {
    // TEST: initial barcode is a preflight; the KIZ request keeps that barcode and counts one.
    @Test public void pairsBarcodeAndKizWithoutBulkCounting() {
        InventoryKizScanState state = new InventoryKizScanState();
        state.syncBox("box-1");
        assertEquals(true, state.payload("2045143989162", 8, true).get("captureKiz"));
        state.awaitKiz("2045143989162");
        Map<String, Object> request = state.payload("full-kiz", 8, true);
        assertEquals("2045143989162", request.get("barcode"));
        assertEquals("full-kiz", request.get("kiz"));
        assertEquals(1, request.get("quantity"));
    }
    @Test public void keepsPendingBarcodeDuringRerenderAndRetry() {
        InventoryKizScanState state = new InventoryKizScanState();
        state.syncBox("box-1"); state.awaitKiz("barcode"); state.syncBox("box-1");
        assertTrue(state.waitingForKiz());
        assertEquals("barcode", state.barcode());
    }
    @Test public void clearsPendingBarcodeOnBoxChangeOrExit() {
        InventoryKizScanState state = new InventoryKizScanState();
        state.syncBox("box-1"); state.awaitKiz("barcode"); state.syncBox("box-2");
        assertFalse(state.waitingForKiz());
        state.awaitKiz("other"); state.syncBox(null);
        assertFalse(state.waitingForKiz());
    }
    @Test public void legacyModeDoesNotSendNewFlagOrStaleKiz() {
        InventoryKizScanState state = new InventoryKizScanState();
        state.awaitKiz("stale");
        Map<String, Object> request = state.payload("barcode", 3, false);
        assertEquals("barcode", request.get("barcode"));
        assertEquals(3, request.get("quantity"));
        assertFalse(request.containsKey("captureKiz"));
        assertFalse(request.containsKey("kiz"));
    }
    @Test public void clearsPendingAfterSuccessfulCount() {
        InventoryKizScanState state = new InventoryKizScanState();
        state.awaitKiz("barcode"); state.clear();
        assertFalse(state.waitingForKiz());
    }
}
