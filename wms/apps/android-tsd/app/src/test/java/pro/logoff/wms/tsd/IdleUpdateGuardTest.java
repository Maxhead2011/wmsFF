package pro.logoff.wms.tsd;

import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner.class)
@org.robolectric.annotation.Config(sdk = 28)
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
    // TEST: HT330 retained a durable FBO position, not an unacknowledged command.
    @Test public void savedProductPositionDoesNotBlockUpgradeOrChangeTheDraft() {
        java.util.Map<String,Object> entries = new java.util.LinkedHashMap<>();
        String position = "{\"barcode\":\"460123\",\"productKiz\":\"saved-kiz\",\"productMode\":true}";
        entries.put("worker:request:position", position);
        assertFalse(IdleUpdateGuard.hasFboScan(entries));
        assertEquals(position, entries.get("worker:request:position"));
        entries.put("worker:request", "{\"operationId\":\"pending-operation\"}");
        assertTrue(IdleUpdateGuard.hasFboScan(entries));
        assertEquals(position, entries.get("worker:request:position"));
    }
    // TEST: unreadable state fails closed and remains available for diagnosis.
    @Test public void invalidPositionStillBlocksUpdate() {
        assertTrue(IdleUpdateGuard.hasFboScan(Collections.singletonMap("request:position", "broken")));
    }
    // TEST: DT40 has a durable receipt draft from22November; preserve it while replacing the package.
    @Test public void validPersistedReceiptDoesNotBlockUpgrade() {
        java.util.Map<String,Object> entries=new java.util.LinkedHashMap<>();
        String draft="{\"version\":1,\"items\":[{\"barcode\":\"460123\",\"quantity\":2}]}";
        entries.put("receipt-box-draft:v1:old-box",draft);
        assertFalse(IdleUpdateGuard.hasReceiptDraft(entries));
        assertEquals(draft,entries.get("receipt-box-draft:v1:old-box"));
        entries.put("receipt-box-draft:v1:broken","{broken");
        assertTrue(IdleUpdateGuard.hasReceiptDraft(entries));
    }
}
