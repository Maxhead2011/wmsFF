package pro.logoff.wms.tsd;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class FbsLocalRecoveryPolicyTest {
    // TEST: a normal WB order must still be blocked until the real sticker is loaded.
    @Test
    public void regularWildberriesOrderStillRequiresSticker() {
        assertFalse(FbsLocalRecoveryPolicy.canCompleteWithoutSticker(false, true));
        assertFalse(FbsLocalRecoveryPolicy.canCompleteWithoutSticker(true, true));
    }

    // TEST: a local-only recovery never mutates WB and may finish without requesting
    // an already unavailable sticker for an order in complete/shipped status.
    @Test
    public void localOnlyRecoveryCanCompleteWithoutSticker() {
        assertTrue(FbsLocalRecoveryPolicy.canCompleteWithoutSticker(true, false));
    }
}
