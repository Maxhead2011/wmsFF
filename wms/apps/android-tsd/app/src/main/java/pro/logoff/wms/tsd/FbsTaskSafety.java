package pro.logoff.wms.tsd;

import java.util.Locale;

import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

final class FbsTaskSafety {
    private FbsTaskSafety() {
    }

    static boolean isStaleTaskConflict(int httpStatus, String errorCode) {
        return httpStatus == 409 && "FBS_TASK_STALE".equals(errorCode);
    }

    // ADDED: Clear only a rejected product barcode. KIZ, authorization,
    // throttling, server and stale-task errors must preserve their input.
    static boolean shouldClearRejectedBarcode(
        String action,
        String state,
        int httpStatus
    ) {
        if (httpStatus != 400 && httpStatus != 422) return false;
        if (!"scan-any".equals(action) && !"scan-barcode".equals(action)) return false;
        return "SCAN_BARCODE".equals(state)
            || "SCAN_SOURCE_BARCODE".equals(state)
            || "SCAN_RELABEL_BARCODE".equals(state);
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

    static boolean shouldQueueMandatoryAuditAfterTaskSwitch(
        boolean previousBoxWasLocallyConfirmed,
        boolean previousBoxWasNotPicked,
        boolean releaseAction,
        boolean updatedTaskAcceptedBarcode,
        String previousTaskId,
        String previousBoxCode,
        TsdFbsAssemblyResponse.Task updatedTask
    ) {
        if (!previousBoxWasLocallyConfirmed) return false;
        if (releaseAction) return !normalizeBox(previousBoxCode).isEmpty();

        // FIX: успешный ШК уже доказывает, что сотрудник взял нужный товар из
        // открытого короба. Переключение размера/заказа не является недостачей.
        if (updatedTaskAcceptedBarcode) return false;

        boolean switchedToAnotherTask = updatedTask == null
            || !nonEmpty(previousTaskId).equals(nonEmpty(updatedTask.id));
        if (!previousBoxWasNotPicked || !switchedToAnotherTask) return false;

        // FIX: скан другого нужного размера может законно переключить FBS-заказ,
        // но физический короб остаётся тем же. В этом случае инвентаризация не нужна.
        return !taskCanUseBox(updatedTask, previousBoxCode);
    }

    static boolean taskAcceptedScannedBarcode(
        String action,
        String scannedValue,
        TsdFbsAssemblyResponse updated
    ) {
        if (updated == null || updated.task == null) return false;
        if (!"scan-any".equals(action) && !"scan-barcode".equals(action)) return false;
        if (nonEmpty(scannedValue).isEmpty() || nonEmpty(updated.task.scannedBarcode).isEmpty()) return false;
        // FIX: the API can legitimately return SCAN_BOX while switching the order;
        // equality with scannedBarcode is the authoritative successful acceptance.
        return nonEmpty(scannedValue).equalsIgnoreCase(nonEmpty(updated.task.scannedBarcode));
    }

    private static boolean taskCanUseBox(
        TsdFbsAssemblyResponse.Task task,
        String boxCode
    ) {
        if (task == null || normalizeBox(boxCode).isEmpty()) return false;
        if (normalizeBox(boxCode).equals(normalizeBox(task.scannedBoxCode))) return true;
        if (task.storageBoxes == null) return false;
        for (TsdFbsAssemblyResponse.StorageBox storageBox : task.storageBoxes) {
            if (
                storageBox != null
                    && storageBox.quantity > 0
                    && normalizeBox(boxCode).equals(normalizeBox(storageBox.code))
            ) {
                return true;
            }
        }
        return false;
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
