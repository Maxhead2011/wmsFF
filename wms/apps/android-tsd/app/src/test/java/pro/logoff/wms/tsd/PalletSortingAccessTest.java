package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.Arrays;
import pro.logoff.wms.tsd.auth.TsdSession;
import static org.junit.Assert.*;

public class PalletSortingAccessTest {
    private TsdSession session(String... roles) {
        return new TsdSession("test", "Bearer", "device", "TSD", "user", "Worker", Arrays.asList(roles));
    }

    @Test public void ownerHasAdministratorSortingAccessWithoutChangingAssignedRoles() {
        // TEST: Konstantin has OWNER alone; the menu must be visible without assigning ADMIN.
        TsdSession owner = session("OWNER");
        assertTrue(PalletSortingAccess.canOpen("logoff", owner));
        assertEquals(Arrays.asList("OWNER"), owner.roleCodes);
        assertTrue(PalletSortingAccess.canOpen("logoff", session("ADMIN")));
        assertTrue(PalletSortingAccess.canOpen("logoff", session("ADMIN", "OWNER")));
    }

    @Test public void soldFlavorsAndOtherRolesKeepTheirExistingMenus() {
        // TEST: granting OWNER sorting authority must not publish sorting in another installation.
        for (String flavor : Arrays.asList("ffullhab", "platform", "")) {
            assertFalse(PalletSortingAccess.canOpen(flavor, session("OWNER")));
            assertFalse(PalletSortingAccess.canOpen(flavor, session("ADMIN")));
        }
        for (String role : Arrays.asList("TSD", "OPERATOR", "MANAGER", "CLIENT", "WAREHOUSE_KEEPER")) {
            assertFalse(PalletSortingAccess.canOpen("logoff", session(role)));
        }
        assertFalse(PalletSortingAccess.canOpen("logoff", null));
        assertFalse(PalletSortingAccess.canOpen("logoff", session()));
    }
}
