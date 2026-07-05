package pro.logoff.wms.tsd.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [OperationEntity::class], version = 1, exportSchema = false)
abstract class TsdDatabase : RoomDatabase() {
    abstract fun operationDao(): OperationDao

    companion object {
        @Volatile
        private var instance: TsdDatabase? = null

        fun get(context: Context): TsdDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    TsdDatabase::class.java,
                    "logoff_wms_tsd.db",
                ).build().also { instance = it }
            }
    }
}
