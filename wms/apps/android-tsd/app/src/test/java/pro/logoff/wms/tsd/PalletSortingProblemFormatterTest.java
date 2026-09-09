package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

public class PalletSortingProblemFormatterTest {
    @Test public void retainedPackingIsNotLabelledEmptyOrWrittenOff() {
        // TEST: completion keeps reserved goods in place and explains that to the administrator.
        Map<String,Object> box = new LinkedHashMap<>();
        box.put("code", "BOX"); box.put("retainedReason", "Есть PACKING"); box.put("preservedOnPallet", true);
        assertEquals("BOX — Есть PACKING", PalletSortingProblemFormatter.sourceState(box));
        assertEquals(" — НЕ списывается: Есть PACKING\n", PalletSortingProblemFormatter.disposition(box));
    }
    @Test public void showsProblemAndPhysicalScanSeparately() {
        // TEST: a scanned unknown box is still a problem, not a valid WMS source.
        Map<String, Object> box = new LinkedHashMap<>();
        box.put("code", "UNKNOWN"); box.put("scanned", true);
        assertEquals("UNKNOWN — проблемный: не найден в WMS · отсканирован", PalletSortingProblemFormatter.source(box));
        box.put("scanned", false);
        assertTrue(PalletSortingProblemFormatter.source(box).endsWith("не отсканирован"));
    }
    @Test public void separatesRecoveredUnitsAndSupportsOldSessions() {
        // TEST: total handling count must not hide +1 inventory adjustments.
        Map<String, Object> state = new LinkedHashMap<>();
        assertEquals(0, PalletSortingProblemFormatter.recovered(state));
        Map<String, Object> ordinary = new LinkedHashMap<>(), recovered = new LinkedHashMap<>();
        recovered.put("recovered", true);
        state.put("moves", Arrays.asList(ordinary, recovered));
        assertEquals(1, PalletSortingProblemFormatter.recovered(state));
    }
}
