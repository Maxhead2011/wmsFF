package pro.logoff.wms.tsd.network;

import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;
import okhttp3.OkHttpClient;
import pro.logoff.wms.tsd.BuildConfig;

public final class WmsApiFactory {
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";

    private WmsApiFactory() {
    }

    private static final java.util.Map<String,pro.logoff.wms.tsd.auth.TsdIdleSession> IDLE = new java.util.HashMap<>();
    public static synchronized void idleSession(String baseUrl,pro.logoff.wms.tsd.auth.TsdIdleSession gate){
        okhttp3.HttpUrl url=okhttp3.HttpUrl.parse(normalizeBaseUrl(baseUrl));
        if(url!=null)IDLE.put(url.scheme()+"://"+url.host()+":"+url.port(),gate);
    }
    private static synchronized pro.logoff.wms.tsd.auth.TsdIdleSession idleSession(okhttp3.HttpUrl url){
        return IDLE.get(url.scheme()+"://"+url.host()+":"+url.port());
    }
    public static pro.logoff.wms.tsd.auth.TsdIdleSession idleSession(String baseUrl){
        return idleSession(okhttp3.HttpUrl.parse(normalizeBaseUrl(baseUrl)));
    }
    // FIX: transmit only a previously recorded physical input, including its age. No input, no renewal.
    public static void flushIdleActivity(String baseUrl){
        okhttp3.HttpUrl url=okhttp3.HttpUrl.parse(normalizeBaseUrl(baseUrl));if(url==null)return;
        pro.logoff.wms.tsd.auth.TsdIdleSession gate=idleSession(url);if(gate==null)return;
        okhttp3.Request request=gate.activityRequest(url);if(request==null)return;
        CLIENT.newCall(request).enqueue(new okhttp3.Callback(){
            public void onFailure(okhttp3.Call call,java.io.IOException error){}
            public void onResponse(okhttp3.Call call,okhttp3.Response response){response.close();}
        });
    }

    // Share connection pools and TLS sessions across scans and monitoring calls.
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .addInterceptor(chain -> {
            pro.logoff.wms.tsd.auth.TsdIdleSession gate="logoff".equals(BuildConfig.FLAVOR)?idleSession(chain.request().url()):null;
            return gate==null?chain.proceed(chain.request()):gate.intercept(chain);
        })
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
