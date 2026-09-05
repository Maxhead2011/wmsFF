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
    private final boolean autoSource;

    public StorageBoxTransferState() { this(false); }

    // FIX: an additional mode; the source-first workflow keeps its original stages.
    public StorageBoxTransferState(boolean autoSource) {
        this.autoSource = autoSource;
        if (autoSource) stage = "BARCODE";
    }

    public boolean autoSource() { return autoSource; }

    public void autoSourceAccepted(String value) {
        requireStage("KIZ");
        if (!autoSource) throw new IllegalStateException("Automatic source mode is not enabled");
        source = required(value);
    }

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
        return restorePending(source, barcode, scan, key, target, false);
    }

    // FIX: retain mode on uncertain request recovery; old saved operations default to source-first.
    public static StorageBoxTransferState restorePending(String source, String barcode, String scan, String key, String target, boolean autoSource) {
        StorageBoxTransferState result = new StorageBoxTransferState(autoSource);
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
        stage = (autoSource || needsKiz) ? "KIZ" : "TARGET";
    }

    public void kizAccepted(String value) {
        requireStage("KIZ");
        if (autoSource && source.isEmpty()) throw new IllegalStateException("WMS ещё не определила исходный короб");
        scanCode = required(value);
        stage = "TARGET";
    }

    public void completed(boolean sourceArchived) {
        requireStage("TARGET");
        pendingTarget = "";
        cancelUnit();
        if (sourceArchived && !autoSource) { source = ""; stage = "SOURCE"; }
    }

    public void cancelUnit() {
        if (hasPendingTransfer()) throw new IllegalStateException("Сначала подтвердите результат перемещения.");
        barcode = "";
        scanCode = "";
        operationKey = "";
        if (autoSource) source = "";
        stage = autoSource || !source.isEmpty() ? "BARCODE" : "SOURCE";
    }

    private void requireStage(String expected) {
        if (!stage.equals(expected)) throw new IllegalStateException("Unexpected scan stage: " + stage);
    }

    private static String required(String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("Пустой скан");
        return value.trim();
    }
}
