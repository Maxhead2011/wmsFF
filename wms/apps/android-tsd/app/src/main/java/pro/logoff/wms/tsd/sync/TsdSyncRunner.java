package pro.logoff.wms.tsd.sync;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import pro.logoff.wms.tsd.data.OperationOutbox;
import pro.logoff.wms.tsd.data.PendingOperation;
import pro.logoff.wms.tsd.network.TsdOperationRequest;
import pro.logoff.wms.tsd.network.TsdOperationResponse;
import pro.logoff.wms.tsd.network.TsdSyncRequest;
import pro.logoff.wms.tsd.network.WmsApi;
import retrofit2.Response;

public class TsdSyncRunner {
    private final OperationOutbox outbox;
    private final WmsApi api;
    private final String deviceId;

    public TsdSyncRunner(OperationOutbox outbox, WmsApi api, String deviceId) {
        this.outbox = outbox;
        this.api = api;
        this.deviceId = deviceId;
    }

    public TsdSyncSummary syncPending(String authorization) {
        List<PendingOperation> operations = outbox.pending();
        if (operations.isEmpty()) {
            return new TsdSyncSummary(0, 0, 0, 0, "Нет операций для синхронизации");
        }

        try {
            List<TsdOperationRequest> requests = new ArrayList<>();
            for (PendingOperation operation : operations) {
                requests.add(toRequest(operation));
            }

            Response<List<TsdOperationResponse>> response = api
                .syncOperations(authorization, new TsdSyncRequest(requests, Instant.now().toString()))
                .execute();
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }

            List<TsdOperationResponse> responses = response.body();
            if (responses == null) {
                responses = new ArrayList<>();
            }

            Map<String, TsdOperationResponse> byKey = new HashMap<>();
            for (TsdOperationResponse item : responses) {
                byKey.put(item.operationKey, item);
            }

            int applied = 0;
            int rejected = 0;
            int retried = 0;
            List<String> decisionMessages = new ArrayList<>();

            for (PendingOperation operation : operations) {
                TsdOperationResponse item = byKey.get(operation.operationKey);
                String operatorMessage = operatorMessage(item);
                String status = item == null ? null : item.status;
                if ("APPLIED".equals(status) || "ACCEPTED".equals(status) || "ALREADY_APPLIED".equals(status)) {
                    outbox.markSynced(operation.operationKey, operatorMessage);
                    applied++;
                    addDecisionMessage(item, operation, operatorMessage, decisionMessages);
                } else if ("REJECTED".equals(status)) {
                    outbox.markRejected(operation.operationKey, operatorMessage == null ? "Операция отклонена сервером" : operatorMessage);
                    rejected++;
                    addDecisionMessage(item, operation, operatorMessage, decisionMessages);
                } else if ("NEEDS_REVIEW".equals(status)) {
                    outbox.markRejected(operation.operationKey, operatorMessage == null ? "Операция требует разбора" : operatorMessage);
                    rejected++;
                    addDecisionMessage(item, operation, operatorMessage, decisionMessages);
                } else {
                    outbox.markRetry(operation.operationKey, operatorMessage == null ? "Нет ответа по операции" : operatorMessage);
                    retried++;
                }
            }

            String summaryMessage;
            if (decisionMessages.isEmpty()) {
                summaryMessage = "Синхронизация завершена";
            } else {
                summaryMessage = "Синхронизация завершена. Решения: " + firstMessages(decisionMessages);
            }

            return new TsdSyncSummary(operations.size(), applied, rejected, retried, summaryMessage);
        } catch (Exception error) {
            for (PendingOperation operation : operations) {
                outbox.markRetry(operation.operationKey, error.getMessage() == null ? "Ошибка сети" : error.getMessage());
            }
            return new TsdSyncSummary(
                operations.size(),
                0,
                0,
                operations.size(),
                error.getMessage() == null ? "Ошибка синхронизации" : error.getMessage()
            );
        }
    }

    private TsdOperationRequest toRequest(PendingOperation operation) {
        return new TsdOperationRequest(deviceId, operation.operationKey, operation.operationType, operation.payload);
    }

    private String operatorMessage(TsdOperationResponse response) {
        if (response == null) {
            return null;
        }

        String text = response.resolutionMessage != null ? response.resolutionMessage : response.message;
        String reason = response.reviewReason == null ? null : reviewReasonLabel(response.reviewReason);
        if (reason != null && text != null) {
            return reason + ": " + text;
        }
        if (text != null) {
            return text;
        }
        return reason;
    }

    private void addDecisionMessage(
        TsdOperationResponse response,
        PendingOperation operation,
        String operatorMessage,
        List<String> messages
    ) {
        if (response == null || operatorMessage == null) {
            return;
        }
        if (response.reviewReason == null && response.resolutionMessage == null) {
            return;
        }

        messages.add(operation.operationType + ": " + operatorMessage);
    }

    private String reviewReasonLabel(String reason) {
        switch (reason) {
            case "INVENTORY_MISMATCH":
                return "Расхождение инвентаризации";
            case "SKU_NOT_FOUND":
                return "SKU не найден";
            case "BOX_NOT_FOUND":
                return "Короб не найден";
            case "RECEIPT_FAILED":
                return "Ошибка приемки";
            case "DEVICE_MISMATCH":
                return "Не тот ТСД";
            case "VALIDATION_ERROR":
                return "Ошибка данных";
            case "MANUAL_REJECT":
                return "Ручное отклонение";
            case "OTHER":
                return "Другая причина";
            default:
                return reason;
        }
    }

    private String firstMessages(List<String> messages) {
        StringBuilder builder = new StringBuilder();
        int limit = Math.min(2, messages.size());
        for (int index = 0; index < limit; index++) {
            if (index > 0) {
                builder.append("; ");
            }
            builder.append(messages.get(index));
        }
        return builder.toString();
    }
}
