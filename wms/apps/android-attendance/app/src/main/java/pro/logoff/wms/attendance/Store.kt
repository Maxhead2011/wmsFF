package pro.logoff.wms.attendance

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.*
import kotlinx.coroutines.flow.Flow
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Entity(tableName = "employees")
data class Employee(
    @PrimaryKey val id: String,
    val name: String,
    val warehouseId: String,
    val loader: Boolean,
    val active: Boolean = true,
    val openSince: Long? = null,
    val revision: Long = 0,
    val distinguishing: String = "",
)

@Entity(tableName = "events", indices = [Index("employeeId")])
data class Event(
    @PrimaryKey val id: String,
    val employeeId: String,
    val deviceId: String,
    val warehouseId: String,
    val kind: String,
    val capturedAt: Long,
    val elapsedAt: Long,
    val offsetMs: Long?,
    val lastSyncAt: Long?,
    val photoPath: String? = null,
    val photoHash: String? = null,
    val payload: String = "{}",
    val status: String = "PENDING",
    val reason: String = "",
)

@Dao
interface AttendanceDao {
    @Query("SELECT * FROM employees ORDER BY name") fun employees(): Flow<List<Employee>>
    @Query("SELECT * FROM employees WHERE id=:id") suspend fun employee(id: String): Employee?
    @Query("SELECT * FROM employees") suspend fun allEmployees(): List<Employee>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putEmployees(rows: List<Employee>)
    @Query("DELETE FROM employees") suspend fun clearEmployees()
    @Query("SELECT * FROM events ORDER BY capturedAt, rowid") fun events(): Flow<List<Event>>
    @Query("SELECT * FROM events WHERE status='PENDING' ORDER BY capturedAt, rowid") suspend fun pending(): List<Event>
    @Query("SELECT * FROM events WHERE status='REVIEW'") suspend fun reviews(): List<Event>
    @Query("SELECT * FROM events WHERE id=:id") suspend fun event(id: String): Event?
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(event: Event)
    @Query("UPDATE events SET status=:status, reason=:reason WHERE id=:id")
    suspend fun result(id: String, status: String, reason: String)
}

// FIX: durable outbox, no destructive migrations and no automatic deletion of unsent photos.
@Database(entities = [Employee::class, Event::class], version = 1, exportSchema = true)
abstract class AttendanceDb : RoomDatabase() {
    abstract fun dao(): AttendanceDao
    companion object {
        fun open(context: Context) = Room.databaseBuilder(context, AttendanceDb::class.java, "attendance.db").build()
    }
}

data class Device(val id: String, val warehouseId: String, val warehouseName: String, val name: String, val token: String)

class DeviceStore(context: Context) {
    private val prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("attendance-token", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("attendance-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun device(): Device? {
        val id = prefs.getString("id", null) ?: return null
        val bytes = Base64.decode(prefs.getString("token", ""), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        val token = String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        return Device(id, prefs.getString("warehouse", "")!!, prefs.getString("branchName", "")!!, prefs.getString("name", "")!!, token)
    }
    fun save(device: Device) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.iv + cipher.doFinal(device.token.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("id", device.id).putString("warehouse", device.warehouseId)
            .putString("branchName", device.warehouseName).putString("name", device.name)
            .putString("token", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Не удалось сохранить регистрацию" }
    }
    var syncMessage: String
        get() = prefs.getString("syncMessage", "Ещё не синхронизировано")!!
        set(value) { prefs.edit().putString("syncMessage", value).apply() }
    val offsetMs: Long? get() = if (prefs.contains("offset")) prefs.getLong("offset", 0) else null
    val syncedAt: Long? get() = if (prefs.contains("synced")) prefs.getLong("synced", 0) else null
    fun time(serverMs: Long, localMs: Long) { prefs.edit().putLong("offset", serverMs - localMs).putLong("synced", localMs).apply() }
}

// FIX: pending local marks determine the next action even while disconnected.
fun projectedOpen(employee: Employee, events: List<Event>): Long? {
    var open = employee.openSince
    events.filter { it.employeeId == employee.id && it.status == "PENDING" }.sortedBy { it.capturedAt }.forEach {
        if (it.kind == "CLOCK_IN") open = it.capturedAt
        if (it.kind == "CLOCK_OUT") open = null
    }
    return open
}

fun retryableHttp(code: Int) = code == 408 || code == 425 || code == 429 || code in 500..599
