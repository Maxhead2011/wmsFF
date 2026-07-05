package pro.logoff.wms.tsd.data

import java.util.UUID

data class PendingOperation(
    val operationKey: String,
    val operationType: String,
    val payload: Map<String, String>,
    val createdAt: Long,
    val status: OperationStatus = OperationStatus.PENDING,
    val attempts: Int = 0,
    val lastMessage: String? = null,
)

data class OperationOutboxCounts(
    val pending: Int,
    val rejected: Int,
)

class OperationOutbox(private val dao: OperationDao) {
    suspend fun enqueueReceipt(
        clientId: String,
        barcode: String,
        boxCode: String,
        quantity: Int,
        status: String?,
        sourceDocument: String?,
        comment: String?,
    ): PendingOperation {
        val operation = PendingOperation(
            operationKey = UUID.randomUUID().toString(),
            operationType = "receipt_scan",
            // Русский комментарий: payload совпадает с backend DTO, чтобы offline outbox не требовал трансформаций при sync.
            payload = compactPayload(
                "clientId" to clientId,
                "barcode" to barcode,
                "boxCode" to boxCode,
                "quantity" to quantity.toString(),
                "status" to status,
                "sourceDocument" to sourceDocument,
                "comment" to comment,
            ),
            createdAt = System.currentTimeMillis(),
        )
        dao.insert(OperationEntity.fromPending(operation))
        return operation
    }

    suspend fun enqueueMove(
        clientId: String,
        barcode: String,
        fromBoxCode: String,
        toBoxCode: String,
        quantity: Int,
        status: String?,
        comment: String?,
    ): PendingOperation {
        val operation = PendingOperation(
            operationKey = UUID.randomUUID().toString(),
            operationType = "move_scan",
            // Русский комментарий: payload совпадает с backend DTO, чтобы offline outbox не требовал трансформаций при sync.
            payload = compactPayload(
                "clientId" to clientId,
                "barcode" to barcode,
                "fromBoxCode" to fromBoxCode,
                "toBoxCode" to toBoxCode,
                "quantity" to quantity.toString(),
                "status" to status,
                "comment" to comment,
            ),
            createdAt = System.currentTimeMillis(),
        )
        dao.insert(OperationEntity.fromPending(operation))
        return operation
    }

    suspend fun enqueueInventory(
        clientId: String,
        barcode: String,
        boxCode: String,
        countedQuantity: Int,
        status: String?,
    ): PendingOperation {
        val operation = PendingOperation(
            operationKey = UUID.randomUUID().toString(),
            operationType = "inventory_scan",
            payload = compactPayload(
                "clientId" to clientId,
                "barcode" to barcode,
                "boxCode" to boxCode,
                "countedQuantity" to countedQuantity.toString(),
                "status" to status,
            ),
            createdAt = System.currentTimeMillis(),
        )
        dao.insert(OperationEntity.fromPending(operation))
        return operation
    }

    suspend fun pending(limit: Int = 50): List<PendingOperation> =
        dao.findByStatus(OperationStatus.PENDING.name, limit).map { it.toPendingOperation() }

    suspend fun rejected(limit: Int = 25): List<PendingOperation> =
        dao.findByStatus(OperationStatus.REJECTED.name, limit).map { it.toPendingOperation() }

    suspend fun markSynced(operationKey: String, message: String?) {
        val now = System.currentTimeMillis()
        dao.setTerminalStatus(operationKey, OperationStatus.SYNCED.name, message, now, now)
    }

    suspend fun markRejected(operationKey: String, message: String?) {
        dao.setTerminalStatus(operationKey, OperationStatus.REJECTED.name, message, System.currentTimeMillis(), null)
    }

    suspend fun markRetry(operationKey: String, message: String?) {
        dao.setRetryStatus(operationKey, OperationStatus.PENDING.name, message, System.currentTimeMillis())
    }

    suspend fun requeueRejected(): Int =
        dao.requeueRejected(OperationStatus.PENDING.name, OperationStatus.REJECTED.name)

    suspend fun counts(): OperationOutboxCounts =
        OperationOutboxCounts(
            pending = dao.countByStatus(OperationStatus.PENDING.name),
            rejected = dao.countByStatus(OperationStatus.REJECTED.name),
        )

    private fun compactPayload(vararg pairs: Pair<String, String?>): Map<String, String> =
        pairs.mapNotNull { (key, value) ->
            val normalized = value?.trim()
            if (normalized.isNullOrEmpty()) null else key to normalized
        }.toMap()
}
