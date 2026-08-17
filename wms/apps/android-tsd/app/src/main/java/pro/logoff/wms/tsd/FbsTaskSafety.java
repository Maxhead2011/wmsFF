package pro.logoff.wms.tsd;

import java.util.Locale;

final class FbsTaskSafety {
    private FbsTaskSafety() {
    }

    static boolean isStaleTaskConflict(int httpStatus, String errorCode) {
        return httpStatus == 409 && "FBS_TASK_STALE".equals(errorCode);
    }

    static boolean matchesConfirmedBox(
        String taskId,
        String boxCode,
        String ownerKey,
        String confirmedTaskId,
        String confirmedBoxCode,
        String confirmedOwnerKey
    ) {
        return nonEmpty(taskId).equals(nonEmpty(confirmedTaskId))
            && !nonEmpty(taskId).isEmpty()
            && normalizeBox(boxCode).equals(normalizeBox(confirmedBoxCode))
            && !normalizeBox(boxCode).isEmpty()
            && nonEmpty(ownerKey).equals(nonEmpty(confirmedOwnerKey))
            && !nonEmpty(ownerKey).isEmpty();
    }

    static boolean isConfirmedBoxScan(
        String action,
        String scannedValue,
        String responseTaskId,
        String responseBoxCode
    ) {
        if (!"scan-any".equals(action) && !"scan-box".equals(action)) return false;
        if (nonEmpty(responseTaskId).isEmpty()) return false;
        String scannedBox = normalizeBox(scannedValue);
        String responseBox = normalizeBox(responseBoxCode);
        return !scannedBox.isEmpty() && scannedBox.equals(responseBox);
    }

    static boolean mandatoryAuditCanResume(
        String sessionStatus,
        String boxStatus,
        int pendingDifferences
    ) {
        if (pendingDifferences > 0) return false;
        String normalizedSession = nonEmpty(sessionStatus).toUpperCase(Locale.ROOT);
        String normalizedBox = nonEmpty(boxStatus).toUpperCase(Locale.ROOT);
        boolean sessionCanFinish = "ACTIVE".equals(normalizedSession)
            || "REVIEW".equals(normalizedSession)
            || "COMPLETED".equals(normalizedSession);
        boolean boxResolved = "MATCHED".equals(normalizedBox) || "RESOLVED".equals(normalizedBox);
        return sessionCanFinish && boxResolved;
    }

    static boolean mandatoryAuditAlreadyCompleted(String sessionStatus) {
        return "COMPLETED".equals(nonEmpty(sessionStatus).toUpperCase(Locale.ROOT));
    }

    private static String normalizeBox(String value) {
        String source = nonEmpty(value).trim();
        if (source.matches("^][A-Za-z][0-9].*")) {
            source = source.substring(3);
        }
        StringBuilder normalized = new StringBuilder();
        for (int index = 0; index < source.length(); index += 1) {
            char current = source.charAt(index);
            if (Character.isLetterOrDigit(current)) {
                normalized.append(Character.toString(current).toUpperCase(Locale.ROOT));
            }
        }
        return normalized.toString();
    }

    private static String nonEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
