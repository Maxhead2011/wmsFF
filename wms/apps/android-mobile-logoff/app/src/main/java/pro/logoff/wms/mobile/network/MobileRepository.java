package pro.logoff.wms.mobile.network;

import com.squareup.moshi.JsonAdapter;
import com.squareup.moshi.Moshi;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import pro.logoff.wms.mobile.data.CacheDao;
import pro.logoff.wms.mobile.data.CacheEntry;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MobileRepository {
    private final MobileApi api;
    private final CacheDao cache;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final JsonAdapter<Object> json = new Moshi.Builder().build().adapter(Object.class);

    public MobileRepository(MobileApi api, CacheDao cache) { this.api = api; this.cache = cache; }
    public MobileApi api() { return api; }

    public void bootstrap(DataCallback<Map<String, Object>> callback) { cached("bootstrap", api.bootstrap(), callback); }
    public void dashboard(String clientId, DataCallback<Map<String, Object>> callback) { cachedFast("dashboard:" + safe(clientId), api.dashboard(clientId), callback); }
    public void requests(String clientId, String search, DataCallback<Map<String, Object>> callback) { cachedFast("requests:" + safe(clientId) + ":" + safe(search), api.requests(clientId, blank(search), null, 100), callback); }
    public void invoices(String clientId, String search, DataCallback<Map<String, Object>> callback) { cachedFast("invoices:" + safe(clientId) + ":" + safe(search), api.invoices(clientId, blank(search), null, 100), callback); }
    public void notifications(String clientId, DataCallback<Map<String, Object>> callback) { cached("notifications:" + safe(clientId), api.notifications(clientId, false, 100), callback); }
    public void nativeModule(String module, String clientId, String search, DataCallback<Map<String, Object>> callback) { cachedFast("module:" + safe(module) + ":" + safe(clientId) + ":" + safe(search), api.nativeModule(module, clientId, blank(search), 100), callback); }

    private void cached(String key, Call<Map<String, Object>> call, DataCallback<Map<String, Object>> callback) {
        executeNetwork(key, call, callback);
    }

    private void cachedFast(String key, Call<Map<String, Object>> call, DataCallback<Map<String, Object>> callback) {
        io.execute(() -> {
            CacheEntry entry = cache.get(key);
            if (entry != null && System.currentTimeMillis() - entry.updatedAt < 15 * 60 * 1000L) {
                try {
                    Object parsed = json.fromJson(entry.json);
                    if (parsed instanceof Map<?, ?>) {
                        @SuppressWarnings("unchecked") Map<String, Object> value = (Map<String, Object>) parsed;
                        callback.onSuccess(value, true);
                    }
                } catch (IOException ignored) {}
            }
            executeNetwork(key, call, callback);
        });
    }

    private void executeNetwork(String key, Call<Map<String, Object>> call, DataCallback<Map<String, Object>> callback) {
        call.enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> request, Response<Map<String, Object>> response) {
                if (response.isSuccessful() && response.body() != null) {
                    Map<String, Object> value = response.body();
                    io.execute(() -> cache.put(new CacheEntry(key, json.toJson(value), System.currentTimeMillis())));
                    callback.onSuccess(value, false);
                } else fallback(key, callback, errorMessage(response));
            }
            @Override public void onFailure(Call<Map<String, Object>> request, Throwable error) { fallback(key, callback, readable(error)); }
        });
    }

    @SuppressWarnings("unchecked")
    private void fallback(String key, DataCallback<Map<String, Object>> callback, String error) {
        io.execute(() -> {
            CacheEntry entry = cache.get(key);
            if (entry == null) { callback.onError(error); return; }
            try {
                Object parsed = json.fromJson(entry.json);
                if (parsed instanceof Map<?, ?>) callback.onSuccess((Map<String, Object>) parsed, true); else callback.onError(error);
            } catch (IOException ignored) { callback.onError(error); }
        });
    }

    public static String errorMessage(Response<?> response) {
        try {
            if (response.errorBody() != null) return response.errorBody().string();
        } catch (IOException ignored) {}
        return "Ошибка сервера: HTTP " + response.code();
    }

    public static String readable(Throwable error) {
        return error.getMessage() == null ? "Нет связи с WMS" : error.getMessage();
    }

    private String safe(String value) { return value == null ? "all" : value; }
    private String blank(String value) { return value == null || value.trim().isEmpty() ? null : value.trim(); }
}
