package pro.logoff.wms.tsd.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import org.json.JSONObject

@Entity(
    tableName = "tsd_operations",
    indices = [Index(value = ["status", "createdAt"])],
)
data class OperationEntity(
    @PrimaryKey val operationKey: String,
    val operationType: String,
    val payloadJson: String,
    val createdAt: Long,
    val status: String,
    val attempts: Int,
    val lastMessage: String?,
    val lastTriedAt: Long?,
    val syncedAt: Long?,
) {
    fun toPendingOperation(): PendingOperation =
        PendingOperation(
            operationKey = operationKey,
            operationType = operationType,
            payload = jsonToPayload(payloadJson),
            createdAt = createdAt,
            status = OperationStatus.valueOf(status),
            attempts = attempts,
            lastMessage = lastMessage,
        )

    companion object {
        fun fromPending(operation: PendingOperation): OperationEntity =
            OperationEntity(
                operationKey = operation.operationKey,
                operationType = operation.operationType,
                payloadJson = payloadToJson(operation.payload),
                createdAt = operation.createdAt,
                status = operation.status.name,
                attempts = operation.attempts,
                lastMessage = operation.lastMessage,
                lastTriedAt = null,
                syncedAt = null,
            )
    }
}

// Русский комментарий: payload храним JSON-строкой, чтобы Room не зависел от сетевой модели Retrofit.
fun payloadToJson(payload: Map<String, String>): String = JSONObject(payload).toString()

fun jsonToPayload(payloadJson: String): Map<String, String> {
    val payload = JSONObject(payloadJson)
    return payload.keys().asSequence().associateWith { key -> payload.optString(key) }
}
