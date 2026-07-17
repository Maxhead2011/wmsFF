package pro.logoff.wms.mobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class AppState {
    private Map<String, Object> bootstrap;
    private String selectedClientId;

    public void setBootstrap(Map<String, Object> value) {
        bootstrap = value;
        if (selectedClientId == null && !clients().isEmpty()) selectedClientId = string(clients().get(0).get("id"));
    }

    public Map<String, Object> bootstrap() { return bootstrap; }
    public String selectedClientId() { return selectedClientId; }
    public void selectClient(String id) { selectedClientId = id; }
    public boolean isAdmin() { return bootstrap != null && "ADMIN".equals(string(bootstrap.get("mode"))); }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> clients() {
        if (bootstrap == null || !(bootstrap.get("clients") instanceof List<?>)) return new ArrayList<>();
        return (List<Map<String, Object>>) bootstrap.get("clients");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> user() {
        return bootstrap != null && bootstrap.get("user") instanceof Map<?, ?> ? (Map<String, Object>) bootstrap.get("user") : Collections.emptyMap();
    }

    public static String string(Object value) { return value == null ? "" : String.valueOf(value); }
}
