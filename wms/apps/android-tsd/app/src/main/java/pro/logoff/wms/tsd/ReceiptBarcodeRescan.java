package pro.logoff.wms.tsd;

// FIX: a second physical scan confirms one unit; it must never count as a second item.
public final class ReceiptBarcodeRescan {
    private String context = "", first = "", confirmed = "", message = "";
    public static boolean suspicious(String code) {
        if (!code.matches("[0-9]{12,14}")) return true;
        int sum = 0, weight = 3;
        for (int i = code.length() - 2; i >= 0; i--) { sum += (code.charAt(i) - '0') * weight; weight = weight == 3 ? 1 : 3; }
        return (10 - sum % 10) % 10 != code.charAt(code.length() - 1) - '0';
    }
    public boolean scan(String scope, String code) {
        if (!scope.equals(context)) { clear(); context = scope; }
        if (!first.isEmpty()) {
            if (first.equals(code)) { confirmed = code; first = ""; message = ""; return true; }
            message = "ШК различаются: «" + first + "» и «" + code + "». Проверьте этикетку и повторите последний скан.";
            first = code; confirmed = ""; return false;
        }
        confirmed = "";
        if (!suspicious(code)) return true;
        first = code; message = "Необычный штрихкод «" + code + "». Отсканируйте этикетку повторно. Товар пока не принят.";
        return false;
    }
    public String message() { return message; }
    public String evidence() { return confirmed; }
    public boolean waiting() { return !first.isEmpty(); }
    public void clear() { first = ""; confirmed = ""; message = ""; context = ""; }
}
