package pro.logoff.wms.tsd.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.Ignore;
import androidx.room.PrimaryKey;

@Entity(
    tableName = "tsd_operations",
    indices = {@Index(value = {"status", "createdAt"})}
)
public class OperationEntity {
    @PrimaryKey
    @NonNull
    public String operationKey;
    public String operationType;
    public String payloadJson;
    public long createdAt;
    public String status;
    public int attempts;
    public String lastMessage;
    public Long lastTriedAt;
    public Long syncedAt;

    public OperationEntity() {
        operationKey = "";
    }

    @Ignore
    public OperationEntity(
        @NonNull String operationKey,
        String operationType,
        String payloadJson,
        long createdAt,
        String status,
        int attempts,
        String lastMessage,
        Long lastTriedAt,
        Long syncedAt
    ) {
        this.operationKey = operationKey;
        this.operationType = operationType;
        this.payloadJson = payloadJson;
        this.createdAt = createdAt;
        this.status = status;
        this.attempts = attempts;
        this.lastMessage = lastMessage;
        this.lastTriedAt = lastTriedAt;
        this.syncedAt = syncedAt;
    }

    public PendingOperation toPendingOperation() {
        return new PendingOperation(
            operationKey,
            operationType,
            PayloadJson.jsonToPayload(payloadJson),
            createdAt,
            OperationStatus.valueOf(status),
            attempts,
            lastMessage
        );
    }

    public static OperationEntity fromPending(PendingOperation operation) {
        return new OperationEntity(
            operation.operationKey,
            operation.operationType,
            PayloadJson.payloadToJson(operation.payload),
            operation.createdAt,
            operation.status.name(),
            operation.attempts,
            operation.lastMessage,
            null,
            null
        );
    }
}
