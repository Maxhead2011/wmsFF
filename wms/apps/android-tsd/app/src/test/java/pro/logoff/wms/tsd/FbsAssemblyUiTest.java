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
}
