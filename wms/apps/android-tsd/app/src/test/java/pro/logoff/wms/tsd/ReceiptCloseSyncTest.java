package pro.logoff.wms.tsd;

import org.junit.Test;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.util.*;
import pro.logoff.wms.tsd.data.*;
import pro.logoff.wms.tsd.network.*;
import pro.logoff.wms.tsd.sync.*;
import retrofit2.Call;
import retrofit2.Response;
import static org.junit.Assert.*;

// TEST: one box must become ready without waiting for unrelated pending operations.
public class ReceiptCloseSyncTest {
    private ReceiptCloseBatch batch(int size) {
        List<Map<String, String>> items = new ArrayList<>();
        for (int i = 0; i < size; i++) items.add(Collections.singletonMap("barcode", "123"));
        return ReceiptCloseBatch.create("client", "BOX", "receipt", items);
    }

    @Test public void unrelatedQueueDoesNotDelayClosedBox() {
        ReceiptCloseBatch batch = batch(15);
        FakeOutbox outbox = new FakeOutbox(batch);
        for (int i = 0; i < 75; i++) outbox.operations.put("other-" + i,
            new PendingOperation("other-" + i, "receipt_scan", Collections.emptyMap(), 0, OperationStatus.PENDING, 0, null));
        List<String> sent = new ArrayList<>();
        new TsdSyncRunner(outbox, api(sent, "APPLIED", false), "device").syncReceiptBatch("auth", batch.closeKey);
        assertTrue(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
        assertEquals(16, sent.size());
        assertFalse(sent.contains("other-0"));
        assertEquals(OperationStatus.PENDING, outbox.findOperation("other-0").status);
    }

    @Test public void moreThanFiftyIsDrainedWithoutResendingAppliedScans() {
        ReceiptCloseBatch batch = batch(70);
        FakeOutbox outbox = new FakeOutbox(batch);
        List<String> sent = new ArrayList<>();
        TsdSyncRunner runner = new TsdSyncRunner(outbox, api(sent, "APPLIED", false), "device");
        runner.syncReceiptBatch("auth", batch.closeKey);
        assertTrue(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
        assertEquals(71, new HashSet<>(sent).size());
        runner.syncReceiptBatch("auth", batch.closeKey);
        assertEquals(71, sent.size());
    }

    @Test public void offlineBatchSurvivesRunnerRestart() {
        ReceiptCloseBatch batch = batch(2);
        FakeOutbox outbox = new FakeOutbox(batch);
        List<String> sent = new ArrayList<>();
        new TsdSyncRunner(outbox, api(sent, "APPLIED", true), "device").syncReceiptBatch("auth", batch.closeKey);
        assertFalse(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
        assertEquals(3, outbox.pendingReceiptBatch(batch.closeKey).size());
        new TsdSyncRunner(outbox, api(sent, "ALREADY_APPLIED", false), "device").syncReceiptBatch("auth", batch.closeKey);
        assertTrue(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
    }

    @Test public void missingCloseReplyDoesNotClaimReady() {
        ReceiptCloseBatch batch = batch(2);
        FakeOutbox outbox = new FakeOutbox(batch);
        new TsdSyncRunner(outbox, api(new ArrayList<>(), null, false), "device").syncReceiptBatch("auth", batch.closeKey);
        assertFalse(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
        assertEquals(1, outbox.pendingReceiptBatch(batch.closeKey).size());
    }

    @Test public void dependencyRetryIsNotTerminalOrBusyLoop() {
        ReceiptCloseBatch batch = batch(1);
        FakeOutbox outbox = new FakeOutbox(batch);
        List<String> sent = new ArrayList<>();
        new TsdSyncRunner(outbox, api(sent, "RETRY", false), "device").syncReceiptBatch("auth", batch.closeKey);
        assertEquals(2, sent.size());
        assertEquals(OperationStatus.PENDING, outbox.findOperation(batch.closeKey).status);
    }

    // TEST: a rejected close must explain the server reason on the receipt screen.
    @Test public void rejectedCloseKeepsServerReason() {
        ReceiptCloseBatch batch = batch(1);
        FakeOutbox outbox = new FakeOutbox(batch);
        TsdSyncSummary summary = new TsdSyncRunner(outbox, api(new ArrayList<>(), "REJECTED", false), "device")
            .syncReceiptBatch("auth", batch.closeKey);
        assertTrue(summary.message.contains("другому филиалу"));
        assertFalse(batch.isConfirmed(outbox.findOperation(batch.closeKey)));
    }

    private WmsApi api(List<String> sent, String closeStatus, boolean offline) {
        return (WmsApi) Proxy.newProxyInstance(WmsApi.class.getClassLoader(), new Class<?>[]{WmsApi.class},
            (proxy, method, args) -> {
                TsdSyncRequest request = (TsdSyncRequest) args[1];
                return Proxy.newProxyInstance(Call.class.getClassLoader(), new Class<?>[]{Call.class},
                    (call, callMethod, callArgs) -> {
                        if (!callMethod.getName().equals("execute")) throw new UnsupportedOperationException();
                        if (offline) throw new IOException("offline");
                        List<TsdOperationResponse> replies = new ArrayList<>();
                        for (TsdOperationRequest operation : request.operations) {
                            sent.add(operation.operationKey);
                            boolean close = operation.operationType.equals("receipt_close");
                            if (close && closeStatus == null) continue;
                            TsdOperationResponse response = new TsdOperationResponse();
                            response.operationKey = operation.operationKey;
                            response.status = close ? closeStatus : "APPLIED";
                            if (close && "REJECTED".equals(closeStatus)) response.message = "Короб относится к другому филиалу.";
                            replies.add(response);
                        }
                        return Response.success(replies);
                    });
            });
    }

    private static class FakeOutbox extends OperationOutbox {
        final Map<String, PendingOperation> operations = new LinkedHashMap<>();
        final ReceiptCloseBatch batch;
        FakeOutbox(ReceiptCloseBatch batch) {
            super(null);
            this.batch = batch;
            for (PendingOperation operation : batch.operations) operations.put(operation.operationKey, operation);
        }
        @Override public PendingOperation findOperation(String key) { return operations.get(key); }
        @Override public List<PendingOperation> pendingReceiptBatch(String key) {
            List<PendingOperation> pending = new ArrayList<>();
            for (String id : batch.operationKeys()) {
                PendingOperation operation = operations.get(id);
                if (operation.status == OperationStatus.PENDING && pending.size() < 50) pending.add(operation);
            }
            return pending;
        }
        @Override public void markSynced(String key, String message) { change(key, OperationStatus.SYNCED, message); }
        @Override public void markRejected(String key, String message) { change(key, OperationStatus.REJECTED, message); }
        @Override public void markRetry(String key, String message) { change(key, OperationStatus.PENDING, message); }
        private void change(String key, OperationStatus status, String message) {
            PendingOperation old = operations.get(key);
            operations.put(key, new PendingOperation(key, old.operationType, old.payload, old.createdAt, status, old.attempts + 1, message));
        }
    }
}
