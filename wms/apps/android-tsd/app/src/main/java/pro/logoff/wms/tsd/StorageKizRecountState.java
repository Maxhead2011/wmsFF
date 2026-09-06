package pro.logoff.wms.tsd;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** FIX: physical recount stays separate from the normal one-unit transfer state. */
public final class StorageKizRecountState {
    private final LinkedHashMap<String, String> scans = new LinkedHashMap<>();
    private String key = "tsd-recount:" + UUID.randomUUID();
    private String snapshot = "";
    private boolean adminRelease, adminConfirmationRequired, adminConfirmed, adminAbort;

    public boolean add(String value) {
        if (ready()) throw new IllegalStateException("Список уже проверен. Подтвердите или отмените сверку.");
        String raw = value == null ? "" : value.trim();
        String normalized = raw.replaceFirst("(?i)^\\]d2", "").replaceAll("(?i)<GS>", "\u001d")
            .replaceFirst("^\\(01\\)(\\d{14})\\(21\\)", "01$121")
            .replaceFirst("^(01\\d{14})\u001d21", "$121");
        Matcher parsed = Pattern.compile("^01(\\d{14})21([^\u001d\\s]+)(?:\u001d|$)").matcher(normalized);
        if (!parsed.find() || normalized.length() < 21 || normalized.length() > 135) throw new IllegalArgumentException("Сканируйте полный КИЗ товара.");
        String serial = parsed.group(2);
        if (serial.length() > 20 && serial.substring(13).startsWith("91")) serial = serial.substring(0, 13);
        if (serial.isEmpty() || serial.length() > 20) throw new IllegalArgumentException("Неполный КИЗ. Повторите скан.");
        String identity = parsed.group(1) + ":" + serial;
        if (scans.containsKey(identity)) return false;
        if (scans.size() >= 200) throw new IllegalArgumentException("Не более 200 КИЗов за сверку.");
        scans.put(identity, raw);
        return true;
    }

    public List<String> scans() { return new ArrayList<>(scans.values()); }
    public String operationKey() { return key; }
    public String snapshot() { return snapshot; }
    public boolean ready() { return !snapshot.isEmpty(); }
    public void ready(String value) {
        if (scans.isEmpty() || value == null || value.isEmpty()) throw new IllegalStateException("Нет полного списка или проверки WMS.");
        snapshot = value;
    }
    public boolean adminRelease() { return adminRelease; }
    public boolean adminConfirmationRequired() { return adminConfirmationRequired; }
    public boolean adminConfirmed() { return adminConfirmed; }
    public boolean adminAbort() { return adminAbort; }
    public void abortAdministrator() {
        if (!ready() || !adminRelease || !adminConfirmed) throw new IllegalStateException("Нет подтверждённой административной сверки.");
        adminAbort = true;
    }
    public void ready(String value, boolean release, boolean confirmationRequired) {
        ready(value); adminRelease = release; adminConfirmationRequired = confirmationRequired; adminConfirmed = false; adminAbort = false;
    }
    public void confirmAdministrator() {
        if (!ready() || !adminConfirmationRequired) throw new IllegalStateException("Нет административного решения для подтверждения.");
        adminConfirmed = true;
    }
    public void restoreAdminDecision(boolean release, boolean confirmed) {
        if (!ready()) throw new IllegalStateException("Нет сохранённой сверки.");
        adminRelease = release; adminConfirmed = confirmed; adminConfirmationRequired = release || confirmed;
    }
    public void repeatPreview() { snapshot = ""; adminRelease = false; adminConfirmationRequired = false; adminConfirmed = false; adminAbort = false; }
    public static StorageKizRecountState restore(List<String> values, String snapshot, String key) {
        if (key == null || key.isEmpty()) throw new IllegalArgumentException("Нет номера сверки");
        StorageKizRecountState result = new StorageKizRecountState();
        for (String value : values) result.add(value);
        result.ready(snapshot); result.key = key;
        return result;
    }
}
