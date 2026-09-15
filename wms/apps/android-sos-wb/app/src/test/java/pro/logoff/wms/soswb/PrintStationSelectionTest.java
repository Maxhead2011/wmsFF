package pro.logoff.wms.soswb;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PrintStationSelectionTest {
    // TEST: не даём вернуть в список старую станцию, которая оставит задание в QUEUED.
    @Test
    public void selectsOnlyOnlineStation() {
        assertTrue(PrintStationSelection.isSelectable(true));
        assertFalse(PrintStationSelection.isSelectable(false));
    }
}
