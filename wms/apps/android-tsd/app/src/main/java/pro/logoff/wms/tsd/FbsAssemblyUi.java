package pro.logoff.wms.tsd;

final class FbsAssemblyUi {
    private FbsAssemblyUi() {
    }

    static boolean shouldUseGuidedScanDialog(String state) {
        // FIX: после короба ШК и КИЗ сканируются в отдельном рабочем окне.
        return "SCAN_BARCODE".equals(state) || "SCAN_KIZ".equals(state);
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
