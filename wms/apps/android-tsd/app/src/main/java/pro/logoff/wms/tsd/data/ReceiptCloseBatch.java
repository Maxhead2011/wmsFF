package pro.logoff.wms.tsd.data;

import java.util.*;

// FIX: immutable receipt scans and their close marker share one durable batch.
public final class ReceiptCloseBatch {
    public final String closeKey;
    public final List<PendingOperation> operations;

    private ReceiptCloseBatch(String closeKey, List<PendingOperation> operations) {
        this.closeKey = closeKey;
        this.operations = Collections.unmodifiableList(operations);
    }

    public static ReceiptCloseBatch create(
        String clientId, String boxCode, String sourceDocument, List<Map<String, String>> items
    ) {
        if (items == null || items.isEmpty() || items.size() > 1000
            || blank(clientId) || blank(boxCode) || blank(sourceDocument)) {
            throw new IllegalArgumentException("Для закрытия нужны клиент, короб, документ и от 1 до 1000 товаров.");
        }
        List<PendingOperation> operations = new ArrayList<>();
        List<String> keys = new ArrayList<>();
        long timestamp = System.currentTimeMillis();
        for (Map<String, String> item : items) {
            Map<String, String> payload = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : item.entrySet()) {
                if (!blank(entry.getValue())) payload.put(entry.getKey(), entry.getValue().trim());
            }
            if (blank(payload.get("barcode"))) throw new IllegalArgumentException("Не указан ШК товара.");
            payload.put("clientId", clientId);
            payload.put("boxCode", boxCode);
            payload.put("sourceDocument", sourceDocument);
            payload.put("quantity", "1");
            payload.put("status", "AVAILABLE");
            payload.put("receiptMode", "BOXES");
            String key = UUID.randomUUID().toString();
            keys.add(key);
            operations.add(operation(key, "receipt_scan", payload, timestamp + operations.size()));
        }
        Map<String, String> close = new LinkedHashMap<>();
        close.put("clientId", clientId);
        close.put("boxCode", boxCode);
        close.put("sourceDocument", sourceDocument);
        // Generated UUIDs contain no JSON-special characters.
        close.put("receiptOperationKeys", "[\"" + String.join("\",\"", keys) + "\"]");
        String closeKey = UUID.randomUUID().toString();
        operations.add(operation(closeKey, "receipt_close", close, timestamp + operations.size()));
        return new ReceiptCloseBatch(closeKey, operations);
    }

    public List<String> operationKeys() {
        List<String> keys = new ArrayList<>();
        for (PendingOperation operation : operations) keys.add(operation.operationKey);
        return keys;
    }

    // FIX: older Android SQLite allows at most 999 bound parameters.
    public static List<List<String>> queryKeyChunks(List<String> keys) {
        List<List<String>> chunks = new ArrayList<>();
        for (int start = 0; start < keys.size(); start += 900) {
            chunks.add(new ArrayList<>(keys.subList(start, Math.min(start + 900, keys.size()))));
        }
        return chunks;
    }

    public boolean isConfirmed(PendingOperation operation) {
        return operation != null && closeKey.equals(operation.operationKey)
            && "receipt_close".equals(operation.operationType) && operation.status == OperationStatus.SYNCED;
    }

    private static PendingOperation operation(String key, String type, Map<String, String> payload, long timestamp) {
        return new PendingOperation(key, type, Collections.unmodifiableMap(payload), timestamp, OperationStatus.PENDING, 0, null);
    }

    private static boolean blank(String value) { return value == null || value.trim().isEmpty(); }
}
