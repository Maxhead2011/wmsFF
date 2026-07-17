package pro.logoff.wms.mobile.ui;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class StatusLabels {
    private static final Map<String, String> VALUES;

    static {
        Map<String, String> values = new HashMap<>();
        values.put("SUBMITTED", "Новая");
        values.put("IN_REVIEW", "На проверке");
        values.put("APPROVED", "Согласована");
        values.put("IN_WORK", "В работе");
        values.put("PACKED", "Упакована");
        values.put("DONE", "Сдано");
        values.put("CANCELLED", "Отменена");
        values.put("REJECTED", "Отклонена");
        values.put("DRAFT", "Черновик");
        values.put("ISSUED", "Выставлен");
        values.put("PAID", "Оплачен");
        values.put("ACTIVE", "Активен");
        VALUES = Collections.unmodifiableMap(values);
    }

    private StatusLabels() {}

    public static String label(String value) {
        String label = VALUES.get(value);
        return label == null ? value : label;
    }
}
