package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.HashMap;
import java.util.Map;
import okhttp3.Request;
import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;
import pro.logoff.wms.tsd.network.WmsApi;
import static org.junit.Assert.*;

public class KizFoundRouteTest {
    // TEST: construct the actual Retrofit request, catching a missing API prefix before publication.
    @Test public void everyFoundActionUsesVersionedApiRoute() {
        WmsApi api = new Retrofit.Builder().baseUrl("https://wms.logoff.pro/")
            .addConverterFactory(MoshiConverterFactory.create()).build().create(WmsApi.class);
        for (String action : new String[]{"OPEN", "REUSE", "RELABEL", "RETURN", "REJECT"}) {
            Map<String, Object> payload = new HashMap<>();
            payload.put("action", action);
            payload.put("confirmed", true);
            Request request = api.foundKizAction("Bearer test-only", payload).request();
            assertEquals("https://wms.logoff.pro/api/v1/inventory/kiz-found", request.url().toString());
            assertEquals("POST", request.method());
            assertEquals("Bearer test-only", request.header("Authorization"));
        }
    }
}
