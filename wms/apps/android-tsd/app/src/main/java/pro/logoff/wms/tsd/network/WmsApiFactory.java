package pro.logoff.wms.tsd.network;

import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;
import okhttp3.OkHttpClient;
import pro.logoff.wms.tsd.BuildConfig;

public final class WmsApiFactory {
    private static final String DEFAULT_BASE_URL = "https://wms.logoff.pro/";

    private WmsApiFactory() {
    }

    public static WmsApi create(String baseUrl) {
        return new Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            // FIX: only updated LOGOFF terminals opt into label-free physical picking.
            .client(new OkHttpClient.Builder().addInterceptor(chain -> chain.proceed(
                "logoff".equals(BuildConfig.FLAVOR)
                    ? chain.request().newBuilder().header("X-TSD-FBS-Capability", "physical-pick-v1").build()
                    : chain.request()
            )).build())
            .addConverterFactory(MoshiConverterFactory.create())
            .build()
            .create(WmsApi.class);
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.trim().isEmpty()) {
            return DEFAULT_BASE_URL;
        }

        String normalized = baseUrl.trim();
        return normalized.endsWith("/") ? normalized : normalized + "/";
    }
}
