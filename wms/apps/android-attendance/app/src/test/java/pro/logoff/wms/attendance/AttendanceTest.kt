package pro.logoff.wms.attendance

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
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
// TEST: preserve offline shifts, camera retry and retention across supported APIs.
@Config(sdk = [26, 29, 30], application = Application::class)
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

    // TEST: lunch and mixed cargo survive offline retries and do not duplicate.
    @Test fun `handling after closed shift persists once through retry`() = runBlocking {
        val at = System.currentTimeMillis() - 60000
        mark(time = at)
        mark(id = "out", clockIn = false, time = at + 1000)
        assertNull(projectedOpen(employee, db.dao().pending()))
        repo.handling(device, employee.id, listOf(employee.id), "3", at, "UNLOADING", "", 0, at, "after-out")
        repo.handling(device, employee.id, listOf(employee.id), "3", at, "UNLOADING", "", 0, at, "after-out")
        assertEquals(1, db.dao().pending().count { it.kind == "HANDLING" })
        assertEquals("3", org.json.JSONObject(db.dao().event("after-out")!!.payload).getString("pallets"))
    }

    @Test fun `offline lunch transitions preserve shift and block double taps`() = runBlocking {
        mark()
        val at = 1_790_001_000_000L
        repo.mark(device, employee.id, false, photo(), at, 1, 0, at-1000, "lunch", "BREAK_START")
        assertEquals(at, projectedBreak(employee, db.dao().pending()))
        assertNotNull(projectedOpen(employee, db.dao().pending()))
        assertTrue(runCatching { repo.mark(device, employee.id, false, photo(), at+1, 1, 0, at, "duplicate", "BREAK_START") }.isFailure)
        repo.mark(device, employee.id, true, photo(), at+60000, 1, 0, at, "return", "BREAK_END")
        assertNull(projectedBreak(employee, db.dao().pending()))
        assertNotNull(projectedOpen(employee, db.dao().pending()))
    }
    @Test fun `mixed handling retains all four counts and direction`() = runBlocking {
        val at = System.currentTimeMillis()-1000
        val event = repo.handling(device, employee.id, listOf(employee.id), "1.5", at, "LOADING", "", 0, at, "mixed", "16", "5", "30")
        val payload = org.json.JSONObject(event.payload)
        assertEquals("1.5",payload.getString("pallets")); assertEquals("16",payload.getString("boxes"))
        assertEquals("5",payload.getString("bags")); assertEquals("30",payload.getString("rolls"))
        assertEquals("LOADING",payload.getString("type"))
    }
    @Test fun `rolls only accepted but fractional boxes rejected`() = runBlocking {
        val at = System.currentTimeMillis()-1000
        repo.handling(device, employee.id, listOf(employee.id), "", at, "UNLOADING", "", 0, at, "rolls", rolls="30")
        assertTrue(runCatching { repo.handling(device, employee.id, listOf(employee.id), "", at, "LOADING", "", 0, at, "fraction", boxes="0.5") }.isFailure)
    }
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
    // TEST: real Room receipt updates succeed without uploading the private image.
    @Test fun `accepted receipt keeps photo local without requiring photoStored`() = runBlocking {
        val event = mark()
        repo.acknowledge(event, Receipt(event.id, "ACCEPTED", "", employee, false))
        assertEquals("ACCEPTED", repo.dao.event(event.id)?.status)
        assertTrue(File(event.photoPath!!).isFile)
    }
    @Test fun `35 day cleanup deletes photos including pending but preserves events`() = runBlocking {
        val event = mark()
        repo.cleanupPhotos(event.capturedAt + PHOTO_RETENTION_MS - 1)
        assertTrue(File(event.photoPath!!).exists())
        repo.cleanupPhotos(event.capturedAt + PHOTO_RETENTION_MS)
        assertFalse(File(event.photoPath).exists())
        assertEquals(event, repo.dao.event(event.id))
        repo.cleanupPhotos(event.capturedAt + PHOTO_RETENTION_MS + 1)
        val api = FakeApi(employee)
        assertTrue(Synchronizer(repo, api).run(device))
        assertEquals("ACCEPTED", repo.dao.event(event.id)?.status)
    }
    @Test fun `photo retrieval is explicit scoped and expires after 35 days`() = runBlocking {
        val event = mark()
        val api = FakeApi(employee)
        Synchronizer(repo, api).run(device)
        assertTrue(api.photos.isEmpty())
        val request = PhotoRequest("request-1", event.id)
        repo.answerPhoto(device, request, api, event.capturedAt + 25 + PHOTO_RETENTION_MS - 1)
        assertEquals(listOf("AVAILABLE"), api.photos)
        repo.answerPhoto(device, request, api, event.capturedAt + 25 + PHOTO_RETENTION_MS)
        assertEquals(listOf("AVAILABLE", "EXPIRED"), api.photos)
        assertTrue(runCatching { repo.answerPhoto(device.copy(id = "foreign"), request, api, event.capturedAt) }.isFailure)
        assertEquals(2, api.photos.size)
    }
    @Test fun `camera failure creates no mark and save retry reuses photo`() = runBlocking {
        val operation = AutomaticPhotoOperation()
        var captures = 0
        var saves = 0
        assertTrue(runCatching {
            operation.run({ captures++; throw IOException("camera unavailable") }, { saves++ })
        }.isFailure)
        assertEquals(0, saves)
        val photo = photo()
        assertTrue(runCatching { operation.run({ captures++; photo }, { saves++; throw IOException("disk full") }) }.isFailure)
        operation.run({ error("must not recapture") }, { saves++; mark() })
        operation.run({ error("completed") }, { error("duplicate") })
        assertEquals(2, captures)
        assertEquals(2, saves)
        assertEquals(1, repo.dao.pending().size)
    }
    @Test fun `two simultaneous taps capture and commit only once`() = runBlocking {
        val operation = AutomaticPhotoOperation()
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        var captures = 0
        val first = launch {
            operation.run({ captures++; started.complete(Unit); finish.await(); photo() }, { mark() })
        }
        started.await()
        operation.run({ error("second capture") }, { error("second mark") })
        finish.complete(Unit); first.join()
        assertEquals(1, captures)
        assertEquals(1, repo.dao.pending().size)
    }
    private class FakeApi(private val employee: Employee) : AttendanceApi {
        var error: Exception? = null
        val sent = mutableListOf<String>()
        val photos = mutableListOf<String>()
        override fun photo(device: Device, request: PhotoRequest, event: Event, file: File?, status: String) {
            assertEquals(status == "AVAILABLE", file != null)
            photos += status
        }
        override fun register(code: String, name: String): Device = error("unused")
        override fun snapshot(device: Device) = Snapshot(listOf(employee.copy(revision = 2, openSince = 1000)), 1000)
        override fun send(device: Device, event: Event): Receipt {
            sent += event.id; error?.let { throw it }
            return Receipt(event.id, "ACCEPTED", "", employee.copy(revision = 2, openSince = 1000), true)
        }
    }
}
