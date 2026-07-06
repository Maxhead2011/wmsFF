package pro.logoff.wms.tsd.network;

import java.util.Map;

public class TsdOperationRequest {
    public String deviceId;
    public String operationKey;
    public String operationType;
    public Map<String, String> payload;

    public TsdOperationRequest() {
    }

    public TsdOperationRequest(String deviceId, String operationKey, String operationType, Map<String, String> payload) {
        this.deviceId = deviceId;
        this.operationKey = operationKey;
        this.operationType = operationType;
        this.payload = payload;
    }
}
