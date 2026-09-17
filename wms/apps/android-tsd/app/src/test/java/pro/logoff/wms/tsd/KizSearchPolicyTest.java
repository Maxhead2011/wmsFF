package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.Arrays;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizSearch;
import static org.junit.Assert.*;

public class KizSearchPolicyTest {
    private TsdSession session(String... roles) { return new TsdSession("test", "Bearer", "device", "TSD", "user", "Worker", Arrays.asList(roles)); }
    // TEST: the sold installations and restricted roles keep their existing menus.
    @Test public void searchOnlyAppearsInOurAuthenticatedInstallation() {
        assertTrue(KizSearchPolicy.canOpen("logoff", session("TSD")));
        assertFalse(KizSearchPolicy.canOpen("ffullhab", session("ADMIN")));
        assertFalse(KizSearchPolicy.canOpen("platform", session("ADMIN")));
        assertFalse(KizSearchPolicy.canOpen("logoff", null));
        assertFalse(KizSearchPolicy.canOpen("logoff", session("WAREHOUSE_KEEPER")));
    }
    // TEST: opening a box requires its full scanned identity, never a partial match or a KIZ.
    @Test public void requiresAnExactListedBoxScan() {
        TsdKizSearch task = new TsdKizSearch(); TsdKizSearch.Item item = new TsdKizSearch.Item(); item.boxCode = "FFL_LKB0409_35"; task.items = Arrays.asList(item);
        assertTrue(KizSearchPolicy.containsBox(task, "FFL_LKB0409_35"));
        assertFalse(KizSearchPolicy.containsBox(task, "0409_35"));
        assertFalse(KizSearchPolicy.containsBox(task, "FFL_LKB0409_36"));
        assertFalse(KizSearchPolicy.containsBox(null, "FFL_LKB0409_35"));
        assertFalse(KizSearchPolicy.ready(""));
        assertTrue(KizSearchPolicy.ready("0104680992599933215UsV,9s0+X%0J"));
    }
}
