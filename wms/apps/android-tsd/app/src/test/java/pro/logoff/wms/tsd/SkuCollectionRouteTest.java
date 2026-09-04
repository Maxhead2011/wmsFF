package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdSkuCollection;

public class SkuCollectionRouteTest {
    @Test
    public void displaysRoomPalletAndBoxInWalkingOrder() {
        // TEST: picker sees the complete route instead of only a box code.
        TsdSkuCollection.Source source = new TsdSkuCollection.Source();
        source.sourceBoxCode = "FFL_BOX_2";
        source.storageLocation = new TsdSkuCollection.StorageLocation();
        source.storageLocation.zoneName = "Помещение 1";
        source.storageLocation.palletCode = "PALET_SORT_007";
        assertEquals("Помещение: Помещение 1\nПаллетсорт: PALET_SORT_007\nКороб: FFL_BOX_2", source.routeLabel(false));
    }

    @Test
    public void missingPlacementDoesNotInventAPalletOrCrash() {
        // TEST: old API responses and unplaced boxes remain usable.
        TsdSkuCollection.Source source = new TsdSkuCollection.Source();
        source.sourceBoxCode = "BOX-1";
        assertEquals("Помещение: не указано\nПаллетсорт: не указан\nКороб: BOX-1", source.routeLabel(false));
        source.storageLocation = new TsdSkuCollection.StorageLocation();
        source.storageLocation.zoneName = " ";
        source.storageLocation.zoneCode = "ROOM-2";
        assertEquals("Xona: ROOM-2\nPallet-sort: ko‘rsatilmagan\nQuti: BOX-1", source.routeLabel(true));
    }
}
