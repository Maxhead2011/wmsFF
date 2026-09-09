package pro.logoff.wms.tsd;

import java.util.List;
import java.util.Map;

// FIX: keep unknown sources and newly accounted stock explicit in the native workflow.
public final class PalletSortingProblemFormatter {
    private PalletSortingProblemFormatter() {}
    // FIX: retained stock is not an empty permanent box and is never promised as a write-off.
    public static String sourceState(Map<String, Object> box) {
        Object reason = box.get("retainedReason");
        return box.get("code") + " — " + (reason != null ? reason.toString()
            : Boolean.TRUE.equals(box.get("preservedOnPallet")) ? "пустой бокс · сохранён на месте"
            : Boolean.TRUE.equals(box.get("archived")) ? "архив"
            : Boolean.TRUE.equals(box.get("scanned")) ? "подтверждён" : "не отсканирован");
    }
    public static String disposition(Map<String, Object> box) {
        Object reason = box.get("retainedReason");
        return reason != null ? " — НЕ списывается: " + reason + "\n"
            : Boolean.TRUE.equals(box.get("preserveOnPallet")) ? " — останется активным на своём месте\n" : " — будет архивирован\n";
    }
    public static String source(Map<String, Object> box) {
        return box.get("code") + " — проблемный: не найден в WMS · "
            + (Boolean.TRUE.equals(box.get("scanned")) ? "отсканирован" : "не отсканирован");
    }
    public static int recovered(Map<String, Object> state) {
        Object moves = state.get("moves");
        if (!(moves instanceof List)) return 0;
        int total = 0;
        for (Object move : (List<?>) moves) {
            if (move instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) move).get("recovered"))) total++;
        }
        return total;
    }
}
