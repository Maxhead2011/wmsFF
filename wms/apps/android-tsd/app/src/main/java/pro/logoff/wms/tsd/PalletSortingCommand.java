package pro.logoff.wms.tsd;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

// ADDED: retain exactly one uncertain command until the server confirms its outcome.
public final class PalletSortingCommand {
    private String path;
    private Map<String, Object> body;
    public boolean begin(String nextPath, Map<String, Object> nextBody) {
        if (pending()) return false;
        path = nextPath;
        Map<String, Object> copy = new LinkedHashMap<>(nextBody);
        if (copy.containsKey("action")) copy.putIfAbsent("operationId", UUID.randomUUID().toString());
        body = Collections.unmodifiableMap(copy);
        return true;
    }
    public String path() { return path; }
    public Map<String, Object> body() { return body; }
    public boolean pending() { return body != null; }
    public void uncertain() { /* FIX: keep the same id and payload for an exact retry. */ }
    public void confirmed() { path = null; body = null; }
}
