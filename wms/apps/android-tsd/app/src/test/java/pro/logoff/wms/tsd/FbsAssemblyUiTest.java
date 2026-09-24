package pro.logoff.wms.tsd;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FbsAssemblyUiTest {
    @Test
    public void wbStickerDigitsPreserveZerosAndPreferCurrentLabel() {
        // TEST: saved local-recovery digits, refreshed WB labels and absent metadata.
        pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Task task =
            new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Task();
        task.marketplace = "WILDBERRIES";
        task.orderId = "5790000000";
        org.junit.Assert.assertEquals("", FbsAssemblyUi.wbStickerNumber(task));
        task.wbStickerNumber = "0057894 0051";
        org.junit.Assert.assertEquals("0057894 0051", FbsAssemblyUi.wbStickerNumber(task));
        task.orderSticker = new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.OrderSticker();
        task.orderSticker.partA = "0057895";
        task.orderSticker.partB = "0002";
        org.junit.Assert.assertEquals("0057895 0002", FbsAssemblyUi.wbStickerNumber(task));
        task.marketplace = "OZON";
        org.junit.Assert.assertEquals("", FbsAssemblyUi.wbStickerNumber(task));
    }


    // TEST: both marketplaces use physical picking; legacy and sold terminals keep their workflow.
    @Test
    public void physicalPickRequiresBothOurAppAndServerSupport() {
        assertTrue(FbsAssemblyUi.usesPhysicalPickConfirmation("logoff", "OZON", true));
        assertTrue(FbsAssemblyUi.usesPhysicalPickConfirmation("logoff", "WILDBERRIES", true));
        assertFalse(FbsAssemblyUi.usesPhysicalPickConfirmation("logoff", "OZON", false));
        assertFalse(FbsAssemblyUi.usesPhysicalPickConfirmation("ffullhab", "OZON", true));
        assertFalse(FbsAssemblyUi.usesPhysicalPickConfirmation("platform", "WILDBERRIES", true));
    }
    @Test
    public void guidesBarcodeAndKizButReturnsToStickerScreen() {
        // TEST: рабочее окно ведёт сотрудника ровно через ШК и КИЗ.
        assertTrue(FbsAssemblyUi.shouldUseGuidedScanDialog("SCAN_BARCODE"));
        assertTrue(FbsAssemblyUi.shouldUseGuidedScanDialog("SCAN_KIZ"));
        assertFalse(FbsAssemblyUi.shouldUseGuidedScanDialog("READY_TO_COMPLETE"));
    }

    @Test
    public void remainingOrdersOpenOnlyAfterUserChoiceForCurrentTask() {
        // ADDED: первый показ и новый заказ всегда свёрнуты.
        assertFalse(FbsAssemblyUi.keepRemainingOrdersOpen("", "task-1", false));
        assertFalse(FbsAssemblyUi.keepRemainingOrdersOpen("task-1", "task-2", true));

        // FIX: обновление текущего заказа не раскрывает закрытый список и не закрывает открытый вручную.
        assertFalse(FbsAssemblyUi.keepRemainingOrdersOpen("task-1", "task-1", false));
        assertTrue(FbsAssemblyUi.keepRemainingOrdersOpen("task-1", "task-1", true));
    }

    @Test
    public void routeHintsAppearOnlyForFinalNineUnitsAndAlternatesStaySeparate() {
        // TEST: the blue route and collapsed alternatives were previously visible with any remaining count.
        pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Progress progress =
            new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Progress();
        progress.requestRemainingItems = 10;
        assertFalse(FbsAssemblyUi.showLateRouteHints("logoff", progress));
        assertTrue(FbsAssemblyUi.showLateRouteHints("ffullhab", progress));
        assertTrue(FbsAssemblyUi.showLateRouteHints("platform", progress));
        progress.requestRemainingItems = 9;
        assertTrue(FbsAssemblyUi.showLateRouteHints("logoff", progress));
        progress.requestRemainingItems = 0;
        assertFalse(FbsAssemblyUi.showLateRouteHints("logoff", progress));
        assertFalse(FbsAssemblyUi.showLateRouteHints("logoff", null));

        pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Task task =
            new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Task();
        task.recommendedBoxCode = "BOX-1";
        pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.StorageBox chosen =
            new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.StorageBox();
        chosen.code = "box-1";
        chosen.quantity = 3;
        pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.StorageBox other =
            new pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.StorageBox();
        other.code = "BOX-2";
        other.quantity = 2;
        task.storageBoxes = java.util.Arrays.asList(chosen, other);
        org.junit.Assert.assertEquals(java.util.Collections.singletonList(other), FbsAssemblyUi.alternateStorageBoxes(task));
    }
}
