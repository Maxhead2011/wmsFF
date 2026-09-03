package pro.logoff.wms.tsd;

import java.util.UUID;

/** FIX: one unit per destination scan; retries retain the same operation identity. */
public final class StorageBoxTransferState {
    private String stage = "SOURCE";
    private String source = "";
    private String barcode = "";
    private String scanCode = "";
    private String operationKey = "";
    private String pendingTarget = "";

    public String stage() { return stage; }
    public String sourceCode() { return source; }
    public String barcode() { return barcode; }
    public String scanCode() { return scanCode; }
    public String operationKey() { return operationKey; }
    public String pendingTarget() { return pendingTarget; }
    public boolean hasPendingTransfer() { return !pendingTarget.isEmpty(); }

    public void beginTransfer(String target) {
        requireStage("TARGET");
        String normalized = required(target);
        if (hasPendingTransfer() && !pendingTarget.equalsIgnoreCase(normalized)) {
            throw new IllegalStateException("Сначала подтвердите результат перемещения в " + pendingTarget + ". Повторно отсканируйте этот бокс.");
        }
        pendingTarget = normalized;
    }

    public void transferRejected() { pendingTarget = ""; }

    // FIX: preserve the identity of an uncertain request across process restarts.
    public static StorageBoxTransferState restorePending(String source, String barcode, String scan, String key, String target) {
        StorageBoxTransferState result = new StorageBoxTransferState();
        result.source = required(source);
        result.barcode = required(barcode);
        result.scanCode = required(scan);
        result.operationKey = required(key);
        result.pendingTarget = required(target);
        result.stage = "TARGET";
        return result;
    }

    public void sourceAccepted(String value) {
        requireStage("SOURCE");
        source = required(value);
        stage = "BARCODE";
    }

    public void barcodeAccepted(String value, boolean needsKiz) {
        requireStage("BARCODE");
        barcode = required(value);
        scanCode = barcode;
        operationKey = "tsd-storage-box:" + UUID.randomUUID();
        stage = needsKiz ? "KIZ" : "TARGET";
    }

    public void kizAccepted(String value) {
        requireStage("KIZ");
        scanCode = required(value);
        stage = "TARGET";
    }

    public void completed(boolean sourceArchived) {
        requireStage("TARGET");
        pendingTarget = "";
        cancelUnit();
        if (sourceArchived) { source = ""; stage = "SOURCE"; }
    }

    public void cancelUnit() {
        if (hasPendingTransfer()) throw new IllegalStateException("Сначала подтвердите результат перемещения.");
        barcode = "";
        scanCode = "";
        operationKey = "";
        stage = source.isEmpty() ? "SOURCE" : "BARCODE";
    }

    private void requireStage(String expected) {
        if (!stage.equals(expected)) throw new IllegalStateException("Unexpected scan stage: " + stage);
    }

    private static String required(String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("Пустой скан");
        return value.trim();
    }
}
