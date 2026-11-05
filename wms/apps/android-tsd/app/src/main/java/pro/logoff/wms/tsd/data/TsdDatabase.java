package pro.logoff.wms.tsd.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.migration.Migration;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.sqlite.db.SupportSQLiteDatabase;

@Database(entities = {OperationEntity.class}, version = 2, exportSchema = false)
public abstract class TsdDatabase extends RoomDatabase {
    private static final java.util.Map<String, TsdDatabase> instances = new java.util.HashMap<>();
    private static final Migration MIGRATION_1_2 = new Migration(1, 2) {
        @Override
        public void migrate(SupportSQLiteDatabase database) {
            // Схема очереди не менялась, миграция нужна, чтобы не терять несинхронизированные операции.
        }
    };

    public abstract OperationDao operationDao();

    public static synchronized TsdDatabase get(Context context) {
        // Room singleton identity follows the selected server's database path.
        Context app = context.getApplicationContext();
        String path = app.getDatabasePath("logoff_wms_tsd.db").getAbsolutePath();
        TsdDatabase database = instances.get(path);
        if (database == null) {
            database = Room.databaseBuilder(app, TsdDatabase.class, "logoff_wms_tsd.db")
                .addMigrations(MIGRATION_1_2).build();
            instances.put(path, database);
        }
        return database;
    }
}
