package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

public class PalletSortingRestoreConsentTest {
    private Map<String,Object> scan() { Map<String,Object> b=new LinkedHashMap<>(); b.put("action","MOVE"); b.put("barcode","4600000000001"); b.put("kiz","identity"); b.put("operationId","old"); b.put("version",7); return b; }
    @Test public void explicitConsentRetainsScannedUnitButCreatesANewCommand() {
        // TEST: preview is not permission; the button confirms exactly the retained scan.
        PalletSortingRestoreConsent c=new PalletSortingRestoreConsent();
        Map<String,Object> original=scan();
        assertTrue(c.offer("SORTING_WRITEOFF_CONFIRM_REQUIRED",new String(new char[64]).replace('\0','a'),"Found",original));
        original.put("kiz","changed");assertTrue(c.pending());
        Map<String,Object> confirm=c.confirm();
        assertEquals("identity",confirm.get("kiz"));assertEquals(true,confirm.get("confirmRestore"));assertFalse(confirm.containsKey("operationId"));assertFalse(c.pending());
        PalletSortingCommand command=new PalletSortingCommand();assertTrue(command.begin("actions",confirm));
        Object id=command.body().get("operationId");command.uncertain();assertEquals(id,command.body().get("operationId"));
    }
    @Test public void cancellationDoesNotProduceAConfirmedRequest() {
        // TEST: cancellation or leaving must not keep latent approval for the next scan.
        PalletSortingRestoreConsent c=new PalletSortingRestoreConsent();
        c.offer("SORTING_WRITEOFF_CONFIRM_REQUIRED",new String(new char[64]).replace('\0','b'),"Found",scan());c.clear();assertFalse(c.pending());assertNull(c.confirm());
    }
    @Test public void ordinaryConflictOrInvalidFingerprintNeverOffersRecovery() {
        // TEST: neither an arbitrary 409 nor a malformed response allows a stock adjustment.
        PalletSortingRestoreConsent c=new PalletSortingRestoreConsent();
        assertFalse(c.offer("CONFLICT","bad","Error",scan()));
        assertFalse(c.offer("SORTING_WRITEOFF_CONFIRM_REQUIRED","bad","Error",scan()));assertFalse(c.pending());
    }
}
