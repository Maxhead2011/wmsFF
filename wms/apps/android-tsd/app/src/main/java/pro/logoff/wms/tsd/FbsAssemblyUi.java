package pro.logoff.wms.tsd;

final class FbsAssemblyUi {
    private FbsAssemblyUi() {
    }

    static boolean shouldUseGuidedScanDialog(String state) {
        // FIX: после короба ШК и КИЗ сканируются в отдельном рабочем окне.
        return "SCAN_BARCODE".equals(state) || "SCAN_KIZ".equals(state);
    }
}
