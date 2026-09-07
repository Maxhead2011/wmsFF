package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

public class PalletSortingCommandTest {
    @Test public void uncertainRequestRetainsTheSamePayloadAndBlocksAnotherScan() {
        // TEST: network failure must not turn a retry into a second inventory operation.
        PalletSortingCommand command = new PalletSortingCommand();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("action", "MOVE"); body.put("kiz", "same-unit");
        assertTrue(command.begin("session/actions", body));
        String id = (String) command.body().get("operationId");
        command.uncertain();
        assertFalse(command.begin("session/actions", body));
        assertEquals(id, command.body().get("operationId"));
        assertEquals("same-unit", command.body().get("kiz"));
        command.confirmed();
        assertTrue(command.begin("session/actions", body));
        assertNotEquals(id, command.body().get("operationId"));
    }
    @Test public void rejectedRequestCanBeCorrected() {
        // TEST: a confirmed 4xx rejection does not trap the scanner in an endless retry.
        PalletSortingCommand command = new PalletSortingCommand();
        assertTrue(command.begin("start", new LinkedHashMap<>()));
        command.confirmed();
        assertFalse(command.pending());
    }
}
