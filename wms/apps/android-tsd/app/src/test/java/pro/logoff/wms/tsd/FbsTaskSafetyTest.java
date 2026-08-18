package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

import org.junit.Test;

import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

public class FbsTaskSafetyTest {
    @Test
    public void routesBoxAndKizDirectlyWithoutUniversalClassification() {
        // TEST: direct box scanning must stay on the fast specialized endpoint.
        assertEquals("scan-box", FbsTaskSafety.scanActionForState("SCAN_BOX"));
        assertEquals("boxCode", FbsTaskSafety.scanFieldForState("SCAN_BOX"));
        assertEquals("scan-box", FbsTaskSafety.scanActionForState("PALLET_BOXES"));
        assertEquals("scan-kiz", FbsTaskSafety.scanActionForState("SCAN_KIZ"));
        assertEquals("kiz", FbsTaskSafety.scanFieldForState("SCAN_KIZ"));
        assertEquals("scan-any", FbsTaskSafety.scanActionForState("SCAN_BARCODE"));
    }

    @Test
    public void clearsRejectedBarcodesAndKizButKeepsSystemFailures() {
        // TEST: a wrong product barcode is immediately ready for the next scan.
        assertTrue(FbsTaskSafety.shouldClearRejectedScan(
            "scan-any",
            "SCAN_BARCODE",
            400
        ));
        assertTrue(FbsTaskSafety.shouldClearRejectedScan(
            "scan-any",
            "SCAN_RELABEL_BARCODE",
            422
        ));

        // TEST: an invalid or conflicting KIZ is cleared as requested.
        assertTrue(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 400));
        assertTrue(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 409));
        assertTrue(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 422));

        // TEST: authorization, throttling and server failures retain the scan.
        assertFalse(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 401));
        assertFalse(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 429));
        assertFalse(FbsTaskSafety.shouldClearRejectedScan("scan-kiz", "SCAN_KIZ", 500));
        assertFalse(FbsTaskSafety.shouldClearRejectedScan("scan-any", "SCAN_BARCODE", 409));
    }

    @Test
    public void doesNotAuditWhenBarcodeSwitchesToTaskFromSameBox() {
        TsdFbsAssemblyResponse.Task updatedTask = task(
            "order-size-m",
            storageBox("FFL_LKB1007_166", 2)
        );

        // TEST: заявка №259 — ШК другого нужного размера переключил заказ,
        // но новый товар физически доступен в уже подтверждённом коробе.
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            true,
            true,
            false,
            false,
            "order-size-xl",
            "FFL_LKB1007_166",
            updatedTask
        ));
    }

    @Test
    public void auditsWhenSwitchedTaskCannotUseConfirmedBox() {
        TsdFbsAssemblyResponse.Task updatedTask = task(
            "other-order",
            storageBox("FFL_LKB1107_033", 6)
        );

        // TEST: реальный брошенный короб по-прежнему требует обязательной сверки.
        assertTrue(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            true,
            true,
            false,
            false,
            "original-order",
            "FFL_LKB1007_166",
            updatedTask
        ));
    }

    @Test
    public void releaseAfterConfirmedBoxStillRequiresAudit() {
        TsdFbsAssemblyResponse.Task updatedTask = task(
            "same-order",
            storageBox("FFL_LKB1007_166", 2)
        );

        // TEST: явное «Отложить» после открытия короба сохраняет старую защиту.
        assertTrue(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            true,
            true,
            true,
            false,
            "same-order",
            "FFL_LKB1007_166",
            updatedTask
        ));
    }

    @Test
    public void acceptedBarcodeNeverStartsInventoryAfterTaskSwitch() {
        TsdFbsAssemblyResponse updated = new TsdFbsAssemblyResponse();
        updated.state = "SCAN_BOX";
        updated.task = task("switched-order");
        updated.task.scannedBarcode = "2042311801127";

        // TEST: точное воспроизведение заявки №259 — API принял ШК, но старая
        // версия ответа ещё просила короб; инвентаризация всё равно запрещена.
        boolean acceptedBarcode = FbsTaskSafety.taskAcceptedScannedBarcode(
            "scan-any",
            "2042311801127",
            updated
        );
        assertTrue(acceptedBarcode);
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            true,
            true,
            false,
            acceptedBarcode,
            "original-order",
            "FFL_LKB1007_166",
            updated.task
        ));
    }

    private static TsdFbsAssemblyResponse.Task task(
        String id,
        TsdFbsAssemblyResponse.StorageBox... storageBoxes
    ) {
        TsdFbsAssemblyResponse.Task task = new TsdFbsAssemblyResponse.Task();
        task.id = id;
        task.storageBoxes = Arrays.asList(storageBoxes);
        return task;
    }

    private static TsdFbsAssemblyResponse.StorageBox storageBox(
        String code,
        int quantity
    ) {
        TsdFbsAssemblyResponse.StorageBox box = new TsdFbsAssemblyResponse.StorageBox();
        box.code = code;
        box.quantity = quantity;
        return box;
    }
}
