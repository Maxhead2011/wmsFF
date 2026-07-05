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
