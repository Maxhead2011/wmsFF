package pro.logoff.wms.tsd;

import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class IdleUpdateGuardTest {
    @Test public void apkAndFeedFollowSelectedProfile() {
        String path = "downloads/logoff-tsd-server-choice.apk";
        assertEquals(ServerSettings.BACKUP_URL + path, IdleUpdateGuard.channelUrl(ServerSettings.BACKUP));
        assertEquals(ServerSettings.MAIN_URL + path, IdleUpdateGuard.channelUrl(ServerSettings.MAIN));
    }

    // TEST: a persisted receipt scan still blocks installation after navigation.
    @Test public void receiptDraftBlocksUpdate() {
        assertTrue(IdleUpdateGuard.hasReceiptDraft(Collections.singletonMap("receipt-box-draft:v1:42", "{}")));
        assertFalse(IdleUpdateGuard.hasReceiptDraft(Collections.singletonMap("printer", "test")));
    }
    @Test public void commandBlocksButPackingPreferenceAllowsUpdate() {
        assertTrue(IdleUpdateGuard.hasFboScan(Collections.singletonMap("42:command", "scan")));
        assertFalse(IdleUpdateGuard.hasFboScan(Collections.singletonMap("42:mode", "fast")));
    }
}
