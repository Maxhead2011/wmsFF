package pro.logoff.wms.tsd.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.migration.Migration;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.sqlite.db.SupportSQLiteDatabase;

@Database(entities = {OperationEntity.class}, version = 2, exportSchema = false)
public abstract class TsdDatabase extends RoomDatabase {
    private static volatile TsdDatabase instance;
    private static final Migration MIGRATION_1_2 = new Migration(1, 2) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            // Схема очереди не менялась, миграция нужна, чтобы не терять несинхронизированные операции.
        }
    };

    public abstract OperationDao operationDao();

    public static TsdDatabase get(Context context) {
        if (instance == null) {
            synchronized (TsdDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                        context.getApplicationContext(),
                        TsdDatabase.class,
                        "logoff_wms_tsd.db"
                    )
                    .addMigrations(MIGRATION_1_2)
                    .build();
                }
            }
        }
        return instance;
    }
}
