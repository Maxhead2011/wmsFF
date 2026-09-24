package pro.logoff.wms.tsd;

import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

final class FbsRelabelPrintUi {
    private FbsRelabelPrintUi() {}

    // FIX: the button belongs to the FBS source-confirmed step, not the separate relabel menu.
    static boolean showPrintButton(String flavor, String state, TsdFbsAssemblyResponse.Task task) {
        return "logoff".equals(flavor) && "SCAN_RELABEL_BARCODE".equals(state) &&
            task != null && task.relabeling != null && task.relabeling.required &&
            task.relabeling.sourceBarcode != null && !task.relabeling.sourceBarcode.isEmpty() &&
            !targetBarcode(task).isEmpty();
    }

    static String targetBarcode(TsdFbsAssemblyResponse.Task task) {
        if (task == null || task.product == null || task.product.barcodes == null) return "";
        for (String barcode : task.product.barcodes) {
            if (barcode != null && !barcode.trim().isEmpty()) return barcode.trim();
        }
        return "";
    }
}
