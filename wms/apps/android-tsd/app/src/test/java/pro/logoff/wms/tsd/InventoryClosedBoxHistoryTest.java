package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

import pro.logoff.wms.tsd.network.TsdInventoryBox;
import pro.logoff.wms.tsd.network.TsdInventoryLine;
import pro.logoff.wms.tsd.network.TsdInventorySession;

public class InventoryClosedBoxHistoryTest {
    @Test
    public void includesClosedBoxesFromActiveMiniInventoryAndSkipsCountingBox() {
        TsdInventorySession session = new TsdInventorySession();
        session.type = "BOX_CHECK";
        session.status = "ACTIVE";
        TsdInventoryBox matched = box("BOX-1", "MATCHED", 3, 3);
        TsdInventoryBox resolved = box("BOX-2", "RESOLVED", 4, 2);
        TsdInventoryBox counting = box("BOX-3", "COUNTING", 5, 0);
        session.boxes = Arrays.asList(matched, resolved, counting);

        // TEST: closing the box is enough; the parent mini-inventory may remain ACTIVE.
        assertEquals(
            Arrays.asList(matched, resolved),
            InventoryClosedBoxHistory.closedBoxes(Collections.singletonList(session))
        );
        assertEquals(4, InventoryClosedBoxHistory.expectedQuantity(resolved));
        assertEquals(2, InventoryClosedBoxHistory.countedQuantity(resolved));
    }

    private static TsdInventoryBox box(String code, String status, int expected, int counted) {
        TsdInventoryLine line = new TsdInventoryLine();
        line.expectedQuantity = expected;
        line.countedQuantity = counted;
        TsdInventoryBox box = new TsdInventoryBox();
        box.boxCode = code;
        box.status = status;
        box.lines = Collections.singletonList(line);
        return box;
    }
}
