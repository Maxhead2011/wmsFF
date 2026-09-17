package pro.logoff.wms.tsd;

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
}
