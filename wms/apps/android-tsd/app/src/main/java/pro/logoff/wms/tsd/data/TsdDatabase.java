package pro.logoff.wms.tsd.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(entities = {OperationEntity.class}, version = 1, exportSchema = false)
public abstract class TsdDatabase extends RoomDatabase {
    private static volatile TsdDatabase instance;

    public abstract OperationDao operationDao();

    public static TsdDatabase get(Context context) {
        if (instance == null) {
            synchronized (TsdDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                        context.getApplicationContext(),
                        TsdDatabase.class,
                        "logoff_wms_tsd.db"
                    ).build();
                }
            }
        }
        return instance;
    }
}
