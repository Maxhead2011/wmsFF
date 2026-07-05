package pro.logoff.wms.tsd.sync

import pro.logoff.wms.tsd.data.OperationOutbox
import pro.logoff.wms.tsd.data.PendingOperation
import pro.logoff.wms.tsd.network.TsdOperationRequest
import pro.logoff.wms.tsd.network.TsdOperationResponse
import pro.logoff.wms.tsd.network.TsdSyncRequest
import pro.logoff.wms.tsd.network.WmsApi
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException

data class TsdSyncSummary(
    val sent: Int,
    val applied: Int,
    val rejected: Int,
    val retried: Int,
    val message: String,
)

class TsdSyncRunner(
    private val outbox: OperationOutbox,
    private val api: WmsApi,
    private val deviceId: String,
) {
    suspend fun syncPending(authorization: String): TsdSyncSummary {
        val operations = outbox.pending()
        if (operations.isEmpty()) {
            return TsdSyncSummary(
                sent = 0,
                applied = 0,
                rejected = 0,
                retried = 0,
                message = "Нет операций для синхронизации",
            )
        }

        return runCatching {
            val responses = api.syncOperations(
                authorization = authorization,
                request = TsdSyncRequest(
                    operations = operations.map { it.toRequest(deviceId) },
                    deviceClock = Instant.now().toString(),
                ),
            )
            val byKey = responses.associateBy { it.operationKey }
            var applied = 0
            var rejected = 0
            var retried = 0
            val decisionMessages = mutableListOf<String>()

            operations.forEach { operation ->
                val response = byKey[operation.operationKey]
                val operatorMessage = response?.operatorMessage()
                when (response?.status) {
                    "APPLIED", "ACCEPTED", "ALREADY_APPLIED" -> {
                        outbox.markSynced(operation.operationKey, operatorMessage)
                        applied += 1
                        response.addDecisionMessage(operation, operatorMessage, decisionMessages)
                    }

                    "REJECTED" -> {
                        outbox.markRejected(operation.operationKey, operatorMessage ?: "Операция отклонена сервером")
                        rejected += 1
                        response.addDecisionMessage(operation, operatorMessage, decisionMessages)
                    }

                    "NEEDS_REVIEW" -> {
                        outbox.markRejected(operation.operationKey, operatorMessage ?: "Операция требует разбора")
                        rejected += 1
                        response.addDecisionMessage(operation, operatorMessage, decisionMessages)
                    }

                    else -> {
                        // Русский комментарий: неизвестный или отсутствующий ответ оставляем в pending, чтобы повторить sync.
                        outbox.markRetry(operation.operationKey, operatorMessage ?: "Нет ответа по операции")
                        retried += 1
                    }
                }
            }

            val summaryMessage = if (decisionMessages.isEmpty()) {
                "Синхронизация завершена"
            } else {
                "Синхронизация завершена. Решения: ${decisionMessages.take(2).joinToString("; ")}"
            }

            TsdSyncSummary(
                sent = operations.size,
                applied = applied,
                rejected = rejected,
                retried = retried,
                message = summaryMessage,
            )
        }.getOrElse { error ->
            if (error is CancellationException) {
                throw error
            }
            operations.forEach { operation ->
                outbox.markRetry(operation.operationKey, error.message ?: "Ошибка сети")
            }
            TsdSyncSummary(
                sent = operations.size,
                applied = 0,
                rejected = 0,
                retried = operations.size,
                message = error.message ?: "Ошибка синхронизации",
            )
        }
    }

    private fun PendingOperation.toRequest(deviceId: String): TsdOperationRequest =
        TsdOperationRequest(
            deviceId = deviceId,
            operationKey = operationKey,
            operationType = operationType,
            payload = payload,
        )

    private fun TsdOperationResponse.operatorMessage(): String? {
        val text = resolutionMessage ?: message
        val reason = reviewReason?.let(::reviewReasonLabel)
        return when {
            reason != null && text != null -> "$reason: $text"
            text != null -> text
            reason != null -> reason
            else -> null
        }
    }

    private fun TsdOperationResponse.addDecisionMessage(
        operation: PendingOperation,
        operatorMessage: String?,
        messages: MutableList<String>,
    ) {
        if (operatorMessage == null || reviewReason == null && resolutionMessage == null) {
            return
        }

        messages += "${operation.operationType}: $operatorMessage"
    }

    private fun reviewReasonLabel(reason: String): String =
        when (reason) {
            "INVENTORY_MISMATCH" -> "Расхождение инвентаризации"
            "SKU_NOT_FOUND" -> "SKU не найден"
            "BOX_NOT_FOUND" -> "Короб не найден"
            "RECEIPT_FAILED" -> "Ошибка приемки"
            "DEVICE_MISMATCH" -> "Не тот ТСД"
            "VALIDATION_ERROR" -> "Ошибка данных"
            "MANUAL_REJECT" -> "Ручное отклонение"
            "OTHER" -> "Другая причина"
            else -> reason
        }
}
