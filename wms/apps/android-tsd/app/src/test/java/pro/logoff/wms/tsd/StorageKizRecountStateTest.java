package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.*;

// TEST: explicit full-SKU confirmation, identity deduplication and immutable uncertain request.
public class StorageKizRecountStateTest {
    // TEST: entry from batch transfer must not lose selected units or expose an admin action to CLIENT/sold.
    @Test public void correctionEntryPreservesBatchAndBrandBoundaries() {
        assertTrue(StorageKizRecountState.canEnterFromTransfer("logoff", java.util.Arrays.asList("ADMIN"), false, 0));
        assertFalse(StorageKizRecountState.canEnterFromTransfer("ffullhab", java.util.Arrays.asList("ADMIN"), false, 0));
        assertFalse(StorageKizRecountState.canEnterFromTransfer("logoff", java.util.Arrays.asList("ADMIN", "CLIENT"), false, 0));
        assertFalse(StorageKizRecountState.canEnterFromTransfer("logoff", java.util.Arrays.asList("OPERATOR"), false, 0));
        assertFalse(StorageKizRecountState.canEnterFromTransfer("logoff", java.util.Arrays.asList("ADMIN"), true, 0));
        assertFalse(StorageKizRecountState.canEnterFromTransfer("logoff", java.util.Arrays.asList("ADMIN"), false, 1));
    }
    // TEST: explicitly entered old-box counts survive retries, never default to zero.
    @Test public void oldBoxCountsAreExplicitAndRestored() {
        StorageKizRecountState state = new StorageKizRecountState(); state.add(kiz("5abcdefghijkl"));
        assertTrue(state.oldBoxCounts().isEmpty()); state.oldBoxCount("FFL_OLD", 0); state.ready("snapshot");
        StorageKizRecountState restored = StorageKizRecountState.restore(state.scans(), state.snapshot(), state.operationKey(), state.oldBoxCounts());
        assertEquals(state.oldBoxCounts(), restored.oldBoxCounts());
        try { state.oldBoxCount("FFL_OLD", 2); fail(); } catch (IllegalStateException expected) { }
        state.oldBoxCounts().clear(); assertEquals(1, state.oldBoxCounts().size());
    }
    @Test public void invalidOldCountIsRejectedAndRescanClearsIt() {
        StorageKizRecountState state = new StorageKizRecountState(); state.add(kiz("5abcdefghijkl"));
        try { state.oldBoxCount("FFL_OLD", -1); fail(); } catch (IllegalArgumentException expected) { }
        try { state.oldBoxCount("", 0); fail(); } catch (IllegalArgumentException expected) { }
        state.oldBoxCount("FFL_OLD", 0); state.add(kiz("5bcdefghijklm")); assertTrue(state.oldBoxCounts().isEmpty());
    }
    // TEST: administrative confirmation survives restart and cannot be silently reused for a new preview.
    @Test public void adminDecisionMustBeExplicitAndRestoredForRetry() {
        StorageKizRecountState state = new StorageKizRecountState(); state.add(kiz("5abcdefghijkl"));
        state.ready("snapshot", true, true);
        assertTrue(state.adminRelease()); assertTrue(state.adminConfirmationRequired()); assertFalse(state.adminConfirmed());
        state.confirmAdministrator(); assertTrue(state.adminConfirmed());
        state.abortAdministrator(); assertTrue(state.adminAbort());
        StorageKizRecountState restored = StorageKizRecountState.restore(state.scans(), state.snapshot(), state.operationKey());
        restored.restoreAdminDecision(true, true); assertTrue(restored.adminRelease()); assertTrue(restored.adminConfirmed());
        restored.abortAdministrator(); assertTrue(restored.adminAbort());
        restored.repeatPreview(); assertFalse(restored.adminRelease()); assertFalse(restored.adminConfirmed()); assertFalse(restored.adminAbort());
    }
    private String kiz(String serial) { return "010464056995966921" + serial + "\u001d91EE12\u001d92test"; }
    @Test public void countsIdentitiesOnlyOnce() {
        StorageKizRecountState state = new StorageKizRecountState();
        assertTrue(state.add(kiz("5abcdefghijkl")));
        assertFalse(state.add(kiz("5abcdefghijkl").replace("\u001d", "<GS>")));
        assertEquals(1, state.scans().size());
    }
    @Test public void malformedKizIsNotCounted() {
        StorageKizRecountState state = new StorageKizRecountState();
        try { state.add("2051761490973"); fail(); } catch (IllegalArgumentException expected) { }
        assertTrue(state.scans().isEmpty());
    }
    @Test public void previewFreezesCountAndKeepsRetryIdentity() {
        StorageKizRecountState state = new StorageKizRecountState();
        state.add(kiz("5abcdefghijkl")); String id = state.operationKey();
        state.ready("snapshot");
        assertTrue(state.ready()); assertEquals(id, state.operationKey()); assertEquals("snapshot", state.snapshot());
        try { state.add(kiz("5bcdefghijklm")); fail(); } catch (IllegalStateException expected) { }
        assertEquals(1, state.scans().size());
    }
    @Test public void cannotConfirmAnEmptyCount() {
        StorageKizRecountState state = new StorageKizRecountState();
        try { state.ready("snapshot"); fail(); } catch (IllegalStateException expected) { }
    }
    @Test public void scanListCannotBeMutatedByCaller() {
        StorageKizRecountState state = new StorageKizRecountState(); state.add(kiz("5abcdefghijkl"));
        state.scans().clear(); assertEquals(1, state.scans().size());
    }
    // TEST: scanner variants and interrupted confirmations preserve the physical identity.
    @Test public void supportsScannerVariantsAndRestoresPending() {
        StorageKizRecountState state = new StorageKizRecountState();
        assertTrue(state.add("]d2" + kiz("5abcdefghijkl")));
        assertFalse(state.add(kiz("5abcdefghijkl").replace("010464056995966921", "(01)04640569959669(21)")));
        assertFalse(state.add(kiz("5abcdefghijkl").replace("010464056995966921", "0104640569959669\u001d21")));
        state.ready("snapshot");
        StorageKizRecountState restored = StorageKizRecountState.restore(state.scans(), state.snapshot(), state.operationKey());
        assertEquals(state.scans(), restored.scans()); assertEquals(state.operationKey(), restored.operationKey());
        assertTrue(restored.ready()); restored.repeatPreview(); assertFalse(restored.ready());
    }
}
