package pro.logoff.wms.attendance

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.util.UUID

// TEST: exercise actual Room transactions and the durable queue, not a mirror of the implementation.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], application = Application::class)
class AttendanceTest {
    private lateinit var db: AttendanceDb
    private lateinit var repo: AttendanceRepository
    private lateinit var root: File
    private val device = Device("tablet-1", "moscow", "ФФ Москва", "01", "test-token")
    private val employee = Employee("employee-uuid", "Эдик", "moscow", true)
    @Before fun setup() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        root = File(context.cacheDir, UUID.randomUUID().toString()).apply { mkdirs() }
        db = Room.inMemoryDatabaseBuilder(context, AttendanceDb::class.java).allowMainThreadQueries().build()
        repo = AttendanceRepository(db, File(root, "photos"))
        db.dao().putEmployees(listOf(employee))
    }
    @After fun cleanup() { db.close(); root.deleteRecursively() }
    private fun photo() = File(root, "capture.jpg").apply { writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3)) }
    private suspend fun mark(id: String = "event-in", clockIn: Boolean = true, time: Long = 1_790_000_000_000): Event =
        repo.mark(device, employee.id, clockIn, photo(), time, 123456, 25, time - 10_000, id)

    @Test fun `capture timestamp and photo survive new repository instance`() = runBlocking {
        val event = mark()
        val reloaded = AttendanceRepository(db, File(root, "photos")).dao.pending().single()
        assertEquals(1_790_000_000_000, reloaded.capturedAt)
        assertEquals(event.id, reloaded.id)
        assertEquals(reloaded.photoHash, sha256(File(reloaded.photoPath!!)))
    }
    @Test fun `same event id creates exactly one mark`() = runBlocking {
        mark(); mark()
        assertEquals(1, db.dao().pending().size)
    }
    @Test fun `double tap with new id does not open two shifts`() = runBlocking {
        mark()
        assertTrue(runCatching { mark("other") }.isFailure)
        assertEquals(1, db.dao().pending().size)
    }
    @Test fun `offline arrival departure and another arrival remain separate`() = runBlocking {
        mark()
        mark("out", false, 1_790_010_000_000)
        mark("in2", true, 1_790_020_000_000)
        assertEquals(3, db.dao().pending().size)
        assertEquals(1_790_020_000_000, projectedOpen(employee, db.dao().pending()))
    }
    @Test fun `foreign branch employee and missing photo rejected`() = runBlocking {
        db.dao().putEmployees(listOf(employee.copy(warehouseId = "noginsk")))
        assertTrue(runCatching { mark() }.isFailure)
        assertTrue(runCatching { repo.mark(device, employee.id, true, File(root, "absent"), 1000, 1, null, null) }.isFailure)
        assertTrue(db.dao().pending().isEmpty())
    }
    @Test fun `handling preserves exact decimal quantity and participants`() = runBlocking {
        val helper = employee.copy(id = "helper", loader = false)
        db.dao().putEmployees(listOf(helper))
        val event = repo.handling(device, employee.id, listOf(employee.id, helper.id), "1,25", 1000, "UNLOADING", "тест", null, null, "loading-1")
        assertTrue(event.payload.contains("1.25"))
        assertTrue(event.payload.contains("helper"))
        assertTrue(runCatching { repo.handling(device, employee.id, listOf("foreign"), "2", 1000, "LOADING", "", null, null, "bad") }.isFailure)
    }
    @Test fun `network failure leaves same uuid ready after restart`() = runBlocking {
        val event = mark()
        val api = FakeApi(employee)
        api.error = IOException("connection lost")
        assertFalse(Synchronizer(repo, api).run(device))
        assertEquals(event.id, db.dao().pending().single().id)
        api.error = null
        assertTrue(Synchronizer(repo, api).run(device))
        assertTrue(db.dao().pending().isEmpty())
        assertEquals(listOf(event.id, event.id), api.sent)
    }
    @Test fun `429 is retried and revocation retains the outbox`() = runBlocking {
        mark()
        val api = FakeApi(employee)
        api.error = ApiFailure(429)
        assertFalse(Synchronizer(repo, api).run(device))
        assertEquals(1, db.dao().pending().size)
        api.error = ApiFailure(401)
        assertTrue(runCatching { Synchronizer(repo, api).run(device) }.exceptionOrNull() is ApiFailure)
        assertEquals(1, db.dao().pending().size)
    }
    @Test fun `receipt cannot acknowledge another event`() = runBlocking {
        val event = mark()
        assertTrue(runCatching { repo.acknowledge(event, Receipt("other", "ACCEPTED", "", employee)) }.isFailure)
        assertEquals(1, db.dao().pending().size)
    }
    @Test fun `refresh removes stale employees and protects newer revision`() = runBlocking {
        db.dao().putEmployees(listOf(employee.copy(revision = 5, openSince = 500)))
        repo.refresh(Snapshot(listOf(employee.copy(revision = 4)), 1000), device)
        assertEquals(500L, db.dao().employee(employee.id)?.openSince)
        repo.refresh(Snapshot(emptyList(), 1000), device)
        assertTrue(db.dao().allEmployees().isEmpty())
    }
    @Test fun `file based Room survives close and reopen with a pending event`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val name = "persist-${UUID.randomUUID()}.db"
        var disk = Room.databaseBuilder(context, AttendanceDb::class.java, name).allowMainThreadQueries().build()
        val event = mark()
        disk.dao().insert(event); disk.close()
        disk = Room.databaseBuilder(context, AttendanceDb::class.java, name).allowMainThreadQueries().build()
        assertEquals(event, disk.dao().pending().single())
        disk.close(); context.deleteDatabase(name); Unit
    }
    @Test fun `reviewed arrival blocks dependent departure across worker restarts`() = runBlocking {
        val incoming = mark()
        mark("out", false, incoming.capturedAt + 60_000)
        repo.acknowledge(incoming, Receipt(incoming.id, "REVIEW", "Конфликт", employee, true))
        val api = FakeApi(employee)
        Synchronizer(repo, api).run(device)
        assertTrue(api.sent.isEmpty())
        assertEquals("out", db.dao().pending().single().id)
    }
    private class FakeApi(private val employee: Employee) : AttendanceApi {
        var error: Exception? = null
        val sent = mutableListOf<String>()
        override fun register(code: String, name: String): Device = error("unused")
        override fun snapshot(device: Device) = Snapshot(listOf(employee.copy(revision = 2, openSince = 1000)), 1000)
        override fun send(device: Device, event: Event): Receipt {
            sent += event.id; error?.let { throw it }
            return Receipt(event.id, "ACCEPTED", "", employee.copy(revision = 2, openSince = 1000), true)
        }
    }
}
