package pro.logoff.wms.mobile.network;

import com.squareup.moshi.JsonAdapter;
import com.squareup.moshi.Moshi;
import com.squareup.moshi.Types;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.lang.reflect.Type;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import okhttp3.Authenticator;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.Route;
import okhttp3.logging.HttpLoggingInterceptor;
import pro.logoff.wms.mobile.BuildConfig;
import pro.logoff.wms.mobile.session.SessionStore;
import retrofit2.Retrofit;
import retrofit2.converter.moshi.MoshiConverterFactory;

public final class NetworkFactory {
    private NetworkFactory() {}

    public static MobileApi create(SessionStore sessions) {
        Moshi moshi = new Moshi.Builder().build();
        HttpLoggingInterceptor logging = new HttpLoggingInterceptor();
        logging.setLevel(BuildConfig.DEBUG ? HttpLoggingInterceptor.Level.BASIC : HttpLoggingInterceptor.Level.NONE);
        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(45, TimeUnit.SECONDS)
                .addInterceptor(chain -> {
                    Request original = chain.request();
                    Request.Builder builder = original.newBuilder().header("Accept", "application/json").header("X-Mobile-App", BuildConfig.VERSION_NAME);
                    if (!"GET".equals(original.method()) && !"HEAD".equals(original.method()) && original.header("X-Idempotency-Key") == null) builder.header("X-Idempotency-Key", UUID.randomUUID().toString());
                    if (!sessions.accessToken().isEmpty()) builder.header("Authorization", "Bearer " + sessions.accessToken());
                    return chain.proceed(builder.build());
                })
                .addInterceptor(logging)
                .authenticator(new RefreshAuthenticator(sessions, moshi))
                .build();
        return new Retrofit.Builder().baseUrl(BuildConfig.API_BASE_URL).client(client).addConverterFactory(MoshiConverterFactory.create(moshi)).build().create(MobileApi.class);
    }

    private static final class RefreshAuthenticator implements Authenticator {
        private final SessionStore sessions;
        private final JsonAdapter<Map<String, Object>> adapter;
        private final OkHttpClient refreshClient = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build();

        RefreshAuthenticator(SessionStore sessions, Moshi moshi) {
            this.sessions = sessions;
            Type type = Types.newParameterizedType(Map.class, String.class, Object.class);
            adapter = moshi.adapter(type);
        }

        @Override public synchronized Request authenticate(Route route, Response response) throws IOException {
            if (responseCount(response) >= 2 || sessions.refreshToken().isEmpty()) return null;
            String requestToken = response.request().header("Authorization");
            String current = sessions.accessToken();
            if (requestToken != null && !requestToken.equals("Bearer " + current)) return response.request().newBuilder().header("Authorization", "Bearer " + current).build();

            Map<String, Object> refreshBody = new LinkedHashMap<>();
            refreshBody.put("refreshToken", sessions.refreshToken());
            String json = adapter.toJson(refreshBody);
            Request refresh = new Request.Builder().url(BuildConfig.API_BASE_URL + "mobile/auth/refresh")
                    .post(RequestBody.create(json, MediaType.get("application/json; charset=utf-8"))).build();
            try (Response refreshResponse = refreshClient.newCall(refresh).execute()) {
                if (!refreshResponse.isSuccessful() || refreshResponse.body() == null) { sessions.clear(); return null; }
                Map<String, Object> payload = adapter.fromJson(refreshResponse.body().string());
                if (payload == null) return null;
                String access = String.valueOf(payload.get("accessToken"));
                String refreshToken = String.valueOf(payload.get("refreshToken"));
                String device = String.valueOf(payload.get("deviceId"));
                sessions.save(access, refreshToken, device);
                return response.request().newBuilder().header("Authorization", "Bearer " + access).build();
            }
        }

        private int responseCount(Response response) {
            int count = 1;
            while ((response = response.priorResponse()) != null) count++;
            return count;
        }
    }
}
