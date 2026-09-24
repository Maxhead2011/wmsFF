package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.Arrays;
import java.util.List;
import pro.logoff.wms.tsd.network.TsdFbsRequestsResponse;
import static org.junit.Assert.*;

public class FbsMarketplaceFilterTest {
    private TsdFbsRequestsResponse.Request request(String... markets) {
        TsdFbsRequestsResponse.Request r = new TsdFbsRequestsResponse.Request();
        r.marketplaces = Arrays.asList(markets); return r;
    }
    // TEST: archive and active request objects use the same strict marketplace filter.
    @Test public void separatesMarketplacesWithoutChangingServerObjects() {
        var wb=request("WILDBERRIES");var ozon=request("OZON");
        var mixed=request("WILDBERRIES","OZON");var unknown=request();
        List<TsdFbsRequestsResponse.Request> source=Arrays.asList(wb,ozon,mixed,unknown,null);
        assertEquals(List.of(wb),FbsMarketplaceFilter.select(source,"WILDBERRIES"));
        assertEquals(List.of(ozon),FbsMarketplaceFilter.select(source,"OZON"));
        assertEquals(5,source.size());
        assertSame(wb,FbsMarketplaceFilter.select(source,"WILDBERRIES").get(0));
    }
    // TEST: sold installations retain all request types; empty responses are safe.
    @Test public void unfilteredAndEmptyResponses() {
        var unknown=request();unknown.marketplaces=null;
        assertEquals(List.of(unknown),FbsMarketplaceFilter.select(List.of(unknown),""));
        assertTrue(FbsMarketplaceFilter.select(List.of(unknown),"OZON").isEmpty());
        assertTrue(FbsMarketplaceFilter.select(null,"WILDBERRIES").isEmpty());
        assertEquals(1,FbsMarketplaceFilter.select(List.of(request("ozon")),"OZON").size());
    }
}
