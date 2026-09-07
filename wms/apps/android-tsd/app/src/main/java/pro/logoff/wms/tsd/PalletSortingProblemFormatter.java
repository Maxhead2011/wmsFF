package pro.logoff.wms.tsd;

import java.util.List;
import java.util.Map;

// FIX: keep unknown sources and newly accounted stock explicit in the native workflow.
public final class PalletSortingProblemFormatter {
    private PalletSortingProblemFormatter() {}
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
