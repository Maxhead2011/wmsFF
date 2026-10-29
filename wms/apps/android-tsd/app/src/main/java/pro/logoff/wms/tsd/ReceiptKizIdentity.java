package pro.logoff.wms.tsd;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Client-scoped comparison shared by receipt modes. */
public final class ReceiptKizIdentity {
    private static final Pattern IDENTITY = Pattern.compile("^(01\\d{14}21(?:[^\\x00-\\x1f]{13}|[^\\x00-\\x1f]{6}))(?=$|\\x1d|91[^\\x00-\\x1f]{4}(?:\\x1d)?92)");
    private ReceiptKizIdentity() { }
    public static String key(String clientId, String value, boolean enabled) {
        String raw = value == null ? "" : value.trim();
        if (!enabled) return raw.toUpperCase(Locale.ROOT);
        // FIX: never uppercase a serial; scanner/crypto representation is not physical identity.
        String normalized = raw.replaceFirst("(?i)^\\]d2", "").replaceAll("(?i)<GS>", "\u001d");
        Matcher matcher = IDENTITY.matcher(normalized);
        return clientId + "\u0000" + (matcher.find() ? matcher.group(1) : normalized);
    }
}
