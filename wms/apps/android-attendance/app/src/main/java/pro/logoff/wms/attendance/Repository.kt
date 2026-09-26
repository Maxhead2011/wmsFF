package pro.logoff.wms.attendance

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.room.withTransaction
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(8192); while (true) {
        val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count)
    } }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

class AttendanceRepository(val db: AttendanceDb, private val photos: File) {
    val dao = db.dao()
    private val lock = Mutex()

    suspend fun mark(device: Device, employeeId: String, clockIn: Boolean, photo: File, captureTime: Long,
        elapsed: Long, offset: Long?, lastSync: Long?, eventId: String = UUID.randomUUID().toString()): Event = lock.withLock {
        dao.event(eventId)?.let { return@withLock it }
        require(photo.isFile && photo.length() in 1..(4 * 1024 * 1024)) { "Не удалось сохранить фото (максимум 4 МБ)" }
        require(captureTime > 0) { "Неверное время съёмки" }
        photos.mkdirs()
        val destination = File(photos, "$eventId.jpg")
        require(destination.parentFile?.canonicalFile == photos.canonicalFile) { "Неверный ID" }
        // FIX: fsync the photo before the database commit. A crash can leave an orphan, never a false success.
        FileInputStream(photo).use { input -> FileOutputStream(destination).use { out -> input.copyTo(out); out.fd.sync() } }
        try {
            db.withTransaction {
                val employee = dao.employee(employeeId) ?: error("Обновите список сотрудников")
                require(employee.active && employee.warehouseId == device.warehouseId) { "Сотрудник недоступен" }
                val open = projectedOpen(employee, dao.pending())
                require(clockIn == (open == null)) { "Состояние смены изменилось. Вернитесь к списку" }
                if (!clockIn) require(captureTime > open!!) { "Время ухода раньше прихода. Обратитесь к администратору" }
                Event(eventId, employeeId, device.id, device.warehouseId, if (clockIn) "CLOCK_IN" else "CLOCK_OUT",
                    captureTime, elapsed, offset, lastSync, destination.path, sha256(destination)).also { dao.insert(it) }
            }
        } catch (e: Exception) { if (dao.event(eventId) == null) destination.delete(); throw e }
    }

    suspend fun handling(device: Device, creator: String, participants: List<String>, pallets: String, start: Long,
        type: String, comment: String, offset: Long?, lastSync: Long?, eventId: String): Event = lock.withLock {
        dao.event(eventId)?.let { return@withLock it }
        require(type in listOf("LOADING", "UNLOADING"))
        val quantity = pallets.replace(',', '.').toBigDecimalOrNull()
        require(quantity != null && quantity.signum() > 0 && quantity <= "10000".toBigDecimal() && quantity.scale() <= 4) { "Проверьте количество паллет" }
        require(start > 0 && start <= System.currentTimeMillis() + 5 * 60_000) { "Проверьте дату и время начала" }
        require(comment.length <= 1000 && participants.isNotEmpty() && creator in participants && participants.distinct().size == participants.size)
        db.withTransaction {
            val employee = dao.employee(creator)
            require(employee?.loader == true && employee.active && employee.warehouseId == device.warehouseId) { "Этот вид работ недоступен" }
            for (id in participants) {
                val member = dao.employee(id)
                require(member?.active == true && member.warehouseId == device.warehouseId) { "Участник недоступен" }
            }
            val payload = JSONObject().put("type", type).put("startsAtMs", start).put("pallets", quantity!!.toPlainString())
                .put("participantIds", JSONArray(participants)).put("comment", comment).toString()
            Event(eventId, creator, device.id, device.warehouseId, "HANDLING", System.currentTimeMillis(), SystemClock.elapsedRealtime(),
                offset, lastSync, payload = payload).also { dao.insert(it) }
        }
    }
    suspend fun refresh(snapshot: Snapshot, device: Device) = db.withTransaction {
        require(snapshot.employees.all { it.warehouseId == device.warehouseId })
        val previous = dao.allEmployees().associateBy { it.id }
        // Missing employees become unavailable; never retain a stale active card.
        val rows = snapshot.employees.map { row ->
            val old = previous[row.id]; if (old != null && old.revision > row.revision) old else row
        }
        dao.clearEmployees(); dao.putEmployees(rows)
    }
    suspend fun acknowledge(event: Event, receipt: Receipt) = db.withTransaction {
        require(receipt.id == event.id && receipt.status in listOf("ACCEPTED", "REVIEW"))
        require(event.photoPath == null || receipt.photoStored) { "Фото ещё не подтверждено" }
        receipt.employee?.let { current ->
            require(current.id == event.employeeId && current.warehouseId == event.warehouseId)
            val old = dao.employee(current.id)
            if (old == null || current.revision >= old.revision) dao.putEmployees(listOf(current))
        }
        dao.result(event.id, receipt.status, receipt.reason)
    }
}

class Synchronizer(private val repo: AttendanceRepository, private val api: AttendanceApi) {
    private val mutex = Mutex()
    // FIX: no durable SENDING state; interruption leaves the same UUID pending for safe replay.
    suspend fun run(device: Device, onSnapshot: (Snapshot) -> Unit = {}): Boolean = mutex.withLock {
        var retry = false
        val blocked = repo.dao.reviews().filter { it.kind != "HANDLING" }.map { it.employeeId }.toMutableSet()
        for (event in repo.dao.pending()) {
            require(event.deviceId == device.id && event.warehouseId == device.warehouseId) { "Очередь относится к другой регистрации" }
            if (event.employeeId in blocked && event.kind != "HANDLING") continue
            try {
                val receipt = api.send(device, event)
                repo.acknowledge(event, receipt)
                if (receipt.status == "REVIEW" && event.kind != "HANDLING") blocked.add(event.employeeId)
            }
            catch (e: CancellationException) { throw e }
            catch (e: ApiFailure) {
                if (e.code == 401 || e.code == 403 || e.code == 404) throw e
                if (retryableHttp(e.code)) { retry = true; break }
                if (e.code in listOf(400, 409, 413, 422)) {
                    repo.dao.result(event.id, "REVIEW", "Ошибка данных HTTP ${e.code}. Требуется проверка администратора")
                    // Do not send dependent clock-out until the predecessor has been reconciled.
                    break
                }
                throw e
            } catch (e: java.io.IOException) { retry = true; break }
        }
        try {
            val snapshot = api.snapshot(device)
            repo.refresh(snapshot, device)
            for (receipt in snapshot.receipts) {
                val event = repo.dao.event(receipt.id) ?: continue
                require(event.deviceId == device.id && event.warehouseId == device.warehouseId)
                repo.acknowledge(event, receipt)
            }
            onSnapshot(snapshot)
            // A resolved predecessor allows dependent events on the following bounded retry.
            if (blocked.isNotEmpty() && repo.dao.pending().isNotEmpty() && repo.dao.reviews().none { it.kind != "HANDLING" }) retry = true
        }
        catch (e: CancellationException) { throw e }
        catch (e: ApiFailure) { if (e.code in listOf(401, 403, 404)) throw e else retry = true }
        catch (e: java.io.IOException) { retry = true }
        !retry
    }
}

class AttendanceApp : Application() {
    val store by lazy { DeviceStore(this) }
    val repo by lazy { AttendanceRepository(AttendanceDb.open(this), File(filesDir, "photos")) }
    val api: AttendanceApi by lazy { HttpAttendanceApi() }
    val sync by lazy { Synchronizer(repo, api) }
    fun schedule() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        // APPEND_OR_REPLACE avoids losing events appended while an existing worker is completing.
        WorkManager.getInstance(this).enqueueUniqueWork("attendance-upload", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
    override fun onCreate() {
        super.onCreate()
        schedule()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("attendance-recovery", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val app = applicationContext as AttendanceApp
        try {
            val device = app.store.device() ?: return@withContext Result.success()
            val success = app.sync.run(device) { app.store.time(it.serverTime, System.currentTimeMillis()) }
            app.store.syncMessage = if (success) "Связь с WMS установлена" else "Нет связи. Отметки сохранены на планшете"
            if (success) Result.success() else Result.retry()
        } catch (e: CancellationException) { throw e }
        catch (e: ApiFailure) {
            app.store.syncMessage = when (e.code) {
                401, 403 -> "Доступ устройства отключён. Очередь сохранена. Обратитесь к администратору"
                404 -> "API планшетов ещё не опубликован в WMS"
                else -> "Ошибка связи HTTP ${e.code}; очередь сохранена"
            }
            if (e.code in listOf(401, 403, 404)) Result.failure() else Result.retry()
        } catch (e: Exception) {
            app.store.syncMessage = "Не удалось синхронизировать. Очередь сохранена; требуется проверка"
            Result.retry()
        }
    }
}
