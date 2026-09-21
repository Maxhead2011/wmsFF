package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;
public class PalletSortingScanModeTest {
    @Test public void oldSessionKeepsKizAndResumedSessionUsesStoredMode() {
        // TEST: local choice never silently converts an existing KIZ session.
        Map<String,Object> state = new LinkedHashMap<>();
        assertFalse(PalletSortingScanMode.barcodeOnly(state));
        state.put("scanMode", "BARCODE_ONLY");
        assertTrue(PalletSortingScanMode.barcodeOnly(state));
    }
    @Test public void barcodeMoveRetriesOneOperationAndNextScanIsAnotherUnit() {
        // TEST: scanner retry does not debit twice; another physical scan can use the same barcode.
        PalletSortingCommand command = new PalletSortingCommand();
        Map<String,Object> body = PalletSortingScanMode.barcodeMove("123", "BOX");
        assertFalse(body.containsKey("kiz")); assertFalse(body.containsKey("quantity"));
        body.put("action", "MOVE"); // TEST: the screen adds the action before handing it to the retry queue.
        assertTrue(command.begin("/actions", body));
        String first = (String) command.body().get("operationId");
        command.uncertain(); assertFalse(command.begin("/actions", body));
        assertEquals(first, command.body().get("operationId"));
        command.confirmed(); assertTrue(command.begin("/actions", body));
        assertNotEquals(first, command.body().get("operationId"));
    }
    @Test(expected=IllegalArgumentException.class) public void sourceCannotBeGuessed() {
        // TEST: KIZ-free transfer requires the physical source box.
        PalletSortingScanMode.barcodeMove("123", "");
    }
}
