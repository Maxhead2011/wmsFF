package pro.logoff.wms.tsd;

import android.graphics.Color;
import android.graphics.Typeface;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import pro.logoff.wms.tsd.network.TsdOperationResponse;
import pro.logoff.wms.tsd.network.TsdKizDuplicateInfo;

/** FIX: one red, blocking presentation for immediate and delayed receipt conflicts. */
public final class ReceiptKizWarningView {
    public static final int BACKGROUND = Color.rgb(254, 202, 202);
    private ReceiptKizWarningView() { }
    public static void render(LinearLayout root, TsdOperationResponse conflict) {
        root.setBackgroundColor(BACKGROUND);
        text(root, "ОТЛОЖИТЕ ТОВАР", 32, true);
        text(root, "ДУБЛЬ КИЗ — ТОВАР НЕ ПРИНЯТ", 23, true);
        TsdKizDuplicateInfo info = conflict.duplicateInfo;
        if (info != null) {
            text(root, "Ранее принят: " + date(info.firstReceivedAt), 21, false);
            text(root, "Короб при приёмке: " + known(info.firstBoxCode), 21, false);
            text(root, "Товар: " + known(info.productName), 21, false);
            if (info.barcode != null) text(root, "ШК: " + info.barcode, 21, false);
            text(root, "Сейчас: " + status(info.currentStatus), 21, false);
            if (info.currentBoxCode != null) text(root, "Текущий короб: " + info.currentBoxCode, 21, false);
            text(root, "КИЗ: " + known(info.identity == null ? conflict.kiz : info.identity), 18, false);
        } else if (conflict.message != null) text(root, conflict.message, 20, false);
        if (conflict.boxCode != null) text(root, "Отложить из короба приёмки: " + conflict.boxCode, 20, false);
        text(root, "Количество не увеличено. Решение — в «КИЗ → Проверки КИЗ».", 20, false);
    }
    private static void text(LinearLayout root, String value, int size, boolean bold) {
        TextView label = new TextView(root.getContext());
        label.setText(value); label.setTextSize(size); label.setTextColor(Color.rgb(90, 0, 0));
        label.setPadding(8, 10, 8, 10); if (bold) label.setTypeface(null, Typeface.BOLD);
        root.addView(label);
    }
    private static String known(String value) { return value == null || value.trim().isEmpty() ? "не установлено" : value; }
    public static String date(String value) {
        if (value == null || value.trim().isEmpty()) return "первоначальная приёмка не установлена";
        try { return DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss", Locale.forLanguageTag("ru"))
            .withZone(ZoneId.of("Europe/Moscow")).format(Instant.parse(value)) + " МСК"; }
        catch (RuntimeException error) { return "первоначальная приёмка не установлена"; }
    }
    private static String status(String value) {
        if (value == null) return "требуется проверка";
        switch (value) {
            case "AVAILABLE": return "на складе";
            case "RESERVED": return "зарезервирован";
            case "PACKING": return "в сборке / упаковке";
            case "SHIPPING": return "подготовлен к отгрузке";
            case "SHIPPED": return "отгружен";
            case "BLOCKED": return "заблокирован";
            case "QUARANTINE": return "карантин";
            default: return value;
        }
    }
}
