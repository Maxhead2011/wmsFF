package pro.logoff.wms.mobile.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(entities = {CacheEntry.class, PendingAction.class}, version = 1, exportSchema = false)
public abstract class AppDatabase extends RoomDatabase {
    private static volatile AppDatabase instance;
    public abstract CacheDao cacheDao();

    public static AppDatabase get(Context context) {
        if (instance == null) {
            synchronized (AppDatabase.class) {
                if (instance == null) instance = Room.databaseBuilder(context.getApplicationContext(), AppDatabase.class, "logoff-mobile.db").build();
            }
        }
        return instance;
    }
}
