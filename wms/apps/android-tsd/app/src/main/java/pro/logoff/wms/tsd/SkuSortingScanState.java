package pro.logoff.wms.tsd;

// FIX: a unit is only moved after a destination scan; failures keep the physical pair.
public final class SkuSortingScanState {
    private String source = "", audit = "", barcode = "", kiz = "";
    private String expectedBarcode = "", expectedKiz = "";
    private String pendingTarget = "";
    private boolean legacy;
    public String stage() {
        if (source.isEmpty()) return "SOURCE_BOX";
        if (audit.isEmpty() && !legacy) return "ACTUALIZE";
        if (barcode.isEmpty()) return "BARCODE";
        if (kiz.isEmpty()) return "KIZ";
        return "TARGET_BOX";
    }
    private String required(String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("Пустой скан");
        return value.trim();
    }
    private void at(String stage) {
        if (!stage.equals(stage())) throw new IllegalStateException("Сначала завершите текущий этап");
    }
    public void source(String value) { at("SOURCE_BOX"); source = required(value); }
    public void inventoryReady(String value) { at("ACTUALIZE"); audit = required(value); }
    public void barcode(String value) {
        at("BARCODE"); String scan = required(value);
        if (legacy && !expectedBarcode.equals(scan)) throw new IllegalArgumentException("ШК не соответствует выбранному отобранному товару");
        barcode = scan;
    }
    public void kizChecked(String value) {
        at("KIZ"); String scan = required(value);
        if (legacy && !expectedKiz.equals(scan)) throw new IllegalArgumentException("КИЗ не соответствует выбранной отобранной единице");
        kiz = scan;
    }
    public void resumePicked(String box, String code, String mark) {
        source = required(box); expectedBarcode = required(code); expectedKiz = required(mark);
        barcode = ""; kiz = ""; legacy = true;
    }
    public void resetPair() {
        if (!pendingTarget.isEmpty()) throw new IllegalStateException("Сначала уточните результат размещения в " + pendingTarget);
        barcode = ""; kiz = "";
    }
    public void targetAttempted(String value) {
        at("TARGET_BOX"); String target = required(value);
        if (!pendingTarget.isEmpty() && !pendingTarget.equalsIgnoreCase(target))
            throw new IllegalStateException("Повторите целевой короб " + pendingTarget + ": результат предыдущего запроса ещё не подтверждён");
        pendingTarget = target;
    }
    public String pendingTarget() { return pendingTarget; }
    // FIX: leaving while the result is uncertain would discard the physical destination.
    public boolean canLeave(boolean requestBusy) { return !requestBusy && pendingTarget.isEmpty(); }
    public void targetRejected() { pendingTarget = ""; }
    public void moved() {
        at("TARGET_BOX"); barcode = ""; kiz = ""; pendingTarget = "";
        if (legacy) { source = ""; audit = ""; expectedBarcode = ""; expectedKiz = ""; legacy = false; }
    }
    public String source() { return source; }
    public String audit() { return audit; }
    public String barcode() { return barcode; }
    public String kiz() { return kiz; }
    public boolean legacy() { return legacy; }
}
