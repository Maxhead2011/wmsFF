package pro.logoff.wms.mobile.data;

import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface CacheDao {
    @Query("SELECT * FROM mobile_cache WHERE `key` = :key LIMIT 1") CacheEntry get(String key);
    @Insert(onConflict = OnConflictStrategy.REPLACE) void put(CacheEntry entry);
    @Query("DELETE FROM mobile_cache") void clearCache();
    @Query("SELECT * FROM pending_actions ORDER BY createdAt ASC LIMIT 100") List<PendingAction> pending();
    @Insert long enqueue(PendingAction action);
    @Delete void remove(PendingAction action);
    @Query("UPDATE pending_actions SET attempts = attempts + 1 WHERE id = :id") void failed(long id);
}
