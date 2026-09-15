package pro.logoff.wms.tsd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

import org.junit.Test;

import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

public class FbsTaskSafetyTest {
    @Test
    public void routesOnlyOurCurrentScopedStockStopIncludingWbAcceptedTasks() {
        // TEST: wrong-box, old-task, server errors and sold flavors must never enter this audit.
        TsdFbsAssemblyResponse.Task task = new TsdFbsAssemblyResponse.Task();
        task.id = "task"; task.scannedBoxCode = "FFL_BOX016";
        task.client = new TsdFbsAssemblyResponse.Client(); task.client.id = "client";
        assertTrue(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_BOX016", task));
        task.kizAccepted = true;
        assertTrue(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("ffullhab", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("platform", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 500, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 400, "", "task", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "other", "client", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "other", "FFL_BOX016", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "FFL_OTHER", task));
        assertFalse(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED", "task", "client", "", task));
    }

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
            "ffullhab",
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
            "ffullhab",
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
            "ffullhab",
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
            "ffullhab",
            true,
            true,
            false,
            acceptedBarcode,
            "original-order",
            "FFL_LKB1007_166",
            updated.task
        ));
    }

    @Test
    public void ourSuccessfulBoxSwitchDoesNotRequireCountingThePreviousBox() {
        // TEST: 15 September, Marifat: 1009_25 -> BOX_0144; the recount was 27/27.
        TsdFbsAssemblyResponse.Task next = task("5769475500", storageBox("FFL_LKBBOX_0144", 1));
        next.scannedBoxCode = "FFL_LKBBOX_0144";
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            "logoff", true, true, false, false, "5768315844", "FFL_LKBS1009_25", next));
        // TEST: the other observed transition, 1009_13 -> BOX_0203, has the same cause.
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            "logoff", true, true, false, false, "5768594421", "FFL_LKBS1009_13",
            task("5770002919", storageBox("FFL_LKBBOX_0203", 1))));
    }

    @Test
    public void releaseAfterCompletedAuditDoesNotReuseThePreAuditBoxConfirmation() {
        // TEST: BAL1007_005 was validated at 17:04:02 and released at 17:04:51 MSK.
        boolean confirmed = true;
        if (FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "FFL_BAL1007_005", "worker-device", "FFL_BAL1007_005", "worker-device")) {
            confirmed = false;
        }
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            "logoff", confirmed, true, true, false, "task", "FFL_BAL1007_005", null));
    }

    @Test
    public void completionOnlyClearsOurMatchingBoxAndOwner() {
        // TEST: completing another box or another worker's session cannot clear this confirmation.
        assertTrue(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "FFL_BOX_25", "owner", "]C1FFL_BOX_25", "owner"));
        for (String flavor : Arrays.asList("ffullhab", "platform")) {
            assertFalse(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
                flavor, "FFL_BOX_25", "owner", "FFL_BOX_25", "owner"));
            assertTrue(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
                flavor, true, true, false, false, "old", "FFL_BOX_25", task("new")));
        }
        assertFalse(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "FFL_BOX_26", "owner", "FFL_BOX_25", "owner"));
        assertFalse(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "FFL_BOX_25", "other-owner", "FFL_BOX_25", "owner"));
        assertFalse(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "", "owner", "", "owner"));
        assertFalse(FbsTaskSafety.shouldClearConfirmedBoxAfterAudit(
            "logoff", "FFL_BOX_25", "", "FFL_BOX_25", ""));
    }

    @Test
    public void newProblemAfterFreshBoxScanStillRequiresAudit() {
        // TEST: a fresh confirmed scan followed by an explicit problem retains its check.
        assertTrue(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            "logoff", true, true, true, false, "task", "FFL_BOX_25", null));
        assertFalse(FbsTaskSafety.shouldQueueMandatoryAuditAfterTaskSwitch(
            "logoff", false, true, true, false, "task", "FFL_BOX_25", null));
        // TEST: successful navigation never suppresses a NEW server-reported KIZ discrepancy.
        TsdFbsAssemblyResponse.Task current = task("task");
        current.scannedBoxCode = "FFL_BOX_25";
        current.client = new TsdFbsAssemblyResponse.Client(); current.client.id = "client";
        assertTrue(FbsTaskSafety.requiresKizAudit("logoff", 400, "FBS_STOCK_AUDIT_REQUIRED",
            "task", "client", "FFL_BOX_25", current));
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
