package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SkuCollectionScanStateTest {
    @Test
    public void pickingRequiresBoxThenBarcodeThenKiz() {
        // TEST: hardware Enter advances through the exact mandatory scan order.
        SkuCollectionScanState state = new SkuCollectionScanState(false);
        assertEquals("SOURCE_BOX", state.stage());
        state.accept("BOX-1");
        assertEquals("BARCODE", state.stage());
        state.accept("460000000001");
        assertEquals("KIZ", state.stage());
    }

    @Test
    public void receivingRequiresTargetBoxThenBarcodeThenKiz() {
        // TEST: re-receipt cannot skip the destination box or product barcode.
        SkuCollectionScanState state = new SkuCollectionScanState(true);
        assertEquals("TARGET_BOX", state.stage());
        state.accept("BOX-2");
        assertEquals("BARCODE", state.stage());
        state.accept("460000000001");
        assertEquals("KIZ", state.stage());
    }
}
