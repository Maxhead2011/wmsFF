package pro.logoff.wms.soswb;
final class DuplicatePrintState {
    // FIX: while a print is pending, only the saved idempotent request may be resent.
    static boolean canSubmit(String stage, boolean savedRequest) {
        return stage.equals("READY") || stage.equals("WAIT") && savedRequest;
    }
    static boolean canScan(String stage) {
        return stage.equals("KIZ") || stage.equals("BARCODE") || stage.equals("VERIFY");
    }
    static String label(String status) {
        switch(status) {
            case "QUEUED": return "В очереди";
            case "CLAIMED": return "Принято станцией";
            case "PRINTED": return "Передано в печать";
            case "VERIFIED": return "Проверено сканированием";
            case "FAILED": return "Ошибка печати";
            default: return "Проверьте состояние";
        }
    }
}
