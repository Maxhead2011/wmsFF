package pro.logoff.wms.tsd;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

final class FbsAssemblyUi {
    private FbsAssemblyUi() {
    }

    // FIX: prefer the current label over saved digits; never substitute an order ID.
    static String wbStickerNumber(pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse.Task task) {
        if (task == null || (task.marketplace != null && !task.marketplace.isEmpty()
            && !"WILDBERRIES".equalsIgnoreCase(task.marketplace))) return "";
        if (task.orderSticker != null) {
            String a = task.orderSticker.partA == null ? "" : task.orderSticker.partA.trim();
            String b = task.orderSticker.partB == null ? "" : task.orderSticker.partB.trim();
            String digits = (a + " " + b).trim();
            if (!digits.isEmpty()) return digits;
            if (task.orderSticker.barcode != null && !task.orderSticker.barcode.trim().isEmpty())
                return task.orderSticker.barcode.trim();
        }
        return task.wbStickerNumber == null ? "" : task.wbStickerNumber.trim();
    }

    // FIX: the new button is enabled only after both app and API support physical picking.
    static boolean usesPhysicalPickConfirmation(String flavor, String marketplace, boolean supported) {
        return supported && "logoff".equals(flavor) &&
            ("OZON".equalsIgnoreCase(marketplace) || "WILDBERRIES".equalsIgnoreCase(marketplace));
    }

    static boolean shouldUseGuidedScanDialog(String state) {
        // FIX: после короба ШК и КИЗ сканируются в отдельном рабочем окне.
        return "SCAN_BARCODE".equals(state) || "SCAN_KIZ".equals(state) || "SCAN_NEW_KIZ".equals(state);
    }

    static boolean keepRemainingOrdersOpen(
        String previousTaskId,
        String currentTaskId,
        boolean wasOpen
    ) {
        // ADDED: обновление того же заказа сохраняет ручной выбор; новый заказ закрывает список.
        return wasOpen && currentTaskId != null && !currentTaskId.isEmpty() &&
            currentTaskId.equals(previousTaskId);
    }

    // FIX: route hints are useful for the final search, not for every order.
    static boolean showLateRouteHints(String flavor, TsdFbsAssemblyResponse.Progress progress) {
        // FIX: the sold terminal flavors keep their existing always-visible route.
        return !"logoff".equals(flavor) ||
            progress != null && progress.requestRemainingItems > 0 && progress.requestRemainingItems < 10;
    }

    static List<TsdFbsAssemblyResponse.StorageBox> alternateStorageBoxes(TsdFbsAssemblyResponse.Task task) {
        if (task == null || task.storageBoxes == null) return Collections.emptyList();
        List<TsdFbsAssemblyResponse.StorageBox> result = new ArrayList<>();
        for (TsdFbsAssemblyResponse.StorageBox box : task.storageBoxes) {
            if (box == null || box.code == null || box.quantity <= 0) continue;
            if (task.recommendedBoxCode != null && box.code.equalsIgnoreCase(task.recommendedBoxCode)) continue;
            result.add(box);
        }
        return result;
    }
}
