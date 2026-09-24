package pro.logoff.wms.tsd;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RelabelPrintGateTest {
    @Test public void verificationWaitsForTwoLabelAgentAcknowledgement() {
        // TEST: a queued, claimed, failed, or unknown print must not unlock the confirming scan.
        assertFalse(RelabelPrintGate.canVerify(""));
        assertFalse(RelabelPrintGate.canVerify("QUEUED"));
        assertFalse(RelabelPrintGate.canVerify("CLAIMED"));
        assertFalse(RelabelPrintGate.canVerify("FAILED"));
        assertTrue(RelabelPrintGate.canVerify("PRINTED"));
    }

    @Test public void retryKeepsTheSameJobWhileTheNextUnitGetsANewJob() {
        // TEST: lost responses and app restarts cannot silently queue four labels for one item.
        String first = RelabelPrintGate.printId("1291", "BOX", "OLD", "NEW", "M", 0, "worker");
        assertEquals(first, RelabelPrintGate.printId("1291", "BOX", "OLD", "NEW", "M", 0, "worker"));
        assertNotEquals(first, RelabelPrintGate.printId("1291", "BOX", "OLD", "NEW", "M", 1, "worker"));
    }
}
