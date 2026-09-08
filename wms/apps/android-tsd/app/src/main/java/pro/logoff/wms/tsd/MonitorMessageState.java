package pro.logoff.wms.tsd;

// ADDED: pure retry/duplicate state; polling never marks a message as read.
final class MonitorMessageState {
    private String token = "", current = "", acknowledged = "";
    private boolean busy;
    boolean offer(String sessionToken, String id) {
        if (!token.equals(sessionToken)) { reset(); token = sessionToken; }
        if (id == null || id.isEmpty() || !current.isEmpty() || acknowledged.equals(id)) return false;
        current = id;
        return true;
    }
    boolean beginAck() {
        if (busy || current.isEmpty()) return false;
        busy = true;
        return true;
    }
    void ackFailed() { busy = false; }
    void ackSucceeded() { acknowledged = current; current = ""; busy = false; }
    void reset() { token = ""; current = ""; acknowledged = ""; busy = false; }
}
