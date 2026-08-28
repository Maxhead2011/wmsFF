package pro.logoff.wms.tsd;

import java.util.Locale;

final class OzonLabelSafety {
    private OzonLabelSafety() {
    }

    static boolean canRenderOnTsd(String contentType) {
        if (contentType == null) return false;
        String normalized = contentType.trim().toLowerCase(Locale.ROOT);
        // FIX: only decoded images may reach the ATOL view; PDF rendering can abort Android natively.
        return normalized.startsWith("image/") && !normalized.contains("pdf");
    }
}
