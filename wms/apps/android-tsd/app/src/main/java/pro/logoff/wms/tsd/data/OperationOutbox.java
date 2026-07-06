package pro.logoff.wms.tsd.data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class OperationOutbox {
    private final OperationDao dao;

    public OperationOutbox(OperationDao dao) {
        this.dao = dao;
    }

    public PendingOperation enqueueReceipt(
        String clientId,
        String barcode,
        String kiz,
        String boxCode,
        int quantity,
        String status,
        String sourceDocument,
        String comment
    ) {
        Map<String, String> payload = compactPayload();
        put(payload, "clientId", clientId);
        put(payload, "barcode", barcode);
        put(payload, "kiz", kiz);
        put(payload, "boxCode", boxCode);
        put(payload, "quantity", String.valueOf(quantity));
        put(payload, "status", status);
        put(payload, "sourceDocument", sourceDocument);
        put(payload, "comment", comment);

        PendingOperation operation = new PendingOperation(
            UUID.randomUUID().toString(),
            "receipt_scan",
            payload,
            System.currentTimeMillis(),
            OperationStatus.PENDING,
            0,
            null
        );
        dao.insert(OperationEntity.fromPending(operation));
        return operation;
    }

    public PendingOperation enqueueMove(
        String clientId,
        String barcode,
        String fromBoxCode,
        String toBoxCode,
        int quantity,
        String status,
        String comment
    ) {
        Map<String, String> payload = compactPayload();
        put(payload, "clientId", clientId);
        put(payload, "barcode", barcode);
        put(payload, "fromBoxCode", fromBoxCode);
        put(payload, "toBoxCode", toBoxCode);
        put(payload, "quantity", String.valueOf(quantity));
        put(payload, "status", status);
        put(payload, "comment", comment);

        PendingOperation operation = new PendingOperation(
            UUID.randomUUID().toString(),
            "move_scan",
            payload,
            System.currentTimeMillis(),
            OperationStatus.PENDING,
            0,
            null
        );
        dao.insert(OperationEntity.fromPending(operation));
        return operation;
    }

    public PendingOperation enqueueInventory(
        String clientId,
        String barcode,
        String boxCode,
        int countedQuantity,
        String status
    ) {
        Map<String, String> payload = compactPayload();
        put(payload, "clientId", clientId);
        put(payload, "barcode", barcode);
        put(payload, "boxCode", boxCode);
        put(payload, "countedQuantity", String.valueOf(countedQuantity));
        put(payload, "status", status);

        PendingOperation operation = new PendingOperation(
            UUID.randomUUID().toString(),
            "inventory_scan",
            payload,
            System.currentTimeMillis(),
            OperationStatus.PENDING,
            0,
            null
        );
        dao.insert(OperationEntity.fromPending(operation));
        return operation;
    }

    public List<PendingOperation> pending() {
        return toPendingOperations(dao.findByStatus(OperationStatus.PENDING.name(), 50));
    }

    public List<PendingOperation> rejected() {
        return toPendingOperations(dao.findByStatus(OperationStatus.REJECTED.name(), 25));
    }

    public void markSynced(String operationKey, String message) {
        long now = System.currentTimeMillis();
        dao.setTerminalStatus(operationKey, OperationStatus.SYNCED.name(), message, now, now);
    }

    public void markRejected(String operationKey, String message) {
        dao.setTerminalStatus(operationKey, OperationStatus.REJECTED.name(), message, System.currentTimeMillis(), null);
    }

    public void markRetry(String operationKey, String message) {
        dao.setRetryStatus(operationKey, OperationStatus.PENDING.name(), message, System.currentTimeMillis());
    }

    public int requeueRejected() {
        return dao.requeueRejected(OperationStatus.PENDING.name(), OperationStatus.REJECTED.name());
    }

    public OperationOutboxCounts counts() {
        return new OperationOutboxCounts(
            dao.countByStatus(OperationStatus.PENDING.name()),
            dao.countByStatus(OperationStatus.REJECTED.name())
        );
    }

    private static List<PendingOperation> toPendingOperations(List<OperationEntity> entities) {
        List<PendingOperation> operations = new ArrayList<>();
        for (OperationEntity entity : entities) {
            operations.add(entity.toPendingOperation());
        }
        return operations;
    }

    private static Map<String, String> compactPayload() {
        return new LinkedHashMap<>();
    }

    private static void put(Map<String, String> payload, String key, String value) {
        if (value == null) {
            return;
        }

        String normalized = value.trim();
        if (!normalized.isEmpty()) {
            payload.put(key, normalized);
        }
    }
}
