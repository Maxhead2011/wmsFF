package pro.logoff.wms.attendance

import android.app.Application
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

// TEST: verify the wire protocol, stable idempotency key and incomplete-photo rejection.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], application = Application::class)
class ApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: HttpAttendanceApi
    private lateinit var photo: File
    private val device = Device("device", "branch", "ФФ Москва", "01", "test-only-token")
    @Before fun setup() {
        server = MockWebServer(); server.start()
        api = HttpAttendanceApi(server.url("/").toString())
        photo = File(RuntimeEnvironment.getApplication().cacheDir, "api-photo.jpg").apply { writeText("test-photo") }
    }
    @After fun cleanup() { server.shutdown(); photo.delete() }
    private fun event() = Event("uuid-stable", "employee", "device", "branch", "CLOCK_IN", 1000, 100, null, null, photo.path, sha256(photo))
    private fun body(photoStored: Boolean, id: String = "uuid-stable") = """{"eventId":"$id","status":"ACCEPTED","photoStored":$photoStored,"employee":{"id":"employee","name":"Имя","warehouseId":"branch","revision":2,"openSinceMs":1000}}"""
    @Test fun `multipart contains same uuid timestamp photo hash and scoped token`() {
        repeat(2) { server.enqueue(MockResponse().setBody(body(true))); api.send(device, event()) }
        repeat(2) {
            val request = server.takeRequest()
            assertEquals("uuid-stable", request.getHeader("Idempotency-Key"))
            assertEquals("Bearer test-only-token", request.getHeader("Authorization"))
            val raw = request.body.readUtf8()
            assertTrue(raw.contains("\"capturedAtMs\":1000"))
            assertTrue(raw.contains(sha256(photo)))
            assertTrue(raw.contains("test-photo"))
        }
    }
    @Test fun `server must confirm photo and exact event before accepted`() {
        server.enqueue(MockResponse().setBody(body(false)))
        assertTrue(runCatching { api.send(device, event()) }.isFailure)
        server.enqueue(MockResponse().setBody(body(true, "different-id")))
        assertTrue(runCatching { api.send(device, event()) }.isFailure)
    }
    @Test fun `foreign branch and redirects are not accepted`() {
        server.enqueue(MockResponse().setBody("""{"deviceId":"device","warehouseId":"other","serverTimeMs":1000,"employees":[]}"""))
        assertTrue(runCatching { api.snapshot(device) }.isFailure)
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", server.url("/other")))
        assertTrue(runCatching { api.snapshot(device) }.exceptionOrNull() is ApiFailure)
        assertEquals(2, server.requestCount)
    }
    @Test fun `corrupted photograph is never sent`() {
        val event = event(); photo.appendText("changed")
        assertTrue(runCatching { api.send(device, event) }.isFailure)
        assertEquals(0, server.requestCount)
    }
}
