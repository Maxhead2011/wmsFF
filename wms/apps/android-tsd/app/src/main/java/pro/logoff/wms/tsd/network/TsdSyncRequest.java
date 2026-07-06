package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdSyncRequest {
    public List<TsdOperationRequest> operations;
    public String deviceClock;

    public TsdSyncRequest() {
    }

    public TsdSyncRequest(List<TsdOperationRequest> operations, String deviceClock) {
        this.operations = operations;
        this.deviceClock = deviceClock;
    }
}
