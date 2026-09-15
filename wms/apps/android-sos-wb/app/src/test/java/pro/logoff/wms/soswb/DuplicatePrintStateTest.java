package pro.logoff.wms.soswb;
import org.junit.Test;
import static org.junit.Assert.*;
public class DuplicatePrintStateTest {
    // TEST: a network timeout cannot accept another scanned item or create a new copy.
    @Test public void timeoutAllowsOnlyResendingTheSavedRequest() {
        assertFalse(DuplicatePrintState.canSubmit("WAIT", false));
        assertTrue(DuplicatePrintState.canSubmit("WAIT", true));
        assertFalse(DuplicatePrintState.canScan("WAIT"));
    }
    @Test public void printedLabelCanBeVerifiedButNotPrintedAgain() {
        assertTrue(DuplicatePrintState.canScan("VERIFY"));
        assertFalse(DuplicatePrintState.canSubmit("VERIFY", true));
        assertFalse(DuplicatePrintState.canSubmit("DONE", true));
    }
    @Test public void unknownProductCannotBePrintedBeforeBarcodeConfirmation() {
        assertTrue(DuplicatePrintState.canScan("BARCODE"));
        assertFalse(DuplicatePrintState.canSubmit("BARCODE", false));
        assertTrue(DuplicatePrintState.canSubmit("READY", false));
    }
}
