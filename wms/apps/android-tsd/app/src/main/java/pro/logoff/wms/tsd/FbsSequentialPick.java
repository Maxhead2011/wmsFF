package pro.logoff.wms.tsd;

import java.util.HashSet;
import java.util.Set;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

// FIX: only this live session's physical box confirmation may be reused. Restart requires a scan.
final class FbsSequentialPick {
    private String owner = "", request = "", box = "";
    private final Set<String> completed = new HashSet<>();
    private final Set<String> attempted = new HashSet<>();
    private int picked;
    private int remaining = -1;
    void clear() { owner = request = box = ""; picked = 0; remaining = -1; completed.clear(); attempted.clear(); }
    void acceptedBox(String session, TsdFbsAssemblyResponse response) {
        if (response == null || !response.sequentialPickingEnabled || response.task == null) return;
        TsdFbsAssemblyResponse.Task t = response.task;
        if (t.requestId == null || t.sourceWithoutBox || t.scannedBoxCode == null || t.scannedBoxCode.isEmpty()) return;
        if (!session.equals(owner) || !t.requestId.equals(request) || !t.scannedBoxCode.equals(box)) {
            clear(); owner = session; request = t.requestId; box = t.scannedBoxCode;
        }
        if (t.sourceBoxUsage != null) {
            remaining = t.sourceBoxUsage.units;
            if (t.sourceBoxUsage.pickedUnits != null) picked = t.sourceBoxUsage.pickedUnits;
        }
    }
    void completed(String session, TsdFbsAssemblyResponse response) {
        if (matches(session, response) && "COMPLETED".equals(response.state)
            && box.equals(response.task.scannedBoxCode) && completed.add(response.task.id)) {
            picked += Math.max(1, response.task.itemCount);
            if (remaining >= 0) remaining = Math.max(0, remaining - Math.max(1, response.task.itemCount));
        }
    }
    private boolean matches(String session, TsdFbsAssemblyResponse response) {
        return response != null && response.sequentialPickingEnabled && response.task != null
            && !box.isEmpty() && owner.equals(session) && request.equals(response.task.requestId);
    }
    String continueBox(String session, TsdFbsAssemblyResponse response) {
        if (!matches(session, response)) { clear(); return null; }
        // FIX: never switch an already started order, a relabel flow, or a different recommended box.
        if (!"SCAN_BOX".equals(response.state) || response.task.sourceWithoutBox
            || !box.equals(response.task.recommendedBoxCode)) return null;
        return attempted.add(response.task.id) ? box : null;
    }
    int picked() { return picked; }
    int remaining() { return remaining; }
    String box() { return box; }
}
