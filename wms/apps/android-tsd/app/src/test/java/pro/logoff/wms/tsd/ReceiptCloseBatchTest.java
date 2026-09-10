package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.*;
import pro.logoff.wms.tsd.data.*;
import static org.junit.Assert.*;

// TEST: closing describes exactly one durable receipt batch, never the global queue.
public class ReceiptCloseBatchTest {
    private List<Map<String, String>> items(int count) {
        List<Map<String, String>> items = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Map<String, String> item = new LinkedHashMap<>();
            item.put("barcode", "2044750642217");
            items.add(item);
        }
        return items;
    }

    @Test public void containsEveryScanThenServerClose() {
        ReceiptCloseBatch batch = ReceiptCloseBatch.create("client", "BOX", "receipt", items(15));
        assertEquals(16, batch.operations.size());
        PendingOperation close = batch.operations.get(15);
        assertEquals("receipt_close", close.operationType);
        assertEquals(batch.closeKey, close.operationKey);
        for (int i = 0; i < 15; i++) {
            PendingOperation scan = batch.operations.get(i);
            assertEquals("receipt_scan", scan.operationType);
            assertEquals("BOX", scan.payload.get("boxCode"));
            assertEquals("receipt", scan.payload.get("sourceDocument"));
            assertTrue(close.payload.get("receiptOperationKeys").contains(scan.operationKey));
            assertTrue(scan.createdAt < close.createdAt);
        }
    }

    @Test public void retryReusesExactKeysAndSnapshot() {
        List<Map<String, String>> source = items(2);
        ReceiptCloseBatch batch = ReceiptCloseBatch.create("client", "BOX", "receipt", source);
        String key = batch.closeKey;
        source.get(0).put("barcode", "CHANGED");
        assertEquals(key, batch.closeKey);
        assertEquals("2044750642217", batch.operations.get(0).payload.get("barcode"));
        assertEquals(3, new HashSet<>(batch.operationKeys()).size());
    }

    @Test public void moreThanFiftyScansRemainOneBatch() {
        ReceiptCloseBatch batch = ReceiptCloseBatch.create("client", "BOX", "receipt", items(70));
        assertEquals(71, batch.operations.size());
        assertEquals(71, batch.operationKeys().size());
    }

    // TEST: Android 7 SQLite accepts no more than 999 bound query arguments.
    @Test public void thousandItemsUseBoundedSqlKeyChunks() {
        ReceiptCloseBatch batch = ReceiptCloseBatch.create("client", "BOX", "receipt", items(1000));
        List<String> all = new ArrayList<>();
        for (List<String> chunk : ReceiptCloseBatch.queryKeyChunks(batch.operationKeys())) {
            assertTrue(chunk.size() <= 900);
            all.addAll(chunk);
        }
        assertEquals(batch.operationKeys(), all);
    }

    @Test(expected = IllegalArgumentException.class) public void emptyBoxCannotClose() {
        ReceiptCloseBatch.create("client", "BOX", "receipt", items(0));
    }

    @Test public void oversizedBatchPreservesOriginalScansAndReportsValidationError() {
        List<Map<String, String>> scans = items(1001);
        try {
            ReceiptCloseBatch.create("client", "BOX", "receipt", scans);
            fail("The UI must receive a validation error, not enqueue a partial batch");
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains("1000"));
            assertEquals(1001, scans.size());
            assertEquals("2044750642217", scans.get(1000).get("barcode"));
        }
    }

    @Test public void onlyAcknowledgedCloseMeansReady() {
        ReceiptCloseBatch batch = ReceiptCloseBatch.create("client", "BOX", "receipt", items(1));
        PendingOperation close = batch.operations.get(1);
        assertFalse(batch.isConfirmed(null));
        assertFalse(batch.isConfirmed(close));
        assertFalse(batch.isConfirmed(new PendingOperation(close.operationKey, close.operationType,
            close.payload, close.createdAt, OperationStatus.REJECTED, 1, "error")));
        assertFalse(batch.isConfirmed(new PendingOperation("foreign", close.operationType,
            close.payload, close.createdAt, OperationStatus.SYNCED, 1, null)));
        assertTrue(batch.isConfirmed(new PendingOperation(close.operationKey, close.operationType,
            close.payload, close.createdAt, OperationStatus.SYNCED, 1, null)));
    }
}
