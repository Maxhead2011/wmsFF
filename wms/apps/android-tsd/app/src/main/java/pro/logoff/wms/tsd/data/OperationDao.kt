package pro.logoff.wms.tsd.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface OperationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(operation: OperationEntity)

    @Query(
        """
        SELECT * FROM tsd_operations
        WHERE status = :status
        ORDER BY createdAt ASC
        LIMIT :limit
        """,
    )
    suspend fun findByStatus(status: String, limit: Int): List<OperationEntity>

    @Query("SELECT COUNT(*) FROM tsd_operations WHERE status = :status")
    suspend fun countByStatus(status: String): Int

    @Query(
        """
        UPDATE tsd_operations
        SET status = :status,
            lastMessage = :message,
            lastTriedAt = :now,
            syncedAt = :syncedAt
        WHERE operationKey = :operationKey
        """,
    )
    suspend fun setTerminalStatus(
        operationKey: String,
        status: String,
        message: String?,
        now: Long,
        syncedAt: Long?,
    )

    @Query(
        """
        UPDATE tsd_operations
        SET status = :status,
            attempts = attempts + 1,
            lastMessage = :message,
            lastTriedAt = :now
        WHERE operationKey = :operationKey
        """,
    )
    suspend fun setRetryStatus(operationKey: String, status: String, message: String?, now: Long)

    @Query(
        """
        UPDATE tsd_operations
        SET status = :pendingStatus,
            lastMessage = NULL,
            syncedAt = NULL
        WHERE status = :rejectedStatus
        """,
    )
    suspend fun requeueRejected(pendingStatus: String, rejectedStatus: String): Int
}
