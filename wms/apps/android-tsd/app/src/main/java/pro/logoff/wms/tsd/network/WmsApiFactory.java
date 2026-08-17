package pro.logoff.wms.tsd.network;

import pro.logoff.wms.tsd.BuildConfig;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;

public final class WmsApiFactory {
    private static final String DEFAULT_BASE_URL = BuildConfig.API_BASE_URL;
    private static final Map<String, WmsApi> CLIENTS = new ConcurrentHashMap<>();

    private WmsApiFactory() {
    }

    public static WmsApi create(String baseUrl) {
        String normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        return CLIENTS.computeIfAbsent(normalizedBaseUrl, WmsApiFactory::build);
    }

    private static WmsApi build(String normalizedBaseUrl) {
        OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            // Scan POST/PUT requests change stock and WB state. OkHttp must never
            // replay them implicitly after an uncertain network failure.
            .retryOnConnectionFailure(false)
            .addInterceptor(chain -> {
                Request request = chain.request();
                try {
                    return chain.proceed(request);
                } catch (IOException firstFailure) {
                    if (!"GET".equalsIgnoreCase(request.method()) || chain.call().isCanceled()) {
                        throw firstFailure;
                    }
                    try {
                        return chain.proceed(request);
                    } catch (IOException secondFailure) {
                        secondFailure.addSuppressed(firstFailure);
                        throw secondFailure;
                    }
                }
            })
            .build();
        return new Retrofit.Builder()
            .baseUrl(normalizedBaseUrl)
            .client(httpClient)
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
