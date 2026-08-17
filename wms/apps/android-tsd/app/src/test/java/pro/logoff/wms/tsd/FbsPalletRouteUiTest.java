package pro.logoff.wms.tsd;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FbsPalletRouteUiTest {
    @Test
    public void opensRouteOnlyAfterPalletSortScanResponse() {
        // ADDED: SCAN_BOX must ask for a pallet-sort instead of imposing one recommended pallet.
        assertFalse(FbsPalletRouteUi.isPalletRouteOpen("SCAN_BOX", false));
        assertFalse(FbsPalletRouteUi.isPalletRouteOpen("PALLET_BOXES", false));

        // ADDED: PALLET_BOXES keeps the full boxes-and-nearby-pallets instruction visible.
        assertTrue(FbsPalletRouteUi.isPalletRouteOpen("PALLET_BOXES", true));
    }
}
