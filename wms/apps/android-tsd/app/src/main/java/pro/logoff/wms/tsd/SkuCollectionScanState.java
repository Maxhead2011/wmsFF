package pro.logoff.wms.tsd;

public final class SkuCollectionScanState {
    private final boolean receiving;
    private String boxCode = "";
    private String barcode = "";

    public SkuCollectionScanState(boolean receiving) {
        this.receiving = receiving;
    }

    public String stage() {
        if (boxCode.isEmpty()) return receiving ? "TARGET_BOX" : "SOURCE_BOX";
        if (barcode.isEmpty()) return "BARCODE";
        return "KIZ";
    }

    public void accept(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) throw new IllegalArgumentException("Пустой скан");
        if (boxCode.isEmpty()) boxCode = normalized;
        else if (barcode.isEmpty()) barcode = normalized;
    }

    public String boxCode() { return boxCode; }
    public String barcode() { return barcode; }

    public void nextUnit() {
        barcode = "";
        if (!receiving) boxCode = "";
    }
}
