package pro.logoff.wms.tsd.network;

// FIX: a committed operation receipt does not depend on rebuilding the picking route.
public class TsdFboAcknowledgement {
    public String requestId, operationId, action;
    public boolean accepted;
}
