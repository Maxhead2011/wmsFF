package pro.logoff.wms.tsd.network;

import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;
import okhttp3.OkHttpClient;
import pro.logoff.wms.tsd.BuildConfig;

public final class WmsApiFactory {
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";

    private WmsApiFactory() {
    }

    // Share connection pools and TLS sessions across scans and monitoring calls.
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .addInterceptor(new FbsRequestTimeouts("logoff".equals(BuildConfig.FLAVOR)))
        .addInterceptor(chain -> chain.proceed(
            "logoff".equals(BuildConfig.FLAVOR)
                ? chain.request().newBuilder().header("X-TSD-FBS-Capability", "physical-pick-v1")
                    // FIX: advertise scan-confirmed fabric production only for LOGOFF.
                    .header("X-TSD-Fabric-Capability", "fabric-cut-v1").build()
                : chain.request()
        )).build();
    private static final java.util.Map<String, WmsApi> APIS =
        new java.util.LinkedHashMap<String, WmsApi>(8, 0.75f, true) {
            @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, WmsApi> entry) {
                return size() > 8;
            }
        };

    public static synchronized WmsApi create(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        WmsApi current = APIS.get(normalized);
        if (current != null) return current;
        WmsApi api = new Retrofit.Builder()
            .baseUrl(normalized)
            .client(CLIENT)
            .addConverterFactory(MoshiConverterFactory.create())
            .build().create(WmsApi.class);
        APIS.put(normalized, api);
        return api;
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.trim().isEmpty()) {
            return DEFAULT_BASE_URL;
        }

        String normalized = baseUrl.trim();
        return normalized.endsWith("/") ? normalized : normalized + "/";
    }
}
