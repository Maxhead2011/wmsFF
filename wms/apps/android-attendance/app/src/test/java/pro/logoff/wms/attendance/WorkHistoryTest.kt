package pro.logoff.wms.attendance

import android.app.Application
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = Application::class)
class WorkHistoryTest {
    private val work = Event("event", "creator", "device", "moscow", "HANDLING", 1000, 1000, 0, 1000,
        payload = """{"participantIds":["creator","partner"],"type":"UNLOADING","bags":"60","pallets":"3","startsAtMs":1000}""")
    // TEST: shared work is visible for its participant, not every employee.
    @Test fun `participants can see shared work`() {
        assertTrue(belongsTo(work, "partner")); assertFalse(belongsTo(work, "other"))
        assertTrue(workDescription(work).contains("Мешки: 60"))
    }
    // TEST: local save cannot be presented as delivered or approved.
    @Test fun `delivery states are explicit`() {
        assertTrue(deliveryLabel(work).contains("Ожидает отправки"))
        assertTrue(deliveryLabel(work.copy(status = "ACCEPTED")).contains("Передано в WMS"))
        assertTrue(deliveryLabel(work.copy(status = "REVIEW")).contains("администратора"))
    }
}
