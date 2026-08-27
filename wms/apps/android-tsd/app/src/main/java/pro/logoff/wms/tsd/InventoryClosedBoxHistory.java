package pro.logoff.wms.tsd;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import pro.logoff.wms.tsd.network.TsdInventoryBox;
import pro.logoff.wms.tsd.network.TsdInventoryLine;
import pro.logoff.wms.tsd.network.TsdInventorySession;

final class InventoryClosedBoxHistory {
    private InventoryClosedBoxHistory() {}

    // FIX: a mini-inventory box is closed even if its parent session was left ACTIVE.
    static List<TsdInventoryBox> closedBoxes(List<TsdInventorySession> sessions) {
        if (sessions == null || sessions.isEmpty()) {
            return Collections.emptyList();
        }
        List<TsdInventoryBox> result = new ArrayList<>();
        for (TsdInventorySession session : sessions) {
            if (session == null || !"BOX_CHECK".equals(session.type) || session.boxes == null) {
                continue;
            }
            for (TsdInventoryBox box : session.boxes) {
                if (box != null && isClosed(box.status)) {
                    result.add(box);
                }
            }
        }
        return result;
    }

    static int expectedQuantity(TsdInventoryBox box) {
        int total = 0;
        if (box == null || box.lines == null) return total;
        for (TsdInventoryLine line : box.lines) {
            if (line != null) total += line.expectedQuantity;
        }
        return total;
    }

    static int countedQuantity(TsdInventoryBox box) {
        int total = 0;
        if (box == null || box.lines == null) return total;
        for (TsdInventoryLine line : box.lines) {
            if (line != null) total += line.countedQuantity;
        }
        return total;
    }

    private static boolean isClosed(String status) {
        return "MATCHED".equals(status) || "RESOLVED".equals(status);
    }
}
