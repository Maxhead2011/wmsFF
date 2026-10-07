package pro.logoff.wms.tsd;
import com.squareup.moshi.Moshi;
import com.squareup.moshi.JsonAdapter;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.assertEquals;

public class FboPendingPlacementTest {
    // TEST: distinguish pending placement from shortage and remain compatible with older servers.
    @Test public void readsPlacementSeparatelyFromShortage() throws Exception {
        JsonAdapter<TsdFboPlan> adapter = new Moshi.Builder().build().adapter(TsdFboPlan.class);
        TsdFboPlan waiting = adapter.fromJson("{\"pendingPlacementQuantity\":4,\"shortage\":1}");
        assertEquals(4, waiting.pendingPlacementQuantity);
        assertEquals(1, waiting.shortage);
        assertEquals(0, adapter.fromJson("{\"shortage\":0}").pendingPlacementQuantity);
    }
}
