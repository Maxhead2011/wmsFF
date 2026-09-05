package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;

public class SkuSortingScanStateTest {
    @Test public void inventoryThenPhysicalPairThenDestination() {
        // TEST: no destination/movement is offered before actualization and barcode+KIZ.
        SkuSortingScanState state = new SkuSortingScanState();
        assertEquals("SOURCE_BOX", state.stage());
        state.source("BOX");
        assertEquals("ACTUALIZE", state.stage());
        state.inventoryReady("audit");
        assertEquals("BARCODE", state.stage());
        state.barcode("123");
        assertEquals("KIZ", state.stage());
        state.kizChecked("kiz");
        assertEquals("TARGET_BOX", state.stage());
        // A failed network call does not advance or erase the pair.
        assertEquals("kiz", state.kiz());
        state.moved();
        assertEquals("BARCODE", state.stage());
        assertEquals("BOX", state.source());
    }
    @Test public void legacyPickedCanBePlacedWithoutPickingAgain() {
        // TEST: recover pre-update PACKING scans, including an IN_WORK request.
        SkuSortingScanState state = new SkuSortingScanState();
        state.resumePicked("OLD", "123", "kiz");
        assertTrue(state.legacy());
        assertEquals("BARCODE", state.stage());
        assertThrows(IllegalArgumentException.class, () -> state.barcode("wrong"));
        state.barcode("123");
        assertEquals("KIZ", state.stage());
        assertThrows(IllegalArgumentException.class, () -> state.kizChecked("wrong"));
        state.kizChecked("kiz");
        assertEquals("TARGET_BOX", state.stage());
        state.moved();
        assertEquals("SOURCE_BOX", state.stage());
        assertFalse(state.legacy());
    }
    @Test public void cannotSkipInventoryOrAcceptEmptyScans() {
        // TEST: transitions cannot silently skip a required step.
        SkuSortingScanState state = new SkuSortingScanState();
        assertThrows(IllegalStateException.class, () -> state.barcode("123"));
        assertThrows(IllegalArgumentException.class, () -> state.source(" "));
        state.source("BOX");
        assertThrows(IllegalStateException.class, () -> state.kizChecked("kiz"));
    }
    @Test public void uncertainMoveMustRetryTheSameDestination() {
        // TEST: loss of response cannot turn a retry into a different physical placement.
        SkuSortingScanState state = new SkuSortingScanState();
        assertTrue(state.canLeave(false));
        assertFalse(state.canLeave(true));
        state.source("BOX"); state.inventoryReady("audit"); state.barcode("123"); state.kizChecked("kiz");
        state.targetAttempted("TARGET");
        assertFalse(state.canLeave(false));
        assertEquals("TARGET", state.pendingTarget());
        assertThrows(IllegalStateException.class, () -> state.targetAttempted("OTHER"));
        assertThrows(IllegalStateException.class, () -> state.resetPair());
        state.targetAttempted("TARGET"); state.moved();
        assertEquals("", state.pendingTarget());
        assertTrue(state.canLeave(false));
    }
}
