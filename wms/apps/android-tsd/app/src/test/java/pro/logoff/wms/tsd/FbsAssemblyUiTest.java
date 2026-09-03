package pro.logoff.wms.tsd;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FbsAssemblyUiTest {
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
