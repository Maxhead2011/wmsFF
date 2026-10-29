package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.*;

public class ReceiptKizIdentityTest {
    private final String identity = "010464068426237821AbCdEf1234567";
    // TEST: aliases denote one unit, while case-distinct serials and other clients do not.
    @Test public void aliasesShareClientIdentity() {
        String full = identity + "\u001d91EE12\u001d92proof";
        for (String value : new String[]{identity, full, "]d2" + full, full.replace("\u001d", "<GS>"), full.replace("\u001d", "")}) {
            assertEquals(ReceiptKizIdentity.key("client", identity, true), ReceiptKizIdentity.key("client", value, true));
        }
    }
    @Test public void clientAndCaseArePreserved() {
        assertNotEquals(ReceiptKizIdentity.key("client", identity, true), ReceiptKizIdentity.key("other", identity, true));
        assertNotEquals(ReceiptKizIdentity.key("client", identity, true), ReceiptKizIdentity.key("client", identity.toLowerCase(java.util.Locale.ROOT), true));
    }
    @Test public void soldFlavorKeepsLegacyComparison() {
        assertEquals(identity.toUpperCase(java.util.Locale.ROOT), ReceiptKizIdentity.key("client", identity, false));
    }
}
