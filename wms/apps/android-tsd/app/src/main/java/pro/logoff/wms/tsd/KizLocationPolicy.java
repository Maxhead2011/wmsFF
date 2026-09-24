package pro.logoff.wms.tsd;

import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse;

final class KizLocationPolicy {
    private KizLocationPolicy() {}
    static boolean canOpen(String flavor, TsdSession session) {
        // FIX: only administrators and above in our installation can open this read-only screen.
        return "logoff".equals(flavor) && session != null &&
            (session.hasRole("ADMIN") || session.hasRole("OWNER") || session.hasRole("SUPER_ADMIN"));
    }
    static boolean readyToSubmit(String scan) {
        if (scan == null || scan.length() > 1024) return false;
        String value = scan.trim().replaceFirst("(?i)^\\]d2", "").replaceAll("(?i)<GS>", "\u001d")
            .replaceFirst("^\\(01\\)([0-9]{14})\\(21\\)", "01$121")
            .replaceFirst("^(01[0-9]{14})\u001d21", "$121");
        // Only auto-submit a complete clothing serial; other supported codes use Enter or the button.
        return value.matches("(?s)^01[0-9]{14}21[^\\s\\p{Cntrl}]{13}(?:\u001d.*|91.{4}.*)?$");
    }
    static String describe(TsdKizLocationResponse response) {
        if (response == null) return "Не удалось получить результат. Повторите проверку.";
        if (!response.found) return "КИЗ не найден в системе.";
        if (response.matches == null || response.matches.isEmpty()) return "Ответ сервера неполный. Повторите проверку.";
        StringBuilder text = new StringBuilder();
        if (response.ambiguous || response.matches.size() > 1) {
            text.append("КИЗ найден в нескольких записях. Проверьте привязки:\n\n");
        }
        for (TsdKizLocationResponse.Match match : response.matches) {
            if (match == null) continue;
            if (text.length() > 0 && !text.toString().endsWith("\n\n")) text.append("\n\n");
            TsdKizLocationResponse.Product p = match.product;
            text.append("Товар: ").append(p == null ? "не указан" : or(p.name, "не указан"));
            if (p != null) {
                if (present(p.article)) text.append("\nАртикул: ").append(p.article);
                if (present(p.size)) text.append("\nРазмер: ").append(p.size);
                if (present(p.color)) text.append("\nЦвет: ").append(p.color);
            }
            text.append("\nКороб: ").append(or(match.boxCode, "без привязки к коробу"));
            text.append("\nПаллет: ").append(or(match.palletCode, "не назначен"));
            text.append("\nПомещение: ").append(or(match.room, "не указано"));
            text.append("\nФилиал: ").append(or(match.warehouse, "не указан"));
            text.append("\nКлиент: ").append(or(match.client, "не указан"));
            text.append("\nСтатус: ").append(status(match.status));
            // FIX: only server evidence determines relabel/review; AVAILABLE does not erase history.
            if (match.reuse != null) {
                text.append("\nПроверка использования: ").append(or(match.reuse.message, "Нужна проверка"));
                if (match.reuse.history != null) for (TsdKizLocationResponse.History h : match.reuse.history) {
                    text.append("\nЗаявка: ").append(h.request == null ? "не указана" : String.valueOf(h.request.number));
                    text.append(" · Заказ WB: ").append(or(h.orderId, "не указан"));
                    text.append("\n").append(or(h.event, "Событие")).append(": ").append(date(h.at));
                    if (present(h.worker)) text.append("\nСканировал: ").append(h.worker);
                    if (present(h.supplyId)) text.append("\nПоставка WB: ").append(h.supplyId);
                }
            }
            if (present(match.locationWarning)) text.append("\n").append(match.locationWarning);
        }
        return text.toString();
    }
    private static String status(String value) {
        if ("AVAILABLE".equals(value)) return "Доступен";
        if ("RESERVED".equals(value)) return "В резерве";
        if ("PACKING".equals(value)) return "Упаковка — уже отобран";
        if ("SHIPPING".equals(value)) return "Отгрузка";
        if ("DEFECT".equals(value)) return "Брак";
        if ("QUARANTINE".equals(value)) return "Карантин";
        return or(value, "не указан");
    }
    private static String date(String value) {
        if (!present(value)) return "время не зафиксировано";
        try {
            java.text.SimpleDateFormat source = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT);
            source.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            java.text.SimpleDateFormat display = new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm:ss", java.util.Locale.ROOT);
            display.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Moscow"));
            return display.format(source.parse(value)) + " МСК";
        } catch (Exception error) { return value; }
    }
    private static boolean present(String value) { return value != null && !value.trim().isEmpty(); }
    private static String or(String value, String fallback) { return present(value) ? value : fallback; }
}
