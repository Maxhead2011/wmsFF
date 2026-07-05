package pro.logoff.wms.tsd.data;

import java.util.Map;

public class PendingOperation {
    public final String operationKey;
    public final String operationType;
    public final Map<String, String> payload;
    public final long createdAt;
    public final OperationStatus status;
    public final int attempts;
    public final String lastMessage;

    public PendingOperation(
        String operationKey,
        String operationType,
        Map<String, String> payload,
        long createdAt,
        OperationStatus status,
        int attempts,
        String lastMessage
    ) {
        this.operationKey = operationKey;
        this.operationType = operationType;
        this.payload = payload;
        this.createdAt = createdAt;
        this.status = status;
        this.attempts = attempts;
        this.lastMessage = lastMessage;
    }
}
