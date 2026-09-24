package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
public class FbsSequentialPickTest {
    private TsdFbsAssemblyResponse response(String id, String state) {
        TsdFbsAssemblyResponse r = new TsdFbsAssemblyResponse(); r.sequentialPickingEnabled = true;
        r.state = state; r.task = new TsdFbsAssemblyResponse.Task(); r.task.id = id;
        r.task.requestId = "request"; r.task.scannedBoxCode = "A"; r.task.recommendedBoxCode = "A";
        r.task.itemCount = 1; return r;
    }
    // TEST: several completed orders in one physical box, without double-counting a repeated response.
    @Test public void continuesPairsAndCountsOnlyOnce() {
        FbsSequentialPick s = new FbsSequentialPick();
        TsdFbsAssemblyResponse first = response("one", "SCAN_BARCODE");
        first.task.sourceBoxUsage = new TsdFbsAssemblyResponse.SourceBoxUsage(); first.task.sourceBoxUsage.units = 3;
        s.acceptedBox("user", first);
        assertEquals(3, s.remaining());
        s.completed("user", response("one", "READY_TO_COMPLETE")); assertEquals(0, s.picked());
        s.completed("user", response("one", "COMPLETED")); s.completed("user", response("one", "COMPLETED"));
        assertEquals(1, s.picked()); assertEquals(2, s.remaining());
        assertEquals("A", s.continueBox("user", response("two", "SCAN_BOX")));
        assertNull(s.continueBox("user", response("two", "SCAN_BOX")));
        s.completed("user", response("two", "COMPLETED")); assertEquals(2, s.picked());
    }
    @Test public void neverReusesAnotherSessionOrRequestOrStartedTask() {
        FbsSequentialPick s = new FbsSequentialPick(); s.acceptedBox("user", response("one", "SCAN_BARCODE"));
        assertNull(s.continueBox("user", response("two", "SCAN_KIZ")));
        TsdFbsAssemblyResponse other = response("two", "SCAN_BOX"); other.task.recommendedBoxCode = "B";
        assertNull(s.continueBox("user", other));
        other.task.requestId = "other"; assertNull(s.continueBox("user", other)); assertEquals("", s.box());
        s.acceptedBox("user", response("one", "SCAN_BARCODE"));
        assertNull(s.continueBox("other", response("two", "SCAN_BOX"))); assertEquals("", s.box());
    }
    @Test public void restartAndDisabledServerRequirePhysicalScan() {
        FbsSequentialPick s = new FbsSequentialPick(); assertNull(s.continueBox("user", response("one", "SCAN_BOX")));
        TsdFbsAssemblyResponse disabled = response("one", "SCAN_BARCODE"); disabled.sequentialPickingEnabled = false;
        s.acceptedBox("user", disabled); assertEquals("", s.box());
    }
    @Test public void serverRestoresCounterAfterLostCompletionReply() {
        FbsSequentialPick s = new FbsSequentialPick();
        TsdFbsAssemblyResponse next = response("next", "SCAN_BARCODE");
        next.task.sourceBoxUsage = new TsdFbsAssemblyResponse.SourceBoxUsage();
        next.task.sourceBoxUsage.pickedUnits = 5; next.task.sourceBoxUsage.units = 2;
        s.acceptedBox("user", next); assertEquals(5, s.picked()); assertEquals(2, s.remaining());
    }
}
