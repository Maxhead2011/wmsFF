package pro.logoff.wms.tsd;
import org.junit.Test;
import okhttp3.Request;
import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;
import pro.logoff.wms.tsd.network.WmsApi;
import static org.junit.Assert.*;

public class FboMarketplaceRouteTest {
    // TEST: both picker and packer send an explicit marketplace through the real Retrofit client.
    @Test public void stagesHaveSeparateMarketplaceQueries() {
        WmsApi api = new Retrofit.Builder().baseUrl("https://wms.logoff.pro/")
            .addConverterFactory(MoshiConverterFactory.create()).build().create(WmsApi.class);
        for (String workflow : new String[]{"fbo-pick", "fbo-pack"}) {
            for (String marketplace : new String[]{"WB", "OZON"}) {
                Request request = api.listFboRequests("Bearer test", workflow, marketplace).request();
                assertEquals("/api/v1/tsd/requests", request.url().encodedPath());
                assertEquals(workflow, request.url().queryParameter("workflow"));
                assertEquals(marketplace, request.url().queryParameter("marketplace"));
            }
        }
        assertNull(api.listAssemblyRequests("Bearer test").request().url().queryParameter("marketplace"));
    }
}
