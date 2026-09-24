package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.*;

public class FbsStepVoiceTest {
    // TEST: WB and Ozon use server stages, never redraws or pending requests.
    @Test public void stepsAndRetries() {
        FbsStepVoice v = new FbsStepVoice();
        assertNull(v.step("logoff", false, "u", "a", "SCAN_BARCODE"));
        assertEquals(FboPackingVoice.Cue.BARCODE, v.step("logoff", true, "u", "a", "SCAN_BARCODE"));
        assertNull(v.step("logoff", true, "u", "a", "SCAN_BARCODE"));
        assertEquals(FboPackingVoice.Cue.KIZ, v.step("logoff", true, "u", "a", "SCAN_KIZ"));
        assertEquals(FboPackingVoice.Cue.PUT, v.step("logoff", true, "u", "a", "READY_TO_COMPLETE"));
        assertNull(v.step("logoff", true, "u", "a", "READY_TO_COMPLETE"));
        assertNull(v.step("logoff", true, "u", "a", "COMPLETED"));
        assertEquals(FboPackingVoice.Cue.BARCODE, v.step("logoff", true, "u", "b", "SCAN_BARCODE"));
    }
    // TEST: relabel asks for the NEW BARCODE; confirmation proposals never imply acceptance.
    @Test public void relabelAndSafety() {
        FbsStepVoice v = new FbsStepVoice();
        assertEquals(FboPackingVoice.Cue.NEW_BARCODE, v.step("logoff", true, "u", "a", "SCAN_RELABEL_BARCODE"));
        assertNull(v.step("logoff", true, "u", "a", "CONFIRM_KIZ_MOVE"));
        assertEquals(FboPackingVoice.Cue.KIZ, v.step("logoff", true, "u", "a", "SCAN_NEW_KIZ"));
        for (String flavor : new String[]{"ffullhab", "platform"})
            assertNull(v.step(flavor, true, "u", "a", "SCAN_BARCODE"));
        assertNull(v.step("logoff", true, "u", null, "SCAN_BARCODE"));
    }
}
