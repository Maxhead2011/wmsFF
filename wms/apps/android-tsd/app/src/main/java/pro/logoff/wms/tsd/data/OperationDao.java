package pro.logoff.wms.tsd.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface OperationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insert(OperationEntity operation);

    // FIX: Room executes a multi-row insert atomically; retry preserves terminal rows.
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    void insertReceiptBatch(List<OperationEntity> operations);

    @Query("SELECT * FROM tsd_operations WHERE operationKey = :operationKey LIMIT 1")
    OperationEntity findByKey(String operationKey);

    @Query("SELECT * FROM tsd_operations WHERE operationKey IN (:keys) AND status = 'PENDING' ORDER BY createdAt ASC, operationKey ASC LIMIT 50")
    List<OperationEntity> findPendingReceiptBatch(List<String> keys);

    @Query("SELECT * FROM tsd_operations WHERE status = :status ORDER BY createdAt ASC LIMIT :limit")
    List<OperationEntity> findByStatus(String status, int limit);

    @Query("SELECT COUNT(*) FROM tsd_operations WHERE status = :status")
    int countByStatus(String status);

    @Query(
        "UPDATE tsd_operations " +
            "SET status = :status, lastMessage = :message, lastTriedAt = :now, syncedAt = :syncedAt " +
            "WHERE operationKey = :operationKey"
    )
    void setTerminalStatus(String operationKey, String status, String message, long now, Long syncedAt);

    @Query(
        "UPDATE tsd_operations " +
            "SET status = :status, attempts = attempts + 1, lastMessage = :message, lastTriedAt = :now " +
            "WHERE operationKey = :operationKey"
    )
    void setRetryStatus(String operationKey, String status, String message, long now);

    @Query(
        "UPDATE tsd_operations " +
            "SET status = :pendingStatus, lastMessage = NULL, syncedAt = NULL " +
            "WHERE status = :rejectedStatus"
    )
    int requeueRejected(String pendingStatus, String rejectedStatus);
}
