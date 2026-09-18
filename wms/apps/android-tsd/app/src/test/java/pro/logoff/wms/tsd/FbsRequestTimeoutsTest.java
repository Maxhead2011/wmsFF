package pro.logoff.wms.tsd;

import java.lang.reflect.Proxy;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Interceptor;
import okhttp3.Request;
import org.junit.Test;
import pro.logoff.wms.tsd.network.FbsRequestTimeouts;
import static org.junit.Assert.*;

public class FbsRequestTimeoutsTest {
    // TEST: exercise the real interceptor without waiting or sending a warehouse operation.
    private void check(boolean enabled, String path, int expectedSeconds) throws Exception {
        Request request = new Request.Builder().url("https://wms.logoff.pro" + path).build();
        int[] observed = {10, 0};
        Interceptor.Chain chain = (Interceptor.Chain) Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[]{Interceptor.Chain.class}, (proxy, method, args) -> {
                if (method.getName().equals("request")) return request;
                if (method.getName().equals("withReadTimeout")) {
                    observed[0] = (int)((TimeUnit) args[1]).toSeconds((Integer) args[0]); return proxy;
                }
                if (method.getName().equals("proceed")) { observed[1]++; throw new SocketTimeoutException("simulated"); }
                throw new AssertionError("Unexpected mutation: " + method.getName());
            });
        try { new FbsRequestTimeouts(enabled).intercept(chain); fail("Expected timeout"); }
        catch (SocketTimeoutException expected) { }
        assertEquals(expectedSeconds, observed[0]);
        assertEquals("Never replay a scan in the network interceptor", 1, observed[1]);
    }
    @Test public void kizAllowsMultipleWbStages() throws Exception { check(true,"/api/v1/tsd/fbs/tasks/1/scan-kiz",90); }
    @Test public void localFbsHasBoundedWait() throws Exception { check(true,"/api/v1/tsd/fbs/next",25); }
    @Test public void soldWmsIsUnchanged() throws Exception { check(false,"/api/v1/tsd/fbs/tasks/1/scan-kiz",10); }
    @Test public void otherWorkflowsAreUnchanged() throws Exception { check(true,"/api/v1/tsd/requests",10); }
    @Test public void distinguishesSlowResponseFromDnsFailure() {
        assertTrue(FbsRequestTimeouts.isTimeout(new IOException(new SocketTimeoutException())));
        assertFalse(FbsRequestTimeouts.isTimeout(new UnknownHostException()));
    }
}
