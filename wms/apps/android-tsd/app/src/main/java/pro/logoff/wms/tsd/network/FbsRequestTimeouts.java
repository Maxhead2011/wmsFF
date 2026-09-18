package pro.logoff.wms.tsd.network;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.concurrent.TimeUnit;
import okhttp3.Interceptor;
import okhttp3.Response;

// FIX: only our FBS calls use extended response budgets; connect timeouts and retries are unchanged.
public final class FbsRequestTimeouts implements Interceptor {
    private final boolean enabled;
    public FbsRequestTimeouts(boolean enabled) { this.enabled = enabled; }
    @Override public Response intercept(Chain chain) throws IOException {
        String path = chain.request().url().encodedPath();
        if (enabled && path.startsWith("/api/v1/tsd/fbs/")) {
            // WB preflight + submission + conflict verification can each take 20 seconds.
            int seconds = path.endsWith("/scan-kiz") ? 90 : 25;
            chain = chain.withReadTimeout(seconds, TimeUnit.SECONDS);
        }
        return chain.proceed(chain.request());
    }
    public static boolean isTimeout(Throwable error) {
        for (int depth = 0; error != null && depth < 16; depth++, error = error.getCause()) {
            if (error instanceof SocketTimeoutException) return true;
        }
        return false;
    }
}
